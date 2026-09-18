const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLauncherIpc } = require('../main/ipc/launcher');

test('launcher IPC keeps sender isolation and delegates the stable handler contract', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const mainWindow = { webContents: { send() {} }, isDestroyed: () => false };
  const service = {
    query: async () => [{ id: 'one' }],
    list: async () => [],
    cancel: async () => {},
  };
  const shortcut = { launcher: 'CommandOrControl+Space' };
  registerLauncherIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    getLauncherService: () => service,
    launcherFocus: { restore: () => true, discard: () => {} },
    launcherConfig: () => ({ shortcut: shortcut.launcher, sources: { apps: true } }),
    getShortcutState: () => shortcut,
    setLauncherShortcut: (value) => { shortcut.launcher = value; return true; },
    writeLauncherSettings: () => true,
    app: { getFileIcon: async () => ({ toDataURL: () => '' }) },
    path: require('node:path'),
    fs: require('node:fs'),
    dialog: {},
    shell: {},
    validatePublicHttpUrl: async () => null,
    launcherApplications: {},
    resolveLaunchPath: async () => null,
    clipboard: {},
    getLauncherManaging: () => false,
    setLauncherManaging: () => {},
    adjustTransientSystemInteractionRequests: () => {},
  });

  assert.deepEqual([...handlers.keys()], [
    'launcher:focus', 'launcher:settings', 'launcher:save-settings', 'launcher:query',
    'launcher:icon', 'launcher:cancel', 'launcher:extension-data', 'launcher:extensions',
    'launcher:extension-toggle', 'launcher:extension-install', 'launcher:extension-remove',
    'launcher:run', 'launcher:navigation-result', 'launcher:open-url',
  ]);
  assert.deepEqual(await handlers.get('launcher:settings')({ sender: mainWindow.webContents }), {
    ok: true,
    shortcut: 'CommandOrControl+Space',
    sources: { apps: true },
    registered: true,
  });
  assert.deepEqual(await handlers.get('launcher:query')({ sender: mainWindow.webContents }, { query: 'a' }), {
    ok: true,
    items: [{ id: 'one' }],
  });
  assert.deepEqual(await handlers.get('launcher:settings')({ sender: {} }), { ok: false, error: 'invalid_sender' });
});
