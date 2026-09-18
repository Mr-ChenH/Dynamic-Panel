const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceBackgroundRefresh } = require('../main/finance-background-refresh');

function createHarness(overrides = {}) {
  const updates = [];
  const cancellations = [];
  const service = {
    prefetch: async () => ({ overview: { warnings: [] }, rankings: {} }),
    cancel: (id) => cancellations.push(id),
  };
  return {
    updates,
    cancellations,
    service: createFinanceBackgroundRefresh({
      getFinanceService: () => service,
      getMainWindow: () => ({ isDestroyed: () => false }),
      readAppSettings: () => ({ features: { finance: true } }),
      readFinanceSettings: () => ({ refreshSeconds: 60 }),
      isQuitting: () => false,
      sendUpdate: (_window, snapshot) => updates.push(snapshot),
      setTimeoutImpl: () => ({ unref() {} }),
      clearTimeoutImpl: () => {},
      ...overrides,
    }),
  };
}

test('finance background activity normalizes payload and publishes one snapshot', async () => {
  const harness = createHarness();
  const result = harness.service.setActivity({ active: true, refreshSeconds: 0, assetIds: [' btc ', 'btc'], rankingPage: 0 });
  assert.deepEqual(result, { ok: true, active: true, refreshSeconds: 0 });
  await harness.service.refresh();
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.service.getState().payload, {
    assetIds: ['btc'], rankingMarket: 'all', rankingSource: 'coingecko', rankingSort: 'gainers', rankingPage: 1,
  });
});

test('finance background invalidation cancels the active request and dispose clears activity', () => {
  const harness = createHarness();
  harness.service.setActivity({ active: true, refreshSeconds: 0 });
  harness.service.invalidate();
  assert.equal(harness.cancellations.length, 0);
  harness.service.dispose();
  assert.equal(harness.service.getState().active, false);
});
