const test = require('node:test');
const assert = require('node:assert/strict');
const { bindingNamespace, createInstallationModel, assertSessionMatches } = require('../main/sync/binding');
const { MemoryTransactionalStore, DurableSyncState } = require('../renderer/sync/sync-state');
const { projectInboxBatch } = require('../renderer/sync/projection');

function binding(name) { return { instanceId: 'instance', spaceId: `space-${name}`, clientId: `client-${name}`, workspaceId: 'workspace', restoreEpoch: 1 }; }
function operation(id, text = id) { return { operationId: id, entityType: 'todo', entityId: `todo-${id}`, category: 'todo', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: { text } }; }
function batch() { return { batchId: 'batch-1', nextCursor: 'cursor-1', upperCursor: 'upper-1', restoreEpoch: 1, changes: [{ record: { entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, revision: 1, deleted: false, payload: { text: 'remote' } } }] }; }

test('binding namespaces isolate A/B state and generation tokens cancel late work', async () => {
  const model = createInstallationModel({ randomUUID: () => 'install-1' });
  model.bind(binding('a')); const tokenA = model.token();
  model.bind(binding('b')); const tokenB = model.token();
  assert.equal(model.isCurrent(tokenA), false); assert.equal(model.isCurrent(tokenB), true);
  assert.notEqual(bindingNamespace(binding('a')), bindingNamespace(binding('b')));
  assert.throws(() => assertSessionMatches(binding('a'), { instance: { instanceId: 'instance' }, identity: { spaceId: 'space-b', clientId: 'client-a' }, state: { restoreEpoch: 1 } }), /spaceId_changed/);
  const store = new MemoryTransactionalStore(); const a = new DurableSyncState(store, bindingNamespace(binding('a'))); const b = new DurableSyncState(store, bindingNamespace(binding('b')));
  await a.enqueue(operation('op-a')); assert.equal((await a.outbox()).length, 1); assert.equal((await b.outbox()).length, 0);
});

test('outbox operations are durable, idempotent and atomically acknowledged across restart', async () => {
  const namespace = bindingNamespace(binding('a')); const store = new MemoryTransactionalStore(); const state = new DurableSyncState(store, namespace);
  await Promise.all([state.enqueue(operation('op-1')), state.enqueue(operation('op-2'))]);
  await state.enqueue(operation('op-1'));
  await assert.rejects(state.enqueue(operation('op-1', 'changed')), /operation_reused/);
  const restarted = new DurableSyncState(new MemoryTransactionalStore(store.snapshot()), namespace);
  assert.equal((await restarted.outbox()).length, 2);
  assert.equal(await restarted.acknowledge('op-1', { record: { revision: 1 } }), true);
  assert.equal((await restarted.outbox()).length, 1);
});

test('projection does not advance cursor before apply markers and replays crash boundaries idempotently', async () => {
  for (const crashPoint of ['after-stage', 'after-apply:0', 'after-marker:0', 'after-commit']) {
    const namespace = `${bindingNamespace(binding('a'))}-${crashPoint}`;
    const store = new MemoryTransactionalStore(); const state = new DurableSyncState(store, namespace); const projected = new Map(); let snapshots = 0; let crashed = false;
    const adapters = { todo: { apply: async (record) => { const prior = projected.get(record.entityId); if (!prior || prior.revision < record.revision) projected.set(record.entityId, record); } } };
    await assert.rejects(projectInboxBatch({ state, batch: batch(), adapters, requestWorkspaceSnapshot: async () => { snapshots += 1; }, fault(point) { if (!crashed && point === crashPoint) { crashed = true; throw new Error(`crash:${point}`); } } }), /crash/);
    const cursorAfterCrash = await state.tx(['cursors'], (tx) => tx.get('cursors', 'committed'));
    if (crashPoint !== 'after-commit') assert.equal(cursorAfterCrash, undefined, crashPoint);
    const result = await projectInboxBatch({ state, batch: batch(), adapters, requestWorkspaceSnapshot: async () => { snapshots += 1; } });
    assert.equal(result.cursor, 'cursor-1'); assert.equal(projected.get('todo-1').revision, 1);
    const cursor = await state.tx(['cursors'], (tx) => tx.get('cursors', 'committed'));
    assert.equal(cursor.cursor, 'cursor-1'); assert.ok(snapshots >= 1);
  }
});

test('durable auxiliary stores retain conflict, object, transfer and quarantine checkpoints', async () => {
  const store = new MemoryTransactionalStore(); const state = new DurableSyncState(store, 'aux');
  await state.saveConflict({ conflictId: 'conflict-1', entityId: 'todo-1' });
  await state.saveObject({ objectId: 'object-1', digest: 'sha256:x' });
  await state.saveTransfer({ transferId: 'transfer-1', completedParts: [1] });
  await state.quarantine('bad-1', { schemaVersion: 2 }, 'unsupported_remote_schema');
  const restarted = new DurableSyncState(new MemoryTransactionalStore(store.snapshot()), 'aux');
  assert.equal((await restarted.conflicts())[0].conflictId, 'conflict-1');
  assert.equal((await restarted.object('object-1')).digest, 'sha256:x');
  assert.deepEqual((await restarted.transfer('transfer-1')).completedParts, [1]);
  assert.equal((await restarted.quarantined())[0].reason, 'unsupported_remote_schema');
});

test('unknown remote payload fields are quarantined without advancing the cursor', async () => {
  const state = new DurableSyncState(new MemoryTransactionalStore(), 'quarantine'); const invalid = batch();
  invalid.changes[0].record.payload.futureField = true;
  await assert.rejects(projectInboxBatch({ state, batch: invalid, adapters: { todo: { apply: async () => assert.fail('must not apply') } } }), /unknown_remote_payload_property/);
  assert.equal((await state.quarantined()).length, 1);
  assert.equal(await state.cursor(), undefined);
});

test('projection cancels stale binding generation without committing cursor', async () => {
  const state = new DurableSyncState(new MemoryTransactionalStore(), 'namespace');
  await assert.rejects(projectInboxBatch({ state, batch: batch(), adapters: { todo: { apply: async () => {} } }, isGenerationCurrent: () => false }), /generation_cancelled/);
  assert.equal(await state.tx(['cursors'], (tx) => tx.get('cursors', 'committed')), undefined);
});
