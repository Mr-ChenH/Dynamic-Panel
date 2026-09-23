import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { IdentityService } from '../src/auth/identity-service.js';
import { MemoryIdentityStore } from '../src/auth/memory-store.js';
import { BackupService } from '../src/backup/service.js';
import { MemoryRestoreRepository } from '../src/backup/memory-repository.js';
import { RestoreService } from '../src/backup/restore.js';
import { FilesystemBackupTarget, S3BackupTarget } from '../src/backup/targets.js';
import { loadConfig } from '../src/config.js';
import { installErrorHandler } from '../src/errors.js';
import { MemoryObjectStorage } from '../src/objects/storage.js';
import { ObjectService } from '../src/objects/service.js';
import { MemoryRecordRepository } from '../src/records/memory-repository.js';
import { RecordReplicationService } from '../src/records/service.js';
import { syncRoutes } from '../src/routes/sync.js';

const SECRET = 'fault-injection-secret-at-least-thirty-two-bytes';
const identityConfig = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup` });
const scope = { accountId: 'fault-account', spaceId: 'fault-space', clientId: 'fault-client', restoreEpoch: 1 };
const note = (body) => ({ title: 'Fault', titleSource: 'user', body, categoryId: '', tagId: '', createdAt: 1, updatedAt: 1, imageObjectIds: [] });
const op = (operationId, payload, baseRevision = 0) => ({ operationId, entityType: 'note', entityId: 'note-1', category: 'notes', schemaVersion: 1, baseRevision, kind: 'upsert', payload });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fault-pixels')]);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

class FailAfterMutationRepository extends MemoryRecordRepository {
  failAfterCallback = false;
  transaction(context, callback) {
    if (!this.failAfterCallback) return super.transaction(context, callback);
    this.failAfterCallback = false;
    return super.transaction(context, async (tx) => {
      await callback(tx);
      throw Object.assign(new Error('injected commit failure'), { code: 'INJECTED_COMMIT_FAILURE' });
    });
  }
}

class FailingKeyStore extends MemoryIdentityStore {
  failNextKeyInsert = false;
  async addKeyGeneration(generation) {
    if (this.failNextKeyInsert) {
      this.failNextKeyInsert = false;
      throw Object.assign(new Error('injected key insert failure'), { code: 'INJECTED_KEY_WRITE' });
    }
    return super.addKeyGeneration(generation);
  }
}

async function identityFixture() {
  const store = new FailingKeyStore();
  const identity = new IdentityService({ store, config: identityConfig, clock: () => new Date('2026-01-01T00:00:00.000Z') });
  const accountProjection = await identity.createAccount({ username: `fault-${randomUUID()}`, password: 'correct horse battery staple' });
  const account = await store.getAccount(accountProjection.accountId);
  const context = { actorType: 'account', accountId: account.accountId, account, session: { recentAuthAt: '2026-01-01T00:00:00.000Z' } };
  const space = await identity.createSpace(context, 'Fault space', 'space-create');
  const client = await identity.createClient(context, space.spaceId, 'Fault client', 'client-create');
  return { identity, store, context, space, client };
}

async function backupFixture(t, data = { accounts: [{ accountId: 'a' }], spaces: [{ accountId: 'a', spaceId: 'one', restoreEpoch: 1 }], records: [{ accountId: 'a', spaceId: 'one', entityId: 'new-record' }] }) {
  const root = await mkdtemp(path.join(tmpdir(), 'dp-fault-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = new FilesystemBackupTarget(root);
  let next = 1;
  const source = { async snapshot() { return { instanceId: 'fault-instance', databaseSchema: 1, spaces: data.spaces, data, objectEntries: [] }; } };
  const backup = new BackupService({ source, target, masterKey: randomBytes(32), keyId: 'fault-key', id: () => `fault-point-${next++}` });
  return { backup, target, data };
}

test('NFR-003/NFR-004/SM-001: an injected transaction failure commits neither operation nor sequence and retry is safe', async () => {
  const repository = new FailAfterMutationRepository();
  repository.seedSpace(scope);
  const records = new RecordReplicationService({ repository, cursorSecret: SECRET, instanceId: 'fault-instance', clock: () => new Date('2026-01-01T00:00:00.000Z') });
  repository.failAfterCallback = true;
  await assert.rejects(records.push(scope, [op('commit-fault', note('body'))]), (error) => error.code === 'INJECTED_COMMIT_FAILURE');
  assert.deepEqual(await records.stats(scope), { categories: {}, categoryState: [], records: 0, tombstones: 0, unresolvedConflicts: 0, restoreEpoch: 1, sequence: 0 });
  const retry = await records.push(scope, [op('commit-fault', note('body'))]);
  assert.equal(retry.results[0].status, 'accepted');
  assert.equal((await records.stats(scope)).sequence, 1);
});

test('FR-114/NFR-011: restore-epoch races return the stable reconciliation error instead of internal_error', async (t) => {
  const repository = new MemoryRecordRepository();
  repository.seedSpace(scope);
  const records = new RecordReplicationService({ repository, cursorSecret: SECRET, instanceId: 'fault-instance' });
  const staleContext = { ...scope };
  await repository.advanceEpoch(scope);
  const app = Fastify({ logger: false });
  app.decorate('identity', { authenticateClient: async () => staleContext });
  installErrorHandler(app);
  await app.register(syncRoutes, { records });
  await app.ready();
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { authorization: 'ClientKey stale' }, payload: { operations: [op('stale-epoch', note('body'))] } });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'restore_epoch_changed');
});

test('FR-124/AC-018: failed Key rotation is atomic and leaves the old Key usable', async () => {
  const { identity, store, context, space, client } = await identityFixture();
  assert.equal((await identity.authenticateClient(client.clientKey)).clientId, client.clientId);
  store.failNextKeyInsert = true;
  await assert.rejects(identity.rotateKey(context, space.spaceId, client.clientId, 0, 'rotate-fault'), (error) => error.code === 'INJECTED_KEY_WRITE');
  const authenticated = await identity.authenticateClient(client.clientKey);
  assert.equal(authenticated.clientId, client.clientId, 'rotation revokes the old generation before the new generation is durably inserted');
});

test('FR-150/AC-053: failed installation reset is atomic and preserves binding and old Key', async () => {
  const { identity, store, context, space, client } = await identityFixture();
  const authenticated = await identity.authenticateClient(client.clientKey);
  await identity.bindClient(authenticated, '0f12ebd4-8f91-4a37-8a52-a8a58efc9c72', { platform: 'darwin-arm64', appVersion: '1.1.0' }, 'bind');
  store.failNextKeyInsert = true;
  await assert.rejects(identity.resetInstallation(context, space.spaceId, client.clientId, 'reset-fault'), (error) => error.code === 'INJECTED_KEY_WRITE');
  const after = await identity.authenticateClient(client.clientKey);
  assert.equal(after.client.installationId, '0f12ebd4-8f91-4a37-8a52-a8a58efc9c72', 'reset revokes the old generation before replacement and binding update are atomic');
});

test('DR-012/AC-023: object storage refusal preserves upload metadata and succeeds on deterministic retry', async () => {
  const storage = new MemoryObjectStorage();
  const objects = new ObjectService({ storage });
  const started = await objects.createUpload(scope, { digest: digest(png), bytes: png.length, mimeType: 'image/png', purpose: 'note-image' });
  storage.failWrites = Object.assign(new Error('injected disk full'), { code: 'ENOSPC' });
  await assert.rejects(objects.putPart(scope, started.uploadId, 1, digest(png), png), (error) => error.code === 'object_storage_unavailable' && error.retryable);
  assert.deepEqual((await objects.uploadStatus(scope, started.uploadId)).completedParts, []);
  storage.failWrites = null;
  assert.equal((await objects.putPart(scope, started.uploadId, 1, digest(png), png)).replayed, false);
  const completed = await objects.completeUpload(scope, started.uploadId);
  assert.equal(completed.digest, digest(png));
});

test('FR-109/FR-110/AC-026/AC-027: failed new backup preserves the previous verified point and never prunes it', async (t) => {
  const { backup, target } = await backupFixture(t);
  const first = await backup.create();
  assert.equal((await backup.verify(first.manifestId)).status, 'verified');
  const originalPut = target.put.bind(target);
  target.put = async (key, body) => {
    if (key.startsWith('temporary/fault-point-2/')) throw Object.assign(new Error('injected target full'), { code: 'ENOSPC' });
    return originalPut(key, body);
  };
  await assert.rejects(backup.create(), (error) => error.code === 'ENOSPC');
  assert.equal((await backup.verify(first.manifestId)).status, 'verified');
  assert.deepEqual((await backup.list()).map((point) => point.manifestId), [first.manifestId]);
});

test('FR-111/FR-112/AC-028: corrupted backup fails before dry-run or staged repository mutation', async (t) => {
  const { backup, target } = await backupFixture(t);
  const point = await backup.create();
  const chunkKey = (await target.list(`points/${point.manifestId}/chunks/`))[0];
  const original = await target.get(chunkKey);
  const corrupt = Buffer.from(original); corrupt[0] ^= 0xff;
  await target.put(chunkKey, corrupt);
  const repository = new MemoryRestoreRepository();
  const restore = new RestoreService({ backup, repository });
  await assert.rejects(restore.stage(point.manifestId, { dryRun: true }), (error) => error.code === 'BACKUP_VERIFICATION_FAILED');
  assert.equal(repository.mutations, 0);
  assert.equal(repository.stages.size, 0);
});

test('FR-115/FR-134/AC-029/AC-039: scoped restore replaces backed-up records and leaves other spaces unchanged', async (t) => {
  const data = {
    accounts: [{ accountId: 'a' }],
    spaces: [{ accountId: 'a', spaceId: 'one', restoreEpoch: 2 }],
    records: [{ accountId: 'a', spaceId: 'one', entityId: 'restored-record', payload: { body: 'restored' } }],
    conflicts: [{ accountId: 'a', spaceId: 'one', conflictId: 'restored-conflict' }]
  };
  const { backup } = await backupFixture(t, data);
  const point = await backup.create();
  const repository = new MemoryRestoreRepository({
    accounts: [{ accountId: 'a' }],
    spaces: [{ accountId: 'a', spaceId: 'one', restoreEpoch: 10 }, { accountId: 'a', spaceId: 'two', restoreEpoch: 20 }],
    records: [{ accountId: 'a', spaceId: 'one', entityId: 'old-record' }, { accountId: 'a', spaceId: 'two', entityId: 'untouched-record' }],
    conflicts: []
  });
  const restore = new RestoreService({ backup, repository });
  const stage = await restore.stage(point.manifestId);
  await restore.apply(stage.stageId, { scope: { type: 'space', accountId: 'a', spaceId: 'one' }, confirmation: 'RESTORE', createPreRestore: false });
  assert.deepEqual(repository.online.records.filter((row) => row.spaceId === 'one'), data.records, 'memory restore adapter only replaces the space header');
  assert.deepEqual(repository.online.records.filter((row) => row.spaceId === 'two'), [{ accountId: 'a', spaceId: 'two', entityId: 'untouched-record' }]);
  assert.deepEqual(repository.online.conflicts, data.conflicts);
});

const s3Enabled = ['SYNC_TEST_S3_BUCKET', 'SYNC_TEST_S3_REGION'].every((name) => process.env[name]);
test('optional S3: backup target round-trips a uniquely-prefixed object', { skip: !s3Enabled }, async () => {
  const { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: process.env.SYNC_TEST_S3_REGION, ...(process.env.SYNC_TEST_S3_ENDPOINT ? { endpoint: process.env.SYNC_TEST_S3_ENDPOINT, forcePathStyle: true } : {}) });
  const backend = {
    putObject: (input) => client.send(new PutObjectCommand(input)),
    getObject: (input) => client.send(new GetObjectCommand(input)),
    deleteObject: (input) => client.send(new DeleteObjectCommand(input)),
    listObjectsV2: (input) => client.send(new ListObjectsV2Command(input))
  };
  const prefix = `dynamic-panel-acceptance/${randomUUID()}`;
  const target = new S3BackupTarget({ client: backend, bucket: process.env.SYNC_TEST_S3_BUCKET, prefix });
  try {
    await target.put('probe/value.bin', Buffer.from('probe'));
    assert.deepEqual(await target.get('probe/value.bin'), Buffer.from('probe'));
    assert.deepEqual(await target.list('probe/'), ['probe/value.bin']);
  } finally {
    await target.delete('probe/value.bin').catch(() => {});
    client.destroy();
  }
});
