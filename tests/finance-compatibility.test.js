const test = require('node:test');
const assert = require('node:assert/strict');
const finance = require('../finance-service');

const PUBLIC_NORMALIZERS = [
  'normalizeCoinGeckoMarket',
  'normalizeCoinGeckoHistory',
  'normalizeCoinGeckoGlobalHistory',
  'normalizeBinanceMarket',
  'normalizeBinanceHistory',
  'normalizeAlphaVantageMover',
  'normalizeAlpacaSnapshot',
  'normalizeTwelveDataQuote',
  'normalizeTwelveDataHistory',
  'normalizeTwelveDataSearch',
  'normalizeSecCompanyConcept',
  'normalizeQuantdashMarket',
  'normalizeQuantdashHistory',
  'normalizePublicCnQuote',
  'normalizePublicCnHistory',
  'parseTencentQuotes',
  'parseSinaQuotes',
  'parseEastmoneyQuotes',
  'parseEastmoneyKlines',
  'quantdashRows',
  'quantdashKlineData',
  'quantdashCodeFromAssetId',
  'publicCnCodeFromAssetId',
  'providerStates',
  'freshnessFor',
  'sampleSeries',
  'sampleHistory',
];

const FACADE_METHODS = [
  'cancel',
  'clearCache',
  'fundamentals',
  'history',
  'overview',
  'prefetch',
  'providerStates',
  'quotes',
  'ranking',
  'search',
  'testProvider',
];

test('finance service preserves the public normalizer and parser export facade', () => {
  for (const name of PUBLIC_NORMALIZERS) assert.equal(typeof finance[name], 'function', `${name} must remain public`);
});

test('finance service preserves the stable facade method set after adapter extraction', () => {
  const service = finance.createFinanceService({ requestJson: async () => ({}), getConfig: () => ({}) });
  assert.deepEqual(Object.keys(service).sort(), FACADE_METHODS.slice().sort());
  for (const name of FACADE_METHODS) assert.equal(typeof service[name], 'function', `${name} must remain on the facade`);
});
