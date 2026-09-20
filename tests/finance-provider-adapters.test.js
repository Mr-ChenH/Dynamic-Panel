const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceProviderAdapters } = require('../main/finance-provider-adapters');
const { createFinanceRequestCache } = require('../main/finance-request-cache');
const finance = require('../finance-service');

const NOW = Date.parse('2026-09-15T00:00:00.000Z');

function boundedText(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function financeError(error) {
  if (error?.code) return String(error.code);
  if (error?.name === 'AbortError') return 'cancelled';
  return 'network_error';
}

function cancelledError() {
  return Object.assign(new Error('cancelled'), { code: 'cancelled' });
}

function createHarness({ config = {}, respond = () => ({}) } = {}) {
  let clock = NOW;
  const requests = [];
  const cache = createFinanceRequestCache({ now: () => clock, financeError, cancelledError, maxCacheEntries: 64 });
  const requestJson = (url, options = {}) => {
    requests.push({ url, options });
    return Promise.resolve().then(() => {
      const value = respond(url, options);
      if (value instanceof Error) throw value;
      return value;
    });
  };
  const adapters = createFinanceProviderAdapters({
    requestJson,
    getConfig: () => config,
    now: () => clock,
    cached: cache.cached,
    financeError,
    cancelledError,
    boundedText,
    finiteNumber,
    inferQuantdashCode: (value) => boundedText(value, 32).toUpperCase(),
    publicCnPrefix: () => '0',
    publicCnSecId: (code) => `${String(code).toUpperCase().endsWith('.SH') ? '1' : '0'}.${String(code).slice(0, 6)}`,
    publicCnCodeFromAssetId: finance.publicCnCodeFromAssetId,
    usSymbolFromAssetId: (assetId) => {
      const symbol = boundedText(assetId, 240).split(':').at(-1).toUpperCase();
      return /^([A-Z][A-Z0-9.-]{0,14})$/.test(symbol) && String(assetId).startsWith('us:') ? symbol : '';
    },
    quantdashAsset: (symbol, name = '') => ({ id: `cn:quantdash:${symbol}`, symbol, name }),
    publicCnAsset: (symbol, name = '', provider = 'eastmoney') => ({ id: `cn:${provider}:${symbol}`, symbol, name }),
    normalizeCoinGeckoMarket: finance.normalizeCoinGeckoMarket,
    normalizeCoinGeckoHistory: finance.normalizeCoinGeckoHistory,
    normalizeBinanceMarket: finance.normalizeBinanceMarket,
    normalizeBinanceHistory: finance.normalizeBinanceHistory,
    normalizeAlphaVantageMover: finance.normalizeAlphaVantageMover,
    normalizeAlpacaSnapshot: finance.normalizeAlpacaSnapshot,
    normalizeTwelveDataQuote: finance.normalizeTwelveDataQuote,
    normalizeTwelveDataHistory: finance.normalizeTwelveDataHistory,
    normalizeQuantdashMarket: finance.normalizeQuantdashMarket,
    normalizeQuantdashHistory: finance.normalizeQuantdashHistory,
    normalizePublicCnQuote: finance.normalizePublicCnQuote,
    normalizePublicCnHistory: finance.normalizePublicCnHistory,
    normalizeSecCompanyConcept: finance.normalizeSecCompanyConcept,
    parseTencentQuotes: finance.parseTencentQuotes,
    parseSinaQuotes: finance.parseSinaQuotes,
    parseEastmoneyQuotes: finance.parseEastmoneyQuotes,
    parseEastmoneyKlines: finance.parseEastmoneyKlines,
    quantdashRows: finance.quantdashRows,
    quantdashKlineData: finance.quantdashKlineData,
    quantdashInstrumentRows: (payload) => finance.quantdashRows(payload).map((row) => ({ ...row, ext: row.ext || {} })),
    twelveDataError: (payload) => {
      if (payload?.status !== 'error') return null;
      return Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
    },
  });
  return {
    adapters,
    requests,
    advance(ms) { clock += ms; },
  };
}

function binanceKlines() {
  return [
    [NOW - 86_400_000, '0', '0', '0', '65000', '0'],
    [NOW, '0', '0', '0', '68000', '0'],
  ];
}

function quantdashKlines() {
  return {
    data: {
      timestamp: [NOW - 86_400_000, NOW],
      open: [64, 67],
      high: [66, 69],
      low: [63, 66],
      close: [65, 68],
      volume: [100, 120],
      amount: [1000, 1200],
    },
  };
}

test('provider adapter history constructs bounded Binance requests and serves cached results', async () => {
  const harness = createHarness({
    config: { binance: { enabled: true } },
    respond: () => binanceKlines(),
  });
  const first = await harness.adapters.history('crypto:binance:BTCUSDT', 7);
  const second = await harness.adapters.history('crypto:binance:BTCUSDT', 7);
  assert.equal(first.ok, true);
  assert.equal(first.series.at(-1).value, 68000);
  assert.deepEqual(second.series, first.series);
  assert.equal(harness.requests.length, 1);
  const request = new URL(harness.requests[0].url);
  assert.equal(request.pathname, '/api/v3/klines');
  assert.equal(request.searchParams.get('symbol'), 'BTCUSDT');
  assert.equal(request.searchParams.get('interval'), '1d');
  assert.equal(request.searchParams.get('limit'), '7');
  assert.equal(harness.requests[0].options.headers['User-Agent'], 'Dynamic-Panel/1.1');
});

test('provider adapter history keeps a fresh cached series as stale fallback after a forced failure', async () => {
  let fail = false;
  const harness = createHarness({
    config: { binance: { enabled: true } },
    respond: () => fail ? Object.assign(new Error('upstream down'), { code: 'http_503' }) : binanceKlines(),
  });
  const first = await harness.adapters.history('crypto:binance:BTCUSDT', 7);
  fail = true;
  const stale = await harness.adapters.history('crypto:binance:BTCUSDT', 7, null, true);
  assert.equal(first.ok, true);
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.warning, 'http_503');
  assert.equal(harness.requests.length, 2);
});

test('provider adapter history sends QuantDash auth and normalized kline parameters', async () => {
  const harness = createHarness({
    config: { cnStock: { enabled: true, apiKey: 'cn-secret' } },
    respond: () => quantdashKlines(),
  });
  const result = await harness.adapters.history('cn:quantdash:600519.SH', 30);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'quantdash');
  assert.equal(result.series.at(-1).value, 68);
  const request = new URL(harness.requests[0].url);
  assert.equal(request.pathname, '/v1/klines');
  assert.equal(request.searchParams.get('symbol'), '600519.SH');
  assert.equal(request.searchParams.get('period'), '1d');
  assert.equal(request.searchParams.get('count'), '40');
  assert.equal(harness.requests[0].options.headers['X-API-Key'], 'cn-secret');
});

test('provider adapter history uses Eastmoney public daily klines with bounded dates', async () => {
  const harness = createHarness({
    config: { cnEastmoney: { enabled: true }, cnStock: { enabled: false } },
    respond: () => ({ rc: 0, data: { klines: ['2026-09-14,64,65,66,63,100,1000,1,2,3,4', '2026-09-15,67,68,69,66,120,1200,1,2,3,4'] } }),
  });
  const result = await harness.adapters.history('cn:eastmoney:600519.SH', 7);
  assert.equal(result.ok, true, JSON.stringify({ result, requests: harness.requests }));
  assert.equal(result.provider, 'eastmoney');
  assert.equal(result.series.at(-1).value, 68);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].options.headers.Referer, 'https://quote.eastmoney.com/');
  assert.ok(harness.requests[0].url.includes('secid=1.600519'));
});

test('provider adapter history sends Twelve Data auth without placing the key in the URL', async () => {
  const harness = createHarness({
    config: { twelveData: { enabled: true, apiKey: 'twelve-secret' } },
    respond: (url, options) => {
      assert.ok(!url.includes('twelve-secret'));
      assert.equal(options.headers.Authorization, 'apikey twelve-secret');
      return { meta: { currency: 'USD' }, values: [
        { datetime: '2026-09-15', close: '205.50' },
        { datetime: '2026-09-14', close: '200' },
      ] };
    },
  });
  const result = await harness.adapters.history('us:nasdaq:AAPL', 7);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'twelve-data');
  assert.deepEqual(result.series.map((point) => point.value), [200, 205.5]);
  const request = new URL(harness.requests[0].url);
  assert.equal(request.searchParams.get('symbol'), 'AAPL');
  assert.equal(request.searchParams.get('interval'), '1day');
  assert.equal(request.searchParams.get('order'), 'DESC');
});

test('provider adapter history propagates cancellation from CoinGecko transport', async () => {
  const harness = createHarness({
    config: { coingecko: { enabled: true } },
    respond: (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(cancelledError()), { once: true });
      setTimeout(() => resolve({ prices: [[NOW - 86_400_000, 1], [NOW, 2]] }), 10);
    }),
  });
  const controller = new AbortController();
  const pending = harness.adapters.history('crypto:coingecko:bitcoin', 7, controller.signal);
  controller.abort();
  const result = await pending;
  assert.deepEqual(result, { ok: false, assetId: 'crypto:coingecko:bitcoin', days: 7, error: 'cancelled' });
});

function secConcept(concept, value, filed = '2026-08-01') {
  return {
    cik: '0000320193',
    entityName: 'Apple Inc.',
    units: { USD: [{ form: '10-Q', val: value, start: '2026-04-01', end: '2026-06-30', filed, fy: 2026, fp: 'Q2' }] },
    concept,
  };
}

test('provider adapter SEC fundamentals uses contact-bearing headers and ignores missing concepts', async () => {
  const harness = createHarness({
    config: { secEdgar: { enabled: true, contact: 'market@example.com' } },
    respond: (url, options) => {
      assert.equal(options.headers['User-Agent'], 'Dynamic-Panel/1.1 market@example.com');
      if (url.endsWith('/files/company_tickers.json')) return { '0': { ticker: 'AAPL', cik_str: 320193, title: 'Apple Inc.' } };
      if (url.includes('/Assets.json')) return secConcept('Assets', 1000);
      if (url.includes('/Liabilities.json')) return secConcept('Liabilities', 400);
      if (url.includes('/StockholdersEquity.json')) return secConcept('StockholdersEquity', 600);
      if (url.includes('/RevenueFromContractWithCustomerExcludingAssessedTax.json')) return Object.assign(new Error('missing'), { code: 'http_404' });
      if (url.includes('/Revenues.json')) return secConcept('Revenues', 800);
      if (url.includes('/NetIncomeLoss.json')) return secConcept('NetIncomeLoss', 200);
      throw new Error(`unexpected SEC URL: ${url}`);
    },
  });
  const result = await harness.adapters.fundamentals('us:nasdaq:AAPL');
  assert.equal(result.ok, true);
  assert.equal(result.cik, '0000320193');
  assert.equal(result.entityName, 'Apple Inc.');
  assert.deepEqual(result.metrics.map((metric) => metric.key), ['assets', 'liabilities', 'equity', 'revenue', 'netIncome']);
  assert.equal(result.warning, '');
  assert.equal(harness.requests.length, 7);
});

test('provider adapter SEC fundamentals reports missing ticker without leaking credentials', async () => {
  const harness = createHarness({
    config: { secEdgar: { enabled: true, contact: 'market@example.com' } },
    respond: (url) => url.endsWith('/files/company_tickers.json') ? { '0': { ticker: 'MSFT', cik_str: 789 } } : {},
  });
  const result = await harness.adapters.fundamentals('us:nasdaq:AAPL');
  assert.deepEqual(result, { ok: false, assetId: 'us:nasdaq:AAPL', provider: 'sec-edgar', error: 'fundamentals_unavailable' });
  assert.ok(harness.requests.every(({ url }) => !url.includes('market@example.com')));
});
