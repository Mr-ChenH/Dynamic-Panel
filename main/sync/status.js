function sanitizeError(error) {
  if (!error) return null;
  const rawCode = String(error.code || 'unexpected_error');
  const code = /^[a-z][a-z0-9_:-]{0,79}$/i.test(rawCode) && !rawCode.includes('dpk_v1_') ? rawCode : 'unexpected_error';
  const rawRequestId = error.requestId ? String(error.requestId) : '';
  const requestId = rawRequestId && !rawRequestId.includes('dpk_v1_') && /^[a-z0-9_-]+$/i.test(rawRequestId) ? rawRequestId.slice(0, 12) : null;
  return Object.freeze({ code, retryable: error.retryable === true, requestId });
}

function normalizeCapacity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const count = (candidate) => Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
  return Object.freeze(Object.fromEntries(['spaces', 'clients'].map((name) => [name, Object.freeze({ active: count(value[name]?.active), max: count(value[name]?.max), remaining: count(value[name]?.remaining) })])));
}

function projectStatus(state = {}) {
  const binding = state.binding || {};
  const capabilities = Array.isArray(state.capabilities) ? [...new Set(state.capabilities.filter((item) => typeof item === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(item)))].slice(0, 32).sort() : [];
  const limits = state.limits && typeof state.limits === 'object' && !Array.isArray(state.limits) ? Object.fromEntries(['jsonBytes', 'operationsPerPush', 'changesPerPull', 'chunkBytes', 'clientObjectTransfers', 'chunksPerUpload', 'headerBytes'].map((key) => [key, Number.isSafeInteger(state.limits[key]) && state.limits[key] >= 0 ? state.limits[key] : 0])) : {};
  const storageState = (value) => ['ok', 'degraded', 'down'].includes(value) ? value : 'unknown';
  const serverStorage = state.serverStorage && typeof state.serverStorage === 'object' && !Array.isArray(state.serverStorage) ? Object.freeze({ database: storageState(state.serverStorage.database), objects: storageState(state.serverStorage.objects) }) : null;
  const warning = state.warning?.code === 'clock_skew_warning' && Number.isFinite(state.warning.seconds) ? Object.freeze({ code: 'clock_skew_warning', seconds: Math.trunc(state.warning.seconds) }) : null;
  const activeTransfer = state.activeTransfer && ['queued', 'pending', 'uploading', 'downloading', 'active'].includes(state.activeTransfer.state) ? Object.freeze({ transferIdPrefix: String(state.activeTransfer.transferIdPrefix || '').slice(0, 12), direction: ['upload', 'download'].includes(state.activeTransfer.direction) ? state.activeTransfer.direction : null, state: state.activeTransfer.state }) : null;
  return Object.freeze({
    state: ['disconnected', 'connecting', 'online', 'offline', 'paused', 'blocked'].includes(state.state) ? state.state : 'disconnected',
    identity: binding.instanceId ? Object.freeze({ instanceIdPrefix: String(binding.instanceId).slice(0, 12), spaceIdPrefix: String(binding.spaceId || '').slice(0, 12), clientIdPrefix: String(binding.clientId || '').slice(0, 12), spaceName: String(binding.spaceName || '').slice(0, 120) }) : null,
    queued: Math.max(0, Number(state.queued) || 0), queueCount: Math.max(0, Number(state.queued) || 0), conflicts: Math.max(0, Number(state.conflicts) || 0),
    protocolVersion: Number(state.protocolVersion) || 1, cursorAgeMs: Number.isFinite(state.cursorAgeMs) ? Math.max(0, state.cursorAgeMs) : null,
    activeTransfer, serverCapacity: normalizeCapacity(state.serverCapacity), serverStorage, capabilities, limits,
    clockSkewSeconds: Number.isFinite(state.clockSkewSeconds) ? Math.trunc(state.clockSkewSeconds) : 0, warning,
    lastSyncAt: Number.isFinite(state.lastSyncAt) ? state.lastSyncAt : null,
    error: sanitizeError(state.error),
  });
}

module.exports = { sanitizeError, projectStatus };
