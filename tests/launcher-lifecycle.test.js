const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLauncherService } = require('../launcher/service');
const { queryExtension } = require('../launcher/extension-host');
const example = require('../examples/launcher/local-tools/manifest.json');

test('active extension uninstall waits for exit; registry changes serialize', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-lifecycle-'));
  const service = createLauncherService({ dataRoot: root, executable: process.execPath });
  try {
    const staged = await service.stage(path.join(__dirname, '../examples/launcher/local-tools'));
    await fs.writeFile(path.join(staged.temporary, 'index.js'), "require('readline').createInterface({input:process.stdin}).once('line',line=>{const r=JSON.parse(line);require('fs').writeFileSync(require('path').join(r.context.storagePath,'started'),'1');setInterval(()=>{},1000);});");
    await service.install(staged);
    await Promise.all([service.change(example.id, false), service.change(example.id, true)]);
    assert.equal((await service.list())[0].enabled, true);
    let partial, progress;
    const queried = service.query('大写转换 slow', { apps: false }, (rows, state) => { partial = rows; progress = state; });
    const marker = path.join(root, 'launcher/storage', example.id, 'started');
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      try { await fs.access(marker); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await fs.access(marker);
    assert.equal(progress.pending[0].title,'大写转换');
    assert.ok(partial.some(row => row.title === '复制问候'), 'static results arrive before slow extension completes');
    await service.uninstall(example.id);
    assert.deepEqual(await queried, []);
    assert.deepEqual(await service.list(), []);
    await assert.rejects(fs.access(path.join(root,'launcher/extensions',example.id)));
    await fs.access(marker); // Uninstall intentionally preserves extension data.
    const persisted = JSON.parse(await fs.readFile(path.join(root, 'launcher/registry.json'), 'utf8'));
    assert.deepEqual(persisted, {});
  } finally { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); }
});

test('cancel also invalidates queries queued behind another request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-queued-'));
  const service = createLauncherService({ dataRoot: root, executable: process.execPath });
  try {
    await service.install(await service.stage(path.join(__dirname, '../examples/launcher/local-tools')));
    const first = service.query('大写转换 a', { apps: false });
    const second = service.query('大写转换 b', { apps: false });
    await service.cancel();
    assert.deepEqual(await first, []);
    assert.deepEqual(await second, []);
  } finally { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); }
});

test('cancel invalidates queued execution before it can start', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-execute-cancel-'));
  const service = createLauncherService({ dataRoot: root, executable: process.execPath });
  try {
    await service.install(await service.stage(path.join(__dirname, '../examples/launcher/local-tools')));
    const rows = await service.query('大写转换 hello', { apps: false });
    const target = service.target(rows.find(row => row.title === 'HELLO').id);
    const execution = service.execute(target);
    const rejected = assert.rejects(execution, /cancelled/);
    await service.cancel();
    await rejected;
  } finally { await service.cancel(); await fs.rm(root, { recursive: true, force: true }); }
});

test('POSIX extension ignoring SIGTERM is forcibly reaped', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-sigterm-'));
  try {
    await fs.writeFile(path.join(root, 'index.js'), "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    const started = Date.now();
    await assert.rejects(queryExtension(root, example, 'upper', '', undefined), /extension_timeout/);
    assert.ok(Date.now() - started < 4000);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
