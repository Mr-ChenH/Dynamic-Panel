const test = require('node:test');
const assert = require('node:assert/strict');
const { registerClipboardIpc } = require('../main/ipc/clipboard');

test('clipboard IPC confines image file access and preserves paste fallbacks', async () => {
  const handlers = new Map();
  const removed = [];
  const written = [];
  const fs = {
    promises: {
      readFile: async (filePath) => Buffer.from(filePath === 'C:/data/clip.png' ? 'png' : ''),
      unlink: async (filePath) => removed.push(filePath),
    },
  };
  registerClipboardIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    fs,
    getSafeClipImagePath: (value) => value === 'clip.png' ? 'C:/data/clip.png' : '',
    writeClipboardEntry: async (entry) => { written.push(entry); return entry !== 'rejected'; },
    automaticPaste: true,
    isAccessibilityTrusted: () => true,
    getPreviousPasteTarget: () => ({ bundleId: 'com.example.editor' }),
    requestRendererCollapse: () => {},
    waitForCollapsedPanel: async () => {},
    pasteToPreviousApp: async (target) => target.bundleId === 'com.example.editor',
  });

  const image = await handlers.get('clipboard:readImage')({}, 'clip.png');
  assert.equal(image, `data:image/png;base64,${Buffer.from('png').toString('base64')}`);
  assert.equal(await handlers.get('clipboard:readImage')({}, '../escape.png'), null);
  await handlers.get('clipboard:deleteImages')({}, ['clip.png', '../escape.png']);
  assert.deepEqual(removed, ['C:/data/clip.png']);
  assert.deepEqual(await handlers.get('clipboard:paste')({}, 'entry'), { ok: true, pasted: true });
  assert.deepEqual(await handlers.get('clipboard:paste')({}, 'rejected'), { ok: false, pasted: false });
  assert.deepEqual(written, ['entry', 'rejected']);
});

test('clipboard paste reports missing accessibility permission without launching paste', async () => {
  const handlers = new Map();
  let launched = false;
  registerClipboardIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    fs: { promises: { readFile: async () => Buffer.alloc(0), unlink: async () => {} } },
    getSafeClipImagePath: () => '',
    writeClipboardEntry: async () => true,
    automaticPaste: true,
    isAccessibilityTrusted: () => false,
    getPreviousPasteTarget: () => null,
    requestRendererCollapse: () => {},
    waitForCollapsedPanel: async () => {},
    pasteToPreviousApp: async () => { launched = true; return true; },
  });
  assert.deepEqual(await handlers.get('clipboard:paste')({}, 'entry'), { ok: true, pasted: false, permissionRequired: true });
  assert.equal(launched, false);
});
