import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import {
  CHUNK_BYTES,
  FilesystemObjectStorage,
  MAX_PARTS,
  MemoryObjectStorage,
  ObjectService,
  UPLOAD_TTL_MS
} from '../src/objects/index.js';

const scopeA = { accountId: 'account-a', spaceId: 'space-a', clientId: 'client-a' };
const scopeB = { accountId: 'account-b', spaceId: 'space-b', clientId: 'client-b' };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('test-pixels')]);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const descriptor = (value = png) => ({ digest: digest(value), bytes: value.length, mimeType: 'image/png', purpose: 'note-image' });

async function upload(service, scope = scopeA, value = png) {
  const started = await service.createUpload(scope, descriptor(value));
  await service.putPart(scope, started.uploadId, 1, digest(value), Readable.from(value));
  return { started, object: await service.completeUpload(scope, started.uploadId) };
}

async function body(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('multipart status resumes and duplicate parts are idempotent', async () => {
  const service = new ObjectService({ storage: new MemoryObjectStorage() });
  const started = await service.createUpload(scopeA, descriptor());
  const first = await service.putPart(scopeA, started.uploadId, 1, digest(png), png);
  const replay = await service.putPart(scopeA, started.uploadId, 1, digest(png), Readable.from(png));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual((await service.uploadStatus(scopeA, started.uploadId)).completedParts, [{ partNumber: 1, digest: digest(png), bytes: png.length }]);
  const object = await service.completeUpload(scopeA, started.uploadId);
  assert.deepEqual(await service.completeUpload(scopeA, started.uploadId), object);
});

test('completion rejects aggregate corruption and PNG masquerading', async () => {
  const storage = new MemoryObjectStorage();
  const service = new ObjectService({ storage });
  const started = await service.createUpload(scopeA, descriptor());
  await service.putPart(scopeA, started.uploadId, 1, digest(png), png);
  const session = service.repository.uploads.get(started.uploadId);
  storage.objects.set(session.parts.get(1).storageKey, Buffer.from('not a png but same?'));
  await assert.rejects(service.completeUpload(scopeA, started.uploadId), (error) => error.code === 'object_verification_failed');

  const fake = Buffer.from('definitely-not-png');
  const second = await service.createUpload(scopeA, descriptor(fake));
  await service.putPart(scopeA, second.uploadId, 1, digest(fake), fake);
  await assert.rejects(service.completeUpload(scopeA, second.uploadId), (error) => error.code === 'object_verification_failed' && error.details.reason === 'png-signature');
});

test('download ranges and scope authorization do not expose same-digest objects', async () => {
  const service = new ObjectService({ storage: new MemoryObjectStorage() });
  const a = await upload(service, scopeA);
  const b = await upload(service, scopeB);
  assert.notEqual(a.object.objectId, b.object.objectId);
  await assert.rejects(service.download(scopeB, a.object.objectId), (error) => error.code === 'resource_not_found');
  await assert.rejects(service.download(scopeA, 'obj_missing00000000000000000'), (error) => error.code === 'resource_not_found');
  const ranged = await service.download(scopeA, a.object.objectId, 'bytes=1-4');
  assert.equal(ranged.partial, true);
  assert.deepEqual(await body(ranged.stream), png.subarray(1, 5));
  assert.equal((await service.completeness(scopeB, [a.object.objectId])).complete, false);
});

test('expiry, transfer concurrency, and storage failures preserve checkpoints', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const storage = new MemoryObjectStorage();
  const service = new ObjectService({ storage, clock: () => now });
  const sessions = [];
  for (let index = 0; index < 4; index += 1) sessions.push(await service.createUpload(scopeA, descriptor()));
  await assert.rejects(service.createUpload(scopeA, descriptor()), (error) => error.code === 'object_transfer_limit');
  await service.cancelUpload(scopeA, sessions.pop().uploadId);
  const replacement = await service.createUpload(scopeA, descriptor());
  storage.failWrites = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  await assert.rejects(service.putPart(scopeA, replacement.uploadId, 1, digest(png), png), (error) => error.code === 'object_storage_unavailable' && error.retryable);
  assert.equal((await service.uploadStatus(scopeA, replacement.uploadId)).completedParts.length, 0);
  storage.failWrites = null;
  now = new Date(now.getTime() + UPLOAD_TTL_MS + 1);
  await assert.rejects(service.uploadStatus(scopeA, replacement.uploadId), (error) => error.code === 'upload_expired');
  assert.equal((await service.cleanup()).expiredUploads, 3);
});

test('large descriptors have only protocol part bounds, never account or image quota', async () => {
  const service = new ObjectService({ storage: new MemoryObjectStorage() });
  const maximumTechnicalBytes = CHUNK_BYTES * MAX_PARTS;
  const started = await service.createUpload(scopeA, { ...descriptor(), bytes: maximumTechnicalBytes });
  assert.equal(started.maxParts, MAX_PARTS);
  assert.equal((await service.usage(scopeA)).quota, null);
  await service.cancelUpload(scopeA, started.uploadId);
  await assert.rejects(service.createUpload(scopeA, { ...descriptor(), bytes: maximumTechnicalBytes + 1 }), (error) => error.code === 'invalid_request');
});

test('references gate completeness and retention-aware GC', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const storage = new MemoryObjectStorage();
  const service = new ObjectService({ storage, clock: () => now, unreferencedGraceMs: 1_000 });
  const { object } = await upload(service);
  assert.deepEqual(await service.setReferences(scopeA, 'note:1', [object.objectId]), { referenceId: 'note:1', complete: true, objects: [object] });
  assert.equal((await service.usage(scopeA)).referencedBytes, png.length);
  await service.deleteReferences(scopeA, 'note:1');
  now = new Date(now.getTime() + 1_001);
  assert.equal((await service.cleanup({ backupRetainUntil: new Date(now.getTime() + 1000) })).deletedObjects, 0);
  assert.equal((await service.cleanup()).deletedObjects, 1);
});

test('filesystem adapter rejects symlink roots and never accepts caller paths', async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'dp-objects-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'root');
  const storage = new FilesystemObjectStorage({ root });
  const service = new ObjectService({ storage });
  const { object } = await upload(service);
  assert.deepEqual(await body((await service.download(scopeA, object.objectId)).stream), png);
  await assert.rejects(storage.put('../escape', png), /Invalid server object key/);

  const target = path.join(parent, 'target');
  const linked = path.join(parent, 'linked');
  await mkdir(target);
  try { await symlink(target, linked, 'dir'); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  const unsafe = new FilesystemObjectStorage({ root: linked });
  await assert.rejects(unsafe.ready, /real directory|symlink/);
});
