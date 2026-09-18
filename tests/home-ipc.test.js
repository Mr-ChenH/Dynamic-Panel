const test = require('node:test');
const assert = require('node:assert/strict');
const { registerHomeIpc } = require('../main/ipc/home');

function createHarness(dialogResults = []) {
  const handlers = new Map();
  const calls = [];
  const musicLibrary = new Proxy({}, {
    get: (_target, method) => (...args) => {
      calls.push({ method, args });
      return { ok: true, method, args };
    },
  });
  let dialogIndex = 0;
  registerHomeIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    weatherService: {
      search: (query) => ({ query }),
      weather: (location) => ({ location }),
    },
    musicLibrary,
    showOwnedOpenDialog: async (options) => {
      calls.push({ method: 'showOwnedOpenDialog', args: [options] });
      return dialogResults[dialogIndex++] || { canceled: true, filePaths: [] };
    },
  });
  return { handlers, calls };
}

test('home IPC registers the complete weather and music contract', () => {
  const { handlers } = createHarness();
  assert.deepEqual([...handlers.keys()], [
    'home:weather-search', 'home:weather', 'home:music-library', 'home:music-mode',
    'home:music-select-playlist', 'home:music-refresh-source', 'home:music-add-source',
    'home:music-remove-source', 'home:music-browse-categories', 'home:music-search-playlists',
    'home:music-browse-category', 'home:music-browse-recommend', 'home:music-browse-user-playlists',
    'home:music-select-online-playlist', 'home:music-choose-files', 'home:music-choose-folder',
    'home:music-add-network', 'home:music-remove', 'home:music-load', 'home:music-cover',
  ]);
  assert.deepEqual(handlers.get('home:weather-search')({}, '北京'), { query: '北京' });
  assert.deepEqual(handlers.get('home:weather')({}, { latitude: 39 }), { location: { latitude: 39 } });
});

test('home music file and folder pickers preserve cancellation and import behavior', async () => {
  const { handlers, calls } = createHarness([
    { canceled: false, filePaths: ['C:/music/a.mp3', 'C:/music/b.flac'] },
    { canceled: false, filePaths: ['C:/music'] },
  ]);
  assert.deepEqual(await handlers.get('home:music-choose-files')(), {
    ok: true, method: 'addLocal', args: [['C:/music/a.mp3', 'C:/music/b.flac']],
  });
  assert.deepEqual(await handlers.get('home:music-choose-folder')(), {
    ok: true, method: 'addFolder', args: ['C:/music'],
  });
  const picker = calls.find((call) => call.method === 'showOwnedOpenDialog');
  assert.deepEqual(picker.args[0].properties, ['openFile', 'multiSelections']);
  assert.ok(picker.args[0].filters[0].extensions.includes('webm'));

  const canceled = createHarness();
  assert.deepEqual(await canceled.handlers.get('home:music-choose-files')(), { ok: false, error: 'cancelled' });
});
