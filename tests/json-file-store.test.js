const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonFileStore } = require('../main/json-file-store');

test('json file store atomically writes nested settings with restrictive mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-json-'));
  try {
    const store = createJsonFileStore({ fsModule: fs, pathModule: path, processId: 1234 });
    const filePath = path.join(root, 'nested', 'settings.json');
    assert.equal(store.writeJsonFile(filePath, { enabled: true, count: 2 }), true);
    assert.deepEqual(store.readJsonFile(filePath), { enabled: true, count: 2 });
    const mode = fs.statSync(filePath).mode & 0o777;
    assert.ok(process.platform === 'win32' || mode === 0o600);
    assert.equal(fs.existsSync(`${filePath}.1234.tmp`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('json file store returns fallbacks for malformed and non-object settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-json-'));
  try {
    const store = createJsonFileStore({ fsModule: fs, pathModule: path, processId: 5678 });
    const invalidPath = path.join(root, 'invalid.json');
    fs.writeFileSync(invalidPath, '{broken');
    assert.deepEqual(store.readJsonFile(invalidPath, { fallback: true }), { fallback: true });
    fs.writeFileSync(invalidPath, '[]');
    assert.deepEqual(store.readJsonFile(invalidPath, { fallback: true }), { fallback: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('json file store cleans up a temporary file after a write failure', () => {
  const calls = [];
  const fakeFs = {
    mkdirSync: () => {},
    writeFileSync: (filePath) => calls.push(filePath),
    renameSync: () => { throw new Error('rename failed'); },
    unlinkSync: (filePath) => calls.push(`unlink:${filePath}`),
    readFileSync: () => '{}',
  };
  const store = createJsonFileStore({ fsModule: fakeFs, pathModule: path, processId: 9 });
  assert.equal(store.writeJsonFile('/settings.json', { value: 1 }), false);
  assert.deepEqual(calls, ['/settings.json.9.tmp', 'unlink:/settings.json.9.tmp']);
});
