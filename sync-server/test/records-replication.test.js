import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRecordRepository } from '../src/records/memory-repository.js';
import { RecordReplicationService, ReplicationError } from '../src/records/service.js';
import { InvalidationRegistry, POLLING_FALLBACK_MS, assertInvalidationPayload } from '../src/realtime/registry.js';
import { validateEntity, RecordValidationError } from '../src/records/schema-registry.js';

const SECRET = 'records-test-secret-at-least-thirty-two-characters';
const scope = { accountId: 'account-a', spaceId: 'space-a', clientId: 'client-a', restoreEpoch: 1 };
const other = { accountId: 'account-a', spaceId: 'space-a', clientId: 'client-b', restoreEpoch: 1 };
const note = (body, title = 'Plan') => ({ title, titleSource: 'user', body, categoryId: '', tagId: '', createdAt: 1, updatedAt: 1, imageObjectIds: [] });
const op = (operationId, payload, baseRevision = 0, overrides = {}) => ({ operationId, entityType: 'note', entityId: 'note-1', category: 'notes', schemaVersion: 1, baseRevision, kind: 'upsert', payload, ...overrides });

function fixture() {
  const repository = new MemoryRecordRepository(); repository.seedSpace(scope);
  const invalidations = new InvalidationRegistry();
  const service = new RecordReplicationService({ repository, cursorSecret: SECRET, instanceId: 'instance-a', invalidations, clock: () => new Date('2026-01-01T00:00:00.000Z') });
  return { repository, service, invalidations };
}

test('100 operation replays are idempotent and changed reuse fails', async () => {
  const { service } = fixture(); const operation = op('op-replay', note('one'));
  const results = await Promise.all(Array.from({ length: 100 }, () => service.push(scope, [operation])));
  assert.equal(results.filter((row) => row.results[0].status === 'accepted').length, 1);
  assert.equal(results.filter((row) => row.results[0].status === 'duplicate').length, 99);
  const stats = await service.stats(scope); assert.equal(stats.sequence, 1); assert.equal(stats.records, 1);
  await assert.rejects(() => service.push(scope, [op('op-replay', note('changed'))]), (error) => error instanceof ReplicationError && error.code === 'operation_reused');
});

test('server source, revision, sequence and time ignore forged client values', async () => {
  const { service } = fixture();
  const forged = { ...op('op-forged', note('body')), originClientId: 'client-b', revision: 99, updatedAt: '1999-01-01', spaceId: 'space-b' };
  const rejected = await service.push(scope, [forged]); assert.equal(rejected.results[0].status, 'rejected');
  const accepted = (await service.push(scope, [op('op-real', note('body'))])).results[0];
  assert.equal(accepted.record.originClientId, 'client-a'); assert.equal(accepted.record.revision, 1); assert.equal(accepted.record.sequence, 1); assert.equal(accepted.record.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('concurrent note edits retain incoming copy and field metadata', async () => {
  const { service } = fixture(); await service.push(scope, [op('op-base', note('base'))]);
  const [a, b] = await Promise.all([service.push(scope, [op('op-a', note('alpha'), 1)]), service.push(other, [op('op-b', note('beta'), 1)])]);
  const statuses = [a.results[0].status, b.results[0].status].sort(); assert.deepEqual(statuses, ['accepted', 'conflict']);
  const pull = await service.pull(scope); const conflict = pull.changes.find((row) => row.kind === 'conflict');
  assert.equal(conflict.conflict.reason, 'conflict_copy'); assert.deepEqual(conflict.conflict.changedFields, ['body']);
  const stats = await service.stats(scope); assert.equal(stats.records, 1); assert.equal(stats.unresolvedConflicts, 1); assert.equal(stats.sequence, 3);
});

test('account conflict listing and manual resolution create a validated revision', async () => {
  const { service } = fixture();
  await service.push(scope, [op('account-base', note('base'))]);
  await service.push(scope, [op('account-current', note('alpha'), 1)]);
  await service.push(other, [op('account-incoming', note('beta'), 1)]);
  const page = await service.listConflictsForAccount({ accountId: scope.accountId, spaceId: scope.spaceId });
  assert.equal(page.items.length, 1);
  const conflict = page.items[0];
  await assert.rejects(() => service.resolveConflictForAccount({ accountId: scope.accountId, spaceId: scope.spaceId }, { conflictId: conflict.conflictId, resolution: 'manual', baseRevision: 2, payload: { ...note('bad'), apiKey: 'secret' } }), (error) => error.code === 'forbidden_field');
  const resolved = await service.resolveConflictForAccount({ accountId: scope.accountId, spaceId: scope.spaceId }, { conflictId: conflict.conflictId, resolution: 'manual', baseRevision: 2, payload: note('merged') });
  assert.equal(resolved.status, 'accepted');
  assert.equal(resolved.record.revision, 3);
  assert.equal(resolved.record.payload.body, 'merged');
  assert.equal((await service.stats(scope)).unresolvedConflicts, 0);
});

test('delete blocks stale resurrection and retained tombstone restores as a new revision', async () => {
  const { service } = fixture(); await service.push(scope, [op('op-base', note('base'))]);
  const deleted = (await service.push(scope, [{ operationId: 'op-delete', entityType: 'note', entityId: 'note-1', category: 'notes', schemaVersion: 1, baseRevision: 1, kind: 'delete' }])).results[0];
  assert.equal(deleted.record.deleted, true); assert.match(deleted.record.retainUntil, /^2026-01-31/);
  const stale = (await service.push(other, [op('op-stale', note('offline text'), 1)])).results[0]; assert.equal(stale.status, 'conflict');
  const restored = await service.restore(scope, { entityType: 'note', entityId: 'note-1', operationId: 'op-restore', baseRevision: 2 });
  assert.equal(restored.record.deleted, false); assert.equal(restored.record.revision, 3); assert.equal(restored.record.payload.body, 'base');
  const pull = await service.pull(scope); assert.deepEqual(pull.changes.map((row) => row.kind), ['record', 'tombstone', 'conflict', 'restore']);
});

test('field merge combines disjoint edits while preference is server-order LWW', async () => {
  const { service } = fixture();
  const todoBase = { quadrant: 'P0', text: 'one', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: 'a' };
  const todo = (id, payload, baseRevision) => ({ operationId: id, entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, baseRevision, kind: 'upsert', payload });
  await service.push(scope, [todo('todo-base', todoBase, 0)]);
  await service.push(scope, [todo('todo-a', { ...todoBase, text: 'renamed' }, 1)]);
  const merged = (await service.push(other, [todo('todo-b', { ...todoBase, done: true }, 1)])).results[0];
  assert.equal(merged.status, 'accepted'); assert.equal(merged.merged, true); assert.equal(merged.record.payload.text, 'renamed'); assert.equal(merged.record.payload.done, true);
  const pref = (id, value, baseRevision) => ({ operationId: id, entityType: 'preference', entityId: 'theme', category: 'preferences', schemaVersion: 1, baseRevision, kind: 'upsert', payload: { key: 'theme', value } });
  await service.push(scope, [pref('pref-a', 'light', 0)]); const lww = (await service.push(other, [pref('pref-b', 'dark', 0)])).results[0];
  assert.equal(lww.status, 'accepted'); assert.equal(lww.record.payload.value, 'dark'); assert.equal(lww.record.revision, 2);
});

test('signed cursor holds a stable page upper bound without skipping concurrent writes', async () => {
  const { service } = fixture();
  for (let i = 0; i < 3; i += 1) await service.push(scope, [op(`op-${i}`, note(String(i)), i, { entityId: 'note-1' })]);
  const first = await service.pull(scope, { limit: 1 }); assert.equal(first.hasMore, true); assert.equal(first.changes[0].sequence, 1);
  await service.push(scope, [op('op-concurrent', note('3'), 3)]);
  const second = await service.pull(scope, { cursor: first.nextCursor, limit: 2 }); assert.deepEqual(second.changes.map((row) => row.sequence), [2, 3]); assert.equal(second.hasMore, false);
  const later = await service.pull(scope, { cursor: second.nextCursor, limit: 2 }); assert.deepEqual(later.changes.map((row) => row.sequence), [4]);
  await assert.rejects(() => service.pull({ ...scope, spaceId: 'space-b' }, { cursor: first.nextCursor }), /scope_not_found/);
  await assert.rejects(() => service.pull(scope, { cursor: `${first.nextCursor}x` }), (error) => error.code === 'invalid_cursor');
});

test('filtered cursors advance over nonmatching rows and cannot change filter scope', async () => {
  const { service, repository } = fixture();
  await service.push(scope, [op('op-note', note('one'))]);
  const todoPayload = { quadrant: 'P0', text: 'todo', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: 'a' };
  await service.push(scope, [{ operationId: 'op-todo', entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: todoPayload }]);
  const notes = await service.pull(scope, { categories: ['notes'] });
  assert.deepEqual(notes.changes.map((row) => row.sequence), [1]);
  await repository.setFloor(scope, 3);
  const caughtUp = await service.pull(scope, { cursor: notes.nextCursor, categories: ['notes'] });
  assert.deepEqual(caughtUp.changes, []);
  await assert.rejects(() => service.pull(scope, { cursor: notes.nextCursor, categories: ['todo'] }), (error) => error.code === 'invalid_cursor');
});

test('reconcile tokens bind the query and epoch advancement keeps restored records visible', async () => {
  const { service, repository } = fixture();
  await service.push(scope, [op('op-note-1', note('one'), 0, { entityId: 'note-1' })]);
  await service.push(scope, [op('op-note-2', note('two'), 0, { entityId: 'note-2' })]);
  const first = await service.reconcile(scope, { categories: ['notes'], known: [], limit: 1 });
  assert.equal(first.hasMore, true);
  await assert.rejects(() => service.reconcile(scope, { categories: ['todo'], known: [], limit: 1, pageToken: first.pageToken }), (error) => error.code === 'invalid_page_token');
  await repository.advanceEpoch(scope);
  const restored = await service.reconcile({ ...scope, restoreEpoch: 2 }, { categories: ['notes'], known: [] });
  assert.deepEqual(restored.records.map((row) => row.entityId), ['note-1', 'note-2']);
  assert.equal(restored.restoreEpoch, 2);
});

test('expired and restore-epoch cursors fail without partial data', async () => {
  const { service, repository } = fixture(); await service.push(scope, [op('op-1', note('one'))]); const cursor = (await service.pull(scope)).nextCursor;
  await service.push(scope, [op('op-2', note('two'), 1)]); await repository.setFloor(scope, 3);
  await assert.rejects(() => service.pull(scope, { cursor }), (error) => error.code === 'cursor_expired' && error.statusCode === 410);
  await repository.advanceEpoch(scope);
  await assert.rejects(() => service.pull({ ...scope, restoreEpoch: 2 }, { cursor }), (error) => error.code === 'restore_epoch_changed');
});

test('destructive first-sync plans bind verified impact and require exact confirmation', async () => {
  const { service } = fixture();
  await service.push(scope, [op('first-sync-base', note('server copy'))]);
  const impact = await service.firstSyncImpact(scope, ['notes']);
  const plan = service.createFirstSyncPlan(scope, { planId: '11111111-1111-4111-8111-111111111111', mode: 'local-wins', categories: ['notes'], recoveryPointId: '22222222-2222-4222-8222-222222222222', impact });
  await assert.rejects(() => service.executeFirstSyncPlan(scope, { planToken: plan.planToken, planId: '11111111-1111-4111-8111-111111111111', mode: 'local-wins', recoveryPointId: plan.recoveryPointId, confirmation: 'replace server' }), (error) => error.code === 'first_sync_plan_changed');
  const executed = await service.executeFirstSyncPlan(scope, { planToken: plan.planToken, planId: '11111111-1111-4111-8111-111111111111', mode: 'local-wins', recoveryPointId: plan.recoveryPointId, confirmation: 'REPLACE SERVER' });
  assert.equal(executed.records.length, 1);
  assert.equal(executed.records[0].deleted, true);
  assert.equal((await service.stats(scope, ['notes'])).records, 0);
});

test('destructive first-sync rejects a changed server revision after recovery planning', async () => {
  const { service } = fixture();
  await service.push(scope, [op('impact-base', note('one'))]);
  const impact = await service.firstSyncImpact(scope, ['notes']);
  const plan = service.createFirstSyncPlan(scope, { planId: '33333333-3333-4333-8333-333333333333', mode: 'local-wins', categories: ['notes'], recoveryPointId: '44444444-4444-4444-8444-444444444444', impact });
  await service.push(scope, [op('impact-update', note('two'), 1)]);
  await assert.rejects(() => service.executeFirstSyncPlan(scope, { planToken: plan.planToken, planId: '33333333-3333-4333-8333-333333333333', mode: 'local-wins', recoveryPointId: plan.recoveryPointId, confirmation: 'REPLACE SERVER' }), (error) => error.code === 'first_sync_impact_changed');
  assert.equal((await service.stats(scope, ['notes'])).records, 1);
});

test('category-clear plans require exact confirmation and tombstone only selected categories', async () => {
  const { service } = fixture();
  await service.push(scope, [op('clear-note', note('keep recoverable'))]);
  const todoPayload = { quadrant: 'P0', text: 'keep active', done: false, createdAt: 1, deadline: '', remindedAt: 0, sortKey: 'a' };
  await service.push(scope, [{ operationId: 'clear-todo', entityType: 'todo', entityId: 'todo-1', category: 'todo', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: todoPayload }]);
  const impact = await service.firstSyncImpact(scope, ['notes']);
  const plan = service.createFirstSyncPlan(scope, { planId: '66666666-6666-4666-8666-666666666666', mode: 'category-clear', categories: ['notes'], recoveryPointId: '77777777-7777-4777-8777-777777777777', impact });
  const result = await service.executeFirstSyncPlan(scope, { planToken: plan.planToken, planId: '66666666-6666-4666-8666-666666666666', mode: 'category-clear', recoveryPointId: plan.recoveryPointId, confirmation: 'DELETE SERVER CATEGORY DATA' });
  assert.equal(result.records.length, 1);
  assert.equal((await service.stats(scope, ['notes'])).records, 0);
  assert.equal((await service.stats(scope, ['todo'])).records, 1);
});

test('strict registry rejects unknown fields, secrets and absolute paths for every payload', () => {
  assert.throws(() => validateEntity({ entityType: 'note', category: 'notes', schemaVersion: 1, payload: { ...note('x'), extra: true } }), RecordValidationError);
  assert.throws(() => validateEntity({ entityType: 'note', category: 'notes', schemaVersion: 1, payload: { ...note('x'), apiKey: 'secret' } }), (error) => error.code === 'forbidden_field');
  assert.throws(() => validateEntity({ entityType: 'command', category: 'commands', schemaVersion: 1, payload: { text: 'C:\\Users\\person\\private.txt', createdAt: 1 } }), (error) => error.code === 'forbidden_path');
});

test('realtime invalidations carry no business data and polling fallback is 30 seconds', async () => {
  const registry = new InvalidationRegistry(); const sent = []; registry.register(scope, { send: (value) => sent.push(value) });
  registry.publish({ accountId: scope.accountId, spaceId: scope.spaceId, sequence: 7, restoreEpoch: 1 });
  assert.deepEqual(sent, [{ type: 'cursor-available', sequence: 7, restoreEpoch: 1 }]); assert.equal(POLLING_FALLBACK_MS, 30_000);
  assert.throws(() => assertInvalidationPayload({ type: 'cursor-available', sequence: 8, restoreEpoch: 1, payload: note('leak') }), /business data forbidden/);
  registry.closeSpace(scope.spaceId);
  assert.deepEqual(sent.at(-1), { type: 'connection-revoked', reason: 'space_inactive' });
  assert.throws(() => assertInvalidationPayload({ type: 'connection-revoked', reason: 'note body leak' }), /business data forbidden/);
});
