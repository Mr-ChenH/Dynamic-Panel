function sanitizeError(error) {
  if (!error) return null;
  return Object.freeze({ code: String(error.code || 'unexpected_error').slice(0, 80), retryable: error.retryable === true, requestId: error.requestId ? String(error.requestId).slice(0, 120) : null });
}

function projectStatus(state = {}) {
  const binding = state.binding || {};
  return Object.freeze({
    state: ['disconnected', 'connecting', 'online', 'offline', 'paused', 'blocked'].includes(state.state) ? state.state : 'disconnected',
    identity: binding.instanceId ? Object.freeze({ instanceIdPrefix: String(binding.instanceId).slice(0, 12), spaceIdPrefix: String(binding.spaceId || '').slice(0, 12), clientIdPrefix: String(binding.clientId || '').slice(0, 12), spaceName: String(binding.spaceName || '').slice(0, 120) }) : null,
    queued: Math.max(0, Number(state.queued) || 0), conflicts: Math.max(0, Number(state.conflicts) || 0),
    lastSyncAt: Number.isFinite(state.lastSyncAt) ? state.lastSyncAt : null,
    error: sanitizeError(state.error),
  });
}

module.exports = { sanitizeError, projectStatus };
