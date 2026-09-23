(function exposeSyncState(root, factory) {
const exported = factory();
root.NotchSyncState = exported;
if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window, function createSyncState() {
const STORE_NAMES = Object.freeze(['bindings', 'entityMirror', 'outbox', 'inboxBatches', 'cursors', 'conflicts', 'objectMap', 'transfers', 'quarantine']);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

class MemoryTransactionalStore {
  constructor(snapshot) {
    this.namespaces = new Map();
    this.locks = new Map();
    for (const [namespace, stores] of Object.entries(snapshot || {})) {
      const rows = new Map();
      for (const name of STORE_NAMES) rows.set(name, new Map((stores[name] || []).map(([key, value]) => [key, clone(value)])));
      this.namespaces.set(namespace, rows);
    }
  }

  async transaction(namespace, storeNames, callback) {
    if (!namespace) throw new TypeError('namespace_required');
    const previous = this.locks.get(namespace) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.locks.set(namespace, current);
    await previous;
    try {
      return await this._runTransaction(namespace, storeNames, callback);
    } finally {
      release();
      if (this.locks.get(namespace) === current) this.locks.delete(namespace);
    }
  }

  async _runTransaction(namespace, storeNames, callback) {
    const selected = [...new Set(storeNames || STORE_NAMES)];
    if (selected.some((name) => !STORE_NAMES.includes(name))) throw new TypeError('unknown_store');
    const source = this.namespaces.get(namespace) || new Map(STORE_NAMES.map((name) => [name, new Map()]));
    const draft = new Map([...source].map(([name, rows]) => [name, new Map([...rows].map(([key, value]) => [key, clone(value)]))]));
    const tx = Object.freeze({
      get: async (store, key) => clone(draft.get(store)?.get(String(key))),
      put: async (store, key, value) => { if (!selected.includes(store)) throw new TypeError('store_not_in_transaction'); draft.get(store).set(String(key), clone(value)); },
      delete: async (store, key) => { if (!selected.includes(store)) throw new TypeError('store_not_in_transaction'); draft.get(store).delete(String(key)); },
      values: async (store) => [...(draft.get(store)?.values() || [])].map(clone),
      entries: async (store) => [...(draft.get(store)?.entries() || [])].map(([key, value]) => [key, clone(value)]),
    });
    const result = await callback(tx);
    this.namespaces.set(namespace, draft);
    return result;
  }

  snapshot() {
    return Object.fromEntries([...this.namespaces].map(([namespace, stores]) => [namespace, Object.fromEntries([...stores].map(([name, rows]) => [name, [...rows].map(([key, value]) => [key, clone(value)])]))]));
  }
}

class DurableSyncState {
  constructor(store, namespace) { if (!store || !namespace) throw new TypeError('store_and_namespace_required'); this.store = store; this.namespace = namespace; }
  tx(stores, callback) { return this.store.transaction(this.namespace, stores, callback); }
  async saveBinding(binding) { return this.tx(['bindings'], (tx) => tx.put('bindings', 'current', binding)); }
  async binding() { return this.tx(['bindings'], (tx) => tx.get('bindings', 'current')); }
  async enqueue(operation) {
    if (!operation?.operationId) throw new TypeError('operation_id_required');
    return this.tx(['outbox'], async (tx) => {
      const previous = await tx.get('outbox', operation.operationId);
      if (previous && JSON.stringify(previous.operation) !== JSON.stringify(operation)) throw new TypeError('operation_reused');
      if (!previous) await tx.put('outbox', operation.operationId, { operation: clone(operation), state: 'pending', attempts: 0 });
      return previous || { operation: clone(operation), state: 'pending', attempts: 0 };
    });
  }
  async outbox() { return this.tx(['outbox'], (tx) => tx.values('outbox')); }
  async acknowledge(operationId, result) { return this.tx(['outbox', 'entityMirror'], async (tx) => { const row = await tx.get('outbox', operationId); if (!row) return false; await tx.delete('outbox', operationId); if (result?.record) await tx.put('entityMirror', `${row.operation.entityType}:${row.operation.entityId}`, result.record); return true; }); }
  async stageInbox(batch) {
    if (!batch?.batchId || !Array.isArray(batch.changes) || !batch.nextCursor) throw new TypeError('invalid_inbox_batch');
    return this.tx(['inboxBatches'], async (tx) => {
      const current = await tx.get('inboxBatches', batch.batchId);
      if (current && JSON.stringify(current.batch) !== JSON.stringify(batch)) throw new TypeError('batch_reused');
      if (!current) await tx.put('inboxBatches', batch.batchId, { batch: clone(batch), state: 'applying', projected: [] });
      return current || { batch: clone(batch), state: 'applying', projected: [] };
    });
  }
  async pendingBatches() { return this.tx(['inboxBatches'], async (tx) => (await tx.values('inboxBatches')).filter((row) => row.state === 'applying')); }
  async cursor() { return this.tx(['cursors'], (tx) => tx.get('cursors', 'committed')); }
  async saveConflict(conflict) { if (!conflict?.conflictId) throw new TypeError('conflict_id_required'); return this.tx(['conflicts'], (tx) => tx.put('conflicts', conflict.conflictId, conflict)); }
  async conflicts() { return this.tx(['conflicts'], (tx) => tx.values('conflicts')); }
  async saveObject(descriptor) { if (!descriptor?.objectId) throw new TypeError('object_id_required'); return this.tx(['objectMap'], (tx) => tx.put('objectMap', descriptor.objectId, descriptor)); }
  async object(objectId) { return this.tx(['objectMap'], (tx) => tx.get('objectMap', objectId)); }
  async saveTransfer(transfer) { if (!transfer?.transferId) throw new TypeError('transfer_id_required'); return this.tx(['transfers'], (tx) => tx.put('transfers', transfer.transferId, transfer)); }
  async transfer(transferId) { return this.tx(['transfers'], (tx) => tx.get('transfers', transferId)); }
  async removeTransfer(transferId) { return this.tx(['transfers'], (tx) => tx.delete('transfers', transferId)); }
  async quarantine(key, value, reason) { return this.tx(['quarantine'], (tx) => tx.put('quarantine', key, { value: clone(value), reason, quarantinedAt: Date.now() })); }
  async quarantined() { return this.tx(['quarantine'], (tx) => tx.values('quarantine')); }
}

return Object.freeze({ STORE_NAMES, MemoryTransactionalStore, DurableSyncState, clone });
});
