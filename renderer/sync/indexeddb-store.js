(function exposeSyncIndexedDb(root, factory) {
const syncState = typeof module !== 'undefined' ? require('./sync-state') : root.NotchSyncState;
const exported = factory(syncState);
root.NotchSyncIndexedDb = exported;
if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window, function createSyncIndexedDb({ STORE_NAMES }) {

function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

class IndexedDbTransactionalStore {
  constructor({ indexedDB = globalThis.indexedDB, name = 'dynamic-panel-sync-v1' } = {}) { if (!indexedDB) throw new TypeError('indexeddb_required'); this.indexedDB = indexedDB; this.name = name; this.openPromise = null; }
  open() {
    if (!this.openPromise) this.openPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => { for (const name of STORE_NAMES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return this.openPromise;
  }
  async transaction(namespace, storeNames, callback) {
    const db = await this.open();
    const names = [...new Set(storeNames || STORE_NAMES)];
    const transaction = db.transaction(names, 'readwrite');
    const key = (value) => `${namespace}\u0000${String(value)}`;
    const tx = Object.freeze({
      get: (store, id) => requestResult(transaction.objectStore(store).get(key(id))),
      put: (store, id, value) => requestResult(transaction.objectStore(store).put(value, key(id))),
      delete: (store, id) => requestResult(transaction.objectStore(store).delete(key(id))),
      entries: (store) => new Promise((resolve, reject) => {
        const rows = []; const request = transaction.objectStore(store).openCursor();
        request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(rows); if (String(cursor.key).startsWith(`${namespace}\u0000`)) rows.push([String(cursor.key).slice(namespace.length + 1), cursor.value]); cursor.continue(); };
        request.onerror = () => reject(request.error);
      }),
      values: async (store) => (await tx.entries(store)).map((row) => row[1]),
    });
    let result;
    try { result = await callback(tx); } catch (error) { transaction.abort(); throw error; }
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('transaction_aborted')); });
    return result;
  }
}

return Object.freeze({ IndexedDbTransactionalStore });
});
