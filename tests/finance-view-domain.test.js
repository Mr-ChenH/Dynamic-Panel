const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../renderer/finance-view-domain');

const definitions = [
  { market: 'crypto', label: '加密货币', providerIds: ['coingecko'], session: '24/7' },
  { market: 'us', label: '美股', providerIds: ['alpaca'], session: '交易时段' },
];

test('finance view domain formats prices, percentages and timestamps safely', () => {
  assert.equal(domain.formatPrice(null), '--');
  assert.match(domain.formatPrice(12.5, 'USD'), /12/);
  assert.equal(domain.formatPercent(-1.25), '-1.25%');
  assert.equal(domain.changeClass(-0.01), 'down');
  assert.equal(domain.changeClass(0), 'up');
  assert.equal(domain.formatTime('invalid'), '--');
});

test('finance view domain projects market provider fallback states', () => {
  const result = domain.overviewMarkets({ providers: [{ id: 'coingecko', state: 'ready', label: 'CoinGecko', feed: 'REST' }] }, definitions);
  assert.deepEqual(result[0], {
    market: 'crypto',
    label: '加密货币',
    session: '24/7',
    state: 'available_without_summary',
    provider: 'CoinGecko',
    feed: 'REST',
  });
  assert.equal(result[1].state, 'not_available');
});

test('finance view domain creates bounded chart markup and series summaries', () => {
  assert.equal(domain.renderChartCanvas('asset', [1]), '');
  assert.match(domain.renderChartCanvas('a&b', [1, 2]), /data-finance-chart-asset="a&amp;b"/);
  assert.equal(domain.seriesChange([100, 110]), 10);
  assert.equal(domain.seriesChange([0, 10]), null);
  assert.equal(domain.chartColor([2, 1]), '#ff8d82');
  assert.equal(domain.chartColor([1, 2]), '#59d792');
});
