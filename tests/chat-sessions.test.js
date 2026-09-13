const test = require('node:test');
const assert = require('node:assert/strict');
const Sessions = require('../renderer/chat-sessions');

function record(overrides = {}) {
  return {
    id: 'reply-1',
    groupId: 'turn-1',
    prompt: '规划发布',
    sources: [{ sourceType: 'note', sourceId: 'note-1', sourceTitle: '发布资料', text: '冻结正文' }],
    context: [],
    answer: '先完成测试。',
    state: 'complete',
    detail: '',
    createdAt: 100,
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: 'session-1',
    title: '发布讨论',
    createdAt: 100,
    updatedAt: 200,
    records: [record()],
    history: [{ role: 'user', content: '规划发布' }, { role: 'assistant', content: '先完成测试。' }],
    ...overrides,
  };
}

test('saved chat sessions parse damaged data without exposing invalid records', () => {
  assert.deepEqual(Sessions.parseSessions('{bad json'), []);
  const parsed = Sessions.parseSessions({ schemaVersion: 99, sessions: [
    session(),
    session({ id: 'session-1', title: 'duplicate' }),
    session({ id: 'broken', records: [{ prompt: '', state: 'streaming' }] }),
    null,
  ] });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 'session-1');
  assert.equal(parsed[0].records[0].sources[0].text, '冻结正文');
  assert.equal(parsed.find((item) => item.id === 'broken').records.length, 0);
});

test('saved chat sessions upsert, search, rename and delete deterministically', () => {
  const saved = Sessions.upsertSession([], session());
  assert.equal(saved.ok, true);
  assert.equal(JSON.parse(saved.serialized).schemaVersion, 1);
  assert.equal(Sessions.searchSessions(saved.next, '测试').length, 1);
  assert.equal(Sessions.searchSessions(saved.next, '不存在').length, 0);
  const renamed = Sessions.renameSession(saved.next, 'session-1', '  新标题  ', 300);
  assert.equal(renamed.ok, true);
  assert.equal(renamed.next[0].title, '新标题');
  assert.equal(renamed.next[0].updatedAt, 300);
  assert.equal(Sessions.renameSession(renamed.next, 'session-1', '   ', 400).error, 'invalid_title');
  const removed = Sessions.removeSession(renamed.next, 'session-1');
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.next, []);
  assert.equal(Sessions.removeSession([], 'missing').error, 'missing_session');
});

test('saved chat sessions reject record, session, count and total storage limits without eviction', () => {
  const tooManyRecords = Array.from({ length: Sessions.MAX_RECORDS + 1 }, (_, index) => record({ id: `r-${index}`, groupId: `g-${index}` }));
  assert.equal(Sessions.upsertSession([], session({ records: tooManyRecords })).error, 'record_limit');

  const largeRecords = Array.from({ length: 9 }, (_, index) => record({
    id: `large-${index}`,
    groupId: `large-group-${index}`,
    prompt: `问题 ${index} ${'p'.repeat(11000)}`,
    answer: 'a'.repeat(65536),
    sources: [{ sourceType: 'note', sourceId: `note-${index}`, sourceTitle: '资料', text: 's'.repeat(11000) }],
  }));
  assert.equal(Sessions.upsertSession([], session({ records: largeRecords })).error, 'session_too_large');

  const atCountLimit = Array.from({ length: Sessions.MAX_SESSIONS }, (_, index) => session({ id: `session-${index}`, title: `会话 ${index}`, updatedAt: index + 1 }));
  assert.equal(Sessions.upsertSession(atCountLimit, session({ id: 'new-session' })).error, 'session_limit');
  assert.equal(atCountLimit.length, Sessions.MAX_SESSIONS);

  const nearStorageLimit = Array.from({ length: Sessions.MAX_SESSIONS - 1 }, (_, index) => session({
    id: `bulk-${index}`,
    title: `大对话 ${index}`,
    updatedAt: index + 1,
    records: [record({
      id: `bulk-record-${index}`,
      groupId: `bulk-group-${index}`,
      answer: 'x'.repeat(65536),
      sources: [{ sourceType: 'note', sourceId: `bulk-note-${index}`, sourceTitle: '资料', text: 's'.repeat(5000) }],
    })],
  }));
  assert.equal(Sessions.upsertSession(nearStorageLimit, session({ id: 'storage-overflow', records: [record({ answer: 'y'.repeat(65536) })] })).error, 'storage_limit');
  assert.equal(nearStorageLimit.length, Sessions.MAX_SESSIONS - 1);
});
