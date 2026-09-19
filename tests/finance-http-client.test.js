const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceHttpClient } = require('../main/finance-http-client');

function response(body, contentType = 'application/json', ok = true, status = 200) {
  const bytes = Buffer.from(body);
  let consumed = false;
  return {
    ok,
    status,
    headers: { get: (name) => name === 'content-type' ? contentType : '' },
    body: {
      getReader: () => ({
        read: async () => {
          if (consumed) return { done: true };
          consumed = true;
          return { done: false, value: new Uint8Array(bytes) };
        },
        cancel: async () => {},
      }),
      cancel: async () => {},
    },
  };
}

function createClient(fetchPinnedEndpoint, options = {}) {
  return createFinanceHttpClient({
    allowedOrigins: new Set(['https://provider.test']),
    resolvePinnedEndpoint: async (url) => url === 'https://provider.test/data' ? { url } : null,
    fetchPinnedEndpoint,
    timeoutMs: 50,
    maxResponseBytes: 32,
    maxRequestBytes: 8,
    ...options,
  });
}

test('finance HTTP client validates origins and parses bounded JSON/text responses', async () => {
  const calls = [];
  const client = createClient(async (endpoint, request) => {
    calls.push({ endpoint, request });
    return response('{"ok":true}');
  });
  assert.deepEqual(await client.requestJson('https://provider.test/data'), { ok: true });
  assert.deepEqual(calls[0].request.method, 'GET');
  await assert.rejects(() => client.requestJson('https://other.test/data'), { code: 'unsafe_endpoint' });
  await assert.rejects(() => client.requestJson('https://provider.test/data', { method: 'PUT' }), { code: 'invalid_request' });
});

test('finance HTTP client rejects wrong content and oversized responses', async () => {
  const wrongType = createClient(async () => response('plain', 'text/plain'));
  await assert.rejects(() => wrongType.requestJson('https://provider.test/data'), { code: 'invalid_response' });

  const oversized = createClient(async () => response('x'.repeat(33)));
  await assert.rejects(() => oversized.requestJson('https://provider.test/data'), { code: 'response_too_large' });
});

test('finance HTTP client maps external cancellation, timeout and retry metadata', async () => {
  const controller = new AbortController();
  const cancelled = createClient(async (_endpoint, request) => {
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });
  await assert.rejects(() => cancelled.requestJson('https://provider.test/data', { signal: controller.signal }), { code: 'cancelled' });

  const timedOut = createClient(async (_endpoint, request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }), { timeoutMs: 5 });
  await assert.rejects(() => timedOut.requestJson('https://provider.test/data'), { code: 'timeout' });

  const limited = createClient(async () => response('{"retry_after_ms":123}', 'application/json', false, 429));
  await assert.rejects(() => limited.requestJson('https://provider.test/data'), (error) => error.code === 'http_429' && error.retryAfterMs === 123);
});
