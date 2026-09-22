const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadShortcutRecorder() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shortcut-recorder-controller.js'), 'utf8');
  const context = { window: {}, setTimeout: (callback) => callback() };
  vm.runInNewContext(source, context, { filename: 'shortcut-recorder-controller.js' });
  return context.window.NotchShortcutRecorder;
}

function createElement() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    addEventListener: (type, listener) => listeners.set(type, listener),
    focus: () => {},
    listener: (type) => listeners.get(type),
  };
}

test('shortcut recorder uses physical key codes through IME and canonicalizes the primary modifier', () => {
  const recorder = loadShortcutRecorder();
  assert.equal(recorder.keyEventToAccelerator({ code: 'KeyK', key: 'Process', ctrlKey: true }, 'win32'), 'CommandOrControl+K');
  assert.equal(recorder.keyEventToAccelerator({ code: 'KeyK', key: 'Unidentified', metaKey: true }, 'darwin'), 'CommandOrControl+K');
  assert.equal(recorder.keyEventToAccelerator({ code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true }, 'win32'), 'CommandOrControl+Shift+1');
  assert.equal(recorder.keyEventToAccelerator({ code: 'ArrowLeft', key: 'ArrowLeft', altKey: true }, 'darwin'), 'Alt+Left');
});

test('shortcut recorder surfaces registration failures outside the recorder value', async () => {
  const shortcutRecorder = loadShortcutRecorder();
  const elements = Object.fromEntries([
    'shortcut-recorder', 'shortcut-recorder-title', 'shortcut-recorder-value',
    'shortcut-recorder-hint', 'shortcut-recorder-disable', 'shortcut-recorder-cancel',
  ].map((id) => [id, createElement()]));
  const toasts = [];
  const controller = shortcutRecorder.createController({
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener: () => {},
    },
    window: { requestAnimationFrame: (callback) => callback() },
    platform: 'win32',
    notchAPI: { setShortcut: async () => ({ ok: false, error: 'occupied' }) },
    showStatusToast: (message) => toasts.push(message),
  });
  controller.open({ action: 'launcher', current: '' });
  await elements['shortcut-recorder'].listener('keydown')({
    code: 'Space', key: ' ', altKey: true, repeat: false,
    preventDefault: () => {}, stopPropagation: () => {},
  });
  assert.equal(elements['shortcut-recorder-value'].textContent, '该快捷键已被占用');
  assert.deepEqual(toasts, ['该快捷键已被占用']);
});

test('shortcut recorder submits only one save while a keydown is in flight', async () => {
  const shortcutRecorder = loadShortcutRecorder();
  const elements = Object.fromEntries([
    'shortcut-recorder', 'shortcut-recorder-title', 'shortcut-recorder-value',
    'shortcut-recorder-hint', 'shortcut-recorder-disable', 'shortcut-recorder-cancel',
  ].map((id) => [id, createElement()]));
  const documentListeners = new Map();
  const document = {
    getElementById: (id) => elements[id] || null,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
  };
  let resolveSave;
  const calls = [];
  const pendingSave = new Promise((resolve) => { resolveSave = resolve; });
  const controller = shortcutRecorder.createController({
    document,
    window: { requestAnimationFrame: (callback) => callback() },
    platform: 'win32',
    notchAPI: {
      setShortcut: (action, accelerator) => {
        calls.push({ action, accelerator });
        return pendingSave;
      },
    },
  });
  controller.open({ action: 'screenshot', current: '' });
  const onKeydown = elements['shortcut-recorder'].listener('keydown');
  const event = {
    code: 'KeyS', key: 's', ctrlKey: true, repeat: false,
    preventDefault: () => {}, stopPropagation: () => {},
  };
  const first = onKeydown(event);
  await onKeydown({ ...event, repeat: true });
  await onKeydown({ ...event, repeat: false });
  assert.deepEqual(calls, [{ action: 'screenshot', accelerator: 'CommandOrControl+S' }]);
  resolveSave({ ok: true });
  await first;
});
