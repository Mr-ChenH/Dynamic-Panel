const test = require('node:test');
const assert = require('node:assert/strict');
const facade = require('../finance-service');
const domain = require('../main/finance-domain');

test('finance service keeps the extracted provider state domain as a compatibility facade', () => {
  assert.equal(facade.providerStates, domain.providerStates);
  assert.equal(facade.freshnessFor instanceof Function, true);
  assert.deepEqual(domain.providerStates({ cnTencent: { enabled: true } }).find((row) => row.id === 'cn-tencent'), {
    id: 'cn-tencent', label: '腾讯公开行情', market: 'cn', enabled: true, configured: true,
    credentialSource: 'none', feed: '公开行情 · GBK', state: 'ready',
  });
});

test('finance error mapping remains bounded and cancellation keeps its stable code', () => {
  assert.equal(domain.financeError({ code: 'http_429' }), 'rate_limited');
  assert.equal(domain.financeError({ message: 'cancelled by caller' }), 'cancelled');
  assert.equal(domain.cancelledError().code, 'cancelled');
});
