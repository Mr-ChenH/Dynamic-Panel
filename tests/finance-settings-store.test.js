const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceSettingsStore } = require('../main/finance-settings-store');

test('finance settings store normalizes provider schema and delegates persistence', () => {
  let saved;
  const store = createFinanceSettingsStore({
    readJsonFile: () => ({
      refreshSeconds: 999,
      providers: {
        coingecko: { enabled: false, encryptedApiKey: 42 },
        alpaca: { feed: 'invalid', encryptedKeyId: 'id', encryptedSecretKey: 'secret' },
        'alpha-vantage': { enabled: true },
      },
    }),
    writeJsonFile: (file, value) => { saved = [file, value]; return true; },
    getSettingsPath: (file) => `settings/${file}`,
    fileName: 'finance-settings.json',
  });

  const settings = store.read();
  assert.equal(settings.schemaVersion, 2);
  assert.equal(settings.refreshSeconds, 60);
  assert.equal(settings.providers.coingecko.enabled, false);
  assert.equal(settings.providers.coingecko.encryptedApiKey, '42');
  assert.equal(settings.providers.alpaca.feed, 'iex');
  assert.equal(settings.providers['alpha-vantage'].enabled, true);
  assert.equal(store.write({ schemaVersion: 2 }), true);
  assert.deepEqual(saved, ['settings/finance-settings.json', { schemaVersion: 2 }]);
});
