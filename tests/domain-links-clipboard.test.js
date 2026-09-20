const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHttpUrl,
  classifyHomeCapture,
  classifyLink,
  addLinkToGroups,
  renameGroup,
  preferredLinkGroupId,
  normalizeLinkTags,
  parseLinkQuery,
  linkMatchesQuery,
  moveLinkToGroup,
  moveLinkToPosition,
  prependClipboardHistory,
} = require('../renderer/domain');

test('clipboard history preserves repeated copies of identical text', () => {
  const previous = [{ id: 'first', type: 'text', text: '同一段内容', timestamp: 100 }];
  const next = { id: 'second', type: 'text', text: '同一段内容', timestamp: 200 };
  const result = prependClipboardHistory(previous, next, 100);

  assert.deepEqual(result.history.map((entry) => entry.id), ['second', 'first']);
  assert.deepEqual(result.evicted, []);
});

test('clipboard history evicts only entries beyond its capacity', () => {
  const previous = [
    { id: 'first', type: 'text', text: 'A', timestamp: 100 },
    { id: 'older-image', type: 'image', imagePath: '/tmp/old.png', timestamp: 50 },
  ];
  const result = prependClipboardHistory(
    previous,
    { id: 'new', type: 'text', text: 'A', timestamp: 200 },
    2
  );

  assert.deepEqual(result.history.map((entry) => entry.id), ['new', 'first']);
  assert.deepEqual(result.evicted.map((entry) => entry.id), ['older-image']);
});

test('normalizeHttpUrl adds https and removes URL credentials', () => {
  assert.equal(normalizeHttpUrl(' example.com/docs '), 'https://example.com/docs');
  assert.equal(normalizeHttpUrl('https://user:secret@example.com/a'), 'https://example.com/a');
});

test('normalizeHttpUrl rejects non-web and local URLs', () => {
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), null);
  assert.equal(normalizeHttpUrl('file:///tmp/a'), null);
  assert.equal(normalizeHttpUrl('http://localhost:3000'), null);
  assert.equal(normalizeHttpUrl('http://127.0.0.1/private'), null);
});

test('home capture routes explicit public URLs without misclassifying ordinary text', () => {
  assert.deepEqual(classifyHomeCapture('https://example.com/docs?q=1'), {
    kind: 'link', content: 'https://example.com/docs?q=1', url: 'https://example.com/docs?q=1',
  });
  assert.equal(classifyHomeCapture('example.com/guide').kind, 'link');
  assert.equal(classifyHomeCapture('记录 example.com，稍后阅读').kind, 'note');
  assert.equal(classifyHomeCapture('今天需要整理发布计划').kind, 'note');
  assert.equal(classifyHomeCapture('http://localhost:3000').kind, 'note');
  assert.equal(classifyHomeCapture('example.com', 'note').kind, 'note');
  assert.equal(classifyHomeCapture('普通文字', 'link').url, null);
});

test('classifyLink maps familiar services and falls back to 其他', () => {
  assert.equal(classifyLink('https://github.com/openai', 'OpenAI repository'), '开发');
  assert.equal(classifyLink('https://www.feishu.cn/', '飞书'), '工作');
  assert.equal(classifyLink('https://www.bilibili.com/video/1', '视频'), '影音');
  assert.equal(classifyLink('https://example.com/', 'Example Domain'), '其他');
});

test('link queries support tags, domains, state and date operators', () => {
  const query = parseLinkQuery('tag:"AI tools" domain:github.com is:unread in:开发 after:2025-01-01');
  assert.deepEqual(query.filters, { tags: ['ai tools'], domains: ['github.com'], groups: ['开发'], favorite: null, read: false, before: 0, after: Date.parse('2025-01-01') });
  assert.deepEqual(normalizeLinkTags([' AI ', 'ai', '#工具', '']), ['AI', '工具']);
  const link = { url: 'https://github.com/openai/codex', title: 'Codex', tags: ['AI tools', '开发'], favorite: true, read: false, description: 'AI tools', createdAt: Date.parse('2025-02-01') };
  assert.equal(linkMatchesQuery(link, { name: '开发' }, query), true);
  assert.equal(linkMatchesQuery({ ...link, read: true }, { name: '开发' }, query), false);
  assert.equal(linkMatchesQuery(link, { name: '其他' }, 'is:favorite domain:github.com'), true);
  assert.equal(linkMatchesQuery(link, { name: '其他' }, 'tag:missing'), false);
});

test('addLinkToGroups reuses a matching group and creates a missing group', () => {
  const initial = [{ id: 'g1', name: '开发', collapsed: false, links: [] }];
  const first = addLinkToGroups(initial, {
    id: 'l1',
    url: 'https://github.com/',
    title: 'GitHub',
  }, '开发');
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].links.map((link) => link.id), ['l1']);

  const second = addLinkToGroups(first, {
    id: 'l2',
    url: 'https://example.com/',
    title: 'Example',
  }, '其他');
  assert.equal(second.length, 2);
  assert.equal(second[1].name, '其他');
  assert.equal(second[1].links[0].id, 'l2');
});

test('same-site links reuse an existing group before automatic classification', () => {
  const groups = [
    { id: 'product', name: 'Lollipop', links: [{ id: 'home', url: 'https://lollipop.plus/' }] },
    { id: 'work', name: '工作', links: [{ id: 'docs', url: 'https://docs.example.com/' }] },
  ];
  assert.equal(preferredLinkGroupId(groups, 'https://docs.lollipop.plus/guide'), 'product');
  assert.equal(preferredLinkGroupId(groups, 'https://news.example.com/'), 'work');
  assert.equal(preferredLinkGroupId(groups, 'https://openai.com/'), '');
});

test('same-site grouping respects common multi-part and hosted public suffixes', () => {
  const groups = [
    { id: 'uk', name: '英国站', links: [{ id: 'uk-docs', url: 'https://docs.example.co.uk/' }] },
    { id: 'alice', name: 'Alice', links: [{ id: 'alice-home', url: 'https://alice.github.io/' }] },
  ];
  assert.equal(preferredLinkGroupId(groups, 'https://news.example.co.uk/'), 'uk');
  assert.equal(preferredLinkGroupId(groups, 'https://bob.github.io/'), '');
});

test('moving a link changes only its group and keeps an emptied source group available', () => {
  const groups = [
    { id: 'source', name: '来源', collapsed: false, links: [{ id: 'move-me', url: 'https://example.com/' }] },
    { id: 'target', name: '目标', collapsed: true, links: [{ id: 'stay', url: 'https://openai.com/' }] },
  ];
  const moved = moveLinkToGroup(groups, 'move-me', 'target');
  assert.deepEqual(moved.map((group) => [group.id, group.links.map((link) => link.id)]), [
    ['source', []],
    ['target', ['stay', 'move-me']],
  ]);
  assert.equal(groups[0].links.length, 1);
});

test('moveLinkToPosition reorders links inside one group in both directions', () => {
  const groups = [{ id: 'g1', name: '开发', collapsed: false, links: [
    { id: 'a', url: 'https://a.example.com/' },
    { id: 'b', url: 'https://b.example.com/' },
    { id: 'c', url: 'https://c.example.com/' },
  ] }];
  const order = (result) => result[0].links.map((link) => link.id);

  assert.deepEqual(order(moveLinkToPosition(groups, 'a', 'g1', 3)), ['b', 'c', 'a']);
  assert.deepEqual(order(moveLinkToPosition(groups, 'c', 'g1', 0)), ['c', 'a', 'b']);
  assert.deepEqual(order(moveLinkToPosition(groups, 'a', 'g1', 2)), ['b', 'a', 'c']);
  assert.deepEqual(order(moveLinkToPosition(groups, 'b', 'g1', 1)), ['a', 'b', 'c']);
  assert.deepEqual(order(groups), ['a', 'b', 'c']);
});

test('moveLinkToPosition inserts at an exact slot when crossing groups', () => {
  const groups = [
    { id: 'source', name: '来源', collapsed: false, links: [{ id: 'x', url: 'https://x.example.com/' }] },
    { id: 'target', name: '目标', collapsed: false, links: [
      { id: 'p', url: 'https://p.example.com/' },
      { id: 'q', url: 'https://q.example.com/' },
    ] },
  ];
  const layout = (result) => result.map((group) => [group.id, group.links.map((link) => link.id)]);

  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', 1)),
    [['source', []], ['target', ['p', 'x', 'q']]]);
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', null)),
    [['source', []], ['target', ['p', 'q', 'x']]]);
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', 99)),
    [['source', []], ['target', ['p', 'q', 'x']]]);
  assert.deepEqual(layout(moveLinkToPosition(groups, 'nope', 'target', 0)), layout(groups));
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'nope', 0)), layout(groups));
});

test('renameGroup trims names but never creates an empty name', () => {
  const groups = [{ id: 'g1', name: '开发', collapsed: false, links: [] }];
  assert.equal(renameGroup(groups, 'g1', '  资料  ')[0].name, '资料');
  assert.equal(renameGroup(groups, 'g1', '   ')[0].name, '开发');
});
