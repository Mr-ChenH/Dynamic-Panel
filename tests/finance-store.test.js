const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, normalizeAssetIdentity } = require('../renderer/finance-store');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); },
  };
}

test('finance store normalizes stable asset identities and provider defaults', () => {
  assert.deepEqual(normalizeAssetIdentity({
    id: 'crypto:coingecko:bitcoin',
    name: ' Bitcoin ',
    symbol: 'btc',
    providerAssetId: 'bitcoin',
    addedAt: '2026-01-01',
  }), {
    id: 'crypto:coingecko:bitcoin',
    provider: 'coingecko',
    providerAssetId: 'bitcoin',
    market: 'crypto',
    type: 'crypto',
    symbol: 'BTC',
    name: 'Bitcoin',
    exchange: '',
    currency: 'USD',
    addedAt: '2026-01-01',
  });
  assert.equal(normalizeAssetIdentity({ id: 'invalid:asset', name: 'x', symbol: 'x' }), null);
});

test('finance store migrates watchlists, removes fixture quotes and repairs the all list', () => {
  const storage = createStorage({
    'notch-finance-watchlists-v1': JSON.stringify({
      assets: {
        btc: { id: 'crypto:coingecko:bitcoin', name: 'Bitcoin', symbol: 'btc', price: 1 },
        eth: { id: 'crypto:coingecko:ethereum', name: 'Ethereum', symbol: 'eth', addedAt: '2026-01-01' },
      },
      lists: [{ id: 'favorites', name: 'Favorites', assetIds: ['crypto:coingecko:ethereum', 'missing'] }],
    }),
  });
  const store = createController({ storage, dispatch() {} });
  const result = store.loadWatchlists();
  assert.deepEqual(Object.keys(result.assets), ['crypto:coingecko:ethereum']);
  assert.deepEqual(result.lists, [
    { id: 'all', name: '全部观察', assetIds: ['crypto:coingecko:ethereum'] },
    { id: 'favorites', name: 'Favorites', assetIds: ['crypto:coingecko:ethereum'] },
  ]);
  assert.deepEqual(JSON.parse(storage.value('notch-finance-watchlists-v1')), result);
});

test('finance store normalizes preference aliases and preserves supported refresh intervals', () => {
  const storage = createStorage({
    'notch-finance-view-preferences-v1': JSON.stringify({
      defaultView: 'bad',
      defaultMarket: 'A 股',
      defaultRanking: 'change-asc',
      defaultSource: 'coingecko',
      refreshSeconds: 120,
    }),
  });
  const store = createController({
    storage,
    dispatch() {},
    rankingSourceFor: (market, source, sort) => `${market}:${source}:${sort}`,
  });
  assert.deepEqual(store.loadPreferences(), {
    defaultView: 'overview',
    defaultMarket: 'cn',
    defaultSource: 'cn:coingecko:losers',
    defaultRanking: 'losers',
    refreshSeconds: 120,
  });
});

test('finance store persistence delegates writes and emits the workspace mutation event', () => {
  const storage = createStorage();
  const events = [];
  const store = createController({ storage, dispatch: (event) => events.push(event.type) });
  const watchlists = { schemaVersion: 1, lists: [], assets: {} };
  const preferences = { defaultView: 'overview', refreshSeconds: 60 };
  store.saveWatchlists(watchlists);
  store.savePreferences(preferences);
  assert.deepEqual(JSON.parse(storage.value('notch-finance-watchlists-v1')), watchlists);
  assert.deepEqual(JSON.parse(storage.value('notch-finance-view-preferences-v1')), preferences);
  assert.deepEqual(events, ['notch-workspace-mutated', 'notch-workspace-mutated']);
});
