import { randomUUID } from 'node:crypto';

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const scopeKey = ({ accountId, spaceId }) => `${accountId}:${spaceId}`;
const recordKey = (entityType, entityId) => `${entityType}:${entityId}`;

function newSpace(scope) {
  return { accountId: scope.accountId, spaceId: scope.spaceId, restoreEpoch: scope.restoreEpoch ?? 1, nextSequence: 0, floorSequence: 1, records: new Map(), versions: new Map(), operations: new Map(), changes: [], conflicts: new Map(), categories: new Map() };
}

export class MemoryRecordRepository {
  constructor() { this.spaces = new Map(); this.locks = new Map(); }
  seedSpace(scope) { const key = scopeKey(scope); if (!this.spaces.has(key)) this.spaces.set(key, newSpace(scope)); return cloneSpaceHeader(this.spaces.get(key)); }

  async transaction(scope, callback) {
    const key = scopeKey(scope);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => pending);
    this.locks.set(key, queued);
    await previous;
    try {
      const state = this.spaces.get(key);
      if (!state) throw new RepositoryError('scope_not_found');
      if (scope.restoreEpoch !== undefined && state.restoreEpoch !== scope.restoreEpoch) throw new RepositoryError('restore_epoch_changed');
      const working = cloneState(state);
      const result = await callback(new MemoryRecordTransaction(working));
      this.spaces.set(key, working);
      return clone(result);
    } finally { release(); if (this.locks.get(key) === queued) this.locks.delete(key); }
  }

  async read(scope, callback) {
    const state = this.spaces.get(scopeKey(scope));
    if (!state) throw new RepositoryError('scope_not_found');
    return clone(await callback(new MemoryRecordTransaction(state, true)));
  }

  async advanceEpoch(scope) {
    return this.transaction(scope, (tx) => {
      tx.state.restoreEpoch += 1;
      tx.state.floorSequence = tx.state.nextSequence + 1;
      tx.state.changes = [];
      return tx.space();
    });
  }

  async setFloor(scope, sequence) { return this.transaction(scope, (tx) => { tx.state.floorSequence = sequence; return tx.space(); }); }
}

class MemoryRecordTransaction {
  constructor(state, readonly = false) { this.state = state; this.readonly = readonly; }
  space() { return cloneSpaceHeader(this.state); }
  getOperation(clientId, operationId) { return clone(this.state.operations.get(`${clientId}:${operationId}`)); }
  putOperation(clientId, operationId, value) { this.assertWrite(); this.state.operations.set(`${clientId}:${operationId}`, clone(value)); }
  getRecord(type, id) { return clone(this.state.records.get(recordKey(type, id))); }
  putRecord(record) { this.assertWrite(); this.state.records.set(recordKey(record.entityType, record.entityId), clone(record)); }
  getVersion(type, id, revision) { return clone(this.state.versions.get(recordKey(type, id))?.get(revision)); }
  putVersion(version) { this.assertWrite(); const key = recordKey(version.entityType, version.entityId); if (!this.state.versions.has(key)) this.state.versions.set(key, new Map()); this.state.versions.get(key).set(version.revision, clone(version)); }
  nextSequence() { this.assertWrite(); this.state.nextSequence += 1; return this.state.nextSequence; }
  addChange(change) { this.assertWrite(); this.state.changes.push(clone(change)); }
  listChanges(after, upper, limit, categories) { return clone(this.state.changes.filter((row) => row.sequence > after && row.sequence <= upper && (!categories?.length || categories.includes(row.category))).slice(0, limit)); }
  listRecords(categories) { return clone([...this.state.records.values()].filter((row) => !categories?.length || categories.includes(row.category)).sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId))); }
  addConflict(conflict) { this.assertWrite(); const row = { conflictId: conflict.conflictId ?? randomUUID(), ...clone(conflict) }; this.state.conflicts.set(row.conflictId, row); return clone(row); }
  getConflict(id) { return clone(this.state.conflicts.get(id)); }
  listConflicts(status, after = '', limit = 100) { return clone([...this.state.conflicts.values()].filter((row) => row.status === status && row.conflictId > after).sort((a, b) => a.conflictId.localeCompare(b.conflictId)).slice(0, limit)); }
  updateConflict(id, patch) { this.assertWrite(); const current = this.state.conflicts.get(id); if (!current) return undefined; const row = { ...current, ...clone(patch) }; this.state.conflicts.set(id, row); return clone(row); }
  countConflicts() { return [...this.state.conflicts.values()].filter((row) => row.status === 'unresolved').length; }
  setCategory(category, patch) { this.assertWrite(); const row = { category, present: false, clearGeneration: 0, ...(this.state.categories.get(category) || {}), ...clone(patch) }; this.state.categories.set(category, row); return clone(row); }
  categories() { return clone([...this.state.categories.values()]); }
  assertWrite() { if (this.readonly) throw new RepositoryError('readonly_transaction'); }
}

function cloneState(state) {
  const copy = newSpace(state);
  copy.restoreEpoch = state.restoreEpoch; copy.nextSequence = state.nextSequence; copy.floorSequence = state.floorSequence;
  copy.records = new Map([...state.records].map(([key, value]) => [key, clone(value)]));
  copy.versions = new Map([...state.versions].map(([key, versions]) => [key, new Map([...versions].map(([revision, value]) => [revision, clone(value)]))]));
  copy.operations = new Map([...state.operations].map(([key, value]) => [key, clone(value)]));
  copy.changes = clone(state.changes); copy.conflicts = new Map([...state.conflicts].map(([key, value]) => [key, clone(value)])); copy.categories = new Map([...state.categories].map(([key, value]) => [key, clone(value)]));
  return copy;
}
function cloneSpaceHeader(state) { return { accountId: state.accountId, spaceId: state.spaceId, restoreEpoch: state.restoreEpoch, nextSequence: state.nextSequence, floorSequence: state.floorSequence }; }
export class RepositoryError extends Error { constructor(code) { super(code); this.name = 'RepositoryError'; this.code = code; } }
