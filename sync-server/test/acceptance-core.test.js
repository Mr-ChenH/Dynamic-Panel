import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { installErrorHandler } from '../src/errors.js';
import { IdentityService } from '../src/auth/identity-service.js';
import { MemoryIdentityStore } from '../src/auth/memory-store.js';
import { PostgresIdentityStore } from '../src/db/identity-store.js';
import { migrate } from '../src/db/migrate.js';
import { MemoryObjectRepository } from '../src/objects/repository.js';
import { ObjectService } from '../src/objects/service.js';
import { MemoryObjectStorage } from '../src/objects/storage.js';
import { CHUNK_BYTES, MAX_PARTS } from '../src/objects/constants.js';
import { MemoryRecordRepository } from '../src/records/memory-repository.js';
import { RecordReplicationService } from '../src/records/service.js';
import { objectRoutes } from '../src/routes/objects.js';
import { syncRoutes } from '../src/routes/sync.js';

const SECRET = 'core-acceptance-secret-at-least-thirty-two-bytes';
const scopeA = { accountId: 'account-a', spaceId: 'space-a', clientId: 'client-a', restoreEpoch: 1 };
const scopeB = { accountId: 'account-b', spaceId: 'space-b', clientId: 'client-b', restoreEpoch: 1 };
const note = (body) => ({ title: 'Acceptance', titleSource: 'user', body, categoryId: '', tagId: '', createdAt: 1, updatedAt: 1, imageObjectIds: [] });
const operation = (operationId, payload, baseRevision = 0, overrides = {}) => ({ operationId, entityType: 'note', entityId: 'note-1', category: 'notes', schemaVersion: 1, baseRevision, kind: 'upsert', payload, ...overrides });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('acceptance-pixels')]);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function recordFixture() {
  const repository = new MemoryRecordRepository();
  repository.seedSpace(scopeA);
  repository.seedSpace(scopeB);
  return { repository, records: new RecordReplicationService({ repository, cursorSecret: SECRET, instanceId: 'acceptance-instance', clock: () => new Date('2026-01-01T00:00:00.000Z') }) };
}

async function pluginApp({ records, objects, contexts = new Map([['key-a', scopeA], ['key-b', scopeB]]) }) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.decorate('identity', {
    async authenticateClient(key) {
      const context = contexts.get(key);
      if (!context) throw app.errors.authentication();
      return context;
    }
  });
  app.decorate('errors', (await import('../src/errors.js')).errors);
  installErrorHandler(app);
  if (records) await app.register(syncRoutes, { records });
  if (objects) await app.register(objectRoutes, { service: objects });
  await app.ready();
  return app;
}

function keyHeaders(key) { return { authorization: `ClientKey ${key}` }; }

async function upload(app, key, value = png) {
  const started = await app.inject({ method: 'POST', url: '/api/v1/objects/uploads', headers: keyHeaders(key), payload: { digest: digest(value), bytes: value.length, mimeType: 'image/png', purpose: 'note-image' } });
  assert.equal(started.statusCode, 201, started.body);
  const uploadId = started.json().data.uploadId;
  const part = await app.inject({ method: 'PUT', url: `/api/v1/objects/uploads/${uploadId}/parts/1`, headers: { ...keyHeaders(key), 'content-type': 'application/octet-stream', 'content-digest': digest(value) }, payload: value });
  assert.equal(part.statusCode, 200, part.body);
  const completed = await app.inject({ method: 'POST', url: `/api/v1/objects/uploads/${uploadId}/complete`, headers: keyHeaders(key), payload: {} });
  assert.equal(completed.statusCode, 200, completed.body);
  return completed.json().data;
}

test('FR-029/FR-030/AC-004/AC-049/AC-050: 100 replays are one result and authenticated source defeats spoofing', async () => {
  const { records } = recordFixture();
  const candidate = operation('replay-100', note('first'));
  const results = await Promise.all(Array.from({ length: 100 }, () => records.push(scopeA, [candidate])));
  assert.equal(results.filter((result) => result.results[0].status === 'accepted').length, 1);
  assert.equal(results.filter((result) => result.results[0].status === 'duplicate').length, 99);
  assert.equal((await records.stats(scopeA)).sequence, 1);

  const app = await pluginApp({ records });
  try {
    const forged = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: keyHeaders('key-a'), payload: { operations: [{ ...operation('forged-source', note('forged'), 1), originClientId: scopeB.clientId, spaceId: scopeB.spaceId }] } });
    assert.equal(forged.statusCode, 400);
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: keyHeaders('key-b'), payload: { operations: [operation('source-b', note('from b'))] } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().data.results[0].record.originClientId, scopeB.clientId);
  } finally { await app.close(); }
});

test('FR-130/NFR-018/AC-034: cursors, conflict IDs, and record IDs are bound to authenticated space scope', async () => {
  const { records } = recordFixture();
  await records.push(scopeA, [operation('scope-base', note('base'))]);
  await records.push(scopeA, [operation('scope-current', note('current'), 1)]);
  const conflict = (await records.push({ ...scopeA, clientId: 'client-other' }, [operation('scope-conflict', note('incoming'), 1)])).results[0];
  const cursor = (await records.pull(scopeA)).nextCursor;
  const app = await pluginApp({ records });
  try {
    const foreignCursor = await app.inject({ method: 'GET', url: `/api/v1/sync/pull?cursor=${encodeURIComponent(cursor)}`, headers: keyHeaders('key-b') });
    assert.equal(foreignCursor.statusCode, 400);
    assert.equal(foreignCursor.json().error.code, 'invalid_cursor');

    const resolveBody = { operations: [{ ...operation('foreign-resolve', note('stolen'), 0, { kind: 'resolveConflict' }), conflictId: conflict.conflictId }] };
    const foreignConflict = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: keyHeaders('key-b'), payload: resolveBody });
    assert.equal(foreignConflict.statusCode, 404);
    assert.equal(foreignConflict.json().error.code, 'resource_not_found');

    await records.push(scopeA, [{ operationId: 'scope-delete', entityType: 'note', entityId: 'note-1', category: 'notes', schemaVersion: 1, baseRevision: 2, kind: 'delete' }]);
    const foreignRecord = await app.inject({ method: 'POST', url: '/api/v1/sync/records/note/note-1/restore', headers: keyHeaders('key-b'), payload: { operationId: 'foreign-restore', baseRevision: 3 } });
    const missingRecord = await app.inject({ method: 'POST', url: '/api/v1/sync/records/note/missing-note/restore', headers: keyHeaders('key-b'), payload: { operationId: 'missing-restore', baseRevision: 3 } });
    assert.equal(foreignRecord.statusCode, 404);
    assert.deepEqual(foreignRecord.json().error, missingRecord.json().error);
  } finally { await app.close(); }
});

test('FR-057/FR-064/FR-066/FR-067/AC-005/AC-006/AC-007: conflict, tombstone, stale edit, and restore remain recoverable', async () => {
  const { records } = recordFixture();
  await records.push(scopeA, [operation('base', note('base'))]);
  await records.push(scopeA, [operation('edit-a', note('alpha'), 1)]);
  const conflict = (await records.push({ ...scopeA, clientId: 'client-b' }, [operation('edit-b', note('beta'), 1)])).results[0];
  assert.equal(conflict.status, 'conflict');
  const deleted = (await records.push(scopeA, [{ operationId: 'delete', entityType: 'note', entityId: 'note-1', category: 'notes', schemaVersion: 1, baseRevision: 2, kind: 'delete' }])).results[0];
  assert.equal(deleted.record.deleted, true);
  assert.equal(deleted.record.retainUntil, '2026-01-31T00:00:00.000Z');
  const stale = (await records.push({ ...scopeA, clientId: 'client-b' }, [operation('stale-after-delete', note('offline'), 2)])).results[0];
  assert.equal(stale.status, 'conflict');
  const restored = await records.restore(scopeA, { entityType: 'note', entityId: 'note-1', operationId: 'restore', baseRevision: 3 });
  assert.equal(restored.record.deleted, false);
  assert.equal(restored.record.revision, 4);
  assert.equal((await records.stats(scopeA)).unresolvedConflicts, 2);
});

test('DR-017/NFR-007/AC-040: object IDs, completeness, references, and downloads do not form a cross-scope digest oracle', async () => {
  const storage = new MemoryObjectStorage();
  const objects = new ObjectService({ storage, repository: new MemoryObjectRepository() });
  const app = await pluginApp({ objects });
  try {
    const owned = await upload(app, 'key-a');
    const sameBytesOtherTenant = await upload(app, 'key-b');
    assert.notEqual(owned.objectId, sameBytesOtherTenant.objectId);

    const open = await app.inject({ method: 'POST', url: '/api/v1/objects/uploads', headers: keyHeaders('key-a'), payload: { digest: digest(png), bytes: png.length, mimeType: 'image/png', purpose: 'note-image' } });
    assert.equal(open.statusCode, 201, open.body);
    const foreignUpload = await app.inject({ method: 'GET', url: `/api/v1/objects/uploads/${open.json().data.uploadId}`, headers: keyHeaders('key-b') });
    const missingUpload = await app.inject({ method: 'GET', url: '/api/v1/objects/uploads/upl_AAAAAAAAAAAAAAAAAAAAAAAA', headers: keyHeaders('key-b') });
    assert.equal(foreignUpload.statusCode, 404);
    assert.deepEqual(foreignUpload.json().error, missingUpload.json().error);

    const foreign = await app.inject({ method: 'GET', url: `/api/v1/objects/${owned.objectId}`, headers: keyHeaders('key-b') });
    const missing = await app.inject({ method: 'GET', url: '/api/v1/objects/obj_AAAAAAAAAAAAAAAAAAAAAAAA', headers: keyHeaders('key-b') });
    assert.equal(foreign.statusCode, 404);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(foreign.json().error, missing.json().error);

    const completeness = await app.inject({ method: 'POST', url: '/api/v1/objects/completeness', headers: keyHeaders('key-b'), payload: { objectIds: [owned.objectId] } });
    assert.deepEqual(completeness.json().data, { complete: false, committedCount: 0, requiredCount: 1 });
    const reference = await app.inject({ method: 'PUT', url: '/api/v1/objects/references/note:foreign', headers: keyHeaders('key-b'), payload: { objectIds: [owned.objectId] } });
    assert.equal(reference.statusCode, 404);
  } finally { await app.close(); }
});

test('FR-077/DR-012/AC-057: usage is observational and only the documented protocol ceiling rejects object size', async () => {
  const objects = new ObjectService({ storage: new MemoryObjectStorage() });
  const largest = CHUNK_BYTES * MAX_PARTS;
  const started = await objects.createUpload(scopeA, { digest: digest(png), bytes: largest, mimeType: 'image/png', purpose: 'screenshot' });
  assert.equal(started.maxParts, MAX_PARTS);
  assert.equal((await objects.usage(scopeA)).quota, null);
  await objects.cancelUpload(scopeA, started.uploadId);
  await assert.rejects(objects.createUpload(scopeA, { digest: digest(png), bytes: largest + 1, mimeType: 'image/png', purpose: 'screenshot' }), (error) => error.code === 'invalid_request' && error.details.technicalLimit === largest);
});

test('FR-131/AC-041/AC-055/AC-056: concurrent in-memory 10/10 races have exact isolated winners', async () => {
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup` });
  const store = new MemoryIdentityStore();
  const identity = new IdentityService({ store, config });
  const account = await identity.createAccount({ username: 'race-account', password: 'correct horse battery staple' });
  const other = await identity.createAccount({ username: 'other-race-account', password: 'correct horse battery staple' });
  const context = { actorType: 'account', accountId: account.accountId, account, session: { recentAuthAt: new Date().toISOString() } };
  const otherContext = { actorType: 'account', accountId: other.accountId, account: other, session: { recentAuthAt: new Date().toISOString() } };
  const spaces = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => identity.createSpace(context, `Race ${index}`, `space-${index}`)));
  assert.equal(spaces.filter((result) => result.status === 'fulfilled').length, 10);
  assert.equal(spaces.filter((result) => result.status === 'rejected' && result.reason.code === 'space_limit_reached').length, 10);
  assert.equal((await identity.createSpace(otherContext, 'Unaffected', 'other-space')).status, 'active');
  const space = spaces.find((result) => result.status === 'fulfilled').value;
  const clients = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => identity.createClient(context, space.spaceId, `Client ${index}`, `client-${index}`)));
  assert.equal(clients.filter((result) => result.status === 'fulfilled').length, 10);
  assert.equal(clients.filter((result) => result.status === 'rejected' && result.reason.code === 'client_limit_reached').length, 10);
  assert.equal(new Set(clients.filter((result) => result.status === 'fulfilled').map((result) => result.value.clientKey)).size, 10);
});

test('FR-130/NFR-018: the composed server exposes authenticated record replication routes', async (t) => {
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup` });
  const app = await buildServer({ config, logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/sync/push', payload: { operations: [] } });
  assert.notEqual(response.statusCode, 404, 'syncRoutes is implemented but is not registered by buildServer');
});

test('FR-070/FR-130/NFR-018: the composed server exposes authenticated object routes', async (t) => {
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup` });
  const app = await buildServer({ config, logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/objects/completeness', payload: { objectIds: [] } });
  assert.notEqual(response.statusCode, 404, 'objectRoutes is implemented but is not registered by buildServer');
});

const postgresUrl = process.env.SYNC_TEST_DATABASE_URL;
test('optional PostgreSQL: real transactions enforce exactly 10 concurrent active spaces', { skip: !postgresUrl }, async () => {
  const admin = new pg.Pool({ connectionString: postgresUrl });
  const schema = `acceptance_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: postgresUrl, options: `-c search_path=${schema},public` });
  try {
    await migrate(pool);
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup` });
    const identity = new IdentityService({ store: new PostgresIdentityStore(pool), config });
    const account = await identity.createAccount({ username: `pg-race-${schema}`, password: 'correct horse battery staple' });
    const context = { actorType: 'account', accountId: account.accountId, account };
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => identity.createSpace(context, `PG race ${index}`, `pg-${index}`)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 10);
    assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'space_limit_reached').length, 10);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
