const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSyncBaseUrl } = require('../main/sync/url-policy');
const { classifyRetry, backoffDelay } = require('../main/sync/retry');
const { createCredentialEnvelope } = require('../main/sync/credential-envelope');
const { createProtocolClient } = require('../main/sync/protocol-client');
const { projectStatus } = require('../main/sync/status');

const lookup = async (hostname) => ({
  'sync.example': [{ address: '8.8.8.8', family: 4 }],
  localhost: [{ address: '127.0.0.1', family: 4 }],
  'mixed.example': [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
}[hostname] || []);

test('sync URL policy requires public TLS or explicit loopback development mode', async () => {
  assert.equal((await validateSyncBaseUrl('https://sync.example', { lookup })).hostname, 'sync.example');
  await assert.rejects(validateSyncBaseUrl('http://sync.example', { lookup }), /loopback/);
  await assert.rejects(validateSyncBaseUrl('https://mixed.example', { lookup }), /not_public/);
  await assert.rejects(validateSyncBaseUrl('https://user:pass@sync.example', { lookup }), /credentials/);
  await assert.rejects(validateSyncBaseUrl('https://sync.example?key=x', { lookup }), /credentials/);
  await assert.rejects(validateSyncBaseUrl('http://localhost', { lookup }), /loopback/);
  assert.equal((await validateSyncBaseUrl('http://localhost', { lookup, allowLoopbackHttp: true })).loopback, true);
});

test('protocol client sends credentials only as headers and rejects redirects and unknown envelopes', async () => {
  const calls = [];
  const client = createProtocolClient({ lookup, platform: 'test-x64', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, headers: { get: () => 'req_1' }, json: async () => ({ data: { ok: true }, requestId: 'req_1' }) };
  } });
  const connection = await client.connect({ baseUrl: 'https://sync.example', clientKey: 'dpk_v1_secret', installationId: 'install-1' });
  await connection.session();
  assert.equal(calls[0].url, 'https://sync.example/api/v1/sync/session');
  assert.equal(calls[0].options.headers.authorization, 'ClientKey dpk_v1_secret');
  assert.doesNotMatch(calls[0].url, /secret/);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.throws(() => client.assertDiscovery({ instanceId: 'x', unexpected: true }), /unknown_discovery_property/);
});

test('retry classes stop permanent errors and use bounded full jitter or Retry-After', () => {
  assert.equal(classifyRetry({ code: 'installation_mismatch', retryable: true }).retry, false);
  assert.equal(classifyRetry({ code: 'storage_unavailable' }).retry, true);
  assert.equal(classifyRetry({ status: 503 }).retry, true);
  assert.equal(backoffDelay(3, { random: () => 0.5 }), 4000);
  assert.equal(backoffDelay(8, { retryAfter: '600' }), 300000);
});

test('credential envelope persists only encrypted material and degrades to session-only', () => {
  const secure = createCredentialEnvelope({ secureStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`enc:${value}`), decryptString: (value) => value.toString().slice(4) } });
  const sealed = secure.seal('binding', 'dpk_v1_secret');
  assert.equal(JSON.stringify(sealed).includes('dpk_v1_secret'), false);
  assert.equal(secure.open('binding', sealed), 'dpk_v1_secret');
  const volatile = createCredentialEnvelope(); const marker = volatile.seal('binding', 'dpk_v1_session');
  assert.equal(volatile.export(marker), null); assert.equal(volatile.open('binding', marker), 'dpk_v1_session');
});

test('status projection omits credentials, paths and raw error messages', () => {
  const status = projectStatus({ state: 'blocked', binding: { instanceId: 'instance-long-value', spaceId: 'space-long-value', clientId: 'client-long-value', spaceName: 'Work', clientKey: 'dpk_v1_secret', path: 'C:\\Users\\me' }, error: { code: 'authentication_failed', message: 'dpk_v1_secret C:\\Users\\me', stack: 'secret' } });
  const json = JSON.stringify(status);
  assert.doesNotMatch(json, /dpk_v1_|Users|message|stack/);
  assert.equal(status.error.code, 'authentication_failed');
});
