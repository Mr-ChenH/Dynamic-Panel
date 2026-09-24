const { validateSyncBaseUrl } = require('./url-policy');

const RESPONSE_KEYS = Object.freeze({
  discovery: new Set(['instanceId', 'service', 'protocol', 'recordSchemas', 'capabilities', 'limits', 'serverTime']),
  envelope: new Set(['data', 'requestId']),
  error: new Set(['error', 'requestId']),
});

const DISCOVERY_LIMIT_KEYS = new Set(['jsonBytes', 'operationsPerPush', 'changesPerPull', 'chunkBytes', 'clientObjectTransfers', 'chunksPerUpload', 'headerBytes']);
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_DISCOVERY_CAPABILITIES = 32;

function discoveryError(code) {
  return Object.assign(new TypeError(code), { code, retryable: false });
}

function assertDiscovery(value, protocolVersion = 1) {
  try { assertExactKeys(value, RESPONSE_KEYS.discovery, 'discovery'); }
  catch (error) { throw discoveryError(error.message); }
  if (value.service !== 'dynamic-panel-sync' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value.instanceId || ''))) throw discoveryError('invalid_discovery_identity');
  const range = (row, code) => {
    try { assertExactKeys(row, new Set(['min', 'max']), code); } catch { throw discoveryError(code); }
    if (!Number.isInteger(row.min) || !Number.isInteger(row.max) || row.min < 1 || row.min > row.max || protocolVersion < row.min || protocolVersion > row.max) throw discoveryError(code);
  };
  range(value.protocol, 'invalid_protocol'); range(value.recordSchemas, 'invalid_record_schema');
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0 || value.capabilities.length > MAX_DISCOVERY_CAPABILITIES || new Set(value.capabilities).size !== value.capabilities.length || value.capabilities.some((item) => typeof item !== 'string' || item.length > 64 || !CAPABILITY_PATTERN.test(item))) throw discoveryError('invalid_capabilities');
  if (!value.capabilities.includes('push-pull')) throw discoveryError('required_capability_missing');
  try { assertExactKeys(value.limits, DISCOVERY_LIMIT_KEYS, 'discovery_limits'); }
  catch { throw discoveryError('invalid_discovery_limits'); }
  for (const key of DISCOVERY_LIMIT_KEYS) if (!Number.isSafeInteger(value.limits[key]) || value.limits[key] < 1) throw discoveryError('invalid_discovery_limits');
  if (typeof value.serverTime !== 'string' || !Number.isFinite(Date.parse(value.serverTime))) throw discoveryError('invalid_server_time');
  return value;
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`invalid_${label}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown_${label}_property:${key}`);
  return value;
}

function validateOperation(operation) {
  const allowed = new Set(['operationId', 'entityType', 'entityId', 'category', 'schemaVersion', 'baseRevision', 'kind', 'payload', 'conflictId']);
  assertExactKeys(operation, allowed, 'operation');
  if (!operation.operationId || !operation.entityType || !operation.entityId || !['upsert', 'delete', 'resolveConflict'].includes(operation.kind)) throw new TypeError('invalid_operation');
  if (operation.kind === 'delete' && Object.hasOwn(operation, 'payload')) throw new TypeError('delete_payload_forbidden');
  return operation;
}

function createProtocolClient({ fetchImpl = globalThis.fetch, lookup, appVersion = '1.1.0', platform, protocolVersion = 1 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');
  async function connect({ baseUrl, clientKey, installationId, allowLoopbackHttp = false }) {
    const policy = await validateSyncBaseUrl(baseUrl, { lookup, allowLoopbackHttp });
    if (typeof clientKey !== 'string' || !clientKey.startsWith('dpk_v1_')) throw new TypeError('invalid_client_key');
    const headers = Object.freeze({ authorization: `ClientKey ${clientKey}`, 'dp-installation-id': installationId, 'dp-protocol-version': String(protocolVersion), 'dp-app-version': appVersion, 'dp-platform': platform || `${process.platform}-${process.arch}` });
    async function request(path, { method = 'GET', body, bytes, headers: additionalHeaders = {}, raw = false, signal } = {}) {
      if (!/^\/[a-z0-9/?=&._%+-]*$/i.test(path)) throw new TypeError('invalid_sync_path');
      if (body !== undefined && bytes !== undefined) throw new TypeError('ambiguous_sync_body');
      const target = new URL(`/api/v1${path}`, policy.url);
      if (target.origin !== new URL(policy.url).origin) throw new TypeError('sync_origin_changed');
      const extra = {};
      for (const [name, value] of Object.entries(additionalHeaders || {})) {
        const normalized = String(name).toLowerCase();
        if (['authorization', 'dp-installation-id', 'dp-protocol-version', 'dp-app-version', 'dp-platform', 'host', 'cookie'].includes(normalized)) throw new TypeError('protected_sync_header');
        extra[normalized] = String(value);
      }
      const requestBody = bytes === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : bytes;
      let response;
      try { response = await fetchImpl(target, { method, signal, redirect: 'manual', headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, body: requestBody }); }
      catch (error) { throw Object.assign(error, { networkError: true, retryable: true }); }
      if (response.status >= 300 && response.status < 400) throw Object.assign(new Error('sync_redirect_rejected'), { code: 'redirect_rejected', retryable: false });
      const requestId = response.headers?.get?.('x-request-id') || null;
      if (raw && response.ok) return Object.freeze({ status: response.status, headers: response.headers, arrayBuffer: () => response.arrayBuffer() });
      let json;
      try { json = await response.json(); } catch (error) { throw Object.assign(new Error('invalid_sync_json'), { requestId }); }
      if (!response.ok) {
        assertExactKeys(json, RESPONSE_KEYS.error, 'error_envelope');
        throw Object.assign(new Error(json.error?.message || 'sync_request_failed'), json.error || {}, { status: response.status, requestId: json.requestId || requestId, retryAfter: response.headers?.get?.('retry-after') || null });
      }
      assertExactKeys(json, RESPONSE_KEYS.envelope, 'response_envelope');
      return json;
    }
    async function discover() {
      const target = new URL('/.well-known/dynamic-panel-sync', policy.url);
      let response;
      try { response = await fetchImpl(target, { method: 'GET', redirect: 'manual', headers: { 'dp-protocol-version': String(protocolVersion), 'dp-app-version': appVersion, 'dp-platform': platform || `${process.platform}-${process.arch}` } }); }
      catch (error) { throw Object.assign(error, { networkError: true, retryable: true }); }
      if (response.status >= 300 && response.status < 400) throw Object.assign(new Error('sync_redirect_rejected'), { code: 'redirect_rejected', retryable: false });
      if (!response.ok) throw Object.assign(new Error('discovery_failed'), { code: 'discovery_failed', status: response.status, requestId: response.headers?.get?.('x-request-id') || null });
      let json; try { json = await response.json(); } catch { throw new TypeError('invalid_discovery_json'); }
      return assertDiscovery(json, protocolVersion);
    }
    return Object.freeze({
      policy, request, discover,
      session: () => request('/sync/session', { method: 'POST', body: {} }),
      push: (operations) => {
        if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) throw new TypeError('invalid_operation_batch');
        operations.forEach(validateOperation);
        return request('/sync/push', { method: 'POST', body: { operations } });
      },
      pull: (cursor, limit = 500, categories = []) => {
        if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Array.isArray(categories)) throw new TypeError('invalid_pull_limit');
        const suffix = categories.length ? `&categories=${encodeURIComponent(categories.join(','))}` : '';
        return request(`/sync/pull?cursor=${encodeURIComponent(cursor || '')}&limit=${limit}${suffix}`);
      },
      reconcile: (input) => request('/sync/reconcile', { method: 'POST', body: input }),
      prepareFirstSync: (input) => request('/sync/first-sync/recovery-point', { method: 'POST', body: input }),
      executeFirstSync: (input) => request('/sync/first-sync/execute', { method: 'POST', body: input }),
      restore: (entityType, entityId, input) => request(`/sync/records/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/restore`, { method: 'POST', body: input }),
      objectRequest: request,
    });
  }
  return Object.freeze({ connect, assertDiscovery(value) { return assertDiscovery(value, protocolVersion); } });

}

module.exports = { createProtocolClient, assertExactKeys, assertDiscovery, validateOperation };
