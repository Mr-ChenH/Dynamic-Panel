const test = require('node:test');
const assert = require('node:assert/strict');
const { privacySettingsPanesFor, registerSystemIpc } = require('../main/ipc/system');

test('system IPC exposes only fixed platform privacy settings panes', () => {
  assert.deepEqual(privacySettingsPanesFor('win32'), {
    microphone: 'ms-settings:privacy-microphone',
  });
  assert.deepEqual(privacySettingsPanesFor('darwin'), {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  });
});

test('system IPC validates external URLs and local paths before opening them', async () => {
  const handlers = new Map();
  const openedExternal = [];
  const openedPaths = [];
  registerSystemIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    requestMicrophoneAccess: async () => true,
    validatePublicHttpUrl: async (value) => value === 'https://example.com' ? new URL(value) : null,
    openExternal: async (value) => openedExternal.push(value),
    openPath: (value) => { openedPaths.push(value); return ''; },
    isAbsolutePath: (value) => /^[A-Z]:\//.test(value),
    privacySettingsPanes: privacySettingsPanesFor('win32'),
  });

  assert.equal(await handlers.get('media:microphone')(), true);
  assert.equal(await handlers.get('shell:openExternal')({}, 'file:///secret'), false);
  assert.equal(await handlers.get('shell:openExternal')({}, 'https://example.com'), true);
  assert.deepEqual(openedExternal, ['https://example.com/']);
  assert.equal(handlers.get('shell:openPath')({}, '../relative.txt'), undefined);
  assert.equal(handlers.get('shell:openPath')({}, 'C:/notes/file.txt'), '');
  assert.deepEqual(openedPaths, ['C:/notes/file.txt']);
  assert.equal(handlers.get('shell:open-privacy-settings')({}, 'accessibility'), false);
  assert.equal(handlers.get('shell:open-privacy-settings')({}, 'microphone'), true);
  assert.deepEqual(openedExternal, ['https://example.com/', 'ms-settings:privacy-microphone']);
});
