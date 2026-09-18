const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationTimers } = require('../main/task-notification-timers');

test('task notification timers preserve remaining visibility across hover pause', () => {
  let now = 1000;
  let nextId = 0;
  const callbacks = new Map();
  let dismissed = 0;
  const timers = createTaskNotificationTimers({
    visibleMs: 6000,
    isActive: () => true,
    now: () => now,
    setTimeoutFn: (callback, delay) => { const id = ++nextId; callbacks.set(id, { callback, delay }); return id; },
    clearTimeoutFn: (id) => callbacks.delete(id),
    onDismiss: () => { dismissed += 1; },
  });
  timers.schedule();
  assert.equal(callbacks.get(1).delay, 6000);
  now = 2500;
  timers.setPaused(true);
  assert.equal(timers.remaining(), 4500);
  assert.equal(callbacks.size, 0);
  timers.setPaused(false);
  assert.equal(callbacks.get(2).delay, 4500);
  callbacks.get(2).callback();
  assert.equal(dismissed, 1);
});
