const test = require('node:test');
const assert = require('node:assert/strict');
const { createLauncherSettingsStore } = require('../main/launcher-settings-store');

function createHarness(stored, size = 100) {
  let written = null;
  const service = createLauncherSettingsStore({
    readJsonFile: () => stored,
    writeJsonFile: (_path, value) => { written = value; return true; },
    getSettingsPath: (name) => `user-data/${name}`,
    statFile: () => ({ size }),
  });
  return { service, getWritten: () => written };
}

test('launcher settings normalize defaults, sources and bounded timeouts', () => {
  const { service } = createHarness({
    shortcut: 'Alt+Space',
    executeTimeoutMs: 20000,
    queryTimeoutMs: 100,
    sources: { apps: false, clipboard: true },
  });
  assert.deepEqual(service.read(), {
    shortcut: 'Alt+Space',
    executeTimeoutMs: 10000,
    queryTimeoutMs: 300,
    sources: { apps: false, workspace: true, clipboard: true, extensions: true },
  });
});

test('launcher settings ignore oversized files and use defaults', () => {
  const { service } = createHarness({ shortcut: 'Alt+X' }, 65537);
  assert.deepEqual(service.read(), {
    shortcut: 'CommandOrControl+Space',
    executeTimeoutMs: 5000,
    queryTimeoutMs: 800,
    sources: { apps: true, workspace: true, clipboard: false, extensions: true },
  });
});

test('launcher settings delegate persistence to the injected writer', () => {
  const { service, getWritten } = createHarness({});
  const next = { shortcut: 'CommandOrControl+K', sources: { apps: true } };
  assert.equal(service.write(next), true);
  assert.deepEqual(getWritten(), next);
});
