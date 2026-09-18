const test = require('node:test');
const assert = require('node:assert/strict');
const { registerTaskNotificationIpc } = require('../main/ipc/task-notification');

test('task notification IPC registers the reminder, notification and window contract', async () => {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, listener) { listeners.set(channel, listener); },
  };
  const calls = [];
  const sender = { id: 'notification-window' };

  registerTaskNotificationIpc({
    ipcMain,
    scheduleReminders: (items) => { calls.push(['schedule', items]); return { ok: true }; },
    notifyPomodoro: (minutes) => { calls.push(['pomodoro', minutes]); return { ok: true }; },
    getHistory: () => ['history'],
    onHover: (target, paused) => calls.push(['hover', target, paused]),
    onDismissed: (target, eventId) => calls.push(['dismissed', target, eventId]),
    activate: (target, eventId) => { calls.push(['activate', target, eventId]); return true; },
  });

  assert.deepEqual([...handlers.keys()], [
    'todos:schedule-reminders',
    'pomodoro:notify',
    'tasks:recent',
    'task-notification:activate',
  ]);
  assert.deepEqual([...listeners.keys()], ['task-notification:hover', 'task-notification:dismissed']);
  assert.deepEqual(await handlers.get('todos:schedule-reminders')({}, ['todo']), { ok: true });
  assert.deepEqual(await handlers.get('pomodoro:notify')({}, 25), { ok: true });
  assert.deepEqual(await handlers.get('tasks:recent')({}), ['history']);
  assert.equal(await handlers.get('task-notification:activate')({ sender }, 'event-1'), true);
  listeners.get('task-notification:hover')({ sender }, true);
  listeners.get('task-notification:dismissed')({ sender }, 'event-1');
  assert.deepEqual(calls, [
    ['schedule', ['todo']],
    ['pomodoro', 25],
    ['activate', sender, 'event-1'],
    ['hover', sender, true],
    ['dismissed', sender, 'event-1'],
  ]);
});
