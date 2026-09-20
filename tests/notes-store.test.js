const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const domain = require('../renderer/domain.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-store.js'), 'utf8');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); },
  };
}

function createStore(storage, keys) {
  const window = {};
  vm.runInNewContext(source, { window });
  return window.NotchNotesStore.createStore({ storage, domain, keys });
}

test('notes store normalizes archive references against the current taxonomy', () => {
  const storage = createStorage({
    categories: JSON.stringify([
      { id: 'work', name: '工作', tags: [{ id: 'todo', name: '待办' }] },
    ]),
    archive: JSON.stringify([
      { id: 'valid', categoryId: 'work', tagId: 'todo', content: 'ok', createdAt: 1, updatedAt: 2 },
      { id: 'missing-tag', categoryId: 'work', tagId: 'gone', content: 'tag removed', createdAt: 1, updatedAt: 2 },
      { id: 'missing-category', categoryId: 'gone', tagId: 'todo', content: 'category removed', createdAt: 1, updatedAt: 2 },
    ]),
  });
  const store = createStore(storage, { archive: 'archive', categories: 'categories' });

  const rows = JSON.parse(JSON.stringify(store.loadArchive().map(({ id, categoryId, tagId }) => ({ id, categoryId, tagId }))));
  assert.deepEqual(rows, [
    { id: 'valid', categoryId: 'work', tagId: 'todo' },
    { id: 'missing-tag', categoryId: 'work', tagId: '' },
    { id: 'missing-category', categoryId: '', tagId: '' },
  ]);
});

test('notes store isolates persistence keys and normalizes writes', () => {
  const storage = createStorage();
  const store = createStore(storage, { archive: 'custom-archive', categories: 'custom-categories' });

  const categories = store.saveCategories([
    { id: 'a', name: '工作', tags: [{ id: 'x', name: '重要' }, { id: 'y', name: '重要' }] },
    { id: 'b', name: '工作', tags: [] },
  ]);
  const archive = store.saveArchive([
    { id: 'one', title: '  标题  ', categoryId: 'a', tagId: 'x', content: 'body', createdAt: 10, updatedAt: 12 },
  ]);

  assert.equal(categories.length, 1);
  assert.equal(categories[0].tags.length, 1);
  assert.equal(archive[0].title, '标题');
  assert.deepEqual(JSON.parse(storage.value('custom-archive'))[0].id, 'one');
  assert.equal(storage.value('notch-note-archive-v1'), undefined);
  assert.equal(store.categoryName(archive[0], categories), '工作');
  assert.equal(store.tagName(archive[0], categories), '重要');
});

test('notes store treats malformed persistence as empty data', () => {
  const storage = createStorage({ archive: '{bad', categories: 'null' });
  const store = createStore(storage, { archive: 'archive', categories: 'categories' });

  assert.deepEqual(JSON.parse(JSON.stringify(store.loadArchive())), []);
  assert.deepEqual(JSON.parse(JSON.stringify(store.loadCategories())), []);
});
