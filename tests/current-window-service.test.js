const test = require('node:test');
const assert = require('node:assert/strict');
const { createCurrentWindowService } = require('../main/current-window-service');

test('current window service stays inert on unsupported platforms', async () => {
  const service = createCurrentWindowService({
    execFile: () => {},
    platform: 'win32',
    processId: 42,
    normalizeWindowRows: (rows) => rows,
    withTimeout: async (promise) => promise,
    readWindowAppIcon: async () => null,
  });
  assert.deepEqual(await service.list(), { items: [], error: 'unsupported' });
  assert.equal(await service.focus('missing'), false);
  assert.equal(await service.focusTarget({ pid: 1, title: 'Window', windowIndex: 0 }), false);
});
