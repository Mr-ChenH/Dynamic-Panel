const test = require('node:test');
const assert = require('node:assert/strict');
const Reader = require('../renderer/chat-reader');

test('long answer eligibility uses length, headings or nonempty lines', () => {
  assert.equal(Reader.analyze('简短回答').eligible, false);
  assert.equal(Reader.analyze('a'.repeat(Reader.MIN_LONG_CHARS)).eligible, true);
  assert.equal(Reader.analyze('# 第一节\n正文\n## 第二节\n正文').eligible, true);
  assert.equal(Reader.analyze(Array.from({ length: Reader.MIN_NONEMPTY_LINES }, (_, index) => `第 ${index + 1} 行`).join('\n')).eligible, true);
});

test('long answer outline ignores fenced code headings and normalizes markdown labels', () => {
  const outline = Reader.headings('# **项目计划**\n\n```md\n# 代码里的伪标题\n```\n\n## [执行](https://example.com)\n### `检查`');
  assert.deepEqual(outline, [
    { level: 1, title: '项目计划' },
    { level: 2, title: '执行' },
    { level: 3, title: '检查' },
  ]);
  assert.equal(Reader.title('普通首行\n后续内容'), '普通首行');
  assert.equal(Reader.title('# **项目计划**\n正文'), '项目计划');

  const trickyFence = Reader.headings('```md\n```not-a-close extra\n# 代码里的伪标题\n```\n# 正文标题');
  assert.deepEqual(trickyFence, [{ level: 1, title: '正文标题' }]);
  const malformedFence = Reader.headings('```md extra\n# 可见标题\n## 可见子标题');
  assert.deepEqual(malformedFence, [{ level: 1, title: '可见标题' }, { level: 2, title: '可见子标题' }]);
});

test('todo extraction prefers an explicit bounded selection and never truncates', () => {
  const oversized = 'x'.repeat(Reader.MAX_TODO_SOURCE_CHARS + 1);
  assert.deepEqual(Reader.todoSource(oversized), {
    ok: false,
    error: 'source_too_long',
    length: Reader.MAX_TODO_SOURCE_CHARS + 1,
    scope: 'full',
  });
  assert.deepEqual(Reader.todoSource(oversized, '  提交测试报告  '), {
    ok: true,
    text: '提交测试报告',
    scope: 'selection',
    length: 6,
  });
  assert.equal(Reader.todoSource('  全文待办  ').text, '全文待办');
  assert.equal(Reader.todoSource('  全文待办  ').scope, 'full');
  assert.equal(Reader.todoSource('正文', oversized).scope, 'selection');
  assert.equal(Reader.todoSource('正文', oversized).error, 'source_too_long');
  assert.equal(Reader.todoSource('  ').error, 'empty_source');
});
