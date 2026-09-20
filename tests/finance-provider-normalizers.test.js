const test = require('node:test');
const assert = require('node:assert/strict');
const normalizers = require('../main/finance-provider-normalizers');

test('provider normalizers preserve Twelve Data and SEC contracts', () => {
  const quote = normalizers.normalizeTwelveDataQuote({ symbol: 'AAPL', close: '200', previous_close: '198', datetime: '2026-09-15 10:00:00' }, '2026-09-15T10:01:00.000Z');
  assert.equal(quote.asset.id, 'us:twelve-data:AAPL');
  assert.equal(quote.changeAmount, 2);
  const search = normalizers.normalizeTwelveDataSearch({ data: [{ symbol: 'AAPL', instrument_name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', country: 'United States', instrument_type: 'Common Stock' }] });
  assert.equal(search[0].name, 'Apple Inc.');
  const fact = normalizers.normalizeSecCompanyConcept({ cik: '0000320193', units: { USD: [{ form: '10-K', val: 100, start: '2025-01-01', end: '2025-12-31', filed: '2026-02-01', fy: 2025, fp: 'FY' }] } }, { key: 'revenue', label: 'Revenue', concept: 'Revenue' });
  assert.equal(fact.value, 100);
});

test('provider normalizers preserve QuantDash identities and change semantics', () => {
  const quote = normalizers.normalizeQuantdashMarket({ symbol: '600519.SH', last_price: '1500', prev_close: '1490', timestamp: 1720000000, ext: { change_pct: 0.01 } }, '2026-09-15T00:00:00.000Z');
  assert.equal(quote.asset.id, 'cn:quantdash:600519.SH');
  assert.equal(quote.changePercent, 1);
  const history = normalizers.normalizeQuantdashHistory({ data: { timestamp: [1720000000, 1720086400], close: [1490, 1500] } }, quote.asset.id, '2026-09-15T00:00:00.000Z', 7);
  assert.equal(history.series.length, 2);
});

test('provider normalizers retain bounded public A-share and response parsers', () => {
  assert.equal(normalizers.inferQuantdashCode('600519'), '600519.SH');
  assert.equal(normalizers.publicCnCodeFromAssetId('cn:eastmoney:600519.SH'), '600519.SH');
  assert.throws(() => normalizers.quantdashRows({ code: 403, data: [] }), (error) => error.code === 'provider_permission_denied');
  assert.throws(() => normalizers.quantdashKlineData({ data: { timestamp: [], open: [] } }), (error) => error.code === 'invalid_response');
});
