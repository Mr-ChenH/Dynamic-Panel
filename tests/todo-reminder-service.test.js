const test = require('node:test');
const assert = require('node:assert/strict');
const { createTodoReminderService } = require('../main/todo-reminder-service');

test('todo reminder service schedules due items and notifies the main window', () => {
  const notifications = [];
  const sent = [];
  const timers = [];
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (...args) => sent.push(args) },
  };
  const service = createTodoReminderService({
    reminderState: (todo) => todo.deadline === 'due' ? { state: 'due' } : { state: 'scheduled', delayMs: 5000 },
    timerDelay: (delay) => delay,
    leadMs: 3600000,
    enqueue: (notification) => notifications.push(notification),
    getMainWindow: () => mainWindow,
    now: () => 1000,
    schedule: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearSchedule: () => {},
  });

  const count = service.setReminders([
    { id: 'due-1', text: '马上截止', deadline: 'due' },
    { id: 'later-1', text: '稍后截止', deadline: 'later' },
  ]);

  assert.equal(count, 2);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].taskId, 'due-1');
  assert.deepEqual(sent, [['todo:reminded', {
    id: 'due-1',
    deadline: 'due',
    remindedAt: 1000,
  }]]);
  assert.equal(timers[0].delay, 5000);
  service.clear();
});

test('todo reminder service replaces reminder input and clears outstanding timers', () => {
  const callbacks = [];
  const cleared = [];
  const service = createTodoReminderService({
    reminderState: () => ({ state: 'scheduled', delayMs: 100 }),
    timerDelay: (delay) => delay,
    leadMs: 1,
    enqueue: () => {},
    getMainWindow: () => null,
    schedule: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    clearSchedule: (timer) => cleared.push(timer),
  });

  assert.equal(service.setReminders([{ id: 'one', text: 'one' }]), 1);
  assert.equal(service.setReminders([{ id: 'two', text: 'two' }]), 1);
  assert.equal(callbacks.length, 2);
  assert.deepEqual(service.reminders(), [{ id: 'two', text: 'two' }]);
  assert.deepEqual(cleared, [1]);
  service.clear();
  assert.deepEqual(cleared, [1, 2]);
});
