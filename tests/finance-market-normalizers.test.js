const test = require('node:test');
const assert = require('node:assert/strict');
const normalizers = require('../main/finance-market-normalizers');

const NOW = Date.parse('2026-09-15T00:00:00.000Z');

test('market normalizers project provider identities and bounded freshness', () => {
  const coin = normalizers.normalizeCoinGeckoMarket({
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 78_000,
    last_updated: '2026-09-15T00:00:00.000Z', price_change_24h: 120,
  }, '2026-09-15T00:01:00.000Z');
  assert.equal(coin.asset.id, 'crypto:coingecko:bitcoin');
  assert.equal(coin.freshness, 'delayed');
  const binance = normalizers.normalizeBinanceMarket({ symbol: 'BTCUSDT', lastPrice: '68000', openPrice: '67000', closeTime: NOW }, '2026-09-15T00:01:00.000Z');
  assert.equal(binance.asset.symbol, 'BTC/USDT');
  assert.ok(Math.abs(binance.changePercent - 1000 / 67000 * 100) < Number.EPSILON);
});

test('market normalizers sample provider history without changing output contracts', () => {
  const history = normalizers.normalizeCoinGeckoHistory({ prices: [[NOW - 86_400_000, 100], [NOW, 108]] }, 'bitcoin', '2026-09-15T00:01:00.000Z');
  assert.equal(history.assetId, 'crypto:coingecko:bitcoin');
  assert.equal(history.series[1].value, 108);
  const binance = normalizers.normalizeBinanceHistory([[NOW - 86_400_000, '0', '0', '0', '65000'], [NOW, '0', '0', '0', '68000']], 'crypto:binance:BTCUSDT', '2026-09-15T00:01:00.000Z', 7);
  assert.equal(binance.series.length, 2);
  assert.equal(binance.currency, 'USDT');
});

test('market normalizers reject incomplete provider rows', () => {
  assert.equal(normalizers.normalizeCoinGeckoMarket({ id: 'bitcoin' }, '2026-09-15T00:00:00.000Z'), null);
  assert.equal(normalizers.normalizeAlpacaSnapshot({ symbol: 'AAPL' }, {}, 'iex', '2026-09-15T00:00:00.000Z'), null);
});
