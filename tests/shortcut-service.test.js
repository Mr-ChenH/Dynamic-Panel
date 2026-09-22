const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hoverSpacePollingPolicy,
  isValidShortcutAccelerator,
  shortcutAssignmentConflict,
} = require('../main-services');
const { createShortcutService } = require('../main/shortcut-service');

function createHarness(platform = 'darwin') {
  const registered = new Map();
  const unregistered = [];
  const failed = new Set();
  const intervals = new Map();
  const actions = [];
  let intervalId = 0;
  let panel = { visible: true, mode: 'collapsed' };
  let cursor = { x: 110, y: 15 };
  const service = createShortcutService({
    globalShortcut: {
      register: (accelerator, callback) => {
        if (failed.has(accelerator) || registered.has(accelerator)) return false;
        registered.set(accelerator, callback);
        return true;
      },
      unregister: (accelerator) => {
        unregistered.push(accelerator);
        registered.delete(accelerator);
      },
      isRegistered: (accelerator) => registered.has(accelerator),
    },
    isValidPanelShortcut: (shortcut) => isValidShortcutAccelerator(shortcut, { allowSpace: true }),
    isValidOptionalShortcut: (shortcut) => isValidShortcutAccelerator(shortcut, { allowEmpty: true }),
    shortcutAssignmentConflict,
    platform,
    hoverSpacePollingPolicy,
    getPanelState: () => panel,
    getCursorPoint: () => cursor,
    getCollapsedBounds: () => ({ x: 100, y: 0, width: 200, height: 38 }),
    onPanelShortcut: () => actions.push('panel'),
    onHoverSpaceShortcut: () => actions.push('hover-panel'),
    onLauncherShortcut: () => actions.push('launcher'),
    onActionShortcut: (action) => actions.push(action),
    setIntervalFn: (callback, delay) => {
      const id = ++intervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalFn: (id) => intervals.delete(id),
  });
  return {
    service,
    registered,
    unregistered,
    failed,
    intervals,
    actions,
    setPanel: (next) => { panel = next; },
    setCursor: (next) => { cursor = next; },
    tick: () => [...intervals.values()].forEach(({ callback }) => callback()),
  };
}

test('shortcut service registers distinct panel, launcher and action shortcuts', () => {
  const harness = createHarness();
  assert.equal(harness.service.setPanelShortcut('CommandOrControl+Shift+P'), true);
  assert.equal(harness.service.setLauncherShortcut('CommandOrControl+Space'), true);
  assert.equal(harness.service.setActionShortcut('screenshot', 'CommandOrControl+Shift+S'), true);
  assert.equal(harness.service.setActionShortcut('screenRecording', 'CommandOrControl+Shift+S'), false);
  assert.equal(harness.service.setActionShortcut('unknown', ''), false);

  harness.registered.get('CommandOrControl+Shift+P')();
  harness.registered.get('CommandOrControl+Space')();
  harness.registered.get('CommandOrControl+Shift+S')();
  assert.deepEqual(harness.actions, ['panel', 'launcher', 'screenshot']);
  assert.deepEqual(harness.service.state(), {
    panel: 'CommandOrControl+Shift+P',
    launcher: 'CommandOrControl+Space',
    actions: { screenshot: 'CommandOrControl+Shift+S', screenRecording: '', audioRecording: '' },
    hoverRegistered: false,
  });
});

test('shortcut service rejects platform-equivalent aliases before replacing a registration', () => {
  const windows = createHarness('win32');
  assert.equal(windows.service.setLauncherShortcut('CommandOrControl+Space'), true);
  assert.equal(windows.service.setPanelShortcut('Control+Space'), false);
  assert.equal(windows.registered.has('CommandOrControl+Space'), true);
  assert.deepEqual(windows.unregistered, []);

  const mac = createHarness('darwin');
  assert.equal(mac.service.setLauncherShortcut('CommandOrControl+Space'), true);
  assert.equal(mac.service.setPanelShortcut('Command+Space'), false);
});

test('shortcut service restores the previous registration after an occupied replacement', () => {
  const harness = createHarness();
  assert.equal(harness.service.setLauncherShortcut('CommandOrControl+Space'), true);
  harness.failed.add('CommandOrControl+Alt+Space');
  assert.equal(harness.service.setLauncherShortcut('CommandOrControl+Alt+Space'), false);
  assert.equal(harness.service.state().launcher, 'CommandOrControl+Space');
  assert.equal(harness.registered.has('CommandOrControl+Space'), true);
  assert.deepEqual(harness.unregistered, ['CommandOrControl+Space']);
});

test('Hover + Space registers only while the cursor is inside a visible collapsed panel', () => {
  const harness = createHarness();
  assert.equal(harness.service.setPanelShortcut('Space'), true);
  assert.equal(harness.intervals.size, 1);
  assert.equal(harness.service.state().hoverRegistered, false);

  harness.tick();
  assert.equal(harness.service.state().hoverRegistered, true);
  harness.registered.get('Space')();
  assert.deepEqual(harness.actions, ['hover-panel']);

  harness.setCursor({ x: 20, y: 15 });
  harness.tick();
  assert.equal(harness.service.state().hoverRegistered, false);
  assert.equal(harness.intervals.size, 1);

  harness.setPanel({ visible: true, mode: 'expanded' });
  harness.tick();
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.service.state().hoverRegistered, false);
});
