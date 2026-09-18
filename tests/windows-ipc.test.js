const test = require('node:test');
const assert = require('node:assert/strict');
const { registerWindowsIpc } = require('../main/ipc/windows');

test('windows IPC delegates list and focus while preserving window ids', async () => {
  const handlers = new Map();
  const calls = [];
  registerWindowsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    listWindows: async () => { calls.push(['list']); return { items: [{ id: 'window-1' }], error: null }; },
    focusWindow: async (id) => { calls.push(['focus', id]); return id === 'window-1'; },
  });
  assert.deepEqual(await handlers.get('windows:list')({ sender: { id: 1 } }), { items: [{ id: 'window-1' }], error: null });
  assert.equal(await handlers.get('windows:focus')({ sender: { id: 1 } }, 'window-1'), true);
  assert.equal(await handlers.get('windows:focus')({ sender: { id: 1 } }, 'missing'), false);
  assert.deepEqual(calls, [['list'], ['focus', 'window-1'], ['focus', 'missing']]);
});
