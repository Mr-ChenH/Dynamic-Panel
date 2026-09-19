const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppSettingsService } = require('../main/app-settings-service');

function createHarness(stored = {}) {
  let saved = null;
  const service = createAppSettingsService({
    readJsonFile: () => stored,
    writeJsonFile: (_path, value) => { saved = value; return true; },
    getSettingsPath: (name) => `user-data/${name}`,
    fileName: 'app-settings.json',
    defaultFeatures: {
      home: true, todo: true, finance: true, notes: true,
      links: true, recordings: true, credentials: true, clip: false,
    },
    normalizeDefaultTabPreference: (value, features) => features[value] === false ? 'home' : (value || 'home'),
    isValidPanelShortcut: (value) => typeof value === 'string' && value.length > 0 && value.length <= 100,
    isValidOptionalShortcut: (value) => value === '' || (typeof value === 'string' && value.length <= 100),
    launcherConfig: () => ({ shortcut: 'CommandOrControl+Space' }),
    isAutoLaunchEnabled: () => true,
  });
  return { service, getSaved: () => saved };
}

test('app settings normalize defaults and force home to remain enabled', () => {
  const { service } = createHarness({
    features: { home: false, clip: true, notes: false },
    shortcut: '',
    shortcuts: { screenshot: 'Alt+S', screenRecording: 'bad' },
    defaultTab: 'notes',
    theme: 'light',
  });
  assert.deepEqual(service.read(), {
    features: {
      home: true, todo: true, finance: true, notes: false,
      links: true, recordings: true, credentials: true, clip: true,
    },
    shortcut: 'Space',
    shortcuts: { screenshot: 'Alt+S', screenRecording: 'bad', audioRecording: '' },
    defaultTab: 'home',
    theme: 'light',
  });
});

test('app settings expose launcher shortcut and auto-launch state without changing stored schema', () => {
  const { service } = createHarness({ features: { todo: false }, defaultTab: 'home' });
  assert.deepEqual(service.publicSettings(), {
    features: {
      home: true, todo: false, finance: true, notes: true,
      links: true, recordings: true, credentials: true, clip: false,
    },
    shortcut: 'Space',
    shortcuts: {
      screenshot: '', screenRecording: '', audioRecording: '', launcher: 'CommandOrControl+Space',
    },
    defaultTab: 'home',
    theme: 'dark',
    autoLaunch: true,
  });
});

test('app settings delegate atomic persistence to the injected writer', () => {
  const { service, getSaved } = createHarness();
  const next = { features: { home: true }, shortcut: 'Space' };
  assert.equal(service.save(next), true);
  assert.deepEqual(getSaved(), next);
});
