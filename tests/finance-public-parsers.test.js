const test = require('node:test');
const assert = require('node:assert/strict');
const parsers = require('../main/finance-public-parsers');

const tencent = Array.from({ length: 38 }, (_, index) => String(index));
tencent[1] = '贵州茅台';
tencent[3] = '1500';
tencent[30] = '20260915100000';

test('public finance parsers normalize Tencent and Sina quote payloads', () => {
  const tencentRows = parsers.parseTencentQuotes(`v_sh600519="${tencent.join('~')}";`);
  assert.equal(tencentRows[0].symbol, '600519.SH');
  assert.equal(tencentRows[0].name, '贵州茅台');
  const sinaRows = parsers.parseSinaQuotes('var hq_str_sh600519="贵州茅台,1495,1490,1500,1510,1480,1499,1500,123456,987654321,2026-09-15,10:00:00,0";');
  assert.equal(sinaRows[0].symbol, '600519.SH');
  assert.equal(sinaRows[0].timestamp, '2026-09-15 10:00:00');
});

test('public finance parsers normalize Eastmoney quotes and K lines', () => {
  const quotes = parsers.parseEastmoneyQuotes({ data: { diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 150000, f3: 67, f4: 1000, f5: 123, f6: 456789, f15: 151000, f16: 148000, f124: 1720000000 }] } });
  assert.equal(quotes[0].symbol, '600519.SH');
  assert.equal(quotes[0].price, 1500);
  const klines = parsers.parseEastmoneyKlines({ data: { klines: ['2026-09-14,1490,1495,1500,1480,1,2', '2026-09-15,1495,1500,1510,1490,1,2'] } });
  assert.deepEqual(klines[1], { at: '2026-09-15', close: '1500' });
});

test('public finance parsers reject invalid Eastmoney payloads', () => {
  assert.throws(() => parsers.parseEastmoneyQuotes({ rc: -1, data: null }), (error) => error.code === 'invalid_response');
  assert.throws(() => parsers.parseEastmoneyKlines({ rc: 0, data: null }), (error) => error.code === 'invalid_response');
});
