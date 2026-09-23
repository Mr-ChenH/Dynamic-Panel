'use strict';

const crypto = require('crypto');
const { bindingNamespace, createInstallationModel, assertSessionMatches } = require('./binding');
const { projectStatus } = require('./status');
const { classifyRetry, backoffDelay } = require('./retry');
const { defaultCategories, normalizeCategories } = require('../../renderer/sync/categories');

const TEST_TOKEN_TTL_MS = 5 * 60 * 1000;
const RECONCILE_INTERVAL_MS = 30000;
function unwrap(value) { return value && Object.hasOwn(value, 'data') ? value.data : value; }
function bindingFromSession(session, config) {
  return Object.freeze({
    instanceId: session.instance?.instanceId,
    spaceId: session.identity?.spaceId,
    clientId: session.identity?.clientId,
    workspaceId: config.workspaceId,
    spaceName: session.identity?.spaceName || '',
    clientName: session.identity?.clientName || '',
    restoreEpoch: session.state?.restoreEpoch,
    baseUrl: config.baseUrl,
    allowLoopbackHttp: config.allowLoopbackHttp === true,
    categories: normalizeCategories(config.categories || defaultCategories()),
    initialized: config.initialized === true,
  });
}
function publicPreflight(session, token, secureStorage) {
  return Object.freeze({
    ok: true, token,
    secureStorage,
    identity: Object.freeze({ instanceIdPrefix: String(session.instance?.instanceId || '').slice(0, 12), spaceIdPrefix: String(session.identity?.spaceId || '').slice(0, 12), clientIdPrefix: String(session.identity?.clientId || '').slice(0, 12), spaceName: String(session.identity?.spaceName || '').slice(0, 120), clientName: String(session.identity?.clientName || '').slice(0, 120) }),
    categoryCounts: session.categoryCounts || {}, usage: session.usage || {}, storage: session.storage || {}, clockSkewSeconds: Number(session.clockSkewSeconds) || 0,
  });
}

function projectionUnavailable() { throw Object.assign(new Error('renderer_projection_unavailable'), { code: 'renderer_projection_unavailable', retryable: true }); }
function objectIdsForOperation(operation) {
  const ids = new Set();
  const visit = (value, key = '') => {
    if (typeof value === 'string' && /(?:objectId|objectIds)$/i.test(key) && /^obj_[A-Za-z0-9_-]{24}$/.test(value)) ids.add(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) visit(child, name);
  };
  visit(operation?.payload);
  return [...ids];
}
function referenceId(operation) { return `record:${crypto.createHash('sha256').update(`${operation.entityType}:${operation.entityId}`).digest('hex').slice(0, 48)}`; }
function localRecoveryDigest(records) {
  const normalized = [...records].map((record) => JSON.stringify(record)).sort().join('\n');
  return `sha256:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

function createSyncService({ protocolClient, credentialEnvelope, store, workspaceId = 'default', clock = () => Date.now(), reconcileIntervalMs = RECONCILE_INTERVAL_MS, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout, random = Math.random, randomUUID = crypto.randomUUID, onStatus = () => {}, onFailure = () => {}, applyRemoteBatch = projectionUnavailable, objectTransfers = null, WebSocketImpl, networkEvents, powerEvents } = {}) {
  if (!protocolClient || !credentialEnvelope || !store) throw new TypeError('sync_service_dependencies_required');
  if (!Number.isInteger(reconcileIntervalMs) || reconcileIntervalMs < 1000 || reconcileIntervalMs > RECONCILE_INTERVAL_MS) throw new TypeError('invalid_reconcile_interval');
  const installation = createInstallationModel({ randomUUID, initialInstallationId: store.installationId(), initialBinding: store.binding() });
  const tested = new Map();
  const firstSyncPlans = new Map();
  const categoryClearPlans = new Map();
  let activeWorkspaceId = store.workspaceId?.() || workspaceId;
  let connection = null;
  let timer = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let socket = null;
  let socketHeartbeat = null;
  let running = null;
  let generation = 0;
  let state = store.binding() ? (store.paused() ? 'paused' : 'offline') : 'disconnected';
  let lastSyncAt = null;
  let lastError = null;

  function status() {
    return projectStatus({ state, binding: store.binding(), queued: store.outbox().length, conflicts: store.conflicts().length, lastSyncAt, error: lastError });
  }
  function emit() { const value = status(); onStatus(value); return value; }
  function transition(next, error = null) { state = next; lastError = error; return emit(); }
  function cleanTests() {
    const now = clock();
    for (const [token, row] of tested) if (row.expiresAt <= now) tested.delete(token);
    for (const [planId, row] of firstSyncPlans) if (row.expiresAt <= now) firstSyncPlans.delete(planId);
    for (const [planId, row] of categoryClearPlans) if (row.expiresAt <= now) categoryClearPlans.delete(planId);
  }
  function keyForBinding() {
    const binding = store.binding();
    if (!binding) return null;
    return credentialEnvelope.open(binding.clientId, store.credential()) || connection?.clientKey || null;
  }

  async function connectSaved(expectedGeneration = generation) {
    const binding = store.binding(); const clientKey = keyForBinding();
    if (!binding || !clientKey) throw Object.assign(new Error('credential_unavailable'), { code: 'credential_unavailable', retryable: false });
    const next = await protocolClient.connect({ baseUrl: binding.baseUrl, clientKey, installationId: installation.installationId(), allowLoopbackHttp: binding.allowLoopbackHttp });
    const session = unwrap(await next.session());
    if (expectedGeneration !== generation) throw new Error('binding_generation_cancelled');
    try { assertSessionMatches(binding, session); }
    catch (error) {
      if (error.message !== 'restore_epoch_changed') throw error;
      store.saveBinding({ ...binding, restoreEpoch: session.state?.restoreEpoch }, store.credential());
      store.resetCursor?.();
    }
    connection = Object.freeze({ ...next, clientKey });
    return session;
  }

  async function testConnection(input = {}) {
    cleanTests(); transition('connecting');
    try {
      const next = await protocolClient.connect({ baseUrl: input.baseUrl, clientKey: input.clientKey, installationId: installation.installationId(), allowLoopbackHttp: input.allowLoopbackHttp === true });
      const session = unwrap(await next.session());
      const token = randomUUID();
      tested.set(token, { expiresAt: clock() + TEST_TOKEN_TTL_MS, input: { baseUrl: next.policy.url, clientKey: input.clientKey, allowLoopbackHttp: input.allowLoopbackHttp === true }, session });
      transition(store.binding() ? 'offline' : 'disconnected');
      return publicPreflight(session, token, credentialEnvelope.mode);
    } catch (error) { transition(store.binding() ? 'offline' : 'disconnected', error); return { ok: false, error: projectStatus({ error }).error }; }
  }

  async function saveBinding(input = {}) {
    cleanTests(); const testedRow = tested.get(String(input.token || ''));
    if (!testedRow) return { ok: false, error: { code: 'connection_test_expired', retryable: false, requestId: null } };
    const plan = firstSyncPlans.get(String(input.firstSync?.planId || ''));
    if (!plan || plan.token !== String(input.token) || plan.workspaceId !== activeWorkspaceId) return { ok: false, error: { code: 'first_sync_plan_required', retryable: false, requestId: null } };
    const categories = normalizeCategories(input.categories || defaultCategories());
    if (JSON.stringify(categories) !== JSON.stringify(plan.categories)) return { ok: false, error: { code: 'first_sync_plan_changed', retryable: false, requestId: null } };
    const binding = bindingFromSession(testedRow.session, { ...testedRow.input, workspaceId: activeWorkspaceId, categories, initialized: false });
    const prior = store.binding();
    if (prior && (prior.instanceId !== binding.instanceId || prior.spaceId !== binding.spaceId || prior.clientId !== binding.clientId)) return { ok: false, error: { code: 'binding_mismatch', retryable: false, requestId: null } };
    const envelope = credentialEnvelope.seal(binding.clientId, testedRow.input.clientKey);
    store.saveBinding(binding, credentialEnvelope.export(envelope));
    if (envelope.kind === 'session') connection = { clientKey: testedRow.input.clientKey };
    installation.bind(binding); generation += 1; tested.delete(String(input.token));
    transition('offline');
    return { ok: true, status: status(), binding: status().identity, categories, secureStorage: credentialEnvelope.mode, firstSyncPlanId: input.firstSync?.planId || null };
  }

  async function setCategories(categories) {
    const binding = store.binding(); if (!binding) return { ok: false, error: { code: 'not_configured' } };
    const normalized = normalizeCategories(categories); const disabled = Object.keys(normalized).filter((key) => binding.categories?.[key] && !normalized[key]);
    const disabledPurposes = new Set(disabled.flatMap((category) => ({ notes: ['note-image'], clipboard: ['clipboard-image'], screenshots: ['screenshot'] })[category] || []));
    if (disabledPurposes.size && objectTransfers?.cancel) {
      const transfers = store.transfers?.() || [];
      await Promise.all(transfers.filter((row) => disabledPurposes.has(row.descriptor?.purpose)).map((row) => objectTransfers.cancel(row.transferId)));
    }
    store.saveBinding({ ...binding, categories: normalized }, store.credential()); store.resetCursor?.(); generation += 1;
    return { ok: true, categories: normalized, confirmationRequired: disabled.length > 0, disabled };
  }
  function pause(input = {}) { const paused = input.paused === true; store.setPaused(paused); transition(paused ? 'paused' : 'offline'); if (!paused && store.binding()?.initialized) void runNow(); return { ok: true, status: status() }; }
  function enqueue(operation) { const result = store.enqueue(operation); emit(); if (!store.paused() && store.binding()?.initialized) void runNow(); return result; }

  async function fullReconcile(currentGeneration, enabledCategories) {
    let pageToken = null;
    for (let page = 0; page < 100; page += 1) {
      const reconciled = unwrap(await connection.reconcile({ categories: enabledCategories, known: [], ...(pageToken ? { pageToken } : {}), limit: 500 }));
      if (currentGeneration !== generation) throw new Error('binding_generation_cancelled');
      const records = reconciled.records || [];
      const nextCursor = `reconcile:${crypto.createHash('sha256').update(JSON.stringify({ pageToken: pageToken || 'start', records })).digest('hex').slice(0, 24)}`;
      const batch = { batchId: nextCursor, namespace: bindingNamespace(store.binding()), changes: records.map((record) => ({ kind: record.deleted ? 'tombstone' : 'record', record })), nextCursor, upperCursor: null, restoreEpoch: reconciled.restoreEpoch };
      if (batch.changes.length) {
        store.stageInbox(batch);
        const projected = await applyRemoteBatch(batch);
        if (projected?.batchId !== batch.batchId || projected?.cursor !== batch.nextCursor) throw Object.assign(new Error('invalid_projection_ack'), { code: 'invalid_projection_ack', retryable: true });
        store.completeInbox(batch.batchId, { cursor: batch.nextCursor, upperCursor: null, restoreEpoch: batch.restoreEpoch });
      }
      pageToken = reconciled.pageToken || null;
      if (!reconciled.hasMore) break;
    }
    store.resetCursor?.();
  }

  async function reconcile(currentGeneration) {
    if (!connection?.push || !connection?.pull) await connectSaved(currentGeneration);
    const pending = store.outbox(100);
    if (pending.length) {
      const pushed = unwrap(await connection.push(pending));
      const completed = [];
      const conflicts = [];
      let operationError = null;
      for (const result of pushed.results || []) {
        const operation = pending.find((row) => row.operationId === result.operationId);
        if (!operation) continue;
        if (result.status === 'accepted' || result.status === 'duplicate') {
          const refId = referenceId(operation);
          if (operation.kind === 'delete') await connection.objectRequest(`/objects/references/${encodeURIComponent(refId)}`, { method: 'DELETE' });
          else await connection.objectRequest(`/objects/references/${encodeURIComponent(refId)}`, { method: 'PUT', body: { objectIds: objectIdsForOperation(operation), retainUntil: null } });
          completed.push(result.operationId);
        } else if (result.status === 'conflict') {
          conflicts.push({ conflictId: result.conflictId, operationId: result.operationId, currentRevision: result.currentRevision, entityType: operation.entityType, entityId: operation.entityId, category: operation.category, schemaVersion: operation.schemaVersion, incomingPayload: operation.payload });
          completed.push(result.operationId);
        } else if (result.status === 'rejected') {
          completed.push(result.operationId);
          operationError = Object.assign(new Error(result.error?.code || result.code || 'operation_rejected'), { code: result.error?.code || result.code || 'operation_rejected', retryable: false });
        }
      }
      store.acknowledge(completed); store.saveConflicts(conflicts);
      if (operationError) throw operationError;
    }
    let cursor = store.cursor()?.cursor || '';
    const enabledCategories = Object.entries(store.binding()?.categories || {}).filter(([, enabled]) => enabled).map(([name]) => name).sort();
    for (let page = 0; page < 100; page += 1) {
      let pulled;
      try { pulled = unwrap(await connection.pull(cursor, 500, enabledCategories)); }
      catch (error) {
        if (!['cursor_expired', 'restore_epoch_changed', 'invalid_cursor'].includes(error.code)) throw error;
        await fullReconcile(currentGeneration, enabledCategories);
        cursor = '';
        pulled = unwrap(await connection.pull(cursor, 500, enabledCategories));
      }
      if (currentGeneration !== generation) throw new Error('binding_generation_cancelled');
      const binding = store.binding();
      const batch = { batchId: `pull:${crypto.createHash('sha256').update(String(pulled.nextCursor || cursor)).digest('hex').slice(0, 24)}`, namespace: bindingNamespace(binding), changes: pulled.changes || [], nextCursor: pulled.nextCursor, upperCursor: pulled.upperCursor, restoreEpoch: pulled.restoreEpoch };
      const pulledConflicts = batch.changes.filter((change) => change?.conflict?.conflictId).map((change) => change.conflict);
      if (pulledConflicts.length) store.saveConflicts(pulledConflicts);
      if (batch.changes.length) {
        store.stageInbox(batch);
        const projected = await applyRemoteBatch(batch);
        if (projected?.batchId !== batch.batchId || projected?.cursor !== batch.nextCursor) throw Object.assign(new Error('invalid_projection_ack'), { code: 'invalid_projection_ack', retryable: true });
        if (currentGeneration !== generation) throw new Error('binding_generation_cancelled');
        store.completeInbox(batch.batchId, { cursor: batch.nextCursor, upperCursor: batch.upperCursor, restoreEpoch: batch.restoreEpoch });
      } else store.saveCursor({ cursor: pulled.nextCursor || cursor, upperCursor: pulled.upperCursor || null, restoreEpoch: pulled.restoreEpoch });
      cursor = pulled.nextCursor || cursor;
      if (!pulled.hasMore) break;
    }
    lastSyncAt = clock(); lastError = null; retryAttempt = 0; transition('online'); openSocket();
    return status();
  }

  async function runNow() {
    if (!store.binding()) return { ok: false, error: { code: 'not_configured' }, status: status() };
    if (store.paused()) return { ok: false, error: { code: 'paused' }, status: status() };
    if (running) return running;
    if (retryTimer) clearTimeoutImpl(retryTimer); retryTimer = null;
    const currentGeneration = generation; transition('connecting');
    const task = reconcile(currentGeneration).then((value) => ({ ok: true, status: value })).catch((error) => {
      onFailure(error);
      if (currentGeneration === generation) {
        const retry = classifyRetry({ code: error.code, status: error.status, retryable: error.retryable, networkError: error.networkError === true });
        transition(retry.retry ? 'offline' : 'blocked', error);
        if (retry.retry && !store.paused()) {
          const delay = backoffDelay(retryAttempt++, { random, retryAfter: error.retryAfter, nowMs: clock() });
          if (retryTimer) clearTimeoutImpl(retryTimer);
          retryTimer = setTimeoutImpl(() => { retryTimer = null; if (currentGeneration === generation) void runNow(); }, delay);
          retryTimer?.unref?.();
        }
      }
      return { ok: false, error: projectStatus({ error }).error, status: status() };
    }).finally(() => { if (running === task) running = null; });
    running = task;
    return task;
  }

  function openSocket() {
    if (!WebSocketImpl || !connection?.policy?.url || socket || store.paused()) return;
    try {
      const url = new URL('/api/v1/sync/events', connection.policy.url); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocketImpl(url, { headers: { authorization: `ClientKey ${keyForBinding()}`, 'dp-installation-id': installation.installationId(), 'dp-protocol-version': '1' } });
      socket.on?.('open', () => {
        socketHeartbeat = setIntervalImpl(() => { try { socket?.send?.(JSON.stringify({ type: 'ping' })); } catch {} }, 20000);
        socketHeartbeat?.unref?.();
      });
      socket.on?.('message', (body) => {
        let message;
        try { message = JSON.parse(String(body)); } catch { return; }
        if (message?.type === 'invalidate') void runNow();
      });
      socket.on?.('close', () => { if (socketHeartbeat) clearIntervalImpl(socketHeartbeat); socketHeartbeat = null; socket = null; }); socket.on?.('error', () => {});
    } catch (error) { socket = null; }
  }
  function closeSocket() { if (socketHeartbeat) clearIntervalImpl(socketHeartbeat); socketHeartbeat = null; try { socket?.close?.(); } catch (error) {} socket = null; }
  function start() { if (timer || !store.binding()?.initialized) return; timer = setIntervalImpl(() => void runNow(), reconcileIntervalMs); timer?.unref?.(); networkEvents?.on?.('online', runNow); powerEvents?.on?.('resume', runNow); }
  function stop() { if (timer) clearIntervalImpl(timer); timer = null; if (retryTimer) clearTimeoutImpl(retryTimer); retryTimer = null; networkEvents?.off?.('online', runNow); powerEvents?.off?.('resume', runNow); closeSocket(); }
  function removeBinding(input = {}) { if (input.confirm !== true && input.confirmation !== 'REMOVE') return { ok: false, error: { code: 'confirmation_required' } }; stop(); const prior = store.binding(); generation += 1; connection = null; if (prior) credentialEnvelope.remove(prior.clientId); installation.remove(); store.clearBinding(); transition('disconnected'); return { ok: true, status: status() }; }

  async function previewFirstSync(input = {}) {
    cleanTests();
    const row = tested.get(String(input.token || '')); if (!row) return { ok: false, error: { code: 'connection_test_expired' } };
    const categories = normalizeCategories(input.categories || defaultCategories());
    const local = input.local && typeof input.local === 'object' ? input.local : {};
    const remote = row.session.categoryCounts || {};
    const remoteRecords = Object.values(remote).reduce((sum, value) => sum + (Number(value?.records) || 0), 0);
    const recommended = local.totalRecords ? (remoteRecords ? 'merge' : 'upload') : 'download';
    const planId = randomUUID();
    firstSyncPlans.set(planId, { expiresAt: clock() + TEST_TOKEN_TTL_MS, token: String(input.token), workspaceId: activeWorkspaceId, local, remote, categories });
    return { ok: true, planId, recommended, local, remote, categories };
  }
  async function executeFirstSync(input = {}) {
    cleanTests();
    const modes = ['upload', 'download', 'merge', 'local-wins', 'server-wins'];
    if (!modes.includes(input.mode)) throw new TypeError('invalid_first_sync_mode');
    const plan = firstSyncPlans.get(String(input.planId || ''));
    if (!plan || plan.workspaceId !== activeWorkspaceId) throw Object.assign(new Error('first_sync_plan_expired'), { code: 'first_sync_plan_expired' });
    const remoteRecords = Object.values(plan.remote || {}).reduce((sum, value) => sum + (Number(value?.records) || 0), 0);
    const localRecords = Number(plan.local?.totalRecords) || 0;
    if (input.mode === 'upload' && remoteRecords > 0) throw Object.assign(new Error('destructive_first_sync_forbidden'), { code: 'destructive_first_sync_forbidden' });
    if (input.mode === 'download' && localRecords > 0) throw Object.assign(new Error('destructive_first_sync_forbidden'), { code: 'destructive_first_sync_forbidden' });
    const destructive = input.mode === 'local-wins' || input.mode === 'server-wins';
    if (destructive) {
      const confirmation = input.mode === 'local-wins' ? 'REPLACE SERVER' : 'REPLACE THIS DEVICE';
      if (input.confirmation !== confirmation) throw Object.assign(new Error('first_sync_confirmation_required'), { code: 'first_sync_confirmation_required' });
      if (!connection?.prepareFirstSync || !connection?.executeFirstSync) await connectSaved(generation);
      const categories = Object.entries(plan.categories).filter(([, enabled]) => enabled).map(([name]) => name).sort();
      const prepared = unwrap(await connection.prepareFirstSync({ planId: input.planId, mode: input.mode, categories }));
      if (!prepared?.recoveryVerified || !prepared.recoveryPointId || !prepared.planToken) throw Object.assign(new Error('recovery_verification_failed'), { code: 'recovery_verification_failed' });
      const records = Array.isArray(input.local?.records) ? input.local.records.filter((record) => record && typeof record === 'object' && typeof record.entityType === 'string' && typeof record.entityId === 'string' && typeof record.category === 'string' && record.schemaVersion === 1) : [];
      if (records.length !== localRecords) throw Object.assign(new Error('first_sync_local_inventory_changed'), { code: 'first_sync_local_inventory_changed' });
      const recoveryDigest = localRecoveryDigest(records);
      store.saveRecovery?.({ recoveryPointId: prepared.recoveryPointId, planId: input.planId, mode: input.mode, categories, records, recoveryDigest, createdAt: new Date(clock()).toISOString(), verified: true });
      const persistedRecovery = store.recoveries?.().find((row) => row.recoveryPointId === prepared.recoveryPointId);
      if (!persistedRecovery || persistedRecovery.recoveryDigest !== recoveryDigest || localRecoveryDigest(persistedRecovery.records || []) !== recoveryDigest) throw Object.assign(new Error('local_recovery_verification_failed'), { code: 'local_recovery_verification_failed' });
      const executed = unwrap(await connection.executeFirstSync({ planId: input.planId, planToken: prepared.planToken, recoveryPointId: prepared.recoveryPointId, mode: input.mode, confirmation }));
      if (!executed?.recoveryVerified) throw Object.assign(new Error('recovery_verification_failed'), { code: 'recovery_verification_failed' });
      if (input.mode === 'local-wins') {
        store.rebaseOutbox?.(executed.records || []);
        store.resetCursor?.();
        const recoverableBinding = store.binding();
        store.saveBinding({ ...recoverableBinding, initialized: true }, store.credential());
        start();
      } else {
        store.discardOutbox?.(records);
        const nextCursor = `first-sync:${input.planId}`;
        const batch = { batchId: nextCursor, namespace: bindingNamespace(store.binding()), changes: records.map((record) => ({ kind: 'tombstone', record: { ...record, revision: 1, deleted: true } })), nextCursor, upperCursor: null, restoreEpoch: store.binding()?.restoreEpoch };
        if (batch.changes.length) {
          store.stageInbox(batch);
          const projected = await applyRemoteBatch(batch);
          if (projected?.batchId !== batch.batchId || projected?.cursor !== batch.nextCursor) throw Object.assign(new Error('invalid_projection_ack'), { code: 'invalid_projection_ack', retryable: true });
          store.completeInbox(batch.batchId, { cursor: batch.nextCursor, upperCursor: null, restoreEpoch: batch.restoreEpoch });
        }
        store.resetCursor?.();
        const enabledCategories = Object.entries(plan.categories).filter(([, enabled]) => enabled).map(([name]) => name).sort();
        await fullReconcile(generation, enabledCategories);
        const recoverableBinding = store.binding();
        store.saveBinding({ ...recoverableBinding, initialized: true }, store.credential());
        start();
      }
    }
    const synced = await runNow();
    if (!synced.ok) return synced;
    const binding = store.binding();
    store.saveBinding({ ...binding, initialized: true }, store.credential());
    start();
    firstSyncPlans.delete(input.planId);
    return { ok: true, mode: input.mode, status: status() };
  }
  function cancelFirstSync(input = {}) {
    if (input.planId) { firstSyncPlans.delete(String(input.planId)); categoryClearPlans.delete(String(input.planId)); }
    else {
      for (const [planId, row] of firstSyncPlans) if (row.workspaceId === activeWorkspaceId) firstSyncPlans.delete(planId);
      for (const [planId, row] of categoryClearPlans) if (row.workspaceId === activeWorkspaceId) categoryClearPlans.delete(planId);
    }
    return { ok: true, cancelled: true };
  }
  async function prepareCategoryClear(input = {}) {
    cleanTests();
    const binding = store.binding();
    if (!binding) return { ok: false, error: { code: 'not_configured' } };
    const allowed = new Set(Object.keys(defaultCategories()));
    const categories = [...new Set(Array.isArray(input.categories) ? input.categories : [])].filter((category) => allowed.has(category) && binding.categories?.[category] === false).sort();
    if (!categories.length) return { ok: false, error: { code: 'category_clear_requires_disabled_category' } };
    if (!connection?.prepareFirstSync || !connection?.executeFirstSync) await connectSaved(generation);
    const planId = randomUUID();
    const prepared = unwrap(await connection.prepareFirstSync({ planId, mode: 'category-clear', categories }));
    if (!prepared?.recoveryVerified || !prepared.recoveryPointId || !prepared.planToken) throw Object.assign(new Error('recovery_verification_failed'), { code: 'recovery_verification_failed' });
    categoryClearPlans.set(planId, { workspaceId: activeWorkspaceId, expiresAt: Date.parse(prepared.expiresAt) || clock() + TEST_TOKEN_TTL_MS, categories, prepared });
    return { ok: true, planId, categories, impact: prepared.impact || {}, recoveryPointId: prepared.recoveryPointId, expiresAt: prepared.expiresAt || null };
  }
  async function executeCategoryClear(input = {}) {
    cleanTests();
    const plan = categoryClearPlans.get(String(input.planId || ''));
    if (!plan || plan.workspaceId !== activeWorkspaceId) return { ok: false, error: { code: 'category_clear_plan_expired' } };
    if (input.confirmation !== 'DELETE SERVER CATEGORY DATA') return { ok: false, error: { code: 'confirmation_required' } };
    const prepared = plan.prepared;
    const executed = unwrap(await connection.executeFirstSync({ planId: input.planId, planToken: prepared.planToken, recoveryPointId: prepared.recoveryPointId, mode: 'category-clear', confirmation: input.confirmation }));
    if (!executed?.recoveryVerified) throw Object.assign(new Error('recovery_verification_failed'), { code: 'recovery_verification_failed' });
    categoryClearPlans.delete(input.planId); store.resetCursor?.();
    const synced = await runNow();
    return synced.ok ? { ok: true, categories: plan.categories, deletedRecords: (executed.records || []).length, recoveryPointId: prepared.recoveryPointId, status: synced.status } : synced;
  }
  function listConflicts(input = {}) { const offset = Math.max(0, Number(input.offset) || 0); const limit = Math.max(1, Math.min(100, Number(input.limit) || 50)); const rows = store.conflicts(); return { ok: true, items: rows.slice(offset, offset + limit), total: rows.length }; }
  async function resolveConflict(input = {}) {
    if (!input.conflictId || !['local', 'remote', 'manual'].includes(input.decision)) return { ok: false, error: { code: 'invalid_conflict_resolution' } };
    const conflict = store.conflicts().find((row) => row.conflictId === input.conflictId);
    if (!conflict?.currentPayload || !conflict?.incomingPayload || !conflict.entityType || !conflict.entityId) return { ok: false, error: { code: 'conflict_details_pending' } };
    const localIsIncoming = Boolean(conflict.operationId);
    const payload = input.decision === 'manual' ? input.payload : input.decision === 'local' ? (localIsIncoming ? conflict.incomingPayload : conflict.currentPayload) : (localIsIncoming ? conflict.currentPayload : conflict.incomingPayload);
    const operation = { operationId: randomUUID(), entityType: conflict.entityType, entityId: conflict.entityId, category: conflict.category, schemaVersion: conflict.schemaVersion || 1, baseRevision: conflict.currentRevision, kind: 'resolveConflict', conflictId: conflict.conflictId, payload };
    enqueue(operation);
    const synced = await runNow();
    if (synced.ok) store.removeConflict(input.conflictId);
    emit();
    return synced.ok ? { ok: true, conflictId: input.conflictId, status: synced.status } : synced;
  }
  async function restoreDeleted(input = {}) {
    if (!input.entityType || !input.entityId || !Number.isInteger(input.baseRevision)) return { ok: false, error: { code: 'invalid_restore_request' } };
    const currentGeneration = generation;
    if (!connection?.restore) await connectSaved(currentGeneration);
    const result = unwrap(await connection.restore(input.entityType, input.entityId, { operationId: input.operationId || randomUUID(), baseRevision: input.baseRevision }));
    if (currentGeneration !== generation) throw new Error('binding_generation_cancelled');
    void runNow();
    return { ok: true, result };
  }
  async function objectRequest(path, options) {
    const currentGeneration = generation;
    if (!connection?.objectRequest) await connectSaved(currentGeneration);
    if (currentGeneration !== generation) throw new Error('binding_generation_cancelled');
    return connection.objectRequest(path, options);
  }
  function cancelTransfer(transferId) { return objectTransfers?.cancel?.(transferId) || Promise.resolve({ ok: true, transferId, cancelled: false }); }
  async function uploadObject(input) { if (!objectTransfers?.upload) throw new TypeError('object_transfer_unavailable'); const currentGeneration = generation; const result = await objectTransfers.upload(input); if (currentGeneration !== generation) throw new Error('binding_generation_cancelled'); return result; }
  async function downloadObject(input) { if (!objectTransfers?.download) throw new TypeError('object_transfer_unavailable'); const currentGeneration = generation; const result = await objectTransfers.download(input); if (currentGeneration !== generation) throw new Error('binding_generation_cancelled'); return result; }
  function runtimeContext() {
    const binding = store.binding();
    return binding ? { configured: true, namespace: bindingNamespace(binding), workspaceId: activeWorkspaceId, categories: binding.categories, initialized: binding.initialized === true, generation } : { configured: false, workspaceId: activeWorkspaceId, generation };
  }
  function switchWorkspace(nextWorkspaceId) {
    const next = String(nextWorkspaceId || '');
    if (next === activeWorkspaceId) return runtimeContext();
    stop(); generation += 1; running = null; connection = null; store.switchWorkspace(next); activeWorkspaceId = next;
    const binding = store.binding();
    if (binding) installation.bind(binding); else installation.remove();
    state = binding ? (store.paused() ? 'paused' : 'offline') : 'disconnected'; lastError = null; emit();
    if (binding) { if (binding.initialized) start(); if (binding.initialized && !store.paused()) void runNow(); }
    return runtimeContext();
  }

  if (store.binding()?.initialized) start();
  return Object.freeze({ status, runtimeContext, switchWorkspace, testConnection, saveBinding, setCategories, pause, runNow, removeBinding, enqueue, previewFirstSync, executeFirstSync, cancelFirstSync, prepareCategoryClear, executeCategoryClear, listConflicts, resolveConflict, restoreDeleted, objectRequest, cancelTransfer, uploadObject, downloadObject, start, stop, wake: runNow });
}

module.exports = { TEST_TOKEN_TTL_MS, RECONCILE_INTERVAL_MS, bindingFromSession, publicPreflight, createSyncService };
