function registerTaskNotificationIpc({
  ipcMain,
  scheduleReminders,
  notifyPomodoro,
  getHistory,
  onHover,
  onDismissed,
  activate,
}) {
  ipcMain.handle('todos:schedule-reminders', (_event, items) => scheduleReminders(items));
  ipcMain.handle('pomodoro:notify', (_event, minutes) => notifyPomodoro(minutes));
  ipcMain.handle('tasks:recent', () => getHistory());
  ipcMain.on('task-notification:hover', (event, paused) => onHover(event.sender, paused));
  ipcMain.on('task-notification:dismissed', (event, eventId) => onDismissed(event.sender, eventId));
  ipcMain.handle('task-notification:activate', (event, eventId) => activate(event.sender, eventId));
}

module.exports = { registerTaskNotificationIpc };
