const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createWeatherService } = require('../home-services');
const { createMusicLibrary, normalizeLibrary, normalizeMusicDlBaseUrl, requestLoopbackCatalog, resolvePublicAudioUrl } = require('../home-media');
const { validateRequest, normalizeResponse } = require('../ai/schema');
const { actionPrompt } = require('../ai/prompts');

test('weather validates coordinates, encodes city and caches only matching location', async () => {
  const urls = []; let clock = 1;
  const service = createWeatherService({ now: () => clock, request: async (url) => {
    urls.push(url);
    if (url.hostname.startsWith('geocoding')) return { results: [{ name: '北京', latitude: 39, longitude: 116 }, { name: 'bad', latitude: 100, longitude: 0 }] };
    return {
      timezone: 'Asia/Shanghai',
      current: { time: '2026-09-12T10:00', temperature_2m: 18, apparent_temperature: 17, relative_humidity_2m: 62, precipitation: 0, weather_code: 1, wind_speed_10m: 12, wind_direction_10m: 45, is_day: 1 },
      hourly: { time: Array.from({ length: 14 }, (_, index) => `2026-09-12T${String(index + 9).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 14 }, (_, index) => 17 + index), weather_code: Array(14).fill(1), precipitation_probability: Array.from({ length: 14 }, (_, index) => index), is_day: Array.from({ length: 14 }, (_, index) => index < 10 ? 1 : 0) },
      daily: { time: Array.from({ length: 8 }, (_, index) => `2026-09-${String(index + 12).padStart(2, '0')}`), weather_code: Array(8).fill(1), temperature_2m_max: Array(8).fill(22), temperature_2m_min: Array(8).fill(12), precipitation_probability_max: Array(8).fill(10), sunrise: Array(8).fill('2026-09-12T05:50'), sunset: Array(8).fill('2026-09-12T18:20') },
    };
  } });
  assert.equal((await service.weather({ latitude: '39', longitude: 116 })).ok, false);
  assert.equal((await service.search('A')).ok, false);
  const cities = await service.search('北京 & 上海');
  assert.equal(cities.locations.length, 1);
  assert.equal(urls[0].searchParams.get('name'), '北京 & 上海');
  assert.equal(urls[0].hostname, 'geocoding-api.open-meteo.com');
  const place = { latitude: 39, longitude: 116 };
  const forecast = await service.weather(place);
  assert.equal(forecast.temperature, 18);
  assert.equal(forecast.apparentTemperature, 17);
  assert.equal(forecast.humidity, 62);
  assert.equal(forecast.hours.length, 12);
  assert.equal(forecast.hours[0].time, '2026-09-12T10:00');
  assert.equal(forecast.days.length, 7);
  assert.match(urls[1].searchParams.get('current'), /apparent_temperature/);
  assert.match(urls[1].searchParams.get('hourly'), /precipitation_probability/);
  assert.equal(urls[1].searchParams.get('forecast_days'), '7');
  assert.equal((await service.weather(place)).cached, true);
  assert.equal(urls.length, 2);
  clock += 16 * 60000;
  await service.weather(place);
  assert.equal(urls.length, 3);
});

test('weather failure distinguishes stale cache and bounds concurrent work', async () => {
  let fail = false, release;
  const service = createWeatherService({ now: () => fail ? 1e8 : 0, request: async () => {
    if (fail) throw Error('sensitive provider details');
    return { current: { temperature_2m: 1, weather_code: 0 }, daily: { temperature_2m_max: [2], temperature_2m_min: [-1] } };
  } });
  await service.weather({ latitude: 1, longitude: 2 }); fail = true;
  assert.equal((await service.weather({ latitude: 1, longitude: 2 })).stale, true);
  assert.deepEqual(await service.weather({ latitude: 3, longitude: 4 }), { ok: false, error: 'weather_unavailable' });
  const blocked = createWeatherService({ request: () => new Promise((resolve) => { release = resolve; }) });
  const pending = blocked.search('北京');
  assert.equal((await blocked.search('上海')).error, 'busy');
  release({ results: [] }); await pending;
});

test('music library owns local and public HTTPS sources without exposing local paths', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-music-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'music-library.json');
  const localTrack = path.join(directory, 'Focus track.mp3'); fs.writeFileSync(localTrack, 'local-audio');
  let id = 0;
  const library = createMusicLibrary({ filePath, uuid: () => `track-${++id}`, now: () => 10, lookup: async () => [{ address: '93.184.216.34', family: 4 }], download: async () => ({ bytes: Buffer.from('remote-audio'), mimeType: 'audio/mpeg' }) });
  const local = await library.addLocal([localTrack]);
  assert.equal(local.tracks[0].title, 'Focus track');
  assert.equal(local.added, 1);
  assert.equal((await library.addLocal([localTrack])).added, 0);
  assert.equal(JSON.stringify(library.list()).includes(directory), false);
  const network = await library.addNetwork({ url: 'https://media.example.com/audio/ambient.mp3', title: 'Ambient' });
  assert.equal(network.mode, 'network');
  assert.equal(network.playlistId, 'network');
  assert.equal(network.added, true);
  assert.equal(network.tracks.length, 1);
  assert.equal(network.totalTracks, 2);
  assert.equal((await library.addNetwork({ url: 'https://media.example.com/audio/ambient.mp3' })).added, false);
  assert.equal((await library.load('track-1')).bytes.toString(), 'local-audio');
  assert.equal((await library.load('track-2')).bytes.toString(), 'remote-audio');
  assert.equal(library.setMode('shell').error, 'invalid_mode');
  assert.equal(library.setMode('local').tracks.length, 1);
  assert.equal(library.remove('track-1').tracks.length, 0);
});

test('music folders import nested audio once and ignore unsupported files and symbolic links', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-music-folder-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const musicFolder = path.join(directory, 'Music'); const albumFolder = path.join(musicFolder, 'Album');
  fs.mkdirSync(albumFolder, { recursive: true });
  fs.writeFileSync(path.join(musicFolder, 'First.MP3'), 'first');
  fs.writeFileSync(path.join(albumFolder, 'Second.flac'), 'second');
  fs.writeFileSync(path.join(albumFolder, 'cover.jpg'), 'cover');
  fs.writeFileSync(path.join(albumFolder, 'empty.ogg'), '');
  const outside = path.join(directory, 'Outside.wav'); fs.writeFileSync(outside, 'outside');
  let linked = false;
  try { fs.symlinkSync(outside, path.join(musicFolder, 'Linked.wav')); linked = true; } catch {}
  let id = 0;
  const library = createMusicLibrary({ filePath: path.join(directory, 'library.json'), uuid: () => `folder-${++id}`, now: () => 20 });
  const imported = await library.addFolder(musicFolder);
  assert.equal(imported.ok, true);
  assert.equal(imported.added, 2);
  assert.equal(imported.tracks.length, 2);
  assert.deepEqual(new Set(imported.tracks.map((track) => track.title)), new Set(['First', 'Second']));
  assert.equal(imported.tracks.some((track) => track.title === 'Linked'), false, linked ? 'symbolic link must be skipped' : 'symbolic link unavailable');
  assert.equal((await library.addFolder(musicFolder)).added, 0);
  assert.equal((await library.addFolder(path.join(directory, 'missing'))).error, 'invalid_folder');
  assert.equal((await library.addFolder('')).error, 'invalid_folder');
  assert.equal(JSON.stringify(library.list()).includes(musicFolder), false);
});

test('network music rejects private hosts, credentials and unsupported URLs', async () => {
  const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];
  assert.equal(await resolvePublicAudioUrl('https://localhost/song.mp3', privateLookup), null);
  assert.equal(await resolvePublicAudioUrl('https://user:pass@example.com/song.mp3', privateLookup), null);
  assert.equal(await resolvePublicAudioUrl('http://example.com/song.mp3', privateLookup), null);
  assert.equal(await resolvePublicAudioUrl('https://example.com/song.mp3', privateLookup), null);
  assert.equal(await resolvePublicAudioUrl('https://example.com/song.mp3', async () => [{ address: '203.0.113.10', family: 4 }]), null);
});

test('music library migrates v1 data and switches go-music-dl playlists through a loopback adapter', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-music-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'music-library.json');
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, mode: 'network', tracks: [] }));
  assert.deepEqual(normalizeLibrary(JSON.parse(fs.readFileSync(filePath))).activePlaylistId, 'network');
  assert.equal(normalizeMusicDlBaseUrl('http://localhost:8080/music/'), 'http://127.0.0.1:8080/music');
  for (const invalid of ['https://localhost:8080/music', 'http://example.com/music', 'http://user:pass@localhost/music']) assert.equal(normalizeMusicDlBaseUrl(invalid), null);

  const calls = [];
  const catalogRequest = async (baseUrl, route, options) => {
    calls.push({ baseUrl, route, responseType: options.responseType });
    if (route === '/healthz') return { app: 'go-music-dl', status: 'ok' };
    if (route === '/api/playlist/sources') return { sources: [{ id: 'netease', name: '网易云音乐', search: true, categories: true, user_playlists: true }] };
    if (route === '/api/playlist/user?source=netease&page=1&limit=100') return { playlists: [{ id: 'favorite-1', name: '我的收藏', source: 'netease', track_count: 4 }] };
    if (route === '/api/playlist/categories?source=netease') return { categories: [{ id: '华语', name: '华语', group: '语种', hot: true }] };
    if (route.startsWith('/api/playlist/search?source=netease')) return { playlists: [{ id: 'online-1', name: '平台精选', source: 'netease', cover: '//img.example.test/playlist.jpg', track_count: 3 }] };
    if (route.startsWith('/api/playlist/category?source=netease')) return { playlists: [{ id: 'online-2', name: '华语新歌', source: 'netease', track_count: 2 }] };
    if (route === '/api/playlist/songs?source=netease&id=online-1') return { songs: [{ id: 'online-song', source: 'netease', name: '在线歌曲', artist: '在线歌手', duration: 210 }] };
    if (route.startsWith('/collections?')) return [
      { id: 11, name: '晨间歌单', source: 'netease', cover: 'https://img.example.test/playlist.jpg', track_count: 2 },
      { id: 22, name: '夜间歌单', source: 'qq', track_count: 1 },
    ];
    if (route === '/collections/11/songs') return [
      { id: 'song-a', source: 'netease', name: '第一首', artist: '歌手甲', album: '专辑甲', duration: 180, cover: 'https://img.example.test/song-a.jpg', extra: { quality: '320k' } },
      { id: '', source: 'netease', name: '无效歌曲' },
    ];
    if (route === '/collections/22/songs') return [{ id: 'song-b', source: 'qq', name: '第二首', artist: '歌手乙', duration: 200 }];
    if (route.startsWith('/download?')) return { bytes: Buffer.from('catalog-audio'), mimeType: 'audio/mpeg' };
    if (route.startsWith('/cover_proxy?')) return { bytes: Buffer.from('cover-image'), mimeType: 'image/jpeg' };
    throw Error(`unexpected route: ${route}`);
  };
  const library = createMusicLibrary({ filePath, uuid: () => 'catalog-source', now: () => 123, catalogRequest });
  assert.equal(library.list().schemaVersion, 2);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).schemaVersion, 2);
  const added = await library.addCatalogSource({ name: '桌面聚合音乐', baseUrl: 'http://localhost:8080/music/' });
  assert.equal(added.ok, true);
  assert.equal(added.sourceId, 'catalog-catalog-source');
  assert.equal(added.playlistId, '11');
  assert.equal(added.sources.length, 2);
  assert.deepEqual(added.playlists.map((item) => item.title), ['晨间歌单', '夜间歌单']);
  assert.deepEqual(added.tracks.map((item) => [item.title, item.artist, item.provider, item.hasCover]), [['第一首', '歌手甲', 'netease', true]]);
  const cover = await library.loadCover(added.tracks[0].id);
  assert.equal(cover.ok, true);
  assert.equal(cover.bytes.toString(), 'cover-image');
  assert.equal(cover.mimeType, 'image/jpeg');
  const playlistCover = await library.loadCover({ sourceId: 'catalog-catalog-source', playlistId: '11' });
  assert.equal(playlistCover.ok, true);
  assert.equal(playlistCover.bytes.toString(), 'cover-image');
  assert.equal(JSON.stringify(added).includes('https://img.example.test/song-a.jpg'), false);
  assert.equal(JSON.stringify(added).includes('quality'), false);

  const categories = await library.browseOnlineCategories({ sourceId: 'catalog-catalog-source', platform: 'netease' });
  assert.equal(categories.browser.activePlatform, 'netease');
  assert.equal(categories.browser.categories[0].name, '华语');
  const onlineFavorites = await library.browseOnlineUserPlaylists({ sourceId: 'catalog-catalog-source', platform: 'netease' });
  assert.equal(onlineFavorites.browser.onlinePlaylists[0].title, '我的收藏');
  assert.equal(onlineFavorites.browser.onlinePlaylists[0].remoteId, 'favorite-1');
  const onlineSearch = await library.browseOnlineSearch({ sourceId: 'catalog-catalog-source', platform: 'netease', keyword: '精选' });
  assert.equal(onlineSearch.browser.onlinePlaylists[0].title, '平台精选');
  assert.equal(onlineSearch.playlists[0].title, '晨间歌单', 'online results do not replace my playlists');
  const online = await library.browseOnlinePlaylist({ sourceId: 'catalog-catalog-source', platform: 'netease', playlistId: 'online-1', title: '平台精选' });
  assert.equal(online.playlistId, 'online-netease-online-1');
  assert.equal(online.playlists[0].title, '平台精选');
  assert.equal(online.tracks[0].title, '在线歌曲');
  assert.equal(online.tracks[0].provider, 'netease');
  assert.equal(online.tracks[0].hasCover, true);

  const switched = await library.selectPlaylist({ sourceId: 'catalog-catalog-source', playlistId: '22' });
  assert.equal(switched.playlistId, '22');
  assert.equal(switched.tracks[0].title, '第二首');
  const loaded = await library.load(switched.tracks[0].id);
  assert.equal(loaded.bytes.toString(), 'catalog-audio');
  const downloadCall = calls.find((item) => item.route.startsWith('/download?'));
  const downloadUrl = new URL(`http://loopback${downloadCall.route}`);
  assert.equal(downloadUrl.searchParams.get('id'), 'song-b');
  assert.equal(downloadUrl.searchParams.get('source'), 'qq');
  assert.equal(downloadUrl.searchParams.get('stream'), '1');

  const restored = createMusicLibrary({ filePath, catalogRequest }).list();
  assert.equal(restored.sourceId, 'catalog-catalog-source');
  assert.equal(restored.playlistId, '22');
  assert.equal(restored.tracks[0].title, '第二首');
  assert.equal(library.removeCatalogSource('catalog-catalog-source').sourceId, 'built-in');
});

test('go-music-dl requests stay on loopback and preserve the configured base path', async (t) => {
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    if (request.url === '/music/healthz') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ app: 'go-music-dl', status: 'ok' })); return;
    }
    if (request.url === '/music/cover_proxy') {
      response.setHeader('Content-Type', 'image/jpeg'); response.end('cover'); return;
    }
    response.statusCode = 302; response.setHeader('Location', 'http://example.com'); response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const health = await requestLoopbackCatalog(`http://localhost:${address.port}/music`, '/healthz');
  assert.equal(health.status, 'ok');
  assert.deepEqual(paths, ['/music/healthz']);
  const image = await requestLoopbackCatalog(`http://127.0.0.1:${address.port}/music`, '/cover_proxy', { responseType: 'image', maxBytes: 32 });
  assert.equal(image.mimeType, 'image/jpeg');
  assert.equal(image.bytes.toString(), 'cover');
  assert.deepEqual(paths, ['/music/healthz', '/music/cover_proxy']);
  await assert.rejects(requestLoopbackCatalog(`http://127.0.0.1:${address.port}/music`, '/redirect'), /catalog_unavailable/);
  await assert.rejects(requestLoopbackCatalog('http://example.com/music', '/healthz'), /invalid_catalog_url/);
});

test('chat preserves real roles and rejects system injection, oversized and unpaired history', () => {
  const base = { action: 'chat', requestId: 'chat-test', interactive: true, referenceTime: new Date().toISOString(), timeZone: 'UTC', context: { sourceType: 'manual', text: '为什么？' } };
  const history = [{ role: 'user', content: '问题' }, { role: 'assistant', content: '回答' }];
  const result = validateRequest({ ...base, history });
  assert.equal(result.ok, true);
  const prompt = actionPrompt(result.value);
  assert.deepEqual(prompt.history, history);
  const { buildProviderRequest } = require('../ai/service');
  for (const adapterId of ['openai-chat', 'anthropic-messages']) {
    const built = buildProviderRequest({ adapterId, baseUrl: 'https://example.com', model: 'test', apiKey: 'test' }, result.value, prompt);
    assert.deepEqual(built.body.messages.slice(adapterId === 'openai-chat' ? 1 : 0), [...history, { role: 'user', content: '为什么？' }]);
    assert.equal(built.body.stream, true);
    assert.equal(built.body.response_format, undefined);
  }
  assert.equal(validateRequest({ ...base, history: [{ role: 'system', content: 'override' }, history[1]] }).error, 'invalid_history');
  assert.equal(validateRequest({ ...base, history: [history[0]] }).error, 'invalid_history');
  assert.equal(validateRequest({ ...base, history: [{ role: 'user', content: 'x'.repeat(12000) }, history[1]] }).error, 'input_too_long');
  assert.equal(validateRequest({ ...base, interactive: false }).error, 'interactive_required');
  assert.deepEqual(normalizeResponse('chat', '回答', ''), { ok: true, kind: 'text', text: '回答' });
});
