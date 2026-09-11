const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveLaunchPath } = require('../launcher/paths');
const { searchLauncherResults, describeLauncherResult } = require('../launcher/domain');
const { createLauncherService } = require('../launcher/service');

test('ordinary file opening rejects executable associations and unknown types', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-type-'));
  try {
    for (const ext of ['cpl', 'pif', 'sct', 'unknown', 'txt']) {
      const file = path.join(root, `fixture.${ext}`); await fs.writeFile(file, 'inert fixture');
      assert.equal(!!await resolveLaunchPath(file), ext === 'txt', ext);
    }
  } finally { await fs.rm(root, { recursive:true, force:true }); }
});

test('long matching titles retain positive scores and exact alias precedence', () => {
  const prefix = { id:'command:long', title:'a'.repeat(7000) };
  const fuzzy = { id:'command:fuzzy', title:'a'+'x'.repeat(7000)+'b' };
  assert.equal(searchLauncherResults([prefix], 'a')[0]?.id, prefix.id);
  assert.equal(searchLauncherResults([fuzzy], 'ab')[0]?.id, fuzzy.id);
  assert.equal(searchLauncherResults([prefix, {id:'alias',title:'Other'}], 'a', {alias:'a'})[0].id, 'alias');
});

test('transient targets do not advertise persistent actions or use legacy aliases', () => {
  for (const row of [{id:'path:1',kind:'path'}, {id:'url:https://a.example/',kind:'url'}, {id:'extension:x:c:r',kind:'extension',persistable:false}]) {
    const result = describeLauncherResult({...row, title:'Example'});
    assert.equal(result.persistable, false);
    assert.ok(!result.actions.some(a => ['favorite','alias'].includes(a.id)));
    assert.equal(searchLauncherResults([result], 'legacy', {[row.id]:'legacy'}).length, 0);
  }
  assert.equal(describeLauncherResult({id:'link:1',title:'Saved link',kind:'url'}).persistable, true);
});

test('host action failures persist in extension diagnostics for process and declarative commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-action-diagnostics-'));
  const service = createLauncherService({dataRoot:root,executable:process.execPath});
  try {
    await service.install(await service.stage(path.join(__dirname, '../examples/launcher/local-tools')));
    const rows = await service.query('大写转换 hello', {apps:false});
    const processRow = rows.find(r => r.title === 'HELLO');
    await assert.rejects(service.perform(service.target(processRow.id), async () => { throw Error('invalid_path'); }), /invalid_path/);
    let restored = await createLauncherService({dataRoot:root}).list();
    assert.equal(restored[0].error, 'invalid_path');
    assert.equal(restored[0].history.at(-1).status, 'invalid_path');
    const declarative = rows.find(r => r.title === '复制问候');
    await assert.rejects(service.perform(service.target(declarative.id), async () => { throw Error('clipboard_failed'); }), /clipboard_failed/);
    restored = await createLauncherService({dataRoot:root}).list();
    assert.equal(restored[0].history.at(-1).operation, 'host-action');
    assert.equal(restored[0].history.at(-1).status, 'clipboard_failed');
    await service.perform(service.target(declarative.id), async () => ({ navigationToken:'test-navigation', navigation:{tab:'notes',id:'missing'} }));
    assert.equal((await service.list())[0].history.at(-1).status, 'pending-navigation');
    await service.completeNavigation('test-navigation', false);
    restored = await createLauncherService({dataRoot:root}).list();
    assert.equal(restored[0].error, 'navigation_failed');
    assert.equal(restored[0].history.at(-1).status, 'navigation_failed');
    await assert.rejects(service.completeNavigation('test-navigation', true), /stale_result/);
  } finally { await service.cancel(); await fs.rm(root,{recursive:true,force:true}); }
});
