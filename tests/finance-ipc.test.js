const test = require('node:test');
const assert = require('node:assert/strict');
const { registerFinanceIpc } = require('../main/ipc/finance');

function createHarness({ overviewError = null } = {}) {
  const handlers = new Map();
  const service = {
    overview: async (payload) => {
      if (overviewError) throw overviewError;
      return payload;
    },
    cancel: (requestId) => ({ requestId }),
    clearCache: () => {},
    testProvider: async () => ({ ok: true, capabilities: { quotes: true } }),
  };
  registerFinanceIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getFinanceService: () => service,
    publicFinanceSettings: () => ({ refreshSeconds: 60 }),
    updateFinanceProvider: (payload) => payload,
    updateFinanceRefreshInterval: (value) => value,
    setFinanceBackgroundActivity: (payload) => payload,
    readFinanceSettings: () => ({ refreshSeconds: 60, providers: {} }),
    writeFinanceSettings: () => true,
    isMainWindowSender: (sender) => sender.id === 1,
  });
  return { handlers };
}

test('finance IPC namespaces request ids by sender and rejects activity from other windows', async () => {
  const { handlers } = createHarness();
  const event = { sender: { id: 7 } };
  const payload = await handlers.get('finance:overview')(event, { requestId: 'quotes-1', market: 'crypto' });
  assert.equal(payload.requestId, '7:quotes-1');
  assert.equal(payload.market, 'crypto');
  assert.deepEqual(await handlers.get('finance:set-activity')(event, { active: true }), { ok: false, error: 'forbidden' });
});

test('finance IPC cancellation is returned as structured data', async () => {
  const cancelled = Object.assign(new Error('cancelled'), { code: 'cancelled' });
  const { handlers } = createHarness({ overviewError: cancelled });
  const event = { sender: { id: 2 } };
  assert.deepEqual(await handlers.get('finance:overview')(event, { requestId: 'one' }), { ok: false, error: 'cancelled' });
  assert.deepEqual(await handlers.get('finance:cancel')(event, 'one'), { requestId: '2:one' });

  const aborted = createHarness({ overviewError: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  assert.deepEqual(await aborted.handlers.get('finance:overview')(event, {}), { ok: false, error: 'cancelled' });
});

test('finance IPC does not hide provider failures whose message merely mentions cancellation', async () => {
  const providerError = new Error('provider cancellation policy unavailable');
  const { handlers } = createHarness({ overviewError: providerError });
  await assert.rejects(handlers.get('finance:overview')({ sender: { id: 2 } }, {}), providerError);
});
