const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionService, PERMISSION_PROMPT_SKIP_FILE } = require('../main/permission-service');

function createHarness(overrides = {}) {
  const calls = [];
  const systemPreferences = {
    getMediaAccessStatus: () => 'not-determined',
    isTrustedAccessibilityClient: (prompt) => {
      calls.push(['accessibility', prompt]);
      return true;
    },
    ...overrides.systemPreferences,
  };
  const harness = {
    calls,
    systemPreferences,
    desktopCapturer: { getSources: async () => [{ name: 'Window' }] },
    screenRecordingProbePolicy: (status) => status === 'granted'
      ? { hasAccess: true, inspectWindowTitles: true }
      : { hasAccess: false, inspectWindowTitles: false },
    app: { getPath: () => 'user-data' },
    path: { join: (...parts) => parts.join('/') },
    fs: {
      existsSync: () => false,
      writeFileSync: (...args) => calls.push(['write', ...args]),
    },
    dialog: {
      showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
    },
    shell: { openExternal: (target) => calls.push(['open', target]) },
    privacySettingsPanes: { accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' },
    ...overrides,
  };
  return { calls, service: createPermissionService(harness) };
}

test('permission service avoids capture probing before screen permission is granted', async () => {
  let probes = 0;
  const { service } = createHarness({
    desktopCapturer: { getSources: async () => { probes++; return []; } },
  });
  assert.equal(await service.hasScreenRecordingAccess(), false);
  assert.equal(probes, 0);
});

test('permission service treats an empty or failed granted probe as non-blocking', async () => {
  const empty = createHarness({
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    desktopCapturer: { getSources: async () => [] },
  });
  assert.equal(await empty.service.hasScreenRecordingAccess(), true);

  const failed = createHarness({
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    desktopCapturer: { getSources: async () => { throw new Error('probe failed'); } },
  });
  assert.equal(await failed.service.hasScreenRecordingAccess(), true);
});

test('permission service prompts once and opens the first missing privacy pane', async () => {
  const { calls, service } = createHarness({
    systemPreferences: {
      getMediaAccessStatus: () => 'denied',
      isTrustedAccessibilityClient: () => false,
    },
    dialog: { showMessageBox: async () => ({ response: 0, checkboxChecked: true }) },
  });
  await service.promptForMissingPermissions();
  assert.equal(calls.some(([name]) => name === 'write'), true);
  assert.deepEqual(calls.find(([name]) => name === 'open'), [
    'open',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ]);
});

test('permission service respects unsupported platforms and persisted skip flag', async () => {
  let shown = 0;
  const unsupported = createHarness({ platform: 'win32', dialog: { showMessageBox: async () => { shown++; } } });
  await unsupported.service.promptForMissingPermissions();
  assert.equal(shown, 0);

  const skipped = createHarness({
    fs: { existsSync: (target) => target === `user-data/${PERMISSION_PROMPT_SKIP_FILE}` },
    dialog: { showMessageBox: async () => { shown++; } },
  });
  await skipped.service.promptForMissingPermissions();
  assert.equal(shown, 0);
});
