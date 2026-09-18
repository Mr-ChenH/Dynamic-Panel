const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationWindowState } = require('../main/task-notification-window-state');

test('task notification window state enforces show, leave, finish and recovery transitions', () => {
  const state = createTaskNotificationWindowState();
  const item = { eventId: 'event-1', title: 'Done' };
  assert.equal(state.start(item), true);
  assert.equal(state.start({ eventId: 'event-2' }), false);
  assert.equal(state.beginLeaving(), 'event-1');
  assert.equal(state.beginLeaving(), null);
  assert.equal(state.finish('wrong'), false);
  assert.equal(state.finish('event-1'), true);
  assert.equal(state.active(), null);

  state.markReady();
  state.start(item);
  assert.deepEqual(state.recover(), item);
  assert.equal(state.active(), null);
  assert.equal(state.isLeaving(), false);
  assert.equal(state.isReady(), false);
});
