const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const domain = require('../launcher/domain');
const schema = require('../launcher/extension-schema');
const { createLauncherService } = require('../launcher/service');
const { queryExtension } = require('../launcher/extension-host');
const example = require('../examples/launcher/local-tools/manifest.json');

test('launcher ranks aliases above text, supports subsequences, and never rewrites input', () => {
  const rows = [{ id: 'a', title: 'Visual Studio Code' }, { id: 'b', title: 'Other' }];
  assert.equal(domain.searchLauncherResults(rows, 'vsc')[0].id, 'a');
  assert.equal(domain.searchLauncherResults(rows, 'visual', { b: 'visual' })[0].id, 'b');
  assert.equal(rows.length, 2);
  assert.equal(domain.mergeLauncherResults([rows, rows]).length, 2);
});

test('launcher searches Chinese titles and aliases by full pinyin and initials', () => {
  const rows = [
    { id: 'capture', title: '截图工具', subtitle: '本地画面采集' },
    { id: 'notes', title: '笔记', subtitle: '个人资料' },
    { id: 'english', title: 'Visual Studio Code' },
  ];
  assert.equal(domain.searchLauncherResults(rows, 'jietu')[0].id, 'capture');
  assert.equal(domain.searchLauncherResults(rows, 'jtgj')[0].id, 'capture');
  assert.equal(domain.searchLauncherResults(rows, 'bj')[0].id, 'notes');
  assert.equal(domain.searchLauncherResults(rows, 'bjq', { english: '编辑器' })[0].id, 'english');
});

test('extension schema rejects unsafe entries, duplicate commands and undeclared clipboard access', () => {
  assert.equal(schema.manifest(example).commands.length, 2);
  for (const entry of ['../main.js', '/main.js', 'C:/main.js', 'a\\b.js']) assert.throws(() => schema.manifest({ ...example, runtime: { type: 'node', entry } }));
  assert.throws(() => schema.manifest({ ...example, commands: [example.commands[0], example.commands[0]] }));
  assert.throws(() => schema.manifest({ ...example, permissions: [] }));
  assert.throws(() => schema.action({ type: 'open-url', url: 'javascript:alert(1)' }));
  assert.throws(() => schema.items([{ id: 'x', title: 'x', action: { type: 'shell', text: 'rm' } }], ['shell']));
});

test('local extension installs, queries and executes; disabled or removed results cannot execute', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-test-'));
  const service = createLauncherService({ dataRoot: root, executable: process.execPath });
  try {
    await service.install(await service.stage(path.join(__dirname, '../examples/launcher/local-tools')));
    const items = await service.query('大写转换 hello', { apps: false });
    const dynamic = items.find((r) => r.title === 'HELLO');
    assert.ok(dynamic);
    const action = await service.execute(service.target(dynamic.id));
    assert.deepEqual(action, { type: 'copy-text', text: 'HELLO' });
    await service.change(example.id, false);
    assert.equal((await service.query('', { apps: false })).length, 0);
    assert.equal(service.target(dynamic.id), undefined);
    await service.uninstall(example.id);
    assert.equal((await service.list()).length, 0);
  } finally { service.cancel(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('extension process errors, cancellation and timeout settle without blocking the host', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-host-'));
  const manifest = { ...example, runtime: { type: 'node', entry: 'index.js' } };
  try {
    await fs.writeFile(path.join(root, 'index.js'), "process.stdout.write('bad json\\n'); setInterval(() => {}, 1000);");
    await assert.rejects(queryExtension(root, manifest, 'upper', '', undefined), /invalid_extension_response/);
    await fs.writeFile(path.join(root, 'index.js'), 'setInterval(() => {}, 1000);');
    const abort = new AbortController();
    const request = queryExtension(root, manifest, 'upper', '', abort.signal);
    abort.abort(); await assert.rejects(request, /cancelled/);
    await assert.rejects(queryExtension(root, manifest, 'upper', '', undefined), /extension_timeout/);
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
