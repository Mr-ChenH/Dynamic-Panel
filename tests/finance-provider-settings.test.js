const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceProviderSettings } = require('../main/finance-provider-settings');

function createHarness(overrides = {}) {
  let stored = {
    schemaVersion: 2,
    refreshSeconds: 120,
    providers: {
      coingecko: { enabled: true, encryptedApiKey: 'old', verification: { ok: true } },
      binance: { enabled: true, verification: { ok: true } },
      'alpha-vantage': { enabled: false, encryptedApiKey: 'alpha-old', verification: null },
      alpaca: { enabled: true, feed: 'iex', encryptedKeyId: 'key-old', encryptedSecretKey: 'secret-old', verification: null },
      'twelve-data': { enabled: false, encryptedApiKey: '', verification: null },
      'sec-edgar': { enabled: false, encryptedContact: '', verification: null },
      'cn-stock': { enabled: false, encryptedApiKey: '', verification: null },
      'cn-tencent': { enabled: true, verification: null },
      'cn-eastmoney': { enabled: true, verification: null },
      'cn-sina': { enabled: true, verification: null },
    },
  };
  let writes = 0;
  const service = createFinanceProviderSettings({
    readSettings: () => stored,
    writeSettings: (next) => {
      writes += 1;
      if (overrides.writeSettings) return overrides.writeSettings(next);
      stored = next;
      return true;
    },
    normalizeSecEdgarContact: overrides.normalizeSecEdgarContact || ((value) => value.includes('@') ? value : ''),
    isEncryptionAvailable: overrides.isEncryptionAvailable || (() => true),
    encryptString: overrides.encryptString || ((value) => Buffer.from(`encrypted:${value}`)),
    onSaved: overrides.onSaved || (() => ({ ok: true, saved: true })),
  });
  return { service, getStored: () => stored, getWrites: () => writes };
}

test('finance provider settings validates provider credentials before writing', () => {
  const { service, getWrites } = createHarness();
  assert.deepEqual(service.update({ providerId: 'unknown' }), { ok: false, error: 'invalid_provider' });
  assert.deepEqual(service.update({ providerId: 'coingecko', apiKey: 'x'.repeat(513) }), { ok: false, error: 'invalid_credential' });
  assert.deepEqual(service.update({ providerId: 'sec-edgar', contact: 'invalid' }), { ok: false, error: 'invalid_contact' });
  assert.equal(getWrites(), 0);
});

test('finance provider settings encrypts new credentials and preserves unrelated provider data', () => {
  const { service, getStored } = createHarness();
  const result = service.update({ providerId: 'alpaca', enabled: true, feed: 'sip', keyId: 'new-id', secretKey: 'new-secret' });
  assert.deepEqual(result, { ok: true, saved: true });
  assert.deepEqual(getStored().providers.alpaca, {
    enabled: true,
    feed: 'sip',
    encryptedKeyId: Buffer.from('encrypted:new-id').toString('base64'),
    encryptedSecretKey: Buffer.from('encrypted:new-secret').toString('base64'),
    verification: null,
  });
  assert.equal(getStored().providers.coingecko.encryptedApiKey, 'old');
  assert.equal(getStored().refreshSeconds, 120);
});

test('finance provider settings maps secure storage and persistence failures', () => {
  const unavailable = createHarness({ isEncryptionAvailable: () => false });
  assert.deepEqual(unavailable.service.update({ providerId: 'coingecko', apiKey: 'secret' }), {
    ok: false,
    error: 'secure_storage_unavailable',
  });

  const failed = createHarness({ writeSettings: () => false });
  assert.deepEqual(failed.service.update({ providerId: 'binance', enabled: false }), {
    ok: false,
    error: 'save_failed',
  });
});
