import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ApiError, errors } from '../errors.js';
import {
  CHUNK_BYTES,
  MAX_PARTS,
  MAX_TRANSFERS_PER_CLIENT,
  PNG_MIME,
  PNG_SIGNATURE,
  PURPOSES,
  UPLOAD_TTL_MS,
  clientScopeKey,
  normalizeDigest,
  opaqueId,
  publicDigestHeader,
  storageKey
} from './constants.js';
import { MemoryObjectRepository } from './repository.js';

const invalid = (details) => errors.invalid(details);
const conflict = (code, message, details) => new ApiError(409, code, message, { details });
const verification = (details) => new ApiError(422, 'object_verification_failed', 'Object verification failed.', { details });
const storageFailure = () => new ApiError(503, 'object_storage_unavailable', 'Object storage is temporarily unavailable.', { retryable: true });
const expired = () => new ApiError(410, 'upload_expired', 'Upload has expired.');
const transferLimit = () => new ApiError(429, 'object_transfer_limit', 'Concurrent object transfer limit reached.', { details: { limit: MAX_TRANSFERS_PER_CLIENT }, retryable: true });

function projection(row) {
  return {
    objectId: row.objectId,
    digest: row.digest,
    bytes: row.bytes,
    mimeType: row.mimeType,
    purpose: row.purpose
  };
}

async function* sourceChunks(source) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) { yield Buffer.from(source); return; }
  for await (const chunk of source) yield Buffer.from(chunk);
}

async function drain(source) { for await (const _chunk of sourceChunks(source)) { /* consume request */ } }

export class ObjectService {
  constructor({ storage, repository = new MemoryObjectRepository(), clock = () => new Date(), unreferencedGraceMs = 30 * 86400000 } = {}) {
    if (!storage) throw new TypeError('Object storage is required');
    this.storage = storage;
    this.repository = repository;
    this.clock = clock;
    this.unreferencedGraceMs = unreferencedGraceMs;
    this.locks = new Map();
  }

  now() { return this.clock(); }

  async #locked(key, operation) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.locks.set(key, current);
    await previous;
    try { return await operation(); }
    finally { release(); if (this.locks.get(key) === current) this.locks.delete(key); }
  }

  async createUpload(scope, descriptor) {
    const digest = normalizeDigest(descriptor?.digest);
    if (!digest) throw invalid({ field: 'digest' });
    if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < PNG_SIGNATURE.length) throw invalid({ field: 'bytes' });
    if (descriptor.mimeType !== PNG_MIME) throw invalid({ field: 'mimeType', allowed: [PNG_MIME] });
    if (!PURPOSES.includes(descriptor.purpose)) throw invalid({ field: 'purpose', allowed: PURPOSES });
    const partCount = Math.ceil(descriptor.bytes / CHUNK_BYTES);
    if (partCount > MAX_PARTS) throw invalid({ field: 'bytes', technicalLimit: CHUNK_BYTES * MAX_PARTS, action: 'reduce-object-size' });

    return this.#locked(clientScopeKey(scope), async () => {
      if (await this.repository.activeUploads(scope, this.now())) {
        const active = await this.repository.activeUploads(scope, this.now());
        if (active >= MAX_TRANSFERS_PER_CLIENT) throw transferLimit();
      }
      const createdAt = this.now();
      const row = await this.repository.createUpload({
        uploadId: opaqueId('upl'), accountId: scope.accountId, spaceId: scope.spaceId, clientId: scope.clientId,
        digest, bytes: descriptor.bytes, mimeType: descriptor.mimeType, purpose: descriptor.purpose,
        status: 'open', createdAt, expiresAt: new Date(createdAt.getTime() + UPLOAD_TTL_MS), parts: new Map(), objectId: null
      });
      return this.uploadStatus(scope, row.uploadId);
    });
  }

  async #requireUpload(scope, uploadId, { allowComplete = false } = {}) {
    const row = await this.repository.getUpload(scope, uploadId);
    if (!row) throw errors.notFound();
    if (row.expiresAt <= this.now() && ['open', 'completing'].includes(row.status)) {
      row.status = 'expired';
      await this.repository.updateUpload(row);
      throw expired();
    }
    if (row.status === 'complete' && allowComplete) return row;
    if (row.status !== 'open') throw errors.notFound();
    return row;
  }

  async uploadStatus(scope, uploadId) {
    const row = await this.#requireUpload(scope, uploadId, { allowComplete: true });
    return {
      uploadId: row.uploadId,
      chunkBytes: CHUNK_BYTES,
      maxParts: MAX_PARTS,
      expiresAt: row.expiresAt.toISOString(),
      status: row.status,
      completedParts: [...row.parts.values()].sort((a, b) => a.partNumber - b.partNumber).map(({ partNumber, digest, bytes }) => ({ partNumber, digest, bytes })),
      ...(row.objectId ? { objectId: row.objectId } : {})
    };
  }

  async putPart(scope, uploadId, partNumber, suppliedDigest, source) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) throw invalid({ field: 'partNumber' });
    const digest = normalizeDigest(suppliedDigest);
    if (!digest) throw invalid({ field: 'content-digest' });
    return this.#locked(`upload:${uploadId}`, async () => {
      const upload = await this.#requireUpload(scope, uploadId);
      const expectedParts = Math.ceil(upload.bytes / CHUNK_BYTES);
      if (partNumber > expectedParts) { await drain(source); throw invalid({ field: 'partNumber' }); }
      const expectedBytes = partNumber === expectedParts ? upload.bytes - (partNumber - 1) * CHUNK_BYTES : CHUNK_BYTES;
      const chunks = [];
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of sourceChunks(source)) {
        bytes += chunk.length;
        if (bytes > CHUNK_BYTES || bytes > expectedBytes) throw invalid({ field: 'body', maxBytes: expectedBytes });
        hash.update(chunk); chunks.push(chunk);
      }
      const actualDigest = `sha256:${hash.digest('hex')}`;
      if (bytes !== expectedBytes) throw verification({ reason: 'length', expected: expectedBytes, actual: bytes });
      if (actualDigest !== digest) throw verification({ reason: 'part-digest' });
      const existing = upload.parts.get(partNumber);
      if (existing) {
        if (existing.digest !== digest || existing.bytes !== bytes) throw conflict('part_conflict', 'Part number was already uploaded with different content.');
        return { partNumber, digest, bytes, replayed: true };
      }
      const key = storageKey('parts');
      try { await this.storage.put(key, Buffer.concat(chunks)); }
      catch { throw storageFailure(); }
      upload.parts.set(partNumber, { partNumber, digest, bytes, storageKey: key });
      await this.repository.updateUpload(upload);
      return { partNumber, digest, bytes, replayed: false };
    });
  }

  async completeUpload(scope, uploadId) {
    return this.#locked(`upload:${uploadId}`, async () => {
      const upload = await this.#requireUpload(scope, uploadId, { allowComplete: true });
      if (upload.status === 'complete') return projection(await this.repository.getObject(scope, upload.objectId));
      const expectedParts = Math.ceil(upload.bytes / CHUNK_BYTES);
      if (upload.parts.size !== expectedParts || Array.from({ length: expectedParts }, (_, index) => upload.parts.has(index + 1)).includes(false)) {
        throw conflict('upload_incomplete', 'Upload does not contain every required part.', { expectedParts, completedParts: upload.parts.size });
      }
      upload.status = 'completing';
      await this.repository.updateUpload(upload);
      const finalKey = storageKey('objects');
      const hash = createHash('sha256');
      let bytes = 0;
      let signature = Buffer.alloc(0);
      const service = this;
      async function* verifiedParts() {
        for (let number = 1; number <= expectedParts; number += 1) {
          const stream = await service.storage.open(upload.parts.get(number).storageKey);
          for await (const value of stream) {
            const chunk = Buffer.from(value);
            if (signature.length < PNG_SIGNATURE.length) signature = Buffer.concat([signature, chunk.subarray(0, PNG_SIGNATURE.length - signature.length)]);
            bytes += chunk.length; hash.update(chunk); yield chunk;
          }
        }
      }
      try { await this.storage.put(finalKey, verifiedParts()); }
      catch {
        upload.status = 'open'; await this.repository.updateUpload(upload);
        await this.storage.delete(finalKey).catch(() => {});
        throw storageFailure();
      }
      const actualDigest = `sha256:${hash.digest('hex')}`;
      if (bytes !== upload.bytes || actualDigest !== upload.digest || !signature.equals(PNG_SIGNATURE)) {
        upload.status = 'open'; await this.repository.updateUpload(upload);
        await this.storage.delete(finalKey).catch(() => {});
        throw verification({ reason: !signature.equals(PNG_SIGNATURE) ? 'png-signature' : bytes !== upload.bytes ? 'length' : 'digest' });
      }
      const committedAt = this.now();
      const objectData = {
        objectId: opaqueId('obj'), accountId: scope.accountId, spaceId: scope.spaceId,
        digest: upload.digest, bytes, mimeType: upload.mimeType, purpose: upload.purpose,
        storageKey: finalKey, committedAt, unreferencedAt: committedAt, retainUntil: null
      };
      let object;
      try {
        object = this.repository.commitObject
          ? await this.repository.commitObject(upload, objectData)
          : await this.repository.createObject(objectData);
        upload.status = 'complete'; upload.objectId = object.objectId;
        if (!this.repository.commitObject) await this.repository.updateUpload(upload);
      } catch (error) {
        upload.status = 'open'; upload.objectId = null;
        await this.repository.updateUpload(upload).catch(() => {});
        await this.storage.delete(finalKey).catch(() => {});
        throw storageFailure();
      }
      await Promise.all([...upload.parts.values()].map((part) => this.storage.delete(part.storageKey).catch(() => {})));
      return projection(object);
    });
  }

  async cancelUpload(scope, uploadId) {
    return this.#locked(`upload:${uploadId}`, async () => {
      const upload = await this.repository.getUpload(scope, uploadId);
      if (!upload) throw errors.notFound();
      if (upload.status === 'complete') return { uploadId, status: 'complete', cancelled: false };
      if (upload.status === 'cancelled' || upload.status === 'expired') return { uploadId, status: upload.status, cancelled: false };
      upload.status = 'cancelled'; await this.repository.updateUpload(upload);
      await Promise.all([...upload.parts.values()].map((part) => this.storage.delete(part.storageKey).catch(() => {})));
      return { uploadId, status: 'cancelled', cancelled: true };
    });
  }

  async metadata(scope, objectId) {
    const object = await this.repository.getObject(scope, objectId);
    if (!object) throw errors.notFound();
    return Object.freeze({ objectId: object.objectId, digest: object.digest, bytes: object.bytes, mimeType: object.mimeType, purpose: object.purpose });
  }

  async download(scope, objectId, rangeHeader) {
    const object = await this.repository.getObject(scope, objectId);
    if (!object) throw errors.notFound();
    let start = 0; let end = object.bytes - 1; let partial = false;
    if (rangeHeader !== undefined) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (!match || (!match[1] && !match[2])) throw new ApiError(416, 'invalid_range', 'Requested range is not satisfiable.');
      if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, object.bytes - suffix); }
      else { start = Number(match[1]); if (match[2]) end = Number(match[2]); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= object.bytes || end < start) throw new ApiError(416, 'invalid_range', 'Requested range is not satisfiable.');
      end = Math.min(end, object.bytes - 1); partial = true;
    }
    let stream;
    try {
      stream = await this.storage.open(object.storageKey);
      if (start || end !== object.bytes - 1) stream = Readable.from(sliceStream(stream, start, end));
    } catch { throw storageFailure(); }
    return { stream, object: projection(object), start, end, partial, digestHeader: publicDigestHeader(object.digest) };
  }

  async setReferences(scope, referenceId, objectIds, { retainUntil = null } = {}) {
    if (typeof referenceId !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(referenceId)) throw invalid({ field: 'referenceId' });
    if (!Array.isArray(objectIds) || objectIds.length > 100 || new Set(objectIds).size !== objectIds.length) throw invalid({ field: 'objectIds' });
    const objects = await Promise.all(objectIds.map((id) => this.repository.getObject(scope, id)));
    if (objects.some((row) => !row)) throw errors.notFound();
    const deadline = retainUntil === null ? null : new Date(retainUntil);
    if (deadline && Number.isNaN(deadline.getTime())) throw invalid({ field: 'retainUntil' });
    const previous = await this.repository.replaceReferences(scope, referenceId, objects.map((row) => ({ referenceId, objectId: row.objectId, retainUntil: deadline })));
    for (const row of objects) { row.unreferencedAt = null; if (deadline && (!row.retainUntil || row.retainUntil < deadline)) row.retainUntil = deadline; }
    const currentIds = new Set(objects.map((row) => row.objectId));
    for (const prior of previous) {
      if (currentIds.has(prior.objectId)) continue;
      const row = await this.repository.getObject(scope, prior.objectId);
      if (row && !(await this.repository.referencesForObject(scope, row.objectId)).length) row.unreferencedAt = this.now();
    }
    return { referenceId, complete: true, objects: objects.map(projection) };
  }

  async deleteReferences(scope, referenceId) {
    await this.repository.deleteReferences(scope, referenceId);
    const now = this.now();
    for (const row of await this.repository.objectsForScope(scope)) if (!(await this.repository.referencesForObject(scope, row.objectId)).length && !row.unreferencedAt) row.unreferencedAt = now;
    return { referenceId, deleted: true };
  }

  async completeness(scope, objectIds) {
    if (!Array.isArray(objectIds) || objectIds.length > 100) throw invalid({ field: 'objectIds' });
    const committed = [];
    for (const objectId of objectIds) if (await this.repository.getObject(scope, objectId)) committed.push(objectId);
    return { complete: committed.length === objectIds.length, committedCount: committed.length, requiredCount: objectIds.length };
  }

  async usage(scope) {
    const objects = await this.repository.objectsForScope(scope);
    const refs = await this.repository.allReferences(scope);
    const referencedIds = new Set(refs.map((row) => row.objectId));
    const now = this.now();
    const incompleteUploads = (await this.repository.incompleteUploadsForScope(scope, now)).length;
    return {
      objectCount: objects.length,
      objectBytes: objects.reduce((sum, row) => sum + row.bytes, 0),
      referencedBytes: objects.filter((row) => referencedIds.has(row.objectId)).reduce((sum, row) => sum + row.bytes, 0),
      incompleteUploads,
      observedAt: now.toISOString(),
      quota: null
    };
  }

  async cleanup({ now = this.now(), backupRetainUntil = null } = {}) {
    let expiredUploads = 0; let deletedObjects = 0;
    for (const upload of await this.repository.expiredUploads(now)) {
      upload.status = 'expired'; await this.repository.updateUpload(upload); expiredUploads += 1;
      await Promise.all([...upload.parts.values()].map((part) => this.storage.delete(part.storageKey).catch(() => {})));
    }
    for (const object of await this.repository.allObjects()) {
      const refs = await this.repository.referencesForObject(object, object.objectId);
      const graceEnd = object.unreferencedAt && new Date(object.unreferencedAt.getTime() + this.unreferencedGraceMs);
      const retained = (object.retainUntil && object.retainUntil > now) || (backupRetainUntil && backupRetainUntil > now);
      if (!refs.length && graceEnd && graceEnd <= now && !retained) {
        try { await this.storage.delete(object.storageKey); }
        catch { continue; }
        await this.repository.deleteObject(object); deletedObjects += 1;
      }
    }
    return { expiredUploads, deletedObjects };
  }
}

async function* sliceStream(source, start, end) {
  let offset = 0;
  for await (const value of source) {
    const chunk = Buffer.from(value); const chunkEnd = offset + chunk.length - 1;
    if (chunkEnd >= start && offset <= end) yield chunk.subarray(Math.max(0, start - offset), Math.min(chunk.length, end - offset + 1));
    offset += chunk.length;
    if (offset > end) break;
  }
}
