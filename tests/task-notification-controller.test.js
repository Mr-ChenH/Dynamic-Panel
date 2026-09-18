const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationController } = require('../main/task-notification-controller');

function makeController() {
  const sent = [];
  const callbacks = [];
  let activeWindow = null;
  const window = {
    webContents: { send: (...args) => sent.push(args) },
    isDestroyed: () => false,
    setBounds: () => {},
    showInactive: () => {},
    hide: () => {},
    destroy: () => {},
  };
  const state = {
    current: null, ready: true, leaving: false,
    active() { return this.current; }, isReady() { return this.ready; }, isLeaving() { return this.leaving; },
    markNotReady() { this.ready = false; }, markReady() { this.ready = true; },
    start(item) { this.current = item; return true; },
    beginLeaving() { this.leaving = true; return this.current?.eventId; },
    finish() { this.current = null; this.leaving = false; },
    recover() { const item = this.current; this.current = null; this.leaving = false; this.ready = false; return item; },
  };
  const queue = {
    items: [{ eventId: 'one', title: 'Done' }],
    length() { return this.items.length; }, takeNext() { return this.items.shift(); }, pendingCount() { return this.items.length; },
    requeueFront(item) { this.items.unshift(item); },
  };
  const timers = { reset() {}, schedule() {}, clear() {}, setPaused() {} };
  const controller = createTaskNotificationController({
    queue, state, timers, visibleMs: 100, leaveMs: 10,
    windowFactory: { create: () => { activeWindow = window; return window; } },
    getBounds: () => ({ x: 0, y: 0, width: 400, height: 96 }),
    windowPolicy: () => 'keep',
    schedule: (fn) => { callbacks.push(fn); return callbacks.length; },
    clear: () => {},
  });
  return { controller, state, queue, window, sent, callbacks, get activeWindow() { return activeWindow; } };
}

test('task notification controller displays and dismisses one queued notification', () => {
  const fixture = makeController();
  fixture.controller.showNext();
  fixture.controller.onReady(fixture.activeWindow);
  assert.equal(fixture.state.active().eventId, 'one');
  assert.equal(fixture.sent[0][0], 'task-notification:show');
  fixture.controller.beginDismiss();
  assert.equal(fixture.sent[1][0], 'task-notification:hide');
});
