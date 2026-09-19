const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranscriptionSettingsStore } = require('../main/transcription-settings-store');

test('transcription settings store migrates legacy settings and writes atomically', () => {
  const files = new Map([
    ['C:/legacy/notch-todo/transcription-settings.json', JSON.stringify({ schemaVersion: 2, providerId: 'dashscope' })],
  ]);
  const writes = [];
  const fs = {
    readFileSync(file) {
      if (!files.has(file)) throw new Error('missing');
      return files.get(file);
    },
    mkdirSync(directory, options) { writes.push(['mkdir', directory, options]); },
    writeFileSync(file, value, options) {
      files.set(file, value);
      writes.push(['write', file, value, options]);
    },
    renameSync(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
      writes.push(['rename', from, to]);
    },
  };
  const store = createTranscriptionSettingsStore({
    fs,
    path: {
      join: (...parts) => parts.join('/'),
      dirname: (value) => value.slice(0, value.lastIndexOf('/')),
    },
    getUserDataPath: () => 'C:/user',
    getLegacyAppDataPath: () => 'C:/legacy',
    fileName: 'transcription-settings.json',
    selectSettings: (current, legacy) => Object.keys(current).length ? current : legacy,
  });

  assert.deepEqual(store.read(), { schemaVersion: 2, providerId: 'dashscope' });
  assert.equal(files.get('C:/user/transcription-settings.json'), JSON.stringify({ schemaVersion: 2, providerId: 'dashscope' }));
  store.write({ schemaVersion: 3, providerId: 'dashscope', model: 'qwen' });
  assert.equal(files.get('C:/user/transcription-settings.json'), JSON.stringify({ schemaVersion: 3, providerId: 'dashscope', model: 'qwen' }));
  assert.deepEqual(writes.map((entry) => entry[0]), ['mkdir', 'write', 'mkdir', 'write', 'rename']);
});
