const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveLaunchPath } = require('../launcher/paths');
const schema = require('../launcher/extension-schema');
const { createLauncherService } = require('../launcher/service');

test('local paths accept documents/folders and reject scripts, missing paths and network/device paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-paths-'));
  try {
    const document = path.join(root, 'hello world.txt');
    const script = path.join(root, 'unsafe.cmd');
    await fs.writeFile(document, 'text'); await fs.writeFile(script, '@echo hello');
    assert.equal((await resolveLaunchPath(document)).directory, false);
    assert.equal((await resolveLaunchPath(root)).directory, true);
    for (const value of [script, path.join(root, 'missing.txt'), '../relative', '\\\\server\\share\\file.txt', '\\\\?\\C:\\file.txt', 'C:\\file.txt:stream', document + '\n']) assert.equal(await resolveLaunchPath(value), null, value);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('platform application scanning recognizes nested bundles and shortcuts without duplicates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-app-index-'));
  const apps = path.join(root, 'Applications');
  try {
    await fs.mkdir(path.join(apps, 'Utilities/Example.APP'), { recursive: true });
    await fs.writeFile(path.join(apps, 'Windows Tool.LNK'), 'shortcut fixture');
    await fs.writeFile(path.join(apps, 'ignore.txt'), 'not an app');
    for (const [platform, expected] of [['darwin', 'Example'], ['win32', 'Windows Tool']]) {
      const service = createLauncherService({ dataRoot: root, platform, applicationRoots: [apps] });
      const first = await service.query('', { extensions:false });
      const second = await service.query('', { extensions:false });
      assert.equal(first.length, 1); assert.equal(first[0].title, expected);
      assert.equal(second[0].id, first[0].id);
      assert.equal(service.target(first[0].id).type, 'open-app');
      await service.cancel();
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('extension host actions validate permissions and navigation targets', () => {
  assert.throws(() => schema.action({ type: 'open-path', path: '/tmp/doc.txt' }), /invalid_action/);
  assert.equal(schema.action({ type: 'open-path', path: '/tmp/doc.txt' }, ['readFiles']).type, 'open-path');
  assert.deepEqual(schema.action({ type: 'navigate', tab: 'notes', id: 'note-1' }), { type: 'navigate', tab: 'notes', id: 'note-1' });
  assert.throws(() => schema.action({ type: 'navigate', tab: 'settings' }), /invalid_action/);
});

test('extension diagnostics survive service restart without saving query contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-diagnostics-'));
  const service = createLauncherService({ dataRoot: root, executable: process.execPath });
  try {
    await service.install(await service.stage(path.join(__dirname, '../examples/launcher/local-tools')));
    const rows = await service.query('大写转换 private-search', { apps: false });
    await service.execute(service.target(rows.find(row => row.title === 'PRIVATE-SEARCH').id));
    const restored = createLauncherService({ dataRoot: root, executable: process.execPath });
    const items = await restored.list();
    assert.ok(items[0].lastRunAt > 0);
    assert.deepEqual(items[0].history.map(entry => entry.operation), ['query', 'execute']);
    assert.equal(JSON.stringify(items).includes('private-search'), false);
  } finally { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); }
});

test('extension staging rejects actual symbolic links and oversize packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-staging-'));
  const source = path.join(root, 'source');
  const service = createLauncherService({ dataRoot: root, executable: process.execPath });
  try {
    await fs.cp(path.join(__dirname, '../examples/launcher/local-tools'), source, { recursive: true });
    await fs.mkdir(path.join(root, 'outside'));
    await fs.symlink(path.join(root, 'outside'), path.join(source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.stage(source), /extension_symlink/);
    await fs.rm(path.join(source, 'escape'), { recursive: true });
    await fs.writeFile(path.join(source, 'large.bin'), Buffer.alloc(21 * 1024 * 1024));
    await assert.rejects(service.stage(source), /extension_too_large/);
  } finally { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); }
});
