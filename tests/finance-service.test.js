const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFinanceService,
  freshnessFor,
  sampleSeries,
} = require('../finance-service');

const NOW = Date.parse('2026-09-15T00:00:00.000Z');

function quantdashPayload(rows) {
  return { data: rows };
}

function quantdashKlines(rows) {
  return { data: Object.fromEntries(['timestamp', 'open', 'high', 'low', 'close', 'volume', 'amount'].map((field) => [field, rows.map((row) => row[field])])) };
}

function coin(id, symbol, name, price, change) {
  return {
    id,
    symbol,
    name,
    current_price: price,
    price_change_24h: 12,
    price_change_percentage_24h: change,
    price_change_percentage_1h_in_currency: 0.4,
    price_change_percentage_7d_in_currency: 8.2,
    market_cap: price * 1000,
    market_cap_rank: 1,
    total_volume: 500,
    high_24h: price + 10,
    low_24h: price - 10,
    last_updated: '2026-09-14T23:59:10.000Z',
    sparkline_in_7d: { price: Array.from({ length: 100 }, (_, index) => price + index) },
  };
}

test('Eastmoney public adapter supplies bounded A-share rankings and public quotes', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ cnEastmoney: { enabled: true }, cnTencent: { enabled: false }, cnSina: { enabled: false } }),
    requestJson: async (url) => {
      requests.push(url);
      if (url.includes('/clist/get')) return { data: { diff: [
        { f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 500, f4: 7000, f6: 1000, f15: 151000, f16: 140000 },
        { f12: '000001', f13: 0, f14: '平安银行', f2: 1000, f3: -200, f4: -20, f6: 900, f15: 1100, f16: 900 },
      ] } };
      if (url.includes('/ulist.np/get')) return { data: { diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 500, f4: 7000, f6: 1000, f15: 151000, f16: 140000 }] } };
      throw new Error(`unexpected ${url}`);
    },
  });
  const ranking = await service.ranking({ market: 'cn', sort: 'gainers', page: 1, pageSize: 50 });
  assert.equal(ranking.source, 'eastmoney');
  assert.deepEqual(ranking.rows.map((row) => row.asset.symbol), ['600519', '000001']);
  assert.equal(ranking.coverage[0], 'eastmoney_cn_stock_ranked_page');
  const quotes = await service.quotes({ assetIds: ['cn:tencent:600519.SH'] });
  assert.equal(quotes.rows[0].asset.id, 'cn:tencent:600519.SH');
  assert.equal(quotes.rows[0].feed, 'eastmoney-public-quote');
  assert.ok(requests.some((url) => url.includes('push2.eastmoney.com')));
});

test('Eastmoney ranking uses provider-native bounded pages and upstream totals', async () => {
  const urls = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ cnEastmoney: { enabled: true } }),
    requestJson: async (url) => {
      urls.push(url);
      return { rc: 0, data: { total: 5559, diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 123, f4: 1800, f6: 1000, f15: 151000, f16: 148000 }] } };
    },
  });
  const result = await service.ranking({ market: 'cn', sort: 'gainers', page: 2, pageSize: 50 });
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 50);
  assert.equal(result.totalRows, 5559);
  assert.equal(result.totalPages, 112);
  assert.equal(result.hasMore, true);
  assert.equal(result.countsComplete, false);
  assert.deepEqual(result.counts, { total: 5559 });
  assert.equal(result.rows[0].price, 1500);
  const request = new URL(urls[0]);
  assert.equal(request.searchParams.get('pn'), '2');
  assert.equal(request.searchParams.get('pz'), '50');
  assert.equal(request.searchParams.get('fid'), 'f3');
});

test('Eastmoney ranking falls back to the official delayed endpoint after a primary connection failure', async () => {
  const urls = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ cnEastmoney: { enabled: true } }),
    requestJson: async (url) => {
      urls.push(url);
      if (url.startsWith('https://push2.eastmoney.com/')) throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
      if (url.startsWith('https://push2delay.eastmoney.com/')) {
        return { rc: 0, data: { total: 1, diff: [{ f12: '600519', f13: 1, f14: 'Kweichow Moutai', f2: 150000, f3: 123, f4: 1800, f6: 1000, f15: 151000, f16: 148000 }] } };
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  const result = await service.ranking({ market: 'cn', sort: 'gainers' });
  assert.equal(result.rows[0].asset.symbol, '600519');
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/push2\.eastmoney\.com\//);
  assert.match(urls[1], /^https:\/\/push2delay\.eastmoney\.com\//);
});

test('public quote fallback stops after the first provider returns a valid quote', async () => {
  const requests = [];
  const fields = Array.from({ length: 40 }, () => '');
  fields[1] = '贵州茅台'; fields[3] = '1500'; fields[4] = '1490'; fields[31] = '10'; fields[32] = '0.67'; fields[33] = '1510'; fields[34] = '1480'; fields[37] = '100';
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ cnTencent: { enabled: true }, cnEastmoney: { enabled: false }, cnSina: { enabled: true } }),
    requestJson: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith('https://qt.gtimg.cn/')) return `v_sh600519="${fields.join('~')}";`;
      if (url.startsWith('https://hq.sinajs.cn/')) throw new Error('lower-priority provider should not run');
      throw new Error(`unexpected ${url}`);
    },
  });
  const result = await service.quotes({ assetIds: ['cn:eastmoney:600519.SH'] });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].asset.id, 'cn:eastmoney:600519.SH');
  assert.equal(result.rows[0].feed, 'tencent-public-quote');
  const tencentRequest = requests.find((entry) => entry.url.startsWith('https://qt.gtimg.cn/'));
  assert.equal(tencentRequest.options.responseType, 'text');
  assert.equal(tencentRequest.options.encoding, 'gbk');
  assert.deepEqual(result.errors, []);
  assert.equal(requests.some((entry) => entry.url.startsWith('https://hq.sinajs.cn/')), false);
});

test('public quote fallback advances after a malformed higher-priority response', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ cnTencent: { enabled: true }, cnEastmoney: { enabled: true }, cnSina: { enabled: true } }),
    requestJson: async (url) => {
      requests.push(url);
      if (url.startsWith('https://qt.gtimg.cn/')) return 'malformed';
      if (url.includes('/ulist.np/get')) return { rc: 0, data: { diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 100, f4: 1500, f6: 1000, f15: 151000, f16: 149000 }] } };
      if (url.startsWith('https://hq.sinajs.cn/')) throw new Error('lower-priority provider should not run');
      throw new Error(`unexpected ${url}`);
    },
  });
  const result = await service.quotes({ assetIds: ['cn:tencent:600519.SH'] });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].feed, 'eastmoney-public-quote');
  assert.deepEqual(result.errors, [{ provider: 'cn-tencent', error: 'invalid_response' }]);
  assert.equal(requests.some((url) => url.startsWith('https://hq.sinajs.cn/')), false);
});

test('finance overview and rankings use provider responses without synthetic fallback values', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: true, apiKey: 'demo-key' }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      requests.push(url);
      if (url.endsWith('/api/v3/global')) return { data: { total_market_cap: { usd: 2_500_000 }, total_volume: { usd: 100_000 }, market_cap_change_percentage_24h_usd: 1.2, active_cryptocurrencies: 14000, market_cap_percentage: { btc: 53.4 } } };
      if (url.includes('/api/v3/global/market_cap_chart')) return { market_cap_chart: { market_cap: [[NOW - 3600000, 2_400_000], [NOW, 2_500_000]], volume: [[NOW - 3600000, 90_000], [NOW, 100_000]] } };
      if (url.includes('/api/v3/coins/markets')) return [coin('bitcoin', 'btc', 'Bitcoin', 78000, 2.5), coin('ethereum', 'eth', 'Ethereum', 3200, -1.4)];
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const overview = await service.overview();
  assert.equal(overview.crypto.marketCap, 2_500_000);
  assert.equal(overview.markets.find((item) => item.market === 'cn').state, 'disabled');
  assert.equal(overview.markets.find((item) => item.market === 'us').state, 'disabled');
  const ranking = await service.ranking({ market: 'crypto', sort: 'losers' });
  assert.deepEqual(ranking.rows.map((row) => row.asset.id), ['crypto:coingecko:ethereum', 'crypto:coingecko:bitcoin']);
  assert.equal(ranking.rows.some((row) => Object.hasOwn(row, 'base')), false);
  assert.deepEqual(ranking.coverage, ['coingecko_top_100_market_cap']);
  assert.equal(requests.length, 3);
  assert.ok(requests.some((url) => url.endsWith('/api/v3/global')));
  assert.ok(requests.some((url) => url.includes('/api/v3/global/market_cap_chart')));
  assert.ok(requests.some((url) => url.includes('/api/v3/coins/markets')));
});

test('finance overview uses the Shanghai Composite as the A-share market benchmark', async () => {
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({
      coingecko: { enabled: false },
      alpaca: { enabled: false },
      twelveData: { enabled: false },
      alphaVantage: { enabled: false },
      cnEastmoney: { enabled: true },
      cnTencent: { enabled: false },
      cnSina: { enabled: false },
    }),
    requestJson: async (url) => {
      assert.match(url, /push2\.eastmoney\.com\/api\/qt\/ulist\.np\/get/);
      return { rc: 0, data: { diff: [{ f12: '000001', f13: 1, f14: '上证指数', f2: 320000, f3: 100, f4: 3200, f6: 100000, f15: 321000, f16: 318000, f124: 1720000000 }] } };
    },
  });
  const overview = await service.overview();
  const cnMarket = overview.markets.find((item) => item.market === 'cn');
  assert.equal(cnMarket.benchmark, '上证指数');
  assert.equal(cnMarket.value, 3200);
  assert.equal(cnMarket.changePercent, 1);
  assert.equal(cnMarket.benchmarkAssetId, 'cn:eastmoney:000001.SH');
});

test('all-market rankings include public A-share rows and preserve per-market featured results', async () => {
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alphaVantage: { enabled: false }, cnEastmoney: { enabled: true } }),
    requestJson: async (url) => {
      assert.match(url, /push2\.eastmoney\.com\/api\/qt\/clist\/get/);
      return { data: { total: 1, diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 500, f4: 7000, f6: 1000, f15: 151000, f16: 140000 }] } };
    },
  });
  const ranking = await service.ranking({ market: 'all', sort: 'gainers' });
  assert.equal(ranking.ok, true);
  assert.deepEqual(ranking.rows.map((row) => row.asset.id), ['cn:eastmoney:600519.SH']);
  assert.deepEqual(ranking.featured.cn.map((row) => row.asset.id), ['cn:eastmoney:600519.SH']);
  assert.deepEqual(ranking.featured.us, []);
  assert.deepEqual(ranking.featured.crypto, []);
});

test('rankings paginate provider rows into bounded pages with global counts and stable ordering', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: true }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      requests.push(url);
      return Array.from({ length: 120 }, (_, index) => ({ symbol: `C${String(index).padStart(3, '0')}USDT`, openPrice: '100', lastPrice: String(220 - index), quoteVolume: String(1000 - index), closeTime: NOW }));
    },
  });
  const first = await service.ranking({ market: 'crypto', source: 'binance', sort: 'gainers', page: 1, pageSize: 100 });
  assert.equal(first.pageSize, 50);
  assert.equal(first.page, 1);
  assert.equal(first.totalRows, 120);
  assert.equal(first.totalPages, 3);
  assert.equal(first.hasMore, true);
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0].asset.id, 'crypto:binance:C000USDT');
  assert.deepEqual(first.counts, { total: 120, positive: 120, negative: 0, flat: 0 });
  const second = await service.ranking({ market: 'crypto', source: 'binance', sort: 'gainers', page: 2, pageSize: 50 });
  assert.equal(second.page, 2);
  assert.equal(second.rows.length, 50);
  assert.equal(second.rows[0].asset.id, 'crypto:binance:C050USDT');
  assert.equal(second.rows[49].asset.id, 'crypto:binance:C099USDT');
  const last = await service.ranking({ market: 'crypto', source: 'binance', sort: 'gainers', page: 199, pageSize: 50 });
  assert.equal(last.page, 3);
  assert.equal(last.hasMore, false);
  assert.equal(last.rows[0].asset.id, 'crypto:binance:C100USDT');
  const background = await service.prefetch({ rankingMarket: 'crypto', rankingSource: 'binance', rankingSort: 'gainers', rankingPage: 2 });
  assert.equal(background.rankings['binance:gainers:page:2'].rows[0].asset.id, 'crypto:binance:C050USDT');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => /ticker\/24hr\?type=MINI/.test(url)));
});

test('market-cap rankings use CoinGecko when Binance has no market-cap field', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: true }, binance: { enabled: true }, alphaVantage: { enabled: false }, cnEastmoney: { enabled: false } }),
    requestJson: async (url) => {
      requests.push(url);
      if (url.includes('/api/v3/coins/markets')) return [coin('bitcoin', 'btc', 'Bitcoin', 78000, 2.5)];
      throw new Error(`unexpected ${url}`);
    },
  });
  const result = await service.ranking({ market: 'crypto', source: 'binance', sort: 'market_cap' });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'coingecko');
  assert.equal(result.rows[0].marketCap, 78_000_000);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /api\.coingecko\.com/);
});

test('history uses a bounded CoinGecko market chart request and reports unsupported markets', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: true }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      requests.push(url);
      return { prices: [[NOW - 3600000, 100], [NOW, 105]], total_volumes: [] };
    },
  });
  const result = await service.history({ assetId: 'crypto:coingecko:bitcoin', days: 30 });
  assert.equal(result.ok, true);
  assert.equal(result.days, 30);
  assert.equal(result.series.length, 2);
  assert.match(requests[0], /\/coins\/bitcoin\/market_chart\?vs_currency=usd&days=30/);
  assert.deepEqual(await service.history({ assetId: 'us:nasdaq:AAPL', days: 7 }), { ok: false, assetId: 'us:nasdaq:AAPL', days: 7, error: 'history_not_supported' });
});

test('search and watchlist quotes resolve CoinGecko assets through bounded batch requests', async () => {
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: true }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      if (url.includes('/api/v3/search')) return { coins: [{ id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2 }] };
      if (url.includes('/api/v3/coins/markets')) return [coin('ethereum', 'eth', 'Ethereum', 3200, -1.4)];
      throw new Error('unexpected request');
    },
  });
  const search = await service.search({ query: 'ETH' });
  assert.deepEqual(search.items[0], {
    id: 'crypto:coingecko:ethereum', provider: 'coingecko', providerAssetId: 'ethereum', market: 'crypto', type: 'crypto', symbol: 'ETH', exchange: 'CoinGecko', currency: 'USD', name: 'Ethereum', rank: 2,
  });
  const quotes = await service.quotes({ assetIds: ['crypto:coingecko:ethereum', 'cn:sh:600519'] });
  assert.equal(quotes.rows[0].price, 3200);
  assert.deepEqual(quotes.unavailable, [{ assetId: 'cn:sh:600519', error: 'provider_disabled' }]);
});

test('Binance rankings, quotes and history use public bounded endpoints', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: true }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      requests.push(url);
      if (url.includes('/ticker/24hr?type=MINI')) return [{ symbol: 'BTCUSDT', openPrice: '66800', lastPrice: '68000', quoteVolume: '900000000', closeTime: NOW }];
      if (url.includes('/ticker/24hr?symbols=')) return [{ symbol: 'BTCUSDT', lastPrice: '68000', priceChange: '1200', priceChangePercent: '1.8', quoteVolume: '900000000', closeTime: NOW }];
      if (url.includes('/klines')) return [[NOW - 86400000, '0', '0', '0', '65000'], [NOW, '0', '0', '0', '68000']];
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const ranking = await service.ranking({ market: 'crypto', source: 'binance', sort: 'gainers' });
  assert.equal(ranking.market, 'crypto');
  assert.equal(ranking.source, 'binance');
  assert.equal(ranking.rows[0].asset.id, 'crypto:binance:BTCUSDT');
  const legacyRanking = await service.ranking({ market: 'binance', sort: 'gainers' });
  assert.equal(legacyRanking.source, 'binance');
  assert.equal(legacyRanking.rows[0].asset.id, 'crypto:binance:BTCUSDT');
  const quotes = await service.quotes({ assetIds: ['crypto:binance:BTCUSDT'] });
  assert.equal(quotes.rows[0].price, 68000);
  const history = await service.history({ assetId: 'crypto:binance:BTCUSDT', days: 7 });
  assert.equal(history.series[1].value, 68000);
  assert.ok(requests.some((url) => url.includes('/ticker/24hr')));
  assert.ok(requests.some((url) => url.includes('/klines?symbol=BTCUSDT&interval=1d&limit=7')));
});

test('Alpha Vantage movers feed supports US gainers, losers and volume rankings', async () => {
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alphaVantage: { enabled: true, apiKey: 'test-key' }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      assert.match(url, /function=TOP_GAINERS_LOSERS/);
      return { top_gainers: [{ ticker: 'AAA', price: '10', change_amount: '2', change_percentage: '20%', volume: '500' }], top_losers: [{ ticker: 'BBB', price: '20', change_amount: '-4', change_percentage: '-16%', volume: '400' }], most_actively_traded: [{ ticker: 'CCC', price: '30', change_amount: '1', change_percentage: '3%', volume: '900' }] };
    },
  });
  const gainers = await service.ranking({ market: 'us', sort: 'gainers' });
  assert.deepEqual(gainers.rows.map((row) => row.asset.symbol), ['AAA']);
  const losers = await service.ranking({ market: 'us', sort: 'losers' });
  assert.deepEqual(losers.rows.map((row) => row.asset.symbol), ['BBB']);
  const volume = await service.ranking({ market: 'us', sort: 'volume' });
  assert.deepEqual(volume.rows.map((row) => row.asset.symbol), ['CCC']);
});

test('Twelve Data supplies bounded fallback quotes, US name search and history without exposing its key', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alpaca: { enabled: false }, twelveData: { enabled: true, apiKey: 'twelve-secret' } }),
    requestJson: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/quote?symbol=AAPL')) return { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', close: '205', previous_close: '200', high: '208', low: '198', volume: '900', timestamp: NOW / 1000 };
      if (url.includes('/quote?')) return {
        AAPL: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', close: '205', previous_close: '200', high: '208', low: '198', volume: '900', timestamp: NOW / 1000 },
        MSFT: { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ', currency: 'USD', close: '410', previous_close: '400', high: '412', low: '399', volume: '700', timestamp: NOW / 1000 },
      };
      if (url.includes('/symbol_search?')) return { data: [{ symbol: 'AAPL', instrument_name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', country: 'United States', instrument_type: 'Common Stock' }] };
      if (url.includes('/time_series?')) return { meta: { currency: 'USD' }, values: [{ datetime: '2026-09-15', close: '205' }, { datetime: '2026-09-14', close: '200' }] };
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const quotes = await service.quotes({ assetIds: ['us:nasdaq:AAPL', 'us:nasdaq:MSFT'] });
  assert.deepEqual(quotes.rows.map((row) => [row.asset.id, row.price]), [['us:nasdaq:AAPL', 205], ['us:nasdaq:MSFT', 410]]);
  assert.ok(quotes.rows.every((row) => row.feed === 'twelve-data-us-basic-non-sip'));
  const search = await service.search({ query: 'Apple' });
  assert.deepEqual(search.items.map((asset) => [asset.id, asset.name]), [['us:twelve-data:AAPL', 'Apple Inc.']]);
  const history = await service.history({ assetId: 'us:nasdaq:AAPL', days: 7 });
  assert.deepEqual(history.series.map((point) => point.value), [200, 205]);
  const providerTest = await service.testProvider('twelve-data');
  assert.equal(providerTest.ok, true);
  assert.equal(providerTest.capabilities.realtime, 'available');
  assert.equal(providerTest.capabilities.history, 'available');
  assert.equal(providerTest.capabilities.fullMarket, 'unsupported');
  assert.ok(requests.every((request) => request.options.headers.Authorization === 'apikey twelve-secret'));
  assert.ok(requests.every((request) => !request.url.includes('twelve-secret')));
});

test('SEC EDGAR returns filing-labelled fundamentals with a contact-bearing User-Agent', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ secEdgar: { enabled: true, contact: 'market@example.com' } }),
    requestJson: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/files/company_tickers.json')) return { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } };
      const concept = decodeURIComponent(url.split('/').at(-1).replace('.json', ''));
      if (concept === 'Revenues') throw Object.assign(new Error('http_404'), { code: 'http_404' });
      return { cik: 320193, entityName: 'Apple Inc.', units: { USD: [{ val: concept === 'Assets' ? 350000000000 : 100000000000, start: '2025-09-28', end: '2026-06-27', filed: '2026-08-01', form: '10-Q', fy: 2026, fp: 'Q3' }] } };
    },
  });
  const result = await service.fundamentals({ assetId: 'us:nasdaq:AAPL' });
  assert.equal(result.ok, true);
  assert.equal(result.cik, '0000320193');
  assert.equal(result.entityName, 'Apple Inc.');
  assert.equal(result.metrics.find((metric) => metric.key === 'assets').value, 350000000000);
  assert.ok(result.metrics.every((metric) => metric.form === '10-Q' && metric.periodEnd === '2026-06-27'));
  assert.ok(requests.every((request) => request.options.headers['User-Agent'].includes('market@example.com')));
  assert.ok(requests.every((request) => !request.url.includes('market@example.com')));
  const providerTest = await service.testProvider('sec-edgar');
  assert.equal(providerTest.ok, true);
  assert.equal(providerTest.capabilities.fundamentals, 'available');
  assert.equal(providerTest.capabilities.realtime, 'unsupported');
  assert.deepEqual(await service.fundamentals({ assetId: 'crypto:coingecko:bitcoin' }), { ok: false, assetId: 'crypto:coingecko:bitcoin', error: 'fundamentals_not_supported' });
});

test('Alpha Vantage free movers reuse the quota-protected half-day cache even on forced refresh', async () => {
  let current = NOW;
  let requests = 0;
  const service = createFinanceService({
    now: () => current,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alphaVantage: { enabled: true, apiKey: 'test-key' }, alpaca: { enabled: false } }),
    requestJson: async () => {
      requests += 1;
      return { top_gainers: [{ ticker: 'AAA', price: '10', change_amount: '2', change_percentage: '20%', volume: '500' }], top_losers: [], most_actively_traded: [] };
    },
  });
  await service.ranking({ market: 'us', sort: 'gainers', force: true });
  current += 6 * 60 * 60_000;
  await service.ranking({ market: 'us', sort: 'gainers', force: true });
  assert.equal(requests, 1);
  service.clearCache();
  await service.ranking({ market: 'us', sort: 'gainers', force: true });
  assert.equal(requests, 1);
  current += 7 * 60 * 60_000;
  await service.ranking({ market: 'us', sort: 'gainers', force: true });
  assert.equal(requests, 2);
});

test('QuantDash powers A-share rankings, quotes, search and daily history while preserving legacy asset IDs', async () => {
  const requests = [];
  const quoteRows = [
    { symbol: '600519.SH', last_price: 1500, prev_close: 1470, timestamp: NOW, volume: 1000, amount: 100000, high: 1510, low: 1470, ext: { name: '贵州茅台', change_amount: 30, change_pct: 0.020408 } },
    { symbol: '000001.SZ', last_price: 10.1, prev_close: 10, timestamp: NOW, volume: 2000, amount: 50000, high: 10.2, low: 9.9, ext: { name: '平安银行', change_amount: 0.1, change_pct: 0.01 } },
  ];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alphaVantage: { enabled: false }, alpaca: { enabled: false }, cnStock: { enabled: true, apiKey: 'private-key' } }),
    requestJson: async (url, options = {}) => {
      requests.push({ url, options });
      const parsed = new URL(url);
      if (parsed.pathname === '/v1/quotes' && parsed.searchParams.get('universes') === 'CN_Stock') return quantdashPayload(quoteRows);
      if (parsed.pathname === '/v1/quotes') {
        const symbols = String(parsed.searchParams.get('symbols') || '').split(',');
        return quantdashPayload(quoteRows.filter((row) => symbols.includes(row.symbol)));
      }
      if (parsed.pathname === '/v1/instruments') {
        const symbol = parsed.searchParams.get('symbols');
        const names = { '600519.SH': '贵州茅台', '000001.SZ': '平安银行' };
        return quantdashPayload(names[symbol] ? [{ symbol, name: names[symbol] }] : []);
      }
      if (parsed.pathname === '/v1/klines') return quantdashKlines([
        { timestamp: NOW - 86_400_000, open: 1460, high: 1480, low: 1450, close: 1470, volume: 100, amount: 1000 },
        { timestamp: NOW, open: 1480, high: 1510, low: 1470, close: 1500, volume: 120, amount: 1200 },
      ]);
      throw new Error(`unexpected QuantDash URL ${url}`);
    },
  });
  const overview = await service.overview();
  const cnMarket = overview.markets.find((item) => item.market === 'cn');
  assert.equal(cnMarket.state, 'available_without_summary');
  assert.equal(cnMarket.provider, 'QuantDash');
  assert.equal(cnMarket.feed, '实时快照 / 日 K');
  const gainers = await service.ranking({ market: 'cn', sort: 'gainers' });
  assert.equal(gainers.ok, true);
  assert.equal(gainers.source, 'quantdash');
  assert.deepEqual(gainers.coverage, ['quantdash_cn_stock_universe']);
  assert.deepEqual(gainers.rows.map((row) => row.asset.name), ['贵州茅台', '平安银行']);
  assert.equal(gainers.rows[0].feed, 'quantdash-realtime-snapshot');
  assert.equal(gainers.rows[0].volume24h, 100000);
  const marketCap = await service.ranking({ market: 'cn', sort: 'market_cap' });
  assert.equal(marketCap.unavailable, 'market_cap_not_supported');
  assert.deepEqual(marketCap.rows, []);
  const quotes = await service.quotes({ assetIds: ['cn:tushare:600519.SH', 'cn:sh:600519'] });
  assert.deepEqual(quotes.rows.map((row) => row.asset.id), ['cn:tushare:600519.SH', 'cn:sh:600519']);
  assert.ok(quotes.rows.every((row) => row.asset.name === '贵州茅台'));
  const nameSearch = await service.search({ query: '茅台' });
  assert.equal(nameSearch.items[0].id, 'cn:quantdash:600519.SH');
  const exactSearch = await service.search({ query: '000001' });
  assert.ok(exactSearch.items.some((asset) => asset.id === 'cn:quantdash:000001.SZ'));
  const history = await service.history({ assetId: 'cn:tushare:600519.SH', days: 7 });
  assert.deepEqual(history.series.map((point) => point.value), [1470, 1500]);
  const providerTest = await service.testProvider('cn-stock');
  assert.deepEqual(providerTest, {
    ok: true,
    capabilities: {
      realtime: 'available',
      daily: 'available',
      exactCodeSearch: 'available',
      history: 'available',
      metadata: 'available',
      fullMarket: 'available',
      marketCap: 'unsupported',
    },
  });
  assert.ok(requests.every((request) => request.url.startsWith('https://api.quantdash.net/v1/')));
  assert.ok(requests.every((request) => request.options.headers['X-API-Key'] === 'private-key'));
  assert.ok(requests.every((request) => !request.url.includes('private-key')));
  assert.ok(requests.every((request) => request.options.body === undefined));
});

test('QuantDash watchlist quotes stay within the documented five-symbol request limit', async () => {
  const quoteRequests = [];
  const assetIds = Array.from({ length: 7 }, (_, index) => `cn:quantdash:${String(600000 + index).padStart(6, '0')}.SH`);
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, cnStock: { enabled: true, apiKey: 'free-key' } }),
    requestJson: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, '/v1/quotes');
      assert.equal(parsed.searchParams.has('universes'), false);
      const symbols = String(parsed.searchParams.get('symbols') || '').split(',').filter(Boolean);
      quoteRequests.push(symbols);
      return quantdashPayload(symbols.map((symbol) => ({ symbol, last_price: 10, prev_close: 9.9, timestamp: NOW, volume: 100, amount: 1000, ext: { change_pct: 0.010101 } })));
    },
  });
  const result = await service.quotes({ assetIds });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 7);
  assert.deepEqual(quoteRequests.map((symbols) => symbols.length), [5, 2]);
});

test('QuantDash free-tier exact quotes and history stay usable when full-market access is denied', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alphaVantage: { enabled: false }, alpaca: { enabled: false }, cnStock: { enabled: true, apiKey: 'free-key' } }),
    requestJson: async (url) => {
      requests.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === '/v1/quotes' && parsed.searchParams.has('universes')) throw Object.assign(new Error('http_403'), { code: 'http_403' });
      if (parsed.pathname === '/v1/quotes') {
        const symbol = parsed.searchParams.get('symbols');
        return quantdashPayload(symbol === '600519.SH' || symbol === '000001.SZ'
          ? [{ symbol, last_price: 1500, prev_close: 1470, timestamp: NOW, amount: 1000, ext: { change_pct: 0.020408 } }] : []);
      }
      if (parsed.pathname === '/v1/instruments') {
        const symbol = parsed.searchParams.get('symbols');
        return quantdashPayload(symbol === '600519.SH' || symbol === '000001.SZ' ? [{ symbol, name: symbol === '600519.SH' ? '贵州茅台' : '平安银行' }] : []);
      }
      if (parsed.pathname === '/v1/klines') return quantdashKlines([
        { timestamp: NOW - 86_400_000, open: 1460, high: 1480, low: 1450, close: 1470, volume: 90, amount: 900 },
        { timestamp: NOW, open: 1490, high: 1510, low: 1480, close: 1500, volume: 100, amount: 1000 },
      ]);
      throw new Error(`unexpected QuantDash URL ${url}`);
    },
  });

  const ranking = await service.ranking({ market: 'cn', sort: 'gainers' });
  assert.equal(ranking.ok, true);
  assert.equal(ranking.unavailable, 'market_cap_permission_required');
  assert.deepEqual(ranking.rows, []);

  const marketCap = await service.ranking({ market: 'cn', sort: 'market_cap' });
  assert.equal(marketCap.ok, true);
  assert.equal(marketCap.unavailable, 'market_cap_not_supported');

  const exactCode = await service.search({ query: '600519' });
  assert.equal(exactCode.ok, true);
  assert.deepEqual(exactCode.items.filter((item) => item.market === 'cn').map((item) => [item.id, item.name]), [['cn:quantdash:600519.SH', '贵州茅台']]);

  const unknownCode = await service.search({ query: '600518' });
  assert.equal(unknownCode.ok, true);
  assert.deepEqual(unknownCode.items, []);

  const nameSearch = await service.search({ query: '茅台' });
  assert.equal(nameSearch.ok, true);
  assert.deepEqual(nameSearch.items, []);
  assert.deepEqual(nameSearch.warnings, [{ provider: 'cn-stock', warning: 'asset_search_symbol_only' }]);

  const history = await service.history({ assetId: 'cn:quantdash:600519.SH', days: 7 });
  assert.deepEqual(history.series.map((point) => point.value), [1470, 1500]);

  const providerTest = await service.testProvider('cn-stock');
  assert.deepEqual(providerTest, {
    ok: true,
    capabilities: {
      realtime: 'available',
      daily: 'available',
      exactCodeSearch: 'available',
      history: 'available',
      metadata: 'available',
      fullMarket: 'permission_required',
      marketCap: 'unsupported',
    },
  });
  assert.ok(requests.some((url) => url.includes('universes=CN_Stock')));
});

test('QuantDash exact-code search does not accept an inferred asset when API key authentication fails', async () => {
  const service = createFinanceService({
    getConfig: () => ({ coingecko: { enabled: false }, binance: { enabled: false }, alpaca: { enabled: false }, cnStock: { enabled: true, apiKey: 'invalid-key' } }),
    requestJson: async () => { throw Object.assign(new Error('http_401'), { code: 'http_401' }); },
  });
  const result = await service.search({ query: '600519' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.errors, [{ provider: 'cn-stock', error: 'authentication_failed' }]);
});

test('background prefetch force-refreshes and returns keyed market snapshots without persisting quote fixtures', async () => {
  let marketRequests = 0;
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: true, apiKey: 'demo-key' }, binance: { enabled: false }, alphaVantage: { enabled: false }, alpaca: { enabled: false } }),
    requestJson: async (url) => {
      if (url.endsWith('/api/v3/global')) return { data: { total_market_cap: { usd: 2_500_000 }, total_volume: { usd: 100_000 }, market_cap_change_percentage_24h_usd: 1.2, active_cryptocurrencies: 14000, market_cap_percentage: { btc: 53.4 } } };
      if (url.includes('/api/v3/global/market_cap_chart')) return { market_cap_chart: { market_cap: [[NOW - 3600000, 2_400_000], [NOW, 2_500_000]], volume: [] } };
      if (url.includes('/api/v3/coins/markets')) { marketRequests += 1; return [coin('bitcoin', 'btc', 'Bitcoin', 78000, 2.5)]; };
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const result = await service.prefetch({ assetIds: ['crypto:coingecko:bitcoin'], rankingMarket: 'binance', rankingSort: 'gainers' });
  assert.equal(result.ok, true);
  assert.equal(result.quotes.rows[0].asset.id, 'crypto:coingecko:bitcoin');
  assert.equal(result.rankings['all:coingecko:gainers'].rows[0].price, 78000);
  assert.equal(result.rankings['all:coingecko:losers'].rows[0].price, 78000);
  assert.equal(result.rankings['all:coingecko:volume'].rows[0].price, 78000);
  assert.equal(result.rankings['binance:gainers'].unavailable, 'provider_disabled');
  assert.equal(Object.hasOwn(result.rankings, 'us:volume'), false);
  const firstMarketRequests = marketRequests;
  await service.ranking({ market: 'crypto', sort: 'gainers' });
  assert.equal(marketRequests, firstMarketRequests);
  const nextResult = await service.prefetch({ assetIds: ['crypto:coingecko:bitcoin'], rankingMarket: 'us', rankingSort: 'volume' });
  assert.equal(nextResult.rankings['us:volume'].unavailable, 'provider_disabled');
  assert.ok(marketRequests > firstMarketRequests);
});

test('background prefetch cancellation stops later provider stages', async () => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let requestCount = 0;
  const service = createFinanceService({
    getConfig: () => ({ coingecko: { enabled: true }, binance: { enabled: true }, alphaVantage: { enabled: false }, alpaca: { enabled: false } }),
    requestJson: async (_url, options = {}) => {
      requestCount += 1;
      markStarted();
      return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true }));
    },
  });
  const pending = service.prefetch({ requestId: 'background-1', assetIds: ['crypto:binance:BTCUSDT'] });
  await started;
  assert.deepEqual(service.cancel('background-1'), { ok: true, cancelled: true });
  await assert.rejects(pending, /cancelled/);
  assert.equal(requestCount, 1);
});

test('Alpaca watchlist quotes use one batch snapshot request instead of per-asset metadata calls', async () => {
  const requests = [];
  const service = createFinanceService({
    now: () => NOW,
    getConfig: () => ({ coingecko: { enabled: false }, alpaca: { enabled: true, keyId: 'id', secretKey: 'secret', feed: 'iex' } }),
    requestJson: async (url) => {
      requests.push(url);
      return {
        AAPL: { latestTrade: { p: 205, t: '2026-09-14T23:59:30.000Z' }, dailyBar: { h: 208, l: 198, v: 900 }, prevDailyBar: { c: 200 } },
        MSFT: { latestTrade: { p: 410, t: '2026-09-14T23:59:30.000Z' }, dailyBar: { h: 412, l: 400, v: 700 }, prevDailyBar: { c: 400 } },
      };
    },
  });
  const result = await service.quotes({ assetIds: ['us:nasdaq:AAPL', 'us:nasdaq:MSFT'] });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /symbols=AAPL%2CMSFT/);
  assert.deepEqual(result.rows.map((row) => row.asset.id), ['us:nasdaq:AAPL', 'us:nasdaq:MSFT']);
});

test('cached market data is reused as stale data after a transient provider failure', async () => {
  let current = NOW;
  let failing = false;
  const service = createFinanceService({
    now: () => current,
    getConfig: () => ({ coingecko: { enabled: true } }),
    requestJson: async () => {
      if (failing) throw Object.assign(new Error('http_429'), { code: 'http_429' });
      return [coin('bitcoin', 'btc', 'Bitcoin', 78000, 2.5)];
    },
  });
  assert.equal((await service.ranking()).stale, false);
  current += 60_000;
  failing = true;
  const cached = await service.ranking();
  assert.equal(cached.ok, true);
  assert.equal(cached.stale, true);
  assert.equal(cached.warning, 'rate_limited');
  assert.equal(cached.rows[0].price, 78000);
  assert.equal(cached.retrievedAt, '2026-09-15T00:00:00.000Z');
});

test('finance request cancellation aborts in-flight provider work', async () => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const service = createFinanceService({
    getConfig: () => ({ coingecko: { enabled: true } }),
    requestJson: async (_url, options = {}) => {
      markStarted(options.signal);
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true });
      });
    },
  });
  const request = service.ranking({ requestId: 'window-one:finance-1' });
  const signal = await started;
  assert.equal(signal.aborted, false);
  assert.deepEqual(service.cancel('window-two:finance-1'), { ok: true, cancelled: false });
  assert.deepEqual(service.cancel('window-one:finance-1'), { ok: true, cancelled: true });
  const result = await request;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'cancelled');
  assert.equal(signal.aborted, true);
});

test('freshness and series sampling are deterministic', () => {
  assert.equal(freshnessFor('2026-09-14T23:59:00Z', '2026-09-15T00:00:00Z'), 'delayed');
  assert.equal(freshnessFor('2026-09-14T23:50:00Z', '2026-09-15T00:00:00Z'), 'stale');
  assert.equal(freshnessFor('invalid', '2026-09-15T00:00:00Z'), 'unknown');
  assert.deepEqual(sampleSeries([1, 2, 3], 4), [1, 2, 3]);
});
