const test = require('node:test');
const assert = require('node:assert/strict');
const { registerWindowIpc } = require('../main/ipc/window');

test('window IPC registers the stable window and hover status contract', async () => {
  const handlers = new Map();
  const events = [];
  const mainSender = { id: 1 };
  const otherSender = { id: 2 };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, handler) => handlers.set(channel, handler),
  };
  registerWindowIpc({
    ipcMain,
    isMainWindowSender: (sender) => sender === mainSender,
    setMode: (mode) => { events.push(['mode', mode]); return 'mode-result'; },
    beginCollapse: () => { events.push(['collapse']); return 'collapse-result'; },
    setCollapsedHover: (value) => events.push(['hover', value]),
    getMetrics: () => ({ stripHeight: 24 }),
    keepOpen: () => events.push(['keep-open']),
    setTab: (tab) => { events.push(['tab', tab]); return 'tab-result'; },
    getHoverSpaceStatus: () => ({ registered: false }),
  });
  assert.deepEqual([...handlers.keys()], [
    'window:set-mode', 'window:begin-collapse', 'window:set-collapsed-hover',
    'window:metrics', 'window:keep-open', 'window:set-tab', 'shortcut:hover-space-status',
  ]);
  assert.equal(await handlers.get('window:set-mode')({ sender: mainSender }, 'expanded'), 'mode-result');
  assert.equal(await handlers.get('window:set-mode')({ sender: otherSender }, 'expanded'), undefined);
  assert.equal(await handlers.get('window:begin-collapse')({ sender: otherSender }), undefined);
  handlers.get('window:set-collapsed-hover')({ sender: mainSender }, true);
  handlers.get('window:keep-open')({ sender: mainSender });
  assert.deepEqual(await handlers.get('window:metrics')({ sender: mainSender }), { stripHeight: 24 });
  assert.equal(await handlers.get('window:set-tab')({ sender: mainSender }, 'notes'), 'tab-result');
  assert.deepEqual(await handlers.get('shortcut:hover-space-status')({ sender: mainSender }), { registered: false });
  assert.deepEqual(events, [['mode', 'expanded'], ['hover', true], ['keep-open'], ['tab', 'notes']]);
});
