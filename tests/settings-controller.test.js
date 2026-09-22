const test = require('node:test');
const assert = require('node:assert/strict');
const { updateFeaturePreference, updateDefaultTabPreference } = require('../main-services');
const { createSettingsController } = require('../main/settings-controller');
const { registerSettingsIpc } = require('../main/ipc/settings');

function createHarness() {
  let settings = {
    features: { home: true, todo: true, finance: true, notes: true, links: true, recordings: true, credentials: true, clip: false },
    shortcut: 'Space',
    shortcuts: { screenshot: '', screenRecording: '', audioRecording: '' },
    defaultTab: 'home',
    theme: 'dark',
    notchHeight: { mode: 'small', custom: 24 },
  };
  let saveSucceeds = true;
  let launcherSaveSucceeds = true;
  const calls = [];
  const controller = createSettingsController({
    readAppSettings: () => ({ ...settings, features: { ...settings.features }, shortcuts: { ...settings.shortcuts } }),
    saveAppSettings: (next) => {
      calls.push({ type: 'save', next });
      if (saveSucceeds) settings = next;
      return saveSucceeds;
    },
    publicAppSettings: () => ({ ...settings, autoLaunch: false, shortcuts: { ...settings.shortcuts, launcher: 'CommandOrControl+Space' } }),
    applyAppSettings: () => calls.push({ type: 'apply' }),
    refreshTrayMenu: () => calls.push({ type: 'tray' }),
    updateFeaturePreference,
    updateDefaultTabPreference,
    isMainWindowSender: (sender) => sender?.id === 1,
    setAutoLaunch: (enabled) => { calls.push({ type: 'autoLaunch', enabled }); return true; },
    isAutoLaunchEnabled: () => false,
    isValidPanelShortcut: (value) => typeof value === 'string' && value.length > 0,
    isValidOptionalShortcut: (value) => typeof value === 'string',
    validateNotchHeightPreference: (value) => value?.mode === 'custom' && Number.isInteger(value.custom) && value.custom >= 24 && value.custom <= 64
      ? { mode: 'custom', custom: value.custom }
      : value?.mode === 'small' || value?.mode === 'medium' || value?.mode === 'large'
        ? { mode: value.mode, custom: 24 }
        : null,
    launcherConfig: () => ({ shortcut: 'CommandOrControl+Space', sources: { apps: true } }),
    writeLauncherSettings: (next) => { calls.push({ type: 'launcherSave', next }); return launcherSaveSucceeds; },
    setLauncherShortcut: (shortcut) => { calls.push({ type: 'launcherShortcut', shortcut }); return true; },
    setPanelShortcut: (shortcut) => { calls.push({ type: 'panelShortcut', shortcut }); return true; },
    setActionShortcut: (action, shortcut) => { calls.push({ type: 'actionShortcut', action, shortcut }); return true; },
    sendSettingsChanged: (next) => calls.push({ type: 'changed', next }),
  });
  return {
    controller,
    calls,
    settings: () => settings,
    failAppSave: () => { saveSucceeds = false; },
    failLauncherSave: () => { launcherSaveSucceeds = false; },
  };
}

test('settings controller persists feature, tab and main-window theme changes', () => {
  const harness = createHarness();
  assert.equal(harness.controller.setFeature({ featureId: 'clip', enabled: true }).ok, true);
  assert.equal(harness.settings().features.clip, true);
  assert.equal(harness.controller.setDefaultTab('notes').ok, true);
  assert.equal(harness.settings().defaultTab, 'notes');
  assert.deepEqual(harness.controller.setTheme({ id: 2 }, 'light'), { ok: false, error: 'invalid_sender' });
  assert.equal(harness.controller.setTheme({ id: 1 }, 'light').ok, true);
  assert.equal(harness.settings().theme, 'light');
  assert.ok(harness.calls.some((call) => call.type === 'apply'));
});

test('settings controller persists bounded notch height preferences', () => {
  const harness = createHarness();
  assert.deepEqual(harness.controller.setNotchHeight({ id: 1 }, { mode: 'custom', custom: 48 }), { ok: true, settings: { ...harness.settings(), autoLaunch: false, shortcuts: { ...harness.settings().shortcuts, launcher: 'CommandOrControl+Space' } } });
  assert.deepEqual(harness.settings().notchHeight, { mode: 'custom', custom: 48 });
  assert.deepEqual(harness.controller.setNotchHeight({ id: 1 }, { mode: 'custom', custom: 128 }), { ok: false, error: 'invalid_notch_height' });
});

test('settings controller rolls shortcuts back when persistence fails', () => {
  const appHarness = createHarness();
  appHarness.failAppSave();
  assert.deepEqual(appHarness.controller.setShortcut({ action: 'panel', accelerator: 'Alt+Space' }), { ok: false, error: 'save_failed' });
  assert.deepEqual(appHarness.calls.filter((call) => call.type === 'panelShortcut').map((call) => call.shortcut), ['Alt+Space', 'Space']);

  const launcherHarness = createHarness();
  launcherHarness.failLauncherSave();
  assert.deepEqual(launcherHarness.controller.setShortcut({ action: 'launcher', accelerator: 'Control+Space' }), { ok: false, error: 'save_failed' });
  assert.deepEqual(launcherHarness.calls.filter((call) => call.type === 'launcherShortcut').map((call) => call.shortcut), ['Control+Space', 'CommandOrControl+Space']);
});

test('settings IPC delegates the stable six-channel contract', () => {
  const handlers = new Map();
  const calls = [];
  const settingsController = new Proxy({}, {
    get: (_target, method) => (...args) => { calls.push({ method, args }); return method; },
  });
  registerSettingsIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, settingsController });
  assert.deepEqual([...handlers.keys()], [
    'settings:get', 'settings:set-feature', 'settings:set-default-tab', 'settings:set-theme', 'settings:set-notch-height',
    'settings:set-auto-launch', 'settings:set-shortcut',
  ]);
  assert.equal(handlers.get('settings:set-theme')({ sender: { id: 1 } }, 'light'), 'setTheme');
  assert.deepEqual(calls.at(-1), { method: 'setTheme', args: [{ id: 1 }, 'light'] });
});
