'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createProjectionBridge } = require('../main/sync/projection-bridge');
const { ensureSafePath } = require('../main/sync/media-path');
const { createSyncLocalStore } = require('../main/sync/local-store');
const { createSyncService } = require('../main/sync/sync-service');
const { createCredentialEnvelope } = require('../main/sync/credential-envelope');

const INSTALLATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const TOKEN_ID = '223e4567-e89b-42d3-a456-426614174000';
const binding = (workspaceId, suffix = 'a') => ({ instanceId: 'instance-1', spaceId: `space-${suffix}`, clientId: `client-${suffix}`, workspaceId, spaceName: 'Work', clientName: 'Client', restoreEpoch: 1, baseUrl: 'http://localhost:43822/', allowLoopbackHttp: true, initialized: true, categories: { todo: true } });
const session = () => ({ instance: { instanceId: 'instance-1' }, identity: { spaceId: 'space-a', clientId: 'client-a', spaceName: 'Work', clientName: 'Client' }, state: { restoreEpoch: 1 }, categoryCounts: {}, usage: {}, storage: { database: 'ok', objects: 'ok' } });

function temporaryStore(t, workspaceId = 'workspace-a') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-sync-integration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return createSyncLocalStore({ fsModule: fs, pathModule: path, filePath: path.join(directory, 'state.json'), workspaceId, randomUUID: () => INSTALLATION_ID });
}

function envelope() {
  return createCredentialEnvelope({ secureStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`sealed:${value}`), decryptString: (value) => value.toString().slice(7) } });
}

test('projection bridge resolves only a matching acknowledgement from the main renderer', async () => {
  const ipcMain = new EventEmitter();
  const sender = {};
  let sent;
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_channel, value) => { sent = value; } } };
  const bridge = createProjectionBridge({ ipcMain, getMainWindow: () => window, isMainWindowSender: (candidate) => candidate === sender, randomUUID: () => 'request-1', timeoutMs: 1000 });
  const pending = bridge.applyRemoteBatch({ batchId: 'batch-1' });
  ipcMain.emit('sync:projection-result', { sender: {} }, { requestId: 'request-1', ok: true, result: { batchId: 'wrong' } });
  assert.equal(bridge.pendingCount(), 1);
  ipcMain.emit('sync:projection-result', { sender }, { requestId: sent.requestId, ok: true, result: { batchId: 'batch-1', cursor: 'cursor-1' } });
  assert.deepEqual(await pending, { batchId: 'batch-1', cursor: 'cursor-1' });
  bridge.dispose();
});

test('renderer projection failure keeps the durable cursor replayable until acknowledgement', async (t) => {
  const store = temporaryStore(t);
  const secureEnvelope = envelope();
  let projectionFails = true;
  let pulls = 0;
  const change = { kind: 'record', record: { spaceId: 'space-a', entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z', originClientId: 'client-a', deleted: false, payload: { quadrant: 'P0', text: 'remote', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: '0' }, sequence: 1, retainUntil: null } };
  const connection = {
    policy: { url: 'http://localhost:43822/' },
    session: async () => ({ data: session() }),
    push: async () => ({ data: { results: [] } }),
    pull: async () => ({ data: { changes: [change], nextCursor: 'cursor-1', upperCursor: 'cursor-1', hasMore: false, restoreEpoch: 1 } }),
    objectRequest: async () => ({ data: {} }),
  };
  const service = createSyncService({
    protocolClient: { connect: async () => connection }, credentialEnvelope: secureEnvelope, store, workspaceId: 'workspace-a', randomUUID: () => TOKEN_ID,
    setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {},
    applyRemoteBatch: async (batch) => { pulls += 1; if (projectionFails) throw Object.assign(new Error('projection_failed'), { code: 'projection_failed', retryable: true }); return { batchId: batch.batchId, cursor: batch.nextCursor }; },
  });
  const tested = await service.testConnection({ baseUrl: 'http://localhost:43822', clientKey: 'dpk_v1_private-value', allowLoopbackHttp: true });
  const preview = await service.previewFirstSync({ token: tested.token, categories: { todo: true }, local: { totalRecords: 0 } });
  await service.saveBinding({ token: tested.token, categories: { todo: true }, firstSync: { mode: 'merge', planId: preview.planId } });
  const failed = await service.runNow();
  assert.equal(failed.ok, false);
  assert.equal(store.cursor(), null);
  assert.equal(store.inbox().length, 1);
  projectionFails = false;
  const replayed = await service.runNow();
  assert.equal(replayed.ok, true);
  assert.equal(store.cursor().cursor, 'cursor-1');
  assert.equal(store.inbox().length, 0);
  assert.equal(pulls, 2);
  service.stop();
});

test('sync local store migrates and isolates binding, queues, cursors, and transfers per workspace', (t) => {
  const store = temporaryStore(t);
  const encrypted = { version: 1, kind: 'safeStorage', ciphertext: Buffer.from('cipher').toString('base64') };
  store.saveBinding(binding('workspace-a'), encrypted);
  store.enqueue({ operationId: 'op-a' });
  store.saveCursor({ cursor: 'cursor-a' });
  store.saveTransfer({ transferId: 'transfer-a' });
  store.switchWorkspace('workspace-b');
  assert.equal(store.binding(), null);
  assert.deepEqual(store.outbox(), []);
  assert.equal(store.cursor(), null);
  assert.deepEqual(store.transfers(), []);
  store.saveBinding(binding('workspace-b', 'b'), encrypted);
  store.enqueue({ operationId: 'op-b' });
  store.switchWorkspace('workspace-a');
  assert.equal(store.binding().clientId, 'client-a');
  assert.deepEqual(store.outbox().map((row) => row.operationId), ['op-a']);
  assert.equal(store.cursor().cursor, 'cursor-a');
  assert.equal(store.transfers()[0].transferId, 'transfer-a');
});

test('real loopback server converges a local operation onto a second desktop client', async (t) => {
  const { buildServer } = await import('../sync-server/src/server.js');
  const server = await buildServer({ env: { NODE_ENV: 'test', COOKIE_SECRET: 'desktop-e2e-cookie-secret-at-least-32', KEY_LOOKUP_SECRET: 'desktop-e2e-lookup-secret-at-least-32' } });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const account = await server.identity.createAccount({ username: 'desktop-e2e', password: 'correct horse battery staple' });
  const login = await server.identity.login({ username: account.username, password: 'correct horse battery staple', requestId: 'desktop-e2e' });
  const accountContext = await server.identity.authenticateSession(login.token);
  await server.identity.reauthenticate(accountContext, 'correct horse battery staple');
  const space = await server.identity.createSpace(accountContext, 'Desktop E2E');
  const clientA = await server.identity.createClient(accountContext, space.spaceId, 'Desktop A');
  const clientB = await server.identity.createClient(accountContext, space.spaceId, 'Desktop B');
  const { createProtocolClient } = require('../main/sync/protocol-client');
  const protocolClient = createProtocolClient({ fetchImpl: fetch, lookup: require('node:dns').promises.lookup, appVersion: '1.1.0', platform: 'test-x64' });
  const url = address;

  async function desktop(name, key, projected) {
    const store = temporaryStore(t, `workspace-${name}`);
    let sequence = 0;
    const service = createSyncService({
      protocolClient, credentialEnvelope: envelope(), store, workspaceId: `workspace-${name}`,
      randomUUID: () => `${String(++sequence).padStart(8, '0')}-0000-4000-8000-000000000000`,
      setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {},
      onFailure: (error) => { projected.failure = { message: error.message, code: error.code, stack: error.stack }; },
      applyRemoteBatch: async (batch) => { projected.push(...batch.changes); return { batchId: batch.batchId, cursor: batch.nextCursor }; },
    });
    const tested = await service.testConnection({ baseUrl: url, clientKey: key, allowLoopbackHttp: true });
    assert.equal(tested.ok, true, JSON.stringify(tested));
    const preview = await service.previewFirstSync({ token: tested.token, categories: { todo: true }, local: { totalRecords: 0 } });
    const saved = await service.saveBinding({ token: tested.token, categories: { todo: true }, firstSync: { mode: 'merge', planId: preview.planId } });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    return service;
  }

  const projectedA = [], projectedB = [];
  const first = await desktop('a', clientA.clientKey, projectedA);
  const second = await desktop('b', clientB.clientKey, projectedB);
  first.enqueue({ operationId: 'desktop-e2e-operation', entityType: 'todo', entityId: 'todo-e2e', category: 'todo', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: { quadrant: 'P0', text: 'cross-device', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: '0' } });
  const firstResult = await first.runNow();
  assert.equal(firstResult.ok, true, JSON.stringify({ firstResult, failure: projectedA.failure }));
  const secondResult = await second.runNow();
  assert.equal(secondResult.ok, true, JSON.stringify(secondResult));
  const remote = projectedB.find((change) => change.record?.entityId === 'todo-e2e')?.record;
  assert.equal(remote?.payload.text, 'cross-device');
  assert.equal(remote?.originClientId, clientA.clientId);
  first.stop(); second.stop();
});

test('destructive local-wins first sync creates a verified recovery and replaces server records', async (t) => {
  const recoveryPointId = '55555555-5555-4555-8555-555555555555';
  const { buildServer } = await import('../sync-server/src/server.js');
  const server = await buildServer({
    env: { NODE_ENV: 'test', COOKIE_SECRET: 'first-sync-cookie-secret-at-least-32', KEY_LOOKUP_SECRET: 'first-sync-lookup-secret-at-least-32' },
    operations: {
      createSyncRecovery: async () => ({ id: recoveryPointId }),
      verifySyncRecovery: async ({ recoveryPointId: candidate }) => ({ verified: candidate === recoveryPointId }),
    },
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const account = await server.identity.createAccount({ username: 'first-sync-e2e', password: 'correct horse battery staple' });
  const login = await server.identity.login({ username: account.username, password: 'correct horse battery staple', requestId: 'first-sync-e2e' });
  const accountContext = await server.identity.authenticateSession(login.token);
  await server.identity.reauthenticate(accountContext, 'correct horse battery staple');
  const space = await server.identity.createSpace(accountContext, 'First Sync E2E');
  const client = await server.identity.createClient(accountContext, space.spaceId, 'Desktop');
  const store = temporaryStore(t, 'workspace-first-sync');
  const { createProtocolClient } = require('../main/sync/protocol-client');
  const protocolClient = createProtocolClient({ fetchImpl: fetch, lookup: require('node:dns').promises.lookup, appVersion: '1.1.0', platform: 'test-x64' });
  const service = createSyncService({ protocolClient, credentialEnvelope: envelope(), store, workspaceId: 'workspace-first-sync', randomUUID: () => TOKEN_ID, setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {}, applyRemoteBatch: async (batch) => ({ batchId: batch.batchId, cursor: batch.nextCursor }) });
  const tested = await service.testConnection({ baseUrl: address, clientKey: client.clientKey, allowLoopbackHttp: true });
  assert.equal(tested.ok, true, JSON.stringify(tested));
  const authenticated = await server.identity.authenticateClient(client.clientKey);
  server.recordRepository.seedSpace?.(authenticated);
  await server.records.push(authenticated, [{ operationId: 'server-original', entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: { quadrant: 'P0', text: 'server', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: '0' } }]);
  const localRecord = { entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, payload: { quadrant: 'P0', text: 'local', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: '0' } };
  const local = { totalRecords: 1, records: [localRecord] };
  const preview = await service.previewFirstSync({ token: tested.token, categories: { todo: true }, local });
  await service.saveBinding({ token: tested.token, categories: { todo: true }, firstSync: { mode: 'local-wins', planId: preview.planId } });
  service.enqueue({ operationId: 'local-replacement', ...localRecord, baseRevision: 0, kind: 'upsert' });
  const result = await service.executeFirstSync({ mode: 'local-wins', planId: preview.planId, confirmation: 'REPLACE SERVER', local });
  assert.equal(result.ok, true, JSON.stringify(result));
  const reconciled = await server.records.reconcile(authenticated, { categories: ['todo'], known: [] });
  assert.equal(reconciled.records[0].payload.text, 'local');
  assert.equal(reconciled.records[0].revision, 3);
  assert.equal(store.recoveries()[0].recoveryPointId, recoveryPointId);
  const categoryUpdate = await service.setCategories({ ...store.binding().categories, todo: false });
  assert.deepEqual(categoryUpdate.disabled, ['todo']);
  const clearPlan = await service.prepareCategoryClear({ categories: ['todo'] });
  assert.equal(clearPlan.ok, true, JSON.stringify(clearPlan));
  assert.equal(clearPlan.impact.todo.records, 1);
  const cleared = await service.executeCategoryClear({ planId: clearPlan.planId, confirmation: 'DELETE SERVER CATEGORY DATA' });
  assert.equal(cleared.ok, true, JSON.stringify(cleared));
  assert.equal(cleared.deletedRecords, 1);
  assert.equal((await server.records.stats(authenticated, ['todo'])).records, 0);
  service.stop();
});

test('sync media resolver accepts only purpose-owned portable PNG paths inside the workspace', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-media-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'note-images', 'note-1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'note-images', 'note-1', 'image.png'), Buffer.from('png'));
  const accepted = await ensureSafePath({ fsModule: fs, pathModule: path, rootPath: root, relativePath: 'note-images/note-1/image.png', purpose: 'note-image' });
  assert.equal(accepted.path, path.join(root, 'note-images', 'note-1', 'image.png'));
  await assert.rejects(ensureSafePath({ fsModule: fs, pathModule: path, rootPath: root, relativePath: '../secret.png', purpose: 'note-image' }), /invalid_sync_media_path/);
  await assert.rejects(ensureSafePath({ fsModule: fs, pathModule: path, rootPath: root, relativePath: 'note-images/note-1/image.png', purpose: 'clipboard-image' }), /sync_media_scope_rejected/);
  await assert.rejects(ensureSafePath({ fsModule: fs, pathModule: path, rootPath: root, relativePath: 'recordings/private.png', purpose: 'note-image' }), /sync_media_scope_rejected/);
});
