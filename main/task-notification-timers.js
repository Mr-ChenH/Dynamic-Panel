function createTaskNotificationTimers({
  visibleMs,
  isActive = () => true,
  isLeaving = () => false,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onDismiss,
}) {
  let timer = null;
  let startedAt = 0;
  let remainingMs = visibleMs;
  let paused = false;

  function clear() {
    if (timer) clearTimeoutFn(timer);
    timer = null;
  }

  function schedule() {
    if (!isActive() || isLeaving() || paused) return;
    clear();
    startedAt = now();
    timer = setTimeoutFn(() => {
      timer = null;
      onDismiss?.();
    }, Math.max(0, remainingMs));
  }

  function reset() {
    clear();
    startedAt = 0;
    remainingMs = visibleMs;
    paused = false;
  }

  function setPaused(nextPaused) {
    if (!isActive() || isLeaving() || paused === nextPaused) return;
    paused = nextPaused;
    if (paused) {
      if (timer) {
        remainingMs = Math.max(0, remainingMs - (now() - startedAt));
        clear();
      }
    } else {
      schedule();
    }
  }

  return {
    clear,
    reset,
    schedule,
    setPaused,
    isPaused: () => paused,
    remaining: () => remainingMs,
  };
}

module.exports = { createTaskNotificationTimers };
