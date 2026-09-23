'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const domain = require('../renderer/domain');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('clipboard rolling history retains favorites and evicts only non-favorites', async () => {
  const priorWindow = global.window;
  const priorStorage = global.localStorage;
  const favorite = { id: 'favorite', type: 'text', text: 'keep', imagePath: null, timestamp: 1 };
  const recent = { id: 'recent', type: 'text', text: 'recent', imagePath: null, timestamp: 2 };
  global.localStorage = memoryStorage({
    'notch-clip-history': JSON.stringify([recent, favorite]),
    'notch-clip-favorites': JSON.stringify(['favorite']),
  });
  global.window = { NotchDomain: domain, notchAPI: {} };
  const modulePath = path.join(__dirname, '..', 'renderer', 'clipboard-store.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  let nextId = 0;
  const store = global.window.NotchClipboardStore.createController({ Domain: domain, notchAPI: {}, maxEntries: 2, generateId: () => `new-${++nextId}` });
  try {
    const first = await store.addEntry({ type: 'text', text: 'first' });
    assert.deepEqual(store.history().map((row) => row.id), ['new-1', 'recent', 'favorite']);
    assert.deepEqual(first.evicted, []);
    const second = await store.addEntry({ type: 'text', text: 'second' });
    assert.deepEqual(store.history().map((row) => row.id), ['new-2', 'new-1', 'favorite']);
    assert.deepEqual(second.evicted.map((row) => row.id), ['recent']);
    assert.deepEqual(store.favorites(), ['favorite']);
  } finally {
    global.window = priorWindow;
    global.localStorage = priorStorage;
    delete require.cache[require.resolve(modulePath)];
  }
});
