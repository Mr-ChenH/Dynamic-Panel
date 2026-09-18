const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationQueue } = require('../main/task-notification-queue');

function notification(id) {
  return { eventId: id, source: 'codex', taskId: id, title: id, project: 'demo' };
}

test('task notification queue deduplicates, summarizes overflow, and preserves history', () => {
  let now = 1000;
  const shown = [];
  const updates = [];
  const queue = createTaskNotificationQueue({
    dedupeMs: 100,
    maxQueue: 2,
    now: () => now,
    isActive: () => true,
    onHistory: (item) => shown.push(item.eventId),
    onQueueChange: (count) => updates.push(count),
  });

  assert.equal(queue.enqueue(notification('a')), 'queued');
  assert.equal(queue.enqueue(notification('a')), 'duplicate');
  now += 101;
  assert.equal(queue.enqueue(notification('b')), 'queued');
  assert.equal(queue.enqueue(notification('c')), 'queued');
  assert.equal(queue.pendingCount(), 3);
  assert.deepEqual(shown, ['a', 'b', 'c']);
  assert.deepEqual(updates, [1, 2, 3]);
  assert.equal(queue.takeNext().eventId, 'a');
  assert.equal(queue.takeNext().isSummary, true);
  assert.equal(queue.takeNext(), null);
  assert.deepEqual(queue.history().map((item) => item.eventId), ['c', 'b', 'a']);
});
