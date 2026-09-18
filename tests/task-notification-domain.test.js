const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationDomain } = require('../main/task-notification-domain');
const { taskNotificationIdentity } = require('../main-services');

function createDomain() {
  return createTaskNotificationDomain({
    taskNotificationIdentity,
    now: () => 1700000000000,
    random: () => 0.25,
  });
}

test('task notification domain normalizes compatible payload fields and strips formatting', () => {
  const domain = createDomain();
  const result = domain.normalize({
    title: '# 完成 `构建`\nignored',
    project: 'Dynamic Panel',
    thread_id: ' thread-1 ',
    completed_at: '1700000000123',
  }, 'codex');
  assert.deepEqual(result, {
    eventId: 'loyw3v28-9',
    source: 'codex',
    taskId: 'thread-1',
    title: '完成 构建',
    project: 'Dynamic Panel',
    completedAt: 1700000000123,
  });
});

test('task notification domain ignores subagent events', () => {
  const domain = createDomain();
  assert.equal(domain.normalize({ title: 'hidden', agent_id: 'child-1' }, 'claude'), null);
  assert.equal(domain.normalize({ title: 'hidden', hook_event_name: 'SubagentStop' }, 'claude'), null);
});
