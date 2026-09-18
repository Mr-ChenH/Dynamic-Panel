function createTaskNotificationQueue({
  dedupeMs,
  maxQueue,
  now = () => Date.now(),
  identity = (notification) => `${notification.source}:${notification.taskId || `${notification.title}:${notification.project}`}`,
  isActive = () => false,
  onHistory,
  onQueueChange,
  onIdle,
}) {
  const queue = [];
  const recent = new Map();
  const history = [];

  function pendingCount() {
    return queue.reduce((total, item) => total + (item.summaryCount || 1), 0);
  }

  function enqueue(notification) {
    if (!notification) return 'ignored';
    const timestamp = now();
    for (const [key, seenAt] of recent) {
      if (timestamp - seenAt > dedupeMs) recent.delete(key);
    }
    const key = identity(notification);
    const lastSeenAt = recent.get(key);
    if (lastSeenAt && timestamp - lastSeenAt <= dedupeMs) return 'duplicate';
    recent.set(key, timestamp);

    if (notification.source !== 'todo') {
      history.unshift(notification);
      if (history.length > 20) history.length = 20;
      onHistory?.(notification);
    }
    if (queue.length < maxQueue) {
      queue.push(notification);
    } else {
      const lastIndex = queue.length - 1;
      const previous = queue[lastIndex];
      const summaryCount = previous.isSummary ? previous.summaryCount + 1 : 2;
      queue[lastIndex] = {
        ...notification,
        source: 'task',
        taskId: '',
        title: `另有 ${summaryCount} 个任务已完成`,
        project: '',
        isSummary: true,
        summaryCount,
      };
    }
    if (isActive()) onQueueChange?.(pendingCount());
    else onIdle?.();
    return 'queued';
  }

  return {
    enqueue,
    pendingCount,
    takeNext: () => queue.shift() || null,
    requeueFront: (notification) => { if (notification) queue.unshift(notification); },
    length: () => queue.length,
    history: () => history,
  };
}

module.exports = { createTaskNotificationQueue };
