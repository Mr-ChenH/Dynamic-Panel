const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceConfigResolver } = require('../main/finance-config-resolver');

test('finance config resolver prefers environment credentials and labels their source', () => {
  const resolver = createFinanceConfigResolver({
    readSettings: () => ({ providers: {
      coingecko: { enabled: true, encryptedApiKey: 'stored-coin' },
      binance: { enabled: true },
      'alpha-vantage': { enabled: true, encryptedApiKey: 'stored-alpha' },
      alpaca: { enabled: true, feed: 'sip', encryptedKeyId: 'stored-id', encryptedSecretKey: 'stored-secret' },
      'twelve-data': { enabled: true, encryptedApiKey: 'stored-twelve' },
      'sec-edgar': { enabled: true, encryptedContact: 'stored@example.com' },
      'cn-stock': { enabled: true, encryptedApiKey: 'stored-quant' },
      'cn-tencent': { enabled: true }, 'cn-eastmoney': { enabled: true }, 'cn-sina': { enabled: true },
    } }),
    decryptStoredSecret: (value) => `decrypted:${value}`,
    environment: {
      COINGECKO_API_KEY: 'env-coin',
      ALPACA_API_KEY_ID: 'env-id',
      ALPACA_API_SECRET_KEY: 'env-secret',
      SEC_EDGAR_CONTACT: 'env@example.com',
    },
  });
  const config = resolver.resolve();
  assert.deepEqual(config.coingecko, { enabled: true, apiKey: 'env-coin', credentialSource: 'environment' });
  assert.deepEqual(config.alphaVantage, { enabled: true, apiKey: 'decrypted:stored-alpha', credentialSource: 'stored' });
  assert.equal(config.alpaca.credentialSource, 'environment');
  assert.equal(config.secEdgar.contact, 'env@example.com');
  assert.equal(config.cnStock.apiKey, 'decrypted:stored-quant');
  assert.equal(resolver.normalizeSecEdgarContact(' bad\n@example.com '), '');
});
