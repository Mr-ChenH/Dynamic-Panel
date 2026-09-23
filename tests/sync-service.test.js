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
