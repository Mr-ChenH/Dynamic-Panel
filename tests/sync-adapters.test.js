const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultCategories, normalizeCategories } = require('../renderer/sync/categories');
const { scanPortableValue } = require('../renderer/sync/scanner');
const { serializeEntity, inventoryLocalData } = require('../renderer/sync/adapters');

test('category defaults enable core data and keep sensitive or optional categories off', () => {
  assert.deepEqual(defaultCategories(), { todo: true, notes: true, links: true, preferences: true, clipboard: false, screenshots: false, aiSessions: false, finance: false, commands: false, launcher: false, location: false });
  assert.throws(() => normalizeCategories({ recordings: true }), /invalid_category/);
});

test('forbidden field and recursive absolute path scanner rejects sensitive nested content', () => {
  assert.deepEqual(scanPortableValue({ ok: 'portable' }), []);
  const reasons = scanPortableValue({ nested: { encryptedApiKey: 'cipher', content: 'see C:\\Users\\alice\\secret.txt' } }).map((row) => row.reason);
  assert.ok(reasons.includes('forbidden_field'));
  assert.ok(reasons.includes('absolute_path'));
  assert.ok(scanPortableValue({ text: 'dpk_v1_abc123' }).some((row) => row.reason === 'secret_text'));
});

test('all included and optional entity adapters build fresh allowlisted records', () => {
  const objectContext = { resolveObjectReference: (purpose) => `obj-${purpose}` };
  const fixtures = {
    todo: [{ id: 't1', text: 'x', secret: 'drop' }, { quadrant: 'P0' }], todoCategory: [{ quadrant: 'P0', displayName: 'Study' }],
    note: [{ id: 'n1', title: 'N', content: '![x](note-images/n1/a.png)' }, objectContext], noteTaxon: [{ id: 'c1', name: 'C' }],
    linkGroup: [{ id: 'g1', name: 'G', collapsed: true }], link: [{ id: 'l1', url: 'https://example.com', password: 'drop' }, { groupId: 'g1' }],
    preference: [{ key: 'theme', value: 'dark' }], clipboardEntry: [{ id: 'c1', type: 'image', imagePath: 'clipboard-images/a.png' }, objectContext],
    clipboardFavorite: [{ entryId: 'c1' }], screenshot: [{ id: 's1', kind: 'screenshot', status: 'complete', mimeType: 'image/png', path: 'captures/screenshots/a.png' }, objectContext],
    aiSession: [{ id: 'a1', title: 'A', records: [], history: [] }], financeWatchlist: [{ lists: [], assets: {}, preferences: {} }],
    command: [{ id: 'cmd1', text: 'hello' }], launcherFavorite: [{ resultId: 'app:x' }], launcherAlias: [{ resultId: 'app:x', alias: 'x' }],
    weatherLocation: [{ id: 'loc1', name: 'Here', latitude: 1, longitude: 2 }],
  };
  for (const [type, [value, context]] of Object.entries(fixtures)) {
    const output = serializeEntity(type, value, context);
    assert.equal(output.entityType, type);
    assert.equal(scanPortableValue(output).length, 0, type);
    assert.doesNotMatch(JSON.stringify(output), /drop|collapsed|imagePath|captures\/screenshots/);
  }
});

test('inventory uses only registered sources, applies one clipboard switch, and excludes recordings/media', () => {
  const snapshot = {
    'notch-todo-data': JSON.stringify({ P0: [{ id: 't1', text: 'task', done: false }], P1: [], P2: [], P3: [] }),
    'notch-todo-category-names-v1': JSON.stringify({ P0: 'A', P1: 'B', P2: 'C', P3: 'D' }),
    'notch-clip-history': JSON.stringify([{ id: 'clip1', type: 'text', text: 'hello' }]),
    'notch-clip-favorites': JSON.stringify(['clip1']),
    'notch-recordings': JSON.stringify([{ id: 'r1', transcript: 'never', audioPath: 'recordings/a.wav' }]),
    'unknown-future-key': JSON.stringify({ password: 'never' }),
  };
  const defaults = inventoryLocalData(snapshot, {}, { settings: { theme: 'dark' } });
  assert.equal(defaults.records.some((row) => row.entityType.startsWith('clipboard')), false);
  assert.equal(JSON.stringify(defaults).includes('never'), false);
  const clipboard = inventoryLocalData(snapshot, { clipboard: true }, { settings: { theme: 'dark' } });
  assert.deepEqual(clipboard.records.filter((row) => row.category === 'clipboard').map((row) => row.entityType).sort(), ['clipboardEntry', 'clipboardFavorite']);
  assert.ok(defaults.totalRecords > 0 && defaults.totalBytes > 0);
});
