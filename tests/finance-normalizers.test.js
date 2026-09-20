const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCoinGeckoMarket,
  normalizeCoinGeckoHistory,
  normalizeCoinGeckoGlobalHistory,
  normalizeBinanceMarket,
  normalizeBinanceHistory,
  normalizeAlphaVantageMover,
  normalizeAlpacaSnapshot,
  normalizeTwelveDataQuote,
  normalizeTwelveDataHistory,
  normalizeTwelveDataSearch,
  normalizeSecCompanyConcept,
  normalizeQuantdashMarket,
  normalizeQuantdashHistory,
  quantdashRows,
  quantdashKlineData,
  quantdashCodeFromAssetId,
  publicCnCodeFromAssetId,
  parseTencentQuotes,
  parseSinaQuotes,
  parseEastmoneyQuotes,
  parseEastmoneyKlines,
  normalizePublicCnQuote,
  normalizePublicCnHistory,
  providerStates,
} = require('../finance-service');

const NOW = Date.parse('2026-09-15T00:00:00.000Z');

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

test('CoinGecko rows normalize to stable provider identities with real feed metadata', () => {
  const row = normalizeCoinGeckoMarket(coin('bitcoin', 'btc', 'Bitcoin', 78000, 2.5), '2026-09-15T00:00:00.000Z');
  assert.equal(row.asset.id, 'crypto:coingecko:bitcoin');
  assert.equal(row.asset.symbol, 'BTC');
  assert.equal(row.price, 78000);
  assert.equal(row.changePercent, 2.5);
  assert.equal(row.feed, 'coingecko-aggregate-rest');
  assert.equal(row.freshness, 'delayed');
  assert.equal(row.sparkline.length, 32);
  assert.equal(normalizeCoinGeckoMarket({ id: 'bad' }, '2026-09-15T00:00:00.000Z'), null);
});

test('CoinGecko history normalizes real timestamped points and keeps the asset identity', () => {
  const history = normalizeCoinGeckoHistory({ prices: [[Date.parse('2026-09-14T00:00:00Z'), 100], [Date.parse('2026-09-15T00:00:00Z'), 108]] }, 'bitcoin', '2026-09-15T00:01:00.000Z');
  assert.equal(history.assetId, 'crypto:coingecko:bitcoin');
  assert.deepEqual(history.series, [
    { at: '2026-09-14T00:00:00.000Z', value: 100 },
    { at: '2026-09-15T00:00:00.000Z', value: 108 },
  ]);
  assert.equal(history.feed, 'coingecko-aggregate-rest');
  assert.equal(normalizeCoinGeckoHistory({ prices: [[1, 2]] }, 'bitcoin', '2026-09-15T00:00:00.000Z'), null);
  const global = normalizeCoinGeckoGlobalHistory({ market_cap_chart: { market_cap: [[NOW - 3600000, 200], [NOW, 220]], volume: [[NOW - 3600000, 20], [NOW, 30]] } }, '2026-09-15T00:01:00.000Z');
  assert.equal(global.metric, 'market_cap');
  assert.equal(global.series[1].value, 220);
});

test('Binance and Alpha Vantage rows preserve provider identity and real feed fields', () => {
  const binance = normalizeBinanceMarket({ symbol: 'BTCUSDT', lastPrice: '68000.12', priceChange: '1200.12', priceChangePercent: '1.8', quoteVolume: '900000000', closeTime: NOW }, '2026-09-15T00:00:00.000Z');
  assert.equal(binance.asset.id, 'crypto:binance:BTCUSDT');
  assert.equal(binance.asset.currency, 'USDT');
  assert.equal(binance.asset.symbol, 'BTC/USDT');
  assert.equal(binance.price, 68000.12);
  assert.equal(binance.marketCap, null);
  assert.equal(binance.feed, 'binance-public-rest');
  const history = normalizeBinanceHistory([[NOW - 86400000, '0', '0', '0', '65000'], [NOW, '0', '0', '0', '68000']], binance.asset.id, '2026-09-15T00:01:00.000Z', 7);
  assert.equal(history.series[1].value, 68000);
  const alpha = normalizeAlphaVantageMover({ ticker: 'AAPL', price: '205.50', change_amount: '5.50', change_percentage: '2.75%', volume: '1000', last_updated: '2026-09-15' }, 'gainers', '2026-09-15T00:01:00.000Z');
  assert.equal(alpha.asset.id, 'us:alpha-vantage:AAPL');
  assert.equal(alpha.changePercent, 2.75);
  assert.equal(alpha.feed, 'alpha-vantage-gainers');
});

test('Alpaca snapshots keep the configured feed and derive change from the previous close', () => {
  const row = normalizeAlpacaSnapshot(
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    { latestTrade: { p: 205, t: '2026-09-14T23:59:30.000Z' }, dailyBar: { h: 208, l: 198, v: 900 }, prevDailyBar: { c: 200 } },
    'iex',
    '2026-09-15T00:00:00.000Z'
  );
  assert.equal(row.asset.id, 'us:nasdaq:AAPL');
  assert.equal(row.price, 205);
  assert.equal(row.changeAmount, 5);
  assert.equal(row.changePercent, 2.5);
  assert.equal(row.feed, 'alpaca-iex');
});

test('Twelve Data and SEC rows normalize bounded US market contracts', () => {
  const quote = normalizeTwelveDataQuote({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', close: '205.50', previous_close: '200', change: '5.50', percent_change: '2.75', high: '208', low: '198', volume: '900', timestamp: NOW / 1000, is_market_open: true }, '2026-09-15T00:01:00.000Z');
  assert.equal(quote.asset.id, 'us:twelve-data:AAPL');
  assert.equal(quote.asset.name, 'Apple Inc.');
  assert.equal(quote.price, 205.5);
  assert.equal(quote.changePercent, 2.75);
  assert.equal(quote.feed, 'twelve-data-us-basic-non-sip');
  const history = normalizeTwelveDataHistory({ meta: { currency: 'USD' }, values: [{ datetime: '2026-09-15', close: '205.50' }, { datetime: '2026-09-14', close: '200' }] }, quote.asset.id, '2026-09-15T00:01:00.000Z', 7);
  assert.deepEqual(history.series.map((point) => point.value), [200, 205.5]);
  const search = normalizeTwelveDataSearch({ data: [
    { symbol: 'AAPL', instrument_name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', country: 'United States', instrument_type: 'Common Stock' },
    { symbol: 'AIR', instrument_name: 'Airbus', exchange: 'PARIS', currency: 'EUR', country: 'France', instrument_type: 'Common Stock' },
  ] });
  assert.deepEqual(search.map((asset) => asset.id), ['us:twelve-data:AAPL']);
  const concept = normalizeSecCompanyConcept({ cik: 320193, units: { USD: [
    { val: 100, end: '2025-09-30', filed: '2025-11-01', form: '10-K', fy: 2025, fp: 'FY' },
    { val: 120, end: '2026-06-30', filed: '2026-08-01', form: '10-Q', fy: 2026, fp: 'Q3' },
  ] } }, { key: 'assets', label: '总资产', concept: 'Assets' });
  assert.equal(concept.value, 120);
  assert.equal(concept.form, '10-Q');
  assert.equal(concept.periodEnd, '2026-06-30');
});

test('QuantDash rows normalize snapshot fields, decimal changes and timestamps', () => {
  const row = normalizeQuantdashMarket({ symbol: '600519.SH', last_price: 1500, prev_close: 1470, timestamp: Date.parse('2026-09-15T01:30:00.000Z'), volume: 1000, amount: 123500, high: 1510, low: 1468, ext: { name: '贵州茅台', change_amount: 30, change_pct: 0.020408 } }, '2026-09-15T02:00:00.000Z');
  assert.equal(row.asset.id, 'cn:quantdash:600519.SH');
  assert.equal(row.asset.provider, 'quantdash');
  assert.equal(row.asset.exchange, 'SSE');
  assert.equal(row.asset.currency, 'CNY');
  assert.equal(row.volume24h, 123500);
  assert.equal(row.changePercent, 2.0408);
  assert.equal(row.feed, 'quantdash-realtime-snapshot');
  assert.equal(row.eventAt, '2026-09-15T01:30:00.000Z');
  const history = normalizeQuantdashHistory(quantdashKlines([
    { timestamp: Date.parse('2026-09-14T01:30:00.000Z'), close: 1470, open: 1460, high: 1480, low: 1450, volume: 100, amount: 1000 },
    { timestamp: Date.parse('2026-09-15T01:30:00.000Z'), close: 1500, open: 1480, high: 1510, low: 1470, volume: 120, amount: 1200 },
  ]), row.asset.id, '2026-09-15T02:00:00.000Z', 7);
  assert.deepEqual(history.series.map((point) => point.value), [1470, 1500]);
  assert.equal(history.provider, 'quantdash');
  assert.equal(quantdashCodeFromAssetId('cn:quantdash:600519.SH'), '600519.SH');
  assert.equal(quantdashCodeFromAssetId('cn:tushare:600519.SH'), '600519.SH');
  assert.equal(quantdashCodeFromAssetId('cn:sh:600519'), '600519.SH');
  assert.throws(() => quantdashRows({ code: 403, message: '当前套餐无此功能' }), (error) => error.code === 'provider_permission_denied');
  assert.throws(() => quantdashRows({ code: 429, message: '请求频率超限', retry_after_ms: 45000 }), (error) => error.code === 'http_429' && error.retryAfterMs === 45000);
  assert.throws(() => quantdashKlineData({ data: { timestamp: [1], open: [], high: [1], low: [1], close: [1], volume: [1], amount: [1] } }), (error) => error.code === 'invalid_response');
});

test('provider states expose disabled, missing and ready QuantDash configuration honestly', () => {
  const states = providerStates({
    coingecko: { enabled: true },
    alpaca: { enabled: true, keyId: 'id', secretKey: 'secret', feed: 'sip' },
  });
  assert.deepEqual(states.map((item) => [item.id, item.state]), [
    ['coingecko', 'ready'],
    ['binance', 'ready'],
    ['alpha-vantage', 'disabled'],
    ['alpaca', 'ready'],
    ['twelve-data', 'disabled'],
    ['sec-edgar', 'disabled'],
    ['cn-stock', 'disabled'],
    ['cn-tencent', 'disabled'],
    ['cn-eastmoney', 'disabled'],
    ['cn-sina', 'disabled'],
  ]);
  const missing = providerStates({ cnStock: { enabled: true } }).find((item) => item.id === 'cn-stock');
  assert.equal(missing.state, 'missing_credentials');
  assert.equal(missing.configured, false);
  const ready = providerStates({ cnStock: { enabled: true, apiKey: 'key', credentialSource: 'stored' } }).find((item) => item.id === 'cn-stock');
  assert.equal(ready.state, 'ready');
  assert.equal(ready.configured, true);
  assert.equal(ready.feed, '实时快照 / 日 K');
  assert.equal(ready.credentialSource, 'stored');
});

test('public A-share adapters decode Tencent, Sina and Eastmoney payloads without synthetic fields', () => {
  const tencent = Array.from({ length: 40 }, () => '');
  tencent[1] = '贵州茅台'; tencent[3] = '1500'; tencent[4] = '1490'; tencent[31] = '10'; tencent[32] = '0.67'; tencent[33] = '1510'; tencent[34] = '1480'; tencent[37] = '1234.5';
  const tencentRows = parseTencentQuotes(`v_sh600519="${tencent.join('~')}";`);
  assert.equal(tencentRows[0].symbol, '600519.SH');
  assert.equal(tencentRows[0].amount, 12345000);
  assert.equal(tencentRows[0].changePercent, '0.67');
  const sinaRows = parseSinaQuotes('var hq_str_sh600519="贵州茅台,1495,1490,1500,1510,1480,1499,1500,123456,987654321,2026-09-15,10:00:00,0";');
  assert.equal(sinaRows[0].symbol, '600519.SH');
  assert.equal(sinaRows[0].timestamp, '2026-09-15 10:00:00');
  const eastmoneyRows = parseEastmoneyQuotes({ data: { diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 67, f4: 1000, f5: 123, f6: 456789, f15: 151000, f16: 148000, f124: 1720000000 }] } });
  assert.equal(eastmoneyRows[0].symbol, '600519.SH');
  assert.equal(eastmoneyRows[0].price, 1500);
  assert.equal(eastmoneyRows[0].changePercent, 0.67);
  assert.equal(parseEastmoneyKlines({ data: { klines: ['2026-09-14,1490,1495,1500,1480,1,2', '2026-09-15,1495,1500,1510,1490,1,2'] } })[1].close, '1500');
  assert.throws(() => parseEastmoneyQuotes({ rc: -1, data: null }), (error) => error.code === 'invalid_response');
  assert.throws(() => parseEastmoneyKlines({ rc: 0, data: null }), (error) => error.code === 'invalid_response');
  assert.equal(publicCnCodeFromAssetId('cn:tencent:600519.SH'), '600519.SH');
  assert.equal(publicCnCodeFromAssetId('cn:eastmoney:600519.SH'), '600519.SH');
  const quote = normalizePublicCnQuote({ symbol: '600519.SH', name: '贵州茅台', price: 1500, previousClose: 1490, amount: 456789 }, 'eastmoney', '2026-09-15T00:00:00.000Z');
  assert.equal(quote.asset.id, 'cn:eastmoney:600519.SH');
  assert.equal(quote.changePercent, (10 / 1490) * 100);
  const history = normalizePublicCnHistory([{ at: '2026-09-14', close: '1495' }, { at: '2026-09-15', close: '1500' }], quote.asset.id, '2026-09-15T00:00:00.000Z', 7);
  assert.equal(history.provider, 'eastmoney');
  assert.deepEqual(history.series.map((point) => point.value), [1495, 1500]);
});
