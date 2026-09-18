const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationWindowFactory } = require('../main/task-notification-window');

test('task notification window factory applies isolated non-focusable window policy', () => {
  const events = {};
  const calls = [];
  const fakeWindow = {
    webContents: {
      once(name, callback) { events[name] = callback; },
      on(name, callback) { events[name] = callback; },
    },
    setAlwaysOnTop(...args) { calls.push(['alwaysOnTop', ...args]); },
    setVisibleOnAllWorkspaces(...args) { calls.push(['workspaces', ...args]); },
    setIgnoreMouseEvents(...args) { calls.push(['mouse', ...args]); },
    loadFile(file) { calls.push(['load', file]); },
    on(name, callback) { events[name] = callback; },
    isDestroyed() { return false; },
  };
  function Window(options) { calls.push(['options', options]); return fakeWindow; }
  const ready = [];
  const factory = createTaskNotificationWindowFactory({
    BrowserWindow: Window,
    path: {},
    preloadPath: 'preload.js',
    htmlPath: 'notification.html',
    getBounds: () => ({ x: 1, y: 2, width: 400, height: 96 }),
    installLocalWebContentsGuards: () => calls.push(['guards']),
    onReady: (window) => ready.push(window),
    onRenderProcessGone: () => {},
    onClosed: () => {},
    platform: 'win32',
  });
  const result = factory.create();
  assert.equal(result, fakeWindow);
  assert.deepEqual(calls[0][1], {
    x: 1, y: 2, width: 400, height: 96,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, focusable: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, hiddenInMissionControl: true,
    fullscreenable: false, minimizable: false, maximizable: false,
    roundedCorners: false, show: false,
    webPreferences: { preload: 'preload.js', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  events['did-finish-load']();
  assert.deepEqual(ready, [fakeWindow]);
  assert.equal(calls.some((entry) => entry[0] === 'workspaces'), false);
});
