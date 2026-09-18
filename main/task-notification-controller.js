function createTaskNotificationController({
  queue,
  state,
  timers,
  windowFactory,
  getBounds,
  visibleMs,
  leaveMs,
  windowPolicy,
  isQuitting = () => false,
  schedule = setTimeout,
  clear = clearTimeout,
  onWindowChange,
}) {
  let notificationWindow = null;
  let fallbackTimer = null;

  function getWindow() {
    return notificationWindow;
  }

  function clearTimers() {
    timers.clear();
    if (fallbackTimer) clear(fallbackTimer);
    fallbackTimer = null;
  }

  function recoverClosed(targetWindow) {
    if (notificationWindow !== targetWindow) return;
    const interrupted = state.active();
    clearTimers();
    state.recover();
    notificationWindow = null;
    onWindowChange?.(null);
    timers.reset();
    if (!isQuitting() && interrupted) queue.requeueFront(interrupted);
    if (!isQuitting()) schedule(showNext, 80);
  }

  function ensureWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow;
    state.markNotReady();
    notificationWindow = windowFactory.create();
    onWindowChange?.(notificationWindow);
    return notificationWindow;
  }

  function onReady(targetWindow) {
    if (notificationWindow !== targetWindow || targetWindow.isDestroyed()) return;
    state.markReady();
    showNext();
  }

  function showNext() {
    if (state.active() || queue.length() === 0 || isQuitting()) return;
    const targetWindow = ensureWindow();
    if (!state.isReady() || !targetWindow || targetWindow.isDestroyed()) return;
    const next = queue.takeNext();
    if (!state.start(next)) return;
    timers.reset();
    targetWindow.setBounds(getBounds());
    targetWindow.showInactive();
    targetWindow.webContents.send('task-notification:show', {
      ...state.active(),
      pendingCount: queue.pendingCount(),
      visibleMs,
    });
    timers.schedule();
  }

  function beginDismiss() {
    const eventId = state.beginLeaving();
    if (!eventId) return;
    clearTimers();
    if (notificationWindow && !notificationWindow.isDestroyed() && state.isReady()) {
      notificationWindow.webContents.send('task-notification:hide', eventId);
    }
    fallbackTimer = schedule(() => finish(eventId), leaveMs + 120);
  }

  function finish(eventId) {
    if (state.active()?.eventId !== eventId) return;
    clearTimers();
    const completedWindow = notificationWindow;
    if (completedWindow && !completedWindow.isDestroyed()) completedWindow.hide();
    state.finish(eventId);
    timers.reset();
    schedule(() => {
      showNext();
      const policy = windowPolicy({ active: Boolean(state.active()), queueLength: queue.length() });
      if (
        policy === 'dispose'
        && notificationWindow === completedWindow
        && completedWindow
        && !completedWindow.isDestroyed()
      ) completedWindow.destroy();
    }, 80);
  }

  function handleHover(sender, paused) {
    if (!notificationWindow || notificationWindow.isDestroyed() || sender !== notificationWindow.webContents) return false;
    timers.setPaused(paused === true);
    return true;
  }

  function handleDismissed(sender, eventId) {
    if (
      !notificationWindow
      || notificationWindow.isDestroyed()
      || sender !== notificationWindow.webContents
      || typeof eventId !== 'string'
    ) return false;
    finish(eventId);
    return true;
  }

  function sendQueueCount(count) {
    if (!notificationWindow || notificationWindow.isDestroyed() || !state.isReady() || !state.active()) return;
    notificationWindow.webContents.send('task-notification:queue', count ?? queue.pendingCount());
  }

  return {
    getWindow,
    ensureWindow,
    onReady,
    onClosed: recoverClosed,
    showNext,
    beginDismiss,
    finish,
    clearTimers,
    handleHover,
    handleDismissed,
    sendQueueCount,
    setBounds: (bounds) => {
      if (notificationWindow && !notificationWindow.isDestroyed()) notificationWindow.setBounds(bounds);
    },
  };
}

module.exports = { createTaskNotificationController };
