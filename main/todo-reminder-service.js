function createTodoReminderService({
  reminderState,
  timerDelay,
  leadMs,
  enqueue,
  getMainWindow,
  now = () => Date.now(),
  schedule = setTimeout,
  clearSchedule = clearTimeout,
}) {
  let reminders = [];
  let timer = null;

  function clear() {
    if (timer) clearSchedule(timer);
    timer = null;
  }

  function fire(todo) {
    const deadline = Date.parse(String(todo.deadline || ''));
    const completedAt = now();
    const notification = {
      eventId: `todo-${todo.id}-${deadline}`,
      source: 'todo',
      taskId: String(todo.id || ''),
      title: String(todo.text || '').trim() || '待办即将截止',
      project: '',
      detail: '将在 1 小时内截止',
      deadline,
      completedAt,
    };
    enqueue(notification);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('todo:reminded', {
        id: notification.taskId,
        deadline: String(todo.deadline || ''),
        remindedAt: completedAt,
      });
    }
  }

  function scheduleNext() {
    clear();
    const currentTime = now();
    let nextDelay = Infinity;
    for (const todo of reminders) {
      const status = reminderState(todo, currentTime, leadMs);
      if (status.state === 'due') {
        todo.remindedAt = currentTime;
        fire(todo);
        continue;
      }
      if (status.state === 'scheduled') nextDelay = Math.min(nextDelay, status.delayMs);
    }
    if (Number.isFinite(nextDelay)) {
      timer = schedule(scheduleNext, timerDelay(nextDelay));
    }
  }

  return Object.freeze({
    setReminders(items) {
      reminders = Array.isArray(items) ? items : [];
      scheduleNext();
      return reminders.length;
    },
    clear,
    schedule: scheduleNext,
    reminders: () => reminders,
  });
}

module.exports = { createTodoReminderService };
