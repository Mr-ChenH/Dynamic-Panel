'use strict';

const crypto = require('crypto');

const VERSION = 2;
const EMPTY_BUCKET = Object.freeze({ binding: null, credential: null, paused: false, outbox: [], inbox: [], cursor: null, conflicts: [], transfers: [], recoveries: [] });

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function workspaceKey(value) {
  const result = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(result)) throw new TypeError('invalid_workspace_id');
  return result;
}

function sanitizeBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['instanceId', 'spaceId', 'clientId', 'workspaceId', 'spaceName', 'clientName', 'baseUrl']) if (typeof value[key] === 'string') result[key] = value[key];
  if (Number.isInteger(value.restoreEpoch) && value.restoreEpoch >= 0) result.restoreEpoch = value.restoreEpoch;
  result.allowLoopbackHttp = value.allowLoopbackHttp === true;
  result.initialized = value.initialized === true;
  result.categories = Object.fromEntries(Object.entries(value.categories || {}).filter(([, enabled]) => typeof enabled === 'boolean'));
  return result.instanceId && result.spaceId && result.clientId && result.workspaceId ? result : null;
}

function sanitizeCredential(value) {
  const validCiphertext = typeof value?.ciphertext === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext) && !value.ciphertext.includes('dpk_v1_');
  return value?.kind === 'safeStorage' && validCiphertext ? { version: 1, kind: 'safeStorage', ciphertext: value.ciphertext } : null;
}

function normalizeBucket(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...EMPTY_BUCKET,
    binding: sanitizeBinding(source.binding),
    credential: sanitizeCredential(source.credential),
    paused: source.paused === true,
    outbox: Array.isArray(source.outbox) ? clone(source.outbox) : [],
    inbox: Array.isArray(source.inbox) ? clone(source.inbox) : [],
    cursor: source.cursor && typeof source.cursor === 'object' ? clone(source.cursor) : null,
    conflicts: Array.isArray(source.conflicts) ? clone(source.conflicts) : [],
    transfers: Array.isArray(source.transfers) ? clone(source.transfers) : [],
    recoveries: Array.isArray(source.recoveries) ? clone(source.recoveries).slice(-10) : [],
  };
}

function normalizeState(value, randomUUID, initialWorkspaceId = 'default') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const requestedWorkspaceId = workspaceKey(initialWorkspaceId || source.activeWorkspaceId || source.binding?.workspaceId || 'default');
  const workspaces = {};
  if (source.version === VERSION && source.workspaces && typeof source.workspaces === 'object' && !Array.isArray(source.workspaces)) {
    for (const [id, bucket] of Object.entries(source.workspaces)) {
      try { workspaces[workspaceKey(id)] = normalizeBucket(bucket); } catch (error) {}
    }
  } else {
    const legacyWorkspaceId = workspaceKey(source.binding?.workspaceId || requestedWorkspaceId);
    workspaces[legacyWorkspaceId] = normalizeBucket(source);
  }
  if (!workspaces[requestedWorkspaceId]) workspaces[requestedWorkspaceId] = normalizeBucket();
  return {
    version: VERSION,
    installationId: isUuid(source.installationId) ? source.installationId : randomUUID(),
    activeWorkspaceId: requestedWorkspaceId,
    workspaces,
  };
}

function createSyncLocalStore({ fsModule, pathModule, filePath, workspaceId = 'default', randomUUID = crypto.randomUUID } = {}) {
  if (!fsModule || !pathModule || !filePath) throw new TypeError('sync_store_dependencies_required');
  let loaded = false;
  let state;

  function load() {
    if (loaded) return state;
    let raw = null;
    try { raw = JSON.parse(fsModule.readFileSync(filePath, 'utf8')); } catch (error) {}
    state = normalizeState(raw, randomUUID, workspaceId);
    loaded = true;
    if (!raw || raw.version !== VERSION || raw.activeWorkspaceId !== state.activeWorkspaceId) persist();
    return state;
  }

  function persist() {
    const temporary = `${filePath}.${process.pid}.tmp`;
    fsModule.mkdirSync(pathModule.dirname(filePath), { recursive: true });
    fsModule.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    fsModule.renameSync(temporary, filePath);
  }

  function active(current = load()) {
    const id = current.activeWorkspaceId;
    if (!current.workspaces[id]) current.workspaces[id] = normalizeBucket();
    return current.workspaces[id];
  }

  function update(mutator) {
    load();
    const draft = clone(state);
    const result = mutator(draft, active(draft));
    state = normalizeState(draft, randomUUID, draft.activeWorkspaceId);
    persist();
    return result === undefined ? snapshot() : clone(result);
  }

  function snapshot() { return clone(load()); }

  return Object.freeze({
    filePath,
    snapshot,
    installationId: () => load().installationId,
    workspaceId: () => load().activeWorkspaceId,
    switchWorkspace(nextWorkspaceId) {
      const next = workspaceKey(nextWorkspaceId);
      return update((draft) => { draft.activeWorkspaceId = next; if (!draft.workspaces[next]) draft.workspaces[next] = normalizeBucket(); return next; });
    },
    binding: () => clone(active().binding),
    credential: () => clone(active().credential),
    paused: () => active().paused,
    saveBinding(binding, credential) {
      if (!binding || typeof binding !== 'object') throw new TypeError('binding_required');
      const cleanBinding = sanitizeBinding(binding);
      if (!cleanBinding) throw new TypeError('invalid_binding');
      if (cleanBinding.workspaceId !== load().activeWorkspaceId) throw new TypeError('workspace_binding_mismatch');
      if (credential != null && !sanitizeCredential(credential)) throw new TypeError('encrypted_credential_required');
      return update((_draft, bucket) => { bucket.binding = cleanBinding; bucket.credential = credential ? clone(credential) : null; bucket.paused = false; });
    },
    clearBinding() { return update((_draft, bucket) => { Object.assign(bucket, clone(EMPTY_BUCKET)); }); },
    setPaused(paused) { return update((_draft, bucket) => { bucket.paused = paused === true; return bucket.paused; }); },
    enqueue(operation) {
      if (!operation?.operationId) throw new TypeError('operation_id_required');
      return update((_draft, bucket) => {
        const existing = bucket.outbox.find((row) => row.operationId === operation.operationId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(operation)) throw new TypeError('operation_reused');
        if (!existing) bucket.outbox.push(clone(operation));
        return existing || operation;
      });
    },
    outbox: (limit = 100) => clone(active().outbox.slice(0, Math.max(0, Math.min(100, Number(limit) || 100)))),
    acknowledge(operationIds) { const ids = new Set(operationIds || []); return update((_draft, bucket) => { bucket.outbox = bucket.outbox.filter((row) => !ids.has(row.operationId)); }); },
    rebaseOutbox(records) {
      const revisions = new Map((records || []).map((record) => [`${record.entityType}:${record.entityId}`, record.revision]));
      return update((_draft, bucket) => { bucket.outbox = bucket.outbox.map((operation) => revisions.has(`${operation.entityType}:${operation.entityId}`) ? { ...operation, baseRevision: revisions.get(`${operation.entityType}:${operation.entityId}`) } : operation); });
    },
    discardOutbox(records) {
      const keys = new Set((records || []).map((record) => `${record.entityType}:${record.entityId}`));
      return update((_draft, bucket) => { bucket.outbox = bucket.outbox.filter((operation) => !keys.has(`${operation.entityType}:${operation.entityId}`)); });
    },
    saveRecovery(recovery) {
      if (!recovery?.recoveryPointId || !recovery?.planId || !Array.isArray(recovery.records)) throw new TypeError('invalid_recovery_point');
      return update((_draft, bucket) => { bucket.recoveries = [...bucket.recoveries.filter((row) => row.recoveryPointId !== recovery.recoveryPointId), clone(recovery)].slice(-10); return recovery; });
    },
    recoveries: () => clone(active().recoveries),
    stageInbox(batch) { if (!batch?.batchId) throw new TypeError('batch_id_required'); return update((_draft, bucket) => { if (!bucket.inbox.some((row) => row.batchId === batch.batchId)) bucket.inbox.push(clone(batch)); }); },
    inbox: () => clone(active().inbox),
    completeInbox(batchId, cursor) { return update((_draft, bucket) => { bucket.inbox = bucket.inbox.filter((row) => row.batchId !== batchId); bucket.cursor = cursor ? clone(cursor) : bucket.cursor; }); },
    cursor: () => clone(active().cursor),
    saveCursor(cursor) { return update((_draft, bucket) => { bucket.cursor = clone(cursor); }); },
    resetCursor() { return update((_draft, bucket) => { bucket.cursor = null; bucket.inbox = []; }); },
    conflicts: () => clone(active().conflicts),
    saveConflicts(rows) { return update((_draft, bucket) => { const byId = new Map(bucket.conflicts.map((row) => [row.conflictId, row])); for (const row of rows || []) if (row?.conflictId) byId.set(row.conflictId, { ...(byId.get(row.conflictId) || {}), ...clone(row) }); bucket.conflicts = [...byId.values()]; }); },
    removeConflict(conflictId) { return update((_draft, bucket) => { bucket.conflicts = bucket.conflicts.filter((row) => row.conflictId !== conflictId); }); },
    transfers: () => clone(active().transfers),
    saveTransfer(transfer) { if (!transfer?.transferId) throw new TypeError('transfer_id_required'); return update((_draft, bucket) => { const index = bucket.transfers.findIndex((row) => row.transferId === transfer.transferId); if (index < 0) bucket.transfers.push(clone(transfer)); else bucket.transfers[index] = clone(transfer); }); },
    removeTransfer(transferId) { return update((_draft, bucket) => { bucket.transfers = bucket.transfers.filter((row) => row.transferId !== transferId); }); },
  });
}

module.exports = { VERSION, createSyncLocalStore, normalizeState, sanitizeBinding, isUuid };
