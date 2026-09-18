const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path').win32;
const { createWorkspaceController } = require('../main/workspace-controller');
const { registerWorkspaceIpc } = require('../main/ipc/workspace');

function createHarness({ busy = false, selected = 'D:\\Dynamic Panel' } = {}) {
  const writes = [];
  const directories = [];
  const copiedCaptures = [];
  const lifecycle = [];
  let configuredPath = 'C:\\Users\\tester\\AppData\\Dynamic Panel';
  const persistenceGate = {
    shouldWrite: () => true,
    markWritten: (storage, destination) => lifecycle.push({ type: 'marked', storage, destination }),
  };
  const fs = {
    constants: { COPYFILE_EXCL: 1 },
    existsSync: () => false,
    lstatSync: () => ({ isDirectory: () => false, isFile: () => false }),
    mkdirSync: (directory) => directories.push(directory),
    cpSync: () => {},
    copyFileSync: () => {},
  };
  const controller = createWorkspaceController({
    fs,
    path,
    getUserDataPath: () => 'C:\\Users\\tester\\AppData\\Dynamic Panel',
    getSettingsPath: (name) => `C:\\settings\\${name}`,
    readJsonFile: (filePath, fallback = {}) => {
      if (filePath.endsWith('workspace-settings.json')) return { path: configuredPath };
      if (filePath.endsWith('workspace.json')) return { localStorage: { saved: 'yes' } };
      return fallback;
    },
    writeJsonFile: (filePath, value) => {
      writes.push({ filePath, value });
      if (filePath.endsWith('workspace-settings.json')) configuredPath = value.path;
      return true;
    },
    workspaceSettingsFile: 'workspace-settings.json',
    workspaceDataFile: 'workspace.json',
    recordingsDirName: 'recordings',
    clipImagesDirName: 'clipboard-images',
    noteImagesDirName: 'note-images',
    portableMediaPath: (directory, filePath) => `${directory}/${String(filePath).split(/[\\/]/).pop()}`,
    persistenceGate,
    copyCaptures: (source, target) => copiedCaptures.push({ source, target }),
    isCaptureBusy: () => busy,
    showMessageBox: async (options) => lifecycle.push({ type: 'message', options }),
    showOwnedOpenDialog: async () => ({ canceled: false, filePaths: [selected] }),
    openPath: (target) => ({ target }),
    onContextChanged: () => lifecycle.push({ type: 'context' }),
    onWorkspaceChanged: (workspacePath) => lifecycle.push({ type: 'changed', workspacePath }),
    now: () => 123,
  });
  return { controller, writes, directories, copiedCaptures, lifecycle, persistenceGate };
}

test('workspace controller normalizes portable media and writes bounded snapshots', () => {
  const { controller, writes, lifecycle } = createHarness();
  assert.deepEqual(controller.info(), { path: 'C:\\Users\\tester\\AppData\\Dynamic Panel', portable: false });
  assert.deepEqual(controller.loadData(), { saved: 'yes' });
  const saved = controller.saveData({
    'notch-recordings': JSON.stringify([{ audioPath: 'C:\\old\\voice.webm' }]),
    'notch-clip-history': JSON.stringify([{ imagePath: 'C:\\old\\clip.png' }]),
  });
  assert.equal(saved, true);
  const snapshot = writes.at(-1).value;
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.updatedAt, 123);
  assert.deepEqual(JSON.parse(snapshot.localStorage['notch-recordings']), [{ audioPath: 'recordings/voice.webm' }]);
  assert.deepEqual(JSON.parse(snapshot.localStorage['notch-clip-history']), [{ imagePath: 'clipboard-images/clip.png' }]);
  assert.equal(lifecycle.at(-1).type, 'marked');
  assert.equal(controller.saveData({ huge: 'x'.repeat(8 * 1024 * 1024) }), false);
});

test('workspace switching blocks active capture and completes migration lifecycle', async () => {
  const blocked = createHarness({ busy: true });
  assert.equal(await blocked.controller.choose(), false);
  assert.equal(blocked.lifecycle[0].type, 'message');

  const harness = createHarness();
  assert.equal(await harness.controller.choose(), true);
  assert.equal(harness.copiedCaptures.length, 1);
  assert.ok(harness.directories.some((directory) => directory.endsWith('recordings')));
  assert.ok(harness.lifecycle.some((entry) => entry.type === 'context'));
  assert.ok(harness.lifecycle.some((entry) => entry.type === 'changed' && entry.workspacePath === 'D:\\Dynamic Panel'));
  assert.deepEqual(harness.controller.info(), { path: 'D:\\Dynamic Panel', portable: true });
});

test('workspace IPC delegates the stable five-channel contract', () => {
  const handlers = new Map();
  const calls = [];
  const workspaceController = new Proxy({}, {
    get: (_target, method) => (...args) => { calls.push({ method, args }); return method; },
  });
  registerWorkspaceIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, workspaceController });
  assert.deepEqual([...handlers.keys()], ['workspace:get', 'workspace:load-data', 'workspace:save-data', 'workspace:open', 'workspace:choose']);
  assert.equal(handlers.get('workspace:save-data')({}, { key: 'value' }), 'saveData');
  assert.deepEqual(calls.at(-1), { method: 'saveData', args: [{ key: 'value' }] });
});
