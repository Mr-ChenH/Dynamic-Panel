const STOP_CODES = new Set([
  'authentication_failed', 'session_expired', 'recent_auth_required', 'csrf_failed', 'account_disabled',
  'client_revoked', 'installation_mismatch', 'protocol_unsupported', 'schema_unsupported', 'instance_changed',
  'cursor_expired', 'restore_epoch_changed', 'invalid_request', 'invalid_entity', 'invalid_reference',
  'digest_mismatch', 'content_length_mismatch', 'operation_reused', 'space_limit_reached', 'client_limit_reached',
  'technical_limit_exceeded', 'space_inactive', 'category_disabled',
]);
const RETRY_CODES = new Set(['rate_limited', 'storage_unavailable']);

function classifyRetry({ code, status, retryable, networkError } = {}) {
  if (STOP_CODES.has(code)) return Object.freeze({ retry: false, reason: code });
  if (RETRY_CODES.has(code) || retryable === true || networkError === true || status === 408 || status === 425 || status === 429 || status >= 500) {
    return Object.freeze({ retry: true, reason: code || 'temporary_failure' });
  }
  return Object.freeze({ retry: false, reason: code || 'non_retryable' });
}

function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null || value === '') return null;
  if (/^\d+$/.test(String(value).trim())) return Number(value) * 1000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

function backoffDelay(attempt, { initialMs = 1000, capMs = 300000, random = Math.random, retryAfter = null, nowMs } = {}) {
  const serverDelay = parseRetryAfter(retryAfter, nowMs);
  if (serverDelay !== null) return Math.min(capMs, serverDelay);
  const ceiling = Math.min(capMs, initialMs * (2 ** Math.max(0, Number(attempt) || 0)));
  return Math.floor(Math.max(0, Math.min(1, random())) * ceiling);
}

module.exports = { STOP_CODES, RETRY_CODES, classifyRetry, parseRetryAfter, backoffDelay };
