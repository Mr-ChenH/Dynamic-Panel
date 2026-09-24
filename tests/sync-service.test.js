'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSyncLocalStore } = require('../main/sync/local-store');
const { createSyncService } = require('../main/sync/sync-service');
const { createCredentialEnvelope } = require('../main/sync/credential-envelope');
const { createObjectTransferManager, digestBytes, PNG_SIGNATURE } = require('../main/sync/object-transfer');

const installationId = '123e4567-e89b-42d3-a456-426614174000';
const tokenId = '223e4567-e89b-42d3-a456-426614174000';
const discoveryDocument = (overrides = {}) => ({
  instanceId: '323e4567-e89b-42d3-a456-426614174000', service: 'dynamic-panel-sync', protocol: { min: 1, max: 1 }, recordSchemas: { min: 1, max: 1 },
  capabilities: ['push-pull'], limits: { jsonBytes: 1, operationsPerPush: 1, changesPerPull: 1, chunkBytes: 1, clientObjectTransfers: 1, chunksPerUpload: 1, headerBytes: 1 },
  serverTime: '2040-01-01T00:00:00.000Z', ...overrides,
});
function session() { return { instance: { instanceId: 'instance-1' }, identity: { spaceId: 'space-1', clientId: 'client-1', spaceName: 'Work' }, state: { restoreEpoch: 1 }, categoryCounts: {}, usage: {}, storage: { database: 'ok', objects: 'ok' } }; }

test('sync service persists only an encrypted Key and reconciles durable operations', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-sync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'sync-state.json');
  const store = createSyncLocalStore({ fsModule: fs, pathModule: path, filePath, randomUUID: () => installationId });
  const secureStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`sealed:${value}`), decryptString: (value) => value.toString().slice(7) };
  const credentialEnvelope = createCredentialEnvelope({ secureStorage });
  const pushed = [];
  const connection = { policy: { url: 'http://localhost:43822/' }, session: async () => ({ data: session() }), push: async (rows) => (pushed.push(rows), { data: { results: rows.map((row) => ({ operationId: row.operationId, status: 'accepted' })) } }), pull: async () => ({ data: { changes: [], nextCursor: 'cursor-1', hasMore: false, restoreEpoch: 1 } }), objectRequest: async () => ({ data: { ok: true } }) };
  const protocolClient = { connect: async () => connection };
  const service = createSyncService({ protocolClient, credentialEnvelope, store, workspaceId: 'workspace-1', randomUUID: () => tokenId, setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {} });
  const tested = await service.testConnection({ baseUrl: 'http://localhost:43822', clientKey: 'dpk_v1_private-value', allowLoopbackHttp: true });
  assert.equal(tested.ok, true);
  const preview = await service.previewFirstSync({ token: tested.token, categories: { clipboard: true }, local: { totalRecords: 0 } });
  const saved = await service.saveBinding({ token: tested.token, categories: { clipboard: true }, firstSync: { mode: 'merge', planId: preview.planId } });
  assert.equal(saved.ok, true);
  const persisted = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(persisted, /dpk_v1_private-value/);
  assert.match(persisted, /safeStorage/);
  await new Promise((resolve) => setImmediate(resolve));
  service.enqueue({ operationId: 'op-1', entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, baseRevision: null, kind: 'upsert', payload: { text: 'x' } });
  const result = await service.runNow();
  assert.equal(result.ok, true);
  assert.equal(pushed.flat().some((row) => row.operationId === 'op-1'), true);
  assert.equal(store.outbox().length, 0);
  service.stop();
});

test('connection tests use the authenticated response midpoint and project only normalized diagnostics', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-preflight-midpoint-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSyncLocalStore({ fsModule: fs, pathModule: path, filePath: path.join(directory, 'state.json'), randomUUID: () => installationId });
  const credentialEnvelope = createCredentialEnvelope();
  let now = 1_000_000;
  const calls = [];
  const connection = {
    policy: { url: 'http://localhost:43822/' },
    discover: async () => { calls.push('discover'); return discoveryDocument(); },
    session: async () => {
      calls.push('session');
      const authenticatedServerTime = now + 10_000 + 360_000;
      now += 20_000;
      return { data: {
        instance: { instanceId: '323e4567-e89b-42d3-a456-426614174000', serverTime: new Date(authenticatedServerTime).toISOString() },
        identity: { spaceId: '423e4567-e89b-42d3-a456-426614174000', clientId: '523e4567-e89b-42d3-a456-426614174000', spaceName: 'Work' },
        state: { restoreEpoch: 1 }, protocol: { selected: 1 },
        categoryCounts: { todo: { records: 2, bytes: 64, path: 'C:\\private' } }, usage: { recordCount: 2, objectCount: 1, objectBytes: 8, clientKey: 'dpk_v1_secret' },
        storage: { database: 'ok', objects: 'ok', path: 'C:\\private' },
        capacity: { spaces: { active: 2, max: 10, remaining: 8, accountId: 'full-account-id' }, clients: { active: 1, max: 10, remaining: 9 }, raw: 'secret' },
      } };
    },
  };
  const service = createSyncService({ protocolClient: { connect: async () => connection }, credentialEnvelope, store, clock: () => now, randomUUID: () => tokenId, setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {} });
  const result = await service.testConnection({ baseUrl: 'http://localhost:43822', clientKey: 'dpk_v1_private', allowLoopbackHttp: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(calls, ['discover', 'session']);
  assert.equal(result.clockSkewSeconds, 360);
  assert.deepEqual(result.warning, { code: 'clock_skew_warning', seconds: 360 });
  assert.deepEqual(result.capacity, { spaces: { active: 2, max: 10, remaining: 8 }, clients: { active: 1, max: 10, remaining: 9 } });
  assert.deepEqual(result.usage, { recordCount: 2, objectCount: 1, objectBytes: 8 });
  assert.deepEqual(result.categoryCounts.todo, { records: 2, bytes: 64 });
  assert.doesNotMatch(JSON.stringify(result), /2040-01-01|dpk_v1_private|full-account-id|private/);
});

test('connection tests reject a discovery and authenticated-session identity mismatch before issuing a binding token', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-preflight-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSyncLocalStore({ fsModule: fs, pathModule: path, filePath: path.join(directory, 'state.json'), randomUUID: () => installationId });
  let savedBindings = 0; const calls = [];
  const serviceStore = { ...store, saveBinding(...args) { savedBindings += 1; return store.saveBinding(...args); } };
  const connection = {
    policy: { url: 'http://localhost:43822/' },
    discover: async () => { calls.push('discover'); return discoveryDocument(); },
    session: async () => { calls.push('session'); return { data: { ...session(), instance: { instanceId: '623e4567-e89b-42d3-a456-426614174000', serverTime: new Date(0).toISOString() } } }; },
    push: async () => { calls.push('push'); return { data: { results: [] } }; },
    pull: async () => { calls.push('pull'); return { data: { changes: [], nextCursor: '', hasMore: false } }; },
  };
  const service = createSyncService({ protocolClient: { connect: async () => connection }, credentialEnvelope: createCredentialEnvelope(), store: serviceStore, clock: () => 0, randomUUID: () => tokenId, setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {} });
  const result = await service.testConnection({ baseUrl: 'http://localhost:43822', clientKey: 'dpk_v1_private', allowLoopbackHttp: true });
  assert.deepEqual(result, { ok: false, error: { code: 'server_identity_mismatch', retryable: false, requestId: null } });
  assert.deepEqual(calls, ['discover', 'session']);
  assert.equal(result.token, undefined);
  assert.equal(savedBindings, 0);
  assert.equal(store.binding(), null);
});

test('saved reconnect discovers before session and blocks incompatible, mismatched, or excessive-skew servers before replication', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-saved-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSyncLocalStore({ fsModule: fs, pathModule: path, filePath: path.join(directory, 'state.json'), workspaceId: 'workspace-1', randomUUID: () => installationId });
  const credentialEnvelope = createCredentialEnvelope({ secureStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`sealed:${value}`), decryptString: (value) => value.toString().slice(7) } });
  const bound = { instanceId: '323e4567-e89b-42d3-a456-426614174000', spaceId: '423e4567-e89b-42d3-a456-426614174000', clientId: '523e4567-e89b-42d3-a456-426614174000', workspaceId: 'workspace-1', spaceName: 'Work', restoreEpoch: 1, baseUrl: 'http://localhost:43822/', allowLoopbackHttp: true, initialized: true, categories: { todo: true } };
  const sealed = credentialEnvelope.seal(bound.clientId, 'dpk_v1_saved-secret');
  store.saveBinding(bound, credentialEnvelope.export(sealed));
  let savedBindings = 0;
  const serviceStore = { ...store, saveBinding(...args) { savedBindings += 1; return store.saveBinding(...args); } };
  const validator = require('../main/sync/protocol-client').createProtocolClient({ fetchImpl: async () => { throw new Error('unused'); } });
  let mode = 'incompatible'; let now = 2_000_000; const calls = [];
  const protocolClient = { connect: async () => ({
    policy: { url: 'http://localhost:43822/' },
    discover: async () => { calls.push('discover'); return validator.assertDiscovery(discoveryDocument({ instanceId: mode === 'identity' ? '623e4567-e89b-42d3-a456-426614174000' : bound.instanceId, capabilities: mode === 'incompatible' ? ['exports'] : ['push-pull', 'future-index-v2'] })); },
    session: async () => { calls.push('session'); return { data: { instance: { instanceId: bound.instanceId, serverTime: new Date(now + (mode === 'skew' ? 901_000 : 360_000)).toISOString() }, identity: { spaceId: bound.spaceId, clientId: bound.clientId, spaceName: 'Work' }, state: { restoreEpoch: 1 }, protocol: { selected: 1 }, storage: { database: 'ok', objects: 'ok' }, capacity: { spaces: { active: 1, max: 10, remaining: 9 }, clients: { active: 1, max: 10, remaining: 9 } } } }; },
    push: async () => { calls.push('push'); return { data: { results: [] } }; },
    pull: async () => { calls.push('pull'); return { data: { changes: [], nextCursor: 'cursor-1', hasMore: false, restoreEpoch: 1 } }; },
  }) };
  const service = createSyncService({ protocolClient, credentialEnvelope, store: serviceStore, workspaceId: 'workspace-1', clock: () => now, setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {} });
  const incompatible = await service.runNow();
  assert.equal(incompatible.ok, false); assert.equal(incompatible.error.code, 'required_capability_missing');
  assert.deepEqual(calls, ['discover']);

  calls.length = 0; mode = 'identity';
  const mismatched = await service.runNow();
  assert.equal(mismatched.ok, false); assert.deepEqual(mismatched.error, { code: 'server_identity_mismatch', retryable: false, requestId: null });
  assert.deepEqual(calls, ['discover', 'session']);
  assert.equal(savedBindings, 0);

  calls.length = 0; mode = 'skew';
  const skewed = await service.runNow();
  assert.equal(skewed.ok, false); assert.equal(skewed.error.code, 'clock_skew_excessive');
  assert.deepEqual(calls, ['discover', 'session']);

  calls.length = 0; mode = 'warning';
  const connected = await service.runNow();
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.deepEqual(calls, ['discover', 'session', 'pull']);
  assert.equal(connected.status.clockSkewSeconds, 360);
  assert.deepEqual(connected.status.warning, { code: 'clock_skew_warning', seconds: 360 });
  assert.deepEqual(connected.status.capabilities, ['future-index-v2', 'push-pull']);
  service.stop();
});

test('cursor timestamps support age diagnostics and terminal transfers are never active', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-sync-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSyncLocalStore({ fsModule: fs, pathModule: path, filePath: path.join(directory, 'state.json'), randomUUID: () => installationId });
  store.saveCursor({ cursor: 'cursor-1' });
  const firstSavedAt = store.cursor().savedAt;
  store.stageInbox({ batchId: 'batch-1' });
  store.completeInbox('batch-1');
  assert.ok(store.cursor().savedAt >= firstSavedAt);
  store.saveTransfer({ transferId: 'completed-transfer-full-id', direction: 'upload', state: 'completed' });
  store.saveTransfer({ transferId: 'cancelled-transfer-full-id', direction: 'download', state: 'cancelled' });
  const service = createSyncService({ protocolClient: {}, credentialEnvelope: {}, store, clock: () => store.cursor().savedAt + 25, setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {} });
  assert.equal(service.status().cursorAgeMs, 25);
  assert.equal(service.status().activeTransfer, null);
  store.saveTransfer({ transferId: `upload:sha256:${'a'.repeat(64)}`, direction: 'upload', state: 'uploading' });
  assert.deepEqual(service.status().activeTransfer, { transferIdPrefix: 'upload:sha25', direction: 'upload', state: 'uploading' });
});

test('server-wins first sync verifies recovery, clears local outbox, and fully projects remote records', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-server-wins-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSyncLocalStore({ fsModule: fs, pathModule: path, filePath: path.join(directory, 'sync-state.json'), workspaceId: 'workspace-1', randomUUID: () => installationId });
  const credentialEnvelope = createCredentialEnvelope({ secureStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`sealed:${value}`), decryptString: (value) => value.toString().slice(7) } });
  const remoteRecord = { spaceId: 'space-1', entityType: 'todo', entityId: 'remote-todo', category: 'todo', schemaVersion: 1, revision: 2, updatedAt: '2026-01-01T00:00:00.000Z', originClientId: 'client-2', deleted: false, payload: { quadrant: 'P0', text: 'remote', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: '0' }, sequence: 2, retainUntil: null };
  const projected = [];
  const connection = {
    policy: { url: 'http://localhost:43822/' },
    session: async () => ({ data: { ...session(), categoryCounts: { todo: { records: 1, bytes: 64 } } } }),
    prepareFirstSync: async (input) => ({ data: { recoveryVerified: true, recoveryPointId: '55555555-5555-4555-8555-555555555555', planToken: 'signed-first-sync-plan', input } }),
    executeFirstSync: async (input) => ({ data: { recoveryVerified: input.confirmation === 'REPLACE THIS DEVICE', mode: input.mode, records: [] } }),
    reconcile: async () => ({ data: { records: [remoteRecord], pageToken: null, hasMore: false, restoreEpoch: 1 } }),
    push: async (rows) => ({ data: { results: rows.map((row) => ({ operationId: row.operationId, status: 'accepted' })) } }),
    pull: async () => ({ data: { changes: [], nextCursor: 'server-wins-cursor', upperCursor: 'server-wins-cursor', hasMore: false, restoreEpoch: 1 } }),
    objectRequest: async () => ({ data: {} }),
  };
  const service = createSyncService({
    protocolClient: { connect: async () => connection }, credentialEnvelope, store, workspaceId: 'workspace-1', randomUUID: () => tokenId,
    setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {},
    applyRemoteBatch: async (batch) => { projected.push(...batch.changes); return { batchId: batch.batchId, cursor: batch.nextCursor }; },
  });
  const tested = await service.testConnection({ baseUrl: 'http://localhost:43822', clientKey: 'dpk_v1_private-value', allowLoopbackHttp: true });
  const localRecord = { entityType: 'todo', entityId: 'local-todo', category: 'todo', schemaVersion: 1, payload: { quadrant: 'P0', text: 'local', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: '0' } };
  const local = { totalRecords: 1, totalBytes: 64, categories: { todo: { records: 1, bytes: 64 } }, records: [localRecord] };
  const preview = await service.previewFirstSync({ token: tested.token, categories: { todo: true }, local });
  await service.saveBinding({ token: tested.token, categories: { todo: true }, firstSync: { mode: 'server-wins', planId: preview.planId } });
  service.enqueue({ operationId: 'local-pending', ...localRecord, baseRevision: 0, kind: 'upsert' });
  const result = await service.executeFirstSync({ mode: 'server-wins', planId: preview.planId, confirmation: 'REPLACE THIS DEVICE', local });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(store.outbox().length, 0);
  assert.equal(store.binding().initialized, true);
  assert.equal(store.recoveries().length, 1);
  assert.equal(projected.some((change) => change.record?.entityId === 'local-todo' && change.record.deleted), true);
  assert.equal(projected.some((change) => change.record?.entityId === 'remote-todo' && !change.record.deleted), true);
  service.stop();
});

test('object downloads verify PNG digest before atomic replacement', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-object-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.concat([PNG_SIGNATURE, Buffer.from('payload')]);
  const destinationPath = path.join(directory, 'note-images', 'image.png');
  const manager = createObjectTransferManager({ fsModule: fs, pathModule: path, request: async () => ({ status: 200, body: bytes }) });
  await manager.download({ objectId: 'obj_123456789012345678901234', destinationPath, descriptor: { purpose: 'note-image', mimeType: 'image/png', bytes: bytes.length, digest: digestBytes(bytes) } });
  assert.deepEqual(fs.readFileSync(destinationPath), bytes);
  await assert.rejects(manager.download({ objectId: 'obj_123456789012345678901234', destinationPath, descriptor: { purpose: 'note-image', mimeType: 'image/png', bytes: bytes.length, digest: `sha256:${'0'.repeat(64)}` } }), /verification/);
  assert.deepEqual(fs.readFileSync(destinationPath), bytes);
});
