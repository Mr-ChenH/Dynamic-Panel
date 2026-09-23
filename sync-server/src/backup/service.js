import { randomUUID } from 'node:crypto';
import { decryptAesGcm, encryptAesGcm, newDataKey, sha256, unwrapDataKey, verificationError, wrapDataKey } from './crypto.js';
import { selectRetention, validateRetention } from './retention.js';
import { assertNoPlaintextSecrets } from './security.js';

const FORMAT_VERSION = 1;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

function json(value) { return Buffer.from(JSON.stringify(value)); }
function parse(value, reason) {
  try { return JSON.parse(value.toString('utf8')); }
  catch (error) { throw verificationError(reason, error); }
}
function pointPrefix(id) { return `points/${id}`; }
function metadata(envelope) {
  return Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'ciphertext'));
}
function assertManifest(value, expectedId) {
  if (value?.formatVersion !== FORMAT_VERSION || value.manifestId !== expectedId || !Array.isArray(value.entries)) {
    throw verificationError('invalid_manifest');
  }
  return value;
}

function objectEntries(snapshot) {
  const entries = snapshot.objectEntries ?? (Array.isArray(snapshot.objects) ? snapshot.objects : snapshot.objects?.items) ?? [];
  if (!Array.isArray(entries)) throw new TypeError('snapshot object entries must be an array');
  return entries;
}
function objectMetadata(entry) {
  const { body, bytes: declaredBytes, open, read, ...value } = entry;
  return { ...value, ...(declaredBytes === undefined ? {} : { bytes: declaredBytes }) };
}
async function bufferFrom(value) {
  const resolved = await value;
  if (Buffer.isBuffer(resolved) || resolved instanceof Uint8Array) return Buffer.from(resolved);
  if (!resolved || typeof resolved[Symbol.asyncIterator] !== 'function') throw new TypeError('backup object reader must return bytes or an async iterable');
  const chunks = [];
  for await (const chunk of resolved) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function readObject(entry, snapshot, source) {
  if (entry.body !== undefined) return bufferFrom(entry.body);
  if (typeof entry.read === 'function') return bufferFrom(entry.read());
  if (typeof entry.open === 'function') return bufferFrom(entry.open());
  const reader = snapshot.objectSource ?? source;
  if (typeof reader?.readObject === 'function') return bufferFrom(reader.readObject(entry));
  if (typeof reader?.openObject === 'function') return bufferFrom(reader.openObject(entry));
  throw Object.assign(new Error('Object storage is required to back up referenced objects'), { code: 'OBJECT_STORAGE_UNAVAILABLE' });
}
function validateObjectBytes(descriptor, body) {
  if (descriptor.bytes !== undefined && Number(descriptor.bytes) !== body.length) throw verificationError('object_size_mismatch');
  if (descriptor.digest) {
    const digest = String(descriptor.digest).replace(/^sha256:/, '');
    if (digest !== sha256(body)) throw verificationError('object_digest_mismatch');
  }
}

export class BackupService {
  constructor({ source, target, masterKey, keyId, clock = () => new Date(), id = randomUUID, chunkBytes = DEFAULT_CHUNK_BYTES, retention, timeZone = 'UTC', production = false }) {
    if (!source || !target || !masterKey || !keyId) throw new TypeError('source, target, masterKey, and keyId are required');
    this.source = source;
    this.target = target;
    this.masterKey = masterKey;
    this.keyId = keyId;
    this.clock = clock;
    this.id = id;
    this.chunkBytes = chunkBytes;
    this.retention = validateRetention(retention, { production });
    this.timeZone = timeZone;
  }

  async create({ scope = { type: 'server' }, reason = 'scheduled' } = {}) {
    const manifestId = this.id();
    const temporary = `temporary/${manifestId}`;
    const dataKey = newDataKey();
    let snapshot;
    try {
      snapshot = await this.source.snapshot({ scope, readOnly: true, isolation: 'repeatable-read' });
      assertNoPlaintextSecrets(snapshot.data ?? snapshot);
      const payload = json(snapshot.data ?? snapshot);
      const entries = [];
      for (let offset = 0, index = 0; offset < payload.length || (payload.length === 0 && index === 0); offset += this.chunkBytes, index += 1) {
        const plain = payload.subarray(offset, Math.min(offset + this.chunkBytes, payload.length));
        const entryPath = `chunks/${String(index + 1).padStart(6, '0')}.json.enc`;
        const aad = `${manifestId}:${entryPath}`;
        const encrypted = encryptAesGcm(plain, dataKey, { aad });
        await this.target.put(`${temporary}/${entryPath}`, encrypted.ciphertext);
        entries.push({ path: entryPath, kind: 'logical', schema: snapshot.databaseSchema ?? 1, ...metadata(encrypted), aad });
      }
      const objects = objectEntries(snapshot);
      let objectBytes = 0;
      for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
        const descriptor = objectMetadata(objects[objectIndex]);
        assertNoPlaintextSecrets(descriptor);
        const body = await readObject(objects[objectIndex], snapshot, this.source);
        validateObjectBytes(descriptor, body);
        objectBytes += body.length;
        const artifactId = String(objectIndex + 1).padStart(6, '0');
        for (let offset = 0, chunkIndex = 0; offset < body.length || (body.length === 0 && chunkIndex === 0); offset += this.chunkBytes, chunkIndex += 1) {
          const plain = body.subarray(offset, Math.min(offset + this.chunkBytes, body.length));
          const entryPath = `objects/${artifactId}/${String(chunkIndex + 1).padStart(6, '0')}.bin.enc`;
          const aad = `${manifestId}:${entryPath}`;
          const encrypted = encryptAesGcm(plain, dataKey, { aad });
          await this.target.put(`${temporary}/${entryPath}`, encrypted.ciphertext);
          entries.push({ path: entryPath, kind: 'object', artifactId, object: descriptor, ...metadata(encrypted), aad });
        }
      }
      const wrappedKey = wrapDataKey(dataKey, this.masterKey, this.keyId);
      const manifest = {
        formatVersion: FORMAT_VERSION,
        manifestId,
        instanceId: snapshot.instanceId ?? null,
        createdAt: this.clock().toISOString(),
        reason,
        scope,
        databaseSchema: snapshot.databaseSchema ?? 1,
        protocol: snapshot.protocol ?? 1,
        spaces: snapshot.spaces ?? [],
        entries,
        objects: { count: objects.length, bytes: objectBytes },
        encryption: { algorithm: 'AES-256-GCM', keyId: this.keyId }
      };
      const manifestEnvelope = encryptAesGcm(json(manifest), dataKey, { aad: `${manifestId}:manifest` });
      const manifestRecord = { ...metadata(manifestEnvelope), ciphertext: manifestEnvelope.ciphertext.toString('base64'), wrappedKey };
      await this.target.put(`${temporary}/manifest.enc.json`, json(manifestRecord));
      await this.verifyAt(temporary, manifestId);

      const destination = pointPrefix(manifestId);
      for (const key of await this.target.list(`${temporary}/`)) {
        await this.target.move(key, key.replace(`${temporary}/`, `${destination}/`));
      }
      const marker = {
        formatVersion: FORMAT_VERSION,
        manifestId,
        manifestCipherSha256: manifestEnvelope.cipherSha256,
        committedAt: this.clock().toISOString()
      };
      await this.target.put(`${destination}/COMMITTED.json`, json(marker));
      await this.verify(manifestId);
      return { id: manifestId, manifestId, createdAt: manifest.createdAt, status: 'verified', reason, scope };
    } catch (error) {
      for (const key of await this.target.list(`${temporary}/`).catch(() => [])) await this.target.delete(key).catch(() => {});
      throw error;
    } finally {
      await snapshot?.release?.();
    }
  }

  async verifyAt(prefix, manifestId, expectedDigest) {
    const record = parse(await this.target.get(`${prefix}/manifest.enc.json`), 'invalid_manifest_envelope');
    if (expectedDigest && record.cipherSha256 !== expectedDigest) throw verificationError('commit_marker_mismatch');
    if (!record.wrappedKey) throw verificationError('missing_wrapped_key');
    const dataKey = unwrapDataKey(record.wrappedKey, this.masterKey);
    const manifest = assertManifest(parse(decryptAesGcm(record, dataKey, { aad: `${manifestId}:manifest` }), 'invalid_manifest'), manifestId);
    if (manifest.encryption.keyId !== record.wrappedKey.keyId) throw verificationError('key_id_mismatch');
    const chunks = [];
    const objectChunks = new Map();
    for (const entry of manifest.entries) {
      if (!['logical', 'object'].includes(entry.kind)) throw verificationError('invalid_entry_kind');
      const ciphertext = await this.target.get(`${prefix}/${entry.path}`).catch((error) => { throw verificationError('missing_entry', error); });
      const plain = decryptAesGcm({ ...entry, ciphertext }, dataKey, { aad: entry.aad });
      if (entry.kind === 'logical') chunks.push(plain);
      else {
        if (!entry.artifactId || !entry.object) throw verificationError('invalid_object_entry');
        const artifact = objectChunks.get(entry.artifactId) ?? { descriptor: entry.object, chunks: [] };
        if (JSON.stringify(artifact.descriptor) !== JSON.stringify(entry.object)) throw verificationError('object_metadata_mismatch');
        artifact.chunks.push(plain);
        objectChunks.set(entry.artifactId, artifact);
      }
    }
    const data = parse(Buffer.concat(chunks), 'invalid_logical_data');
    const objects = [...objectChunks.values()].map(({ descriptor, chunks: parts }) => {
      const bytes = Buffer.concat(parts);
      validateObjectBytes(descriptor, bytes);
      return { metadata: descriptor, bytes };
    });
    const expectedObjects = manifest.objects ?? { count: 0, bytes: 0 };
    if (objects.length !== expectedObjects.count || objects.reduce((sum, item) => sum + item.bytes.length, 0) !== expectedObjects.bytes) throw verificationError('object_inventory_mismatch');
    await this.source.validateSnapshot?.(data, manifest, objects);
    return { manifest, data, objects };
  }

  async verify(manifestId) {
    const prefix = pointPrefix(manifestId);
    const marker = parse(await this.target.get(`${prefix}/COMMITTED.json`).catch((error) => { throw verificationError('missing_commit_marker', error); }), 'invalid_commit_marker');
    if (marker.manifestId !== manifestId) throw verificationError('commit_marker_mismatch');
    const result = await this.verifyAt(prefix, manifestId, marker.manifestCipherSha256);
    return { ...result, status: 'verified' };
  }

  async list() {
    const keys = await this.target.list('points/');
    const ids = [...new Set(keys.filter((key) => key.endsWith('/COMMITTED.json')).map((key) => key.split('/')[1]))];
    const points = [];
    for (const id of ids) {
      try {
        const { manifest } = await this.verify(id);
        points.push({ id, manifestId: id, createdAt: manifest.createdAt, status: 'verified', scope: manifest.scope });
      } catch (error) {
        points.push({ id, manifestId: id, status: 'failed', errorCode: error.code ?? 'BACKUP_FAILED' });
      }
    }
    return points.sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));
  }

  async prune({ dryRun = false } = {}) {
    const points = await this.list();
    const { keep, prune } = selectRetention(points, this.retention, { timeZone: this.timeZone });
    if (!dryRun) {
      for (const point of prune) {
        for (const key of await this.target.list(`${pointPrefix(point.id)}/`)) await this.target.delete(key);
      }
    }
    return { kept: keep.map(({ id }) => id), pruned: prune.map(({ id }) => id), dryRun };
  }

  async health({ maximumAgeMs = 36 * 60 * 60 * 1000 } = {}) {
    const points = await this.list();
    const latest = points.find((point) => point.status === 'verified');
    const alerts = [...this.target.warnings()];
    if (!latest) alerts.push({ code: 'backup_missing', message: 'No verified backup point exists.' });
    else if (this.clock().getTime() - Date.parse(latest.createdAt) > maximumAgeMs) alerts.push({ code: 'backup_stale', message: 'Latest verified backup point is too old.' });
    if (points.some((point) => point.status === 'failed')) alerts.push({ code: 'backup_verification_failed', message: 'A committed backup point failed verification.' });
    return { status: alerts.length ? 'degraded' : 'ok', target: this.target.kind, lastVerified: latest ?? null, alerts };
  }
}
