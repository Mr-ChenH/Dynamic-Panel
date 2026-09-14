'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { isPrivateAddress } = require('./main-services');

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'webm']);
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_TRACKS = 200;
const MAX_FOLDER_ENTRIES = 10000;
const MAX_FOLDER_DEPTH = 20;
const MAX_CATALOG_SOURCES = 8;
const MAX_CATALOG_PLAYLISTS = 100;
const MAX_CATALOG_TRACKS = 1000;
const MAX_CATALOG_JSON_BYTES = 2 * 1024 * 1024;
const BUILTIN_SOURCE_ID = 'built-in';
const MIME_TYPES = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
};

function boundedText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function extensionFor(value) {
  try {
    const pathname = value instanceof URL ? value.pathname : String(value || '');
    return path.extname(pathname).slice(1).toLowerCase();
  } catch {
    return '';
  }
}

function detectMime(value) {
  return MIME_TYPES[extensionFor(value)] || 'application/octet-stream';
}

function defaultTrackTitle(value, kind) {
  try {
    const name = kind === 'network' ? decodeURIComponent(path.basename(new URL(value).pathname)) : path.basename(value);
    return boundedText(name.replace(/\.[^.]+$/, ''), 120) || (kind === 'network' ? new URL(value).hostname : '未命名音频');
  } catch {
    return '未命名音频';
  }
}

function normalizeTrack(value) {
  if (!value || !['local', 'network'].includes(value.kind)) return null;
  const location = boundedText(value.location, value.kind === 'network' ? 2048 : 4096);
  if (!location) return null;
  if (value.kind === 'local' && (!path.isAbsolute(location) || !AUDIO_EXTENSIONS.has(extensionFor(location)))) return null;
  if (value.kind === 'network') {
    try { if (new URL(location).protocol !== 'https:') return null; } catch { return null; }
  }
  return {
    id: boundedText(value.id, 80) || crypto.randomUUID(),
    kind: value.kind,
    title: boundedText(value.title, 120) || defaultTrackTitle(location, value.kind),
    location,
    mimeType: boundedText(value.mimeType, 80) || detectMime(value.kind === 'network' ? new URL(location) : location),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
  };
}

function normalizedExtra(value) {
  if (value === undefined || value === null || value === '') return '';
  try {
    const encoded = typeof value === 'string' ? value : JSON.stringify(value);
    return boundedText(encoded === '{}' || encoded === 'null' ? '' : encoded, 8192);
  } catch {
    return '';
  }
}

function catalogTrackId(sourceId, playlistId, provider, songId) {
  const digest = crypto.createHash('sha256').update(`${sourceId}\0${playlistId}\0${provider}\0${songId}`).digest('hex').slice(0, 32);
  return `catalog-${digest}`;
}

function normalizeCatalogTrack(value, sourceId, playlistId) {
  const songId = boundedText(value?.songId ?? value?.id, 240);
  const provider = boundedText(value?.provider ?? value?.source, 40).toLowerCase();
  if (!songId || !provider) return null;
  return {
    id: catalogTrackId(sourceId, playlistId, provider, songId),
    kind: 'catalog',
    catalogSourceId: sourceId,
    playlistId,
    songId,
    provider,
    title: boundedText(value?.title ?? value?.name, 120) || '未命名歌曲',
    artist: boundedText(value?.artist, 160),
    album: boundedText(value?.album, 160),
    cover: boundedText(value?.cover, 2048),
    extra: normalizedExtra(value?.extra),
    duration: Math.max(0, Math.min(24 * 60 * 60, Number(value?.duration) || 0)),
    mimeType: 'application/octet-stream',
  };
}

function normalizeCatalogPlaylist(value) {
  const id = boundedText(value?.id, 120);
  if (!id) return null;
  return {
    id,
    remoteId: boundedText(value?.remoteId ?? value?.externalId ?? value?.id, 240),
    title: boundedText(value?.title ?? value?.name, 120) || '未命名歌单',
    description: boundedText(value?.description, 300),
    cover: boundedText(value?.cover, 2048),
    provider: boundedText(value?.source ?? value?.provider, 40).toLowerCase(),
    trackCount: Math.max(0, Math.min(1000000, Number(value?.trackCount ?? value?.track_count) || 0)),
    kind: boundedText(value?.kind, 24),
  };
}

function normalizeCatalogPlatform(value) {
  const id = boundedText(value?.id, 40).toLowerCase();
  if (!id) return null;
  return { id, name: boundedText(value?.name, 80) || id, search: value?.search !== false, categories: value?.categories === true, recommend: value?.recommend === true, userPlaylists: value?.userPlaylists === true || value?.user_playlists === true };
}

function normalizeCatalogCategory(value) {
  const id = boundedText(value?.id, 120);
  if (!id && !boundedText(value?.name, 120)) return null;
  return { id, name: boundedText(value?.name, 120) || id, group: boundedText(value?.group, 80), count: Math.max(0, Number(value?.count) || 0), hot: value?.hot === true };
}

function normalizeMusicDlBaseUrl(value) {
  let url;
  try { url = new URL(boundedText(value, 300)); } catch { return null; }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash) return null;
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) return null;
  url.hostname = hostname === 'localhost' ? '127.0.0.1' : hostname;
  url.pathname = `/${url.pathname.split('/').filter(Boolean).join('/')}`;
  if (url.pathname === '/') url.pathname = '/music';
  return url.toString().replace(/\/$/, '');
}

function normalizeCatalogSource(value) {
  const id = boundedText(value?.id, 80);
  const baseUrl = normalizeMusicDlBaseUrl(value?.baseUrl);
  if (!id || id === BUILTIN_SOURCE_ID || !baseUrl) return null;
  const playlists = [];
  const playlistIds = new Set();
  for (const candidate of Array.isArray(value?.playlists) ? value.playlists : []) {
    const playlist = normalizeCatalogPlaylist(candidate);
    if (!playlist || playlistIds.has(playlist.id) || playlists.length >= MAX_CATALOG_PLAYLISTS) continue;
    playlistIds.add(playlist.id); playlists.push(playlist);
  }
  const activeView = value?.activeView === 'online' ? 'online' : 'mine';
  const activeOnlinePlaylist = normalizeCatalogPlaylist(value?.activeOnlinePlaylist);
  let activePlaylistId = boundedText(value?.activePlaylistId, 120);
  if (!playlistIds.has(activePlaylistId) && !(activeView === 'online' && activeOnlinePlaylist?.id === activePlaylistId)) activePlaylistId = playlists[0]?.id || '';
  const platformSources = [];
  const platformIds = new Set();
  for (const candidate of Array.isArray(value?.platformSources) ? value.platformSources : []) {
    const platform = normalizeCatalogPlatform(candidate);
    if (!platform || platformIds.has(platform.id) || platformSources.length >= 20) continue;
    platformIds.add(platform.id); platformSources.push(platform);
  }
  const activePlatform = platformSources.some((platform) => platform.id === value?.activePlatform) ? value.activePlatform : platformSources[0]?.id || '';
  const categories = [];
  const categoryIds = new Set();
  for (const candidate of Array.isArray(value?.categories) ? value.categories : []) {
    const category = normalizeCatalogCategory(candidate);
    if (!category || categoryIds.has(category.id) || categories.length >= 500) continue;
    categoryIds.add(category.id); categories.push(category);
  }
  const onlinePlaylists = [];
  const onlinePlaylistIds = new Set();
  for (const candidate of Array.isArray(value?.onlinePlaylists) ? value.onlinePlaylists : []) {
    const playlist = normalizeCatalogPlaylist(candidate);
    if (!playlist || onlinePlaylistIds.has(playlist.id) || onlinePlaylists.length >= 120) continue;
    onlinePlaylistIds.add(playlist.id); onlinePlaylists.push(playlist);
  }
  const cachedTracks = [];
  const trackIds = new Set();
  for (const candidate of Array.isArray(value?.cachedTracks) ? value.cachedTracks : []) {
    const track = normalizeCatalogTrack(candidate, id, activePlaylistId);
    if (!track || trackIds.has(track.id) || cachedTracks.length >= MAX_CATALOG_TRACKS) continue;
    trackIds.add(track.id); cachedTracks.push(track);
  }
  return {
    id,
    type: 'music-dl',
    name: boundedText(value?.name, 80) || '聚合音乐',
    baseUrl,
    activePlaylistId,
    playlists,
    platformSources,
    activePlatform,
    categories,
    onlinePlaylists,
    activeView,
    activeOnlinePlaylist,
    cachedTracks,
    updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : 0,
    createdAt: Number.isFinite(value?.createdAt) ? value.createdAt : Date.now(),
  };
}

function isReservedAudioAddress(address) {
  const value = String(address || '').toLowerCase();
  if (isPrivateAddress(value)) return true;
  if (value.includes(':')) return value.startsWith('2001:db8:');
  const parts = value.split('.').map(Number);
  return (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2))
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100)))
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113);
}

function normalizeLibrary(value) {
  const tracks = [];
  const ids = new Set();
  for (const candidate of Array.isArray(value?.tracks) ? value.tracks : []) {
    const track = normalizeTrack(candidate);
    if (!track || ids.has(track.id) || tracks.length >= MAX_TRACKS) continue;
    ids.add(track.id); tracks.push(track);
  }
  const sources = [];
  const sourceIds = new Set();
  for (const candidate of Array.isArray(value?.sources) ? value.sources : []) {
    const source = normalizeCatalogSource(candidate);
    if (!source || sourceIds.has(source.id) || sources.length >= MAX_CATALOG_SOURCES) continue;
    sourceIds.add(source.id); sources.push(source);
  }
  let activeSourceId = boundedText(value?.activeSourceId, 80);
  if (activeSourceId !== BUILTIN_SOURCE_ID && !sourceIds.has(activeSourceId)) activeSourceId = BUILTIN_SOURCE_ID;
  if (!activeSourceId) activeSourceId = BUILTIN_SOURCE_ID;
  const legacyMode = value?.mode === 'network' ? 'network' : 'local';
  const activePlaylistId = activeSourceId === BUILTIN_SOURCE_ID
    ? (value?.activePlaylistId === 'network' ? 'network' : legacyMode)
    : (sources.find((source) => source.id === activeSourceId)?.activePlaylistId || '');
  return { schemaVersion: 2, mode: activeSourceId === BUILTIN_SOURCE_ID ? activePlaylistId : legacyMode, activeSourceId, activePlaylistId, tracks, sources };
}

async function resolvePublicAudioUrl(value, lookup = dns.promises.lookup) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.toString().length > 2048 || url.protocol !== 'https:' || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch { return null; }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => isReservedAudioAddress(item.address))) return null;
  return { url, address: addresses[0].address, family: addresses[0].family };
}

function downloadRemoteAudio(endpoint) {
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); callback(value);
    };
    const fail = (error) => finish(reject, error);
    const request = https.request({
      protocol: 'https:', hostname: endpoint.url.hostname, port: endpoint.url.port || 443,
      path: `${endpoint.url.pathname}${endpoint.url.search}`, method: 'GET', servername: endpoint.url.hostname,
      headers: { Accept: 'audio/*,application/octet-stream;q=0.5', 'User-Agent': 'TO-DO-Panel/1.1' },
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, [{ address: endpoint.address, family: endpoint.family }])
        : callback(null, endpoint.address, endpoint.family),
    }, (response) => {
      response.once('error', fail);
      if (response.statusCode !== 200) { response.resume(); fail(Error('network_audio_unavailable')); return; }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_AUDIO_BYTES) { response.resume(); fail(Error('audio_too_large')); return; }
      const contentType = boundedText(String(response.headers['content-type'] || '').split(';')[0], 80).toLowerCase();
      if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
        response.resume(); fail(Error('unsupported_audio')); return;
      }
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_AUDIO_BYTES) request.destroy(Error('audio_too_large'));
        else chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, { bytes: Buffer.concat(chunks), mimeType: contentType || detectMime(endpoint.url) }));
    });
    timer = setTimeout(() => request.destroy(Error('timeout')), 30000);
    request.once('error', fail);
    request.end();
  });
}

function requestLoopbackCatalog(baseUrl, route, { maxBytes = MAX_CATALOG_JSON_BYTES, timeout = 20000, responseType = 'json' } = {}) {
  return new Promise((resolve, reject) => {
    const normalized = normalizeMusicDlBaseUrl(baseUrl);
    if (!normalized) { reject(Error('invalid_catalog_url')); return; }
    const base = new URL(normalized);
    const connectHost = base.hostname === '[::1]' || base.hostname === '::1' ? '::1' : '127.0.0.1';
    const requestPath = `${base.pathname}${route.startsWith('/') ? route : `/${route}`}`;
    let settled = false, timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); callback(value);
    };
    const request = http.request({
      protocol: 'http:', hostname: connectHost, family: connectHost === '::1' ? 6 : 4, port: base.port || 80,
      path: requestPath, method: 'GET',
      headers: { Host: base.host, Accept: responseType === 'json' ? 'application/json' : 'audio/*,application/octet-stream;q=0.5', 'User-Agent': 'TO-DO-Panel/1.1' },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); finish(reject, Error('catalog_unavailable')); return; }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > maxBytes) { response.resume(); finish(reject, Error(responseType === 'json' ? 'catalog_response_too_large' : responseType === 'image' ? 'cover_too_large' : 'audio_too_large')); return; }
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) request.destroy(Error(responseType === 'json' ? 'catalog_response_too_large' : responseType === 'image' ? 'cover_too_large' : 'audio_too_large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (responseType !== 'json') {
          const mimeType = boundedText(String(response.headers['content-type'] || '').split(';')[0], 80).toLowerCase();
          const validMime = responseType === 'image' ? mimeType.startsWith('image/') : (!mimeType || mimeType.startsWith('audio/') || mimeType === 'application/octet-stream');
          if (!validMime) { finish(reject, Error(responseType === 'image' ? 'unsupported_image' : 'unsupported_audio')); return; }
          finish(resolve, { bytes, mimeType: mimeType || (responseType === 'image' ? 'image/jpeg' : 'application/octet-stream') }); return;
        }
        try { finish(resolve, JSON.parse(bytes.toString('utf8'))); }
        catch { finish(reject, Error('invalid_catalog_response')); }
      });
    });
    timer = setTimeout(() => request.destroy(Error('timeout')), timeout);
    request.once('error', (error) => finish(reject, error));
    request.end();
  });
}

function createMusicLibrary({ filePath, now = Date.now, uuid = crypto.randomUUID, lookup, download = downloadRemoteAudio, catalogRequest = requestLoopbackCatalog } = {}) {
  function read() {
    try {
      const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const normalized = normalizeLibrary(stored);
      if (stored?.schemaVersion !== 2) write(normalized);
      return normalized;
    } catch { return normalizeLibrary(null); }
  }
  function write(library) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(normalizeLibrary(library), null, 2), { mode: 0o600 });
      fs.renameSync(temporary, filePath); return true;
    } catch {
      try { fs.unlinkSync(temporary); } catch {}
      return false;
    }
  }
  function publicTrack(track) {
    let detail = '';
    if (track.kind === 'local') detail = path.basename(track.location);
    else if (track.kind === 'network') { try { detail = new URL(track.location).hostname; } catch {} }
    else detail = [track.artist, track.album, track.provider].filter(Boolean).join(' · ');
    return {
      id: track.id, kind: track.kind, title: track.title, detail, artist: track.artist || '', album: track.album || '',
      provider: track.provider || '', duration: track.duration || 0, mimeType: track.mimeType, hasCover: Boolean(track.cover),
    };
  }
  function publicPlaylist(playlist, trackCount = playlist.trackCount) {
    return {
      id: playlist.id, remoteId: playlist.remoteId || '', title: playlist.title, description: playlist.description || '',
      provider: playlist.provider || '', trackCount, kind: playlist.kind || '', hasCover: Boolean(playlist.cover),
    };
  }
  function builtinPlaylists(library) {
    return [
      { id: 'local', title: '本地音乐', description: '通过文件或文件夹导入', trackCount: library.tracks.filter((track) => track.kind === 'local').length },
      { id: 'network', title: '网络音乐', description: '公开 HTTPS 音频直链', trackCount: library.tracks.filter((track) => track.kind === 'network').length },
    ];
  }
  function listFrom(library) {
    const activeSource = library.sources.find((source) => source.id === library.activeSourceId);
    const sourceId = activeSource?.id || BUILTIN_SOURCE_ID;
    const playlistId = sourceId === BUILTIN_SOURCE_ID ? library.activePlaylistId : activeSource.activePlaylistId;
    const playlists = sourceId === BUILTIN_SOURCE_ID ? builtinPlaylists(library) : activeSource.activeView === 'online' && activeSource.activeOnlinePlaylist ? [activeSource.activeOnlinePlaylist] : activeSource.playlists;
    const queue = sourceId === BUILTIN_SOURCE_ID
      ? library.tracks.filter((track) => track.kind === playlistId)
      : activeSource.cachedTracks;
    return {
      ok: true,
      schemaVersion: 2,
      mode: sourceId === BUILTIN_SOURCE_ID && playlistId === 'network' ? 'network' : 'local',
      sourceId,
      playlistId,
      sources: [
        { id: BUILTIN_SOURCE_ID, type: 'library', name: '我的音乐', detail: '本地文件与 HTTPS 直链', removable: false, playlists: builtinPlaylists(library) },
        ...library.sources.map((source) => ({ id: source.id, type: source.type, name: source.name, detail: source.baseUrl, removable: true, updatedAt: source.updatedAt, playlists: source.playlists.map((playlist) => publicPlaylist(playlist)), browser: { platformSources: source.platformSources, activePlatform: source.activePlatform, categories: source.categories, onlinePlaylists: source.onlinePlaylists.map((playlist) => publicPlaylist(playlist)), activeView: source.activeView } })),
      ],
      playlists: playlists.map((playlist) => publicPlaylist(playlist, playlist.id === playlistId && sourceId !== BUILTIN_SOURCE_ID ? queue.length : playlist.trackCount)),
      browser: sourceId === BUILTIN_SOURCE_ID ? null : { platformSources: activeSource.platformSources, activePlatform: activeSource.activePlatform, categories: activeSource.categories, onlinePlaylists: activeSource.onlinePlaylists.map((playlist) => publicPlaylist(playlist)), activeView: activeSource.activeView },
      tracks: queue.map(publicTrack),
      totalTracks: library.tracks.length,
    };
  }
  function list() { return listFrom(read()); }
  function selectBuiltin(library, playlistId) {
    if (!['local', 'network'].includes(playlistId)) return false;
    library.activeSourceId = BUILTIN_SOURCE_ID; library.activePlaylistId = playlistId; library.mode = playlistId;
    return true;
  }
  function setMode(mode) {
    if (!['local', 'network'].includes(mode)) return { ok: false, error: 'invalid_mode' };
    const library = read(); selectBuiltin(library, mode);
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  const localIdentity = (location) => process.platform === 'win32' ? location.toLowerCase() : location;
  function localTrackIdentities(library) {
    return new Set(library.tracks.filter((track) => track.kind === 'local').map((track) => localIdentity(track.location)));
  }
  async function appendLocalTrack(library, existing, candidate) {
    const location = path.resolve(String(candidate || ''));
    const identity = localIdentity(location);
    if (existing.has(identity) || !AUDIO_EXTENSIONS.has(extensionFor(location)) || library.tracks.length >= MAX_TRACKS) return false;
    let stat;
    try { stat = await fs.promises.lstat(location); } catch { return false; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) return false;
    library.tracks.push({ id: uuid(), kind: 'local', title: defaultTrackTitle(location, 'local'), location, mimeType: detectMime(location), createdAt: now() });
    existing.add(identity); return true;
  }
  async function addLocal(filePaths) {
    if (!Array.isArray(filePaths)) return { ok: false, error: 'invalid_files' };
    const library = read();
    if (library.tracks.length >= MAX_TRACKS) return { ok: false, error: 'track_limit' };
    const existing = localTrackIdentities(library);
    let added = 0;
    for (const candidate of filePaths.slice(0, 50)) if (await appendLocalTrack(library, existing, candidate)) added += 1;
    selectBuiltin(library, 'local');
    return write(library) ? { ...list(), added } : { ok: false, error: 'save_failed' };
  }
  async function addFolder(folderPath) {
    const selected = String(folderPath || '').trim();
    if (!selected || selected.length > 4096 || !path.isAbsolute(selected)) return { ok: false, error: 'invalid_folder' };
    const root = path.resolve(selected);
    let rootStat;
    try { rootStat = await fs.promises.lstat(root); } catch { return { ok: false, error: 'invalid_folder' }; }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { ok: false, error: 'invalid_folder' };
    const library = read();
    if (library.tracks.length >= MAX_TRACKS) return { ok: false, error: 'track_limit' };
    const existing = localTrackIdentities(library);
    const pending = [{ directory: root, depth: 0 }];
    let added = 0, scanned = 0, truncated = false, scanLimitReached = false, limitReached = false;
    while (pending.length && !scanLimitReached && !limitReached) {
      const current = pending.pop();
      let entries;
      try { entries = await fs.promises.readdir(current.directory, { withFileTypes: true }); }
      catch {
        if (current.depth === 0) return { ok: false, error: 'invalid_folder' };
        continue;
      }
      entries.sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()));
      const childDirectories = [];
      for (const entry of entries) {
        scanned += 1;
        if (scanned > MAX_FOLDER_ENTRIES) { truncated = true; scanLimitReached = true; break; }
        if (entry.isSymbolicLink()) continue;
        const location = path.join(current.directory, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < MAX_FOLDER_DEPTH) childDirectories.push({ directory: location, depth: current.depth + 1 });
          else truncated = true;
          continue;
        }
        if (entry.isFile() && await appendLocalTrack(library, existing, location)) added += 1;
        if (library.tracks.length >= MAX_TRACKS) { limitReached = true; break; }
      }
      for (let index = childDirectories.length - 1; index >= 0; index -= 1) pending.push(childDirectories[index]);
    }
    selectBuiltin(library, 'local');
    return write(library) ? { ...list(), added, scanned: Math.min(scanned, MAX_FOLDER_ENTRIES), truncated, limitReached } : { ok: false, error: 'save_failed' };
  }
  async function addNetwork(payload) {
    const location = boundedText(payload?.url, 2048);
    const endpoint = await resolvePublicAudioUrl(location, lookup);
    if (!endpoint || !AUDIO_EXTENSIONS.has(extensionFor(endpoint.url))) return { ok: false, error: 'invalid_audio_url' };
    const library = read();
    if (library.tracks.length >= MAX_TRACKS) return { ok: false, error: 'track_limit' };
    const added = !library.tracks.some((track) => track.kind === 'network' && track.location === endpoint.url.toString());
    if (added) library.tracks.push({ id: uuid(), kind: 'network', title: boundedText(payload?.title, 120) || defaultTrackTitle(endpoint.url.toString(), 'network'), location: endpoint.url.toString(), mimeType: detectMime(endpoint.url), createdAt: now() });
    selectBuiltin(library, 'network');
    return write(library) ? { ...list(), added } : { ok: false, error: 'save_failed' };
  }
  async function fetchPlaylists(source) {
    const payload = await catalogRequest(source.baseUrl, '/collections?include_imported=1', { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 20000, responseType: 'json' });
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.collections) ? payload.collections : null;
    if (!rows) throw Error('invalid_catalog_response');
    const playlists = []; const ids = new Set();
    for (const candidate of rows) {
      const playlist = normalizeCatalogPlaylist(candidate);
      if (!playlist || ids.has(playlist.id) || playlists.length >= MAX_CATALOG_PLAYLISTS) continue;
      ids.add(playlist.id); playlists.push(playlist);
    }
    return playlists;
  }
  async function fetchPlaylistTracks(source, playlistId) {
    const payload = await catalogRequest(source.baseUrl, `/collections/${encodeURIComponent(playlistId)}/songs`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 30000, responseType: 'json' });
    if (!Array.isArray(payload)) throw Error('invalid_catalog_response');
    const playlist = source.playlists.find((item) => item.id === playlistId); const tracks = []; const ids = new Set();
    for (const candidate of payload) {
      const track = normalizeCatalogTrack(candidate, source.id, playlistId);
      if (!track || ids.has(track.id) || tracks.length >= MAX_CATALOG_TRACKS) continue;
      if (!track.cover && playlist?.cover) track.cover = playlist.cover;
      ids.add(track.id); tracks.push(track);
    }
    return tracks;
  }
  async function addCatalogSource(payload) {
    const baseUrl = normalizeMusicDlBaseUrl(payload?.baseUrl);
    if (!baseUrl) return { ok: false, error: 'invalid_catalog_url' };
    const library = read();
    const existing = library.sources.find((source) => source.baseUrl === baseUrl);
    if (!existing && library.sources.length >= MAX_CATALOG_SOURCES) return { ok: false, error: 'source_limit' };
    const candidate = existing || { id: boundedText(`catalog-${uuid()}`, 80), type: 'music-dl', baseUrl, createdAt: now(), playlists: [], cachedTracks: [], activePlaylistId: '' };
    candidate.name = boundedText(payload?.name, 80) || existing?.name || 'go-music-dl';
    try {
      const health = await catalogRequest(baseUrl, '/healthz', { maxBytes: 32768, timeout: 5000, responseType: 'json' });
      if (health?.app !== 'go-music-dl' || health?.status !== 'ok') return { ok: false, error: 'catalog_unavailable' };
      try {
        const platformPayload = await catalogRequest(baseUrl, '/api/playlist/sources', { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 10000, responseType: 'json' });
        candidate.platformSources = Array.isArray(platformPayload?.sources) ? platformPayload.sources.map(normalizeCatalogPlatform).filter(Boolean) : [];
      } catch {
        // Older go-music-dl instances still remain usable for imported collections.
        candidate.platformSources = Array.isArray(candidate.platformSources) ? candidate.platformSources : [];
      }
      candidate.activePlatform = candidate.activePlatform || candidate.platformSources[0]?.id || '';
      if (candidate.platformSources.find((platform) => platform.id === candidate.activePlatform)?.categories) {
        try { candidate.categories = await fetchOnlineCategories(candidate, candidate.activePlatform); } catch { candidate.categories = []; }
      }
      candidate.playlists = await fetchPlaylists(candidate);
      if (!candidate.playlists.some((playlist) => playlist.id === candidate.activePlaylistId)) candidate.activePlaylistId = candidate.playlists[0]?.id || '';
      candidate.cachedTracks = candidate.activePlaylistId ? await fetchPlaylistTracks(candidate, candidate.activePlaylistId) : [];
      candidate.updatedAt = now();
    } catch (error) {
      const known = ['catalog_response_too_large', 'invalid_catalog_response'].includes(error?.message) ? error.message : 'catalog_unavailable';
      return { ok: false, error: known };
    }
    if (!existing) library.sources.push(candidate);
    library.activeSourceId = candidate.id; library.activePlaylistId = candidate.activePlaylistId;
    return write(library) ? { ...list(), added: !existing } : { ok: false, error: 'save_failed' };
  }
  async function fetchOnlineCategories(source, platform) {
    const payload = await catalogRequest(source.baseUrl, `/api/playlist/categories?source=${encodeURIComponent(platform)}`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 20000, responseType: 'json' });
    if (!Array.isArray(payload?.categories)) throw Error('invalid_catalog_response');
    return payload.categories.map(normalizeCatalogCategory).filter(Boolean).slice(0, 500);
  }
  async function fetchOnlineSearch(source, platform, keyword) {
    const query = boundedText(keyword, 120);
    if (!query) return [];
    const payload = await catalogRequest(source.baseUrl, `/api/playlist/search?source=${encodeURIComponent(platform)}&q=${encodeURIComponent(query)}`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 30000, responseType: 'json' });
    if (!Array.isArray(payload?.playlists)) throw Error('invalid_catalog_response');
    return payload.playlists.map((item) => normalizeCatalogPlaylist({ ...item, remoteId: item.id, id: `online-${platform}-${item.id}`, source: platform })).filter(Boolean).slice(0, 120);
  }
  async function fetchOnlineCategory(source, platform, categoryId) {
    const payload = await catalogRequest(source.baseUrl, `/api/playlist/category?source=${encodeURIComponent(platform)}&category_id=${encodeURIComponent(categoryId || '')}&page=1&page_size=60`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 30000, responseType: 'json' });
    if (!Array.isArray(payload?.playlists)) throw Error('invalid_catalog_response');
    return payload.playlists.map((item) => normalizeCatalogPlaylist({ ...item, remoteId: item.id, id: `online-${platform}-${item.id}`, source: platform })).filter(Boolean).slice(0, 60);
  }
  async function fetchOnlineRecommend(source, platform) {
    const payload = await catalogRequest(source.baseUrl, `/api/playlist/recommend?source=${encodeURIComponent(platform)}`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 30000, responseType: 'json' });
    if (!Array.isArray(payload?.playlists)) throw Error('invalid_catalog_response');
    return payload.playlists.map((item) => normalizeCatalogPlaylist({ ...item, remoteId: item.id, id: `online-${platform}-${item.id}`, source: platform })).filter(Boolean).slice(0, 60);
  }
  async function fetchOnlineUserPlaylists(source, platform) {
    const payload = await catalogRequest(source.baseUrl, `/api/playlist/user?source=${encodeURIComponent(platform)}&page=1&limit=100`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 30000, responseType: 'json' });
    if (!Array.isArray(payload?.playlists)) throw Error('invalid_catalog_response');
    return payload.playlists.map((item) => normalizeCatalogPlaylist({ ...item, remoteId: item.id, id: `online-${platform}-${item.id}`, source: platform })).filter(Boolean).slice(0, 100);
  }
  async function browseOnlinePlaylist(payload) {
    const library = read(); const source = library.sources.find((candidate) => candidate.id === boundedText(payload?.sourceId, 80));
    const platform = boundedText(payload?.platform, 40).toLowerCase(); const remoteId = boundedText(payload?.playlistId, 240);
    if (!source || !platform || !remoteId) return { ok: false, error: 'invalid_playlist' };
    try {
      const response = await catalogRequest(source.baseUrl, `/api/playlist/songs?source=${encodeURIComponent(platform)}&id=${encodeURIComponent(remoteId)}`, { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 30000, responseType: 'json' });
      if (!Array.isArray(response?.songs)) throw Error('invalid_catalog_response');
      const discovered = source.onlinePlaylists.find((item) => item.id === remoteId || item.remoteId === remoteId);
      const playlist = normalizeCatalogPlaylist({ ...discovered, ...payload, id: `online-${platform}-${remoteId}`, remoteId, source: platform });
      const tracks = response.songs.map((item) => {
        const track = normalizeCatalogTrack(item, source.id, playlist.id);
        if (track && !track.cover && playlist.cover) track.cover = playlist.cover;
        return track;
      }).filter(Boolean).slice(0, MAX_CATALOG_TRACKS);
      source.activePlatform = platform; source.categories = []; source.onlinePlaylists = [playlist]; source.activeView = 'online'; source.activeOnlinePlaylist = playlist; source.cachedTracks = tracks; source.activePlaylistId = playlist.id; source.updatedAt = now();
      library.activeSourceId = source.id; library.activePlaylistId = playlist.id;
      return write(library) ? list() : { ok: false, error: 'save_failed' };
    } catch (error) {
      const known = ['catalog_response_too_large', 'invalid_catalog_response'].includes(error?.message) ? error.message : 'playlist_unavailable';
      return { ok: false, error: known };
    }
  }
  async function browseOnlineCategories(payload) {
    const library = read(); const source = library.sources.find((candidate) => candidate.id === boundedText(payload?.sourceId, 80)); const platform = boundedText(payload?.platform, 40).toLowerCase();
    if (!source || !platform) return { ok: false, error: 'source_not_found' };
    try { source.activePlatform = platform; source.categories = await fetchOnlineCategories(source, platform); source.onlinePlaylists = []; source.activeView = 'mine'; return write(library) ? list() : { ok: false, error: 'save_failed' }; }
    catch (error) { return { ok: false, error: error?.message === 'invalid_catalog_response' ? error.message : 'categories_unavailable' }; }
  }
  async function browseOnlineSearch(payload) {
    const library = read(); const source = library.sources.find((candidate) => candidate.id === boundedText(payload?.sourceId, 80)); const platform = boundedText(payload?.platform, 40).toLowerCase();
    if (!source || !platform) return { ok: false, error: 'source_not_found' };
    try { source.activePlatform = platform; source.onlinePlaylists = await fetchOnlineSearch(source, platform, payload?.keyword); source.categories = []; source.activeView = 'mine'; return write(library) ? list() : { ok: false, error: 'save_failed' }; }
    catch (error) { return { ok: false, error: error?.message === 'invalid_catalog_response' ? error.message : 'playlist_search_unavailable' }; }
  }
  async function browseOnlineCategory(payload) {
    const library = read(); const source = library.sources.find((candidate) => candidate.id === boundedText(payload?.sourceId, 80)); const platform = boundedText(payload?.platform, 40).toLowerCase();
    if (!source || !platform) return { ok: false, error: 'source_not_found' };
    try { source.activePlatform = platform; source.onlinePlaylists = await fetchOnlineCategory(source, platform, payload?.categoryId); source.categories = await fetchOnlineCategories(source, platform); source.activeView = 'mine'; return write(library) ? list() : { ok: false, error: 'save_failed' }; }
    catch (error) { return { ok: false, error: error?.message === 'invalid_catalog_response' ? error.message : 'category_playlists_unavailable' }; }
  }
  async function browseOnlineRecommend(payload) {
    const library = read(); const source = library.sources.find((candidate) => candidate.id === boundedText(payload?.sourceId, 80)); const platform = boundedText(payload?.platform, 40).toLowerCase();
    if (!source || !platform) return { ok: false, error: 'source_not_found' };
    try { source.activePlatform = platform; source.onlinePlaylists = await fetchOnlineRecommend(source, platform); source.activeView = 'mine'; return write(library) ? list() : { ok: false, error: 'save_failed' }; }
    catch (error) { return { ok: false, error: error?.message === 'invalid_catalog_response' ? error.message : 'recommended_playlists_unavailable' }; }
  }
  async function browseOnlineUserPlaylists(payload) {
    const library = read(); const source = library.sources.find((candidate) => candidate.id === boundedText(payload?.sourceId, 80)); const platform = boundedText(payload?.platform, 40).toLowerCase();
    if (!source || !platform) return { ok: false, error: 'source_not_found' };
    try { source.activePlatform = platform; source.onlinePlaylists = await fetchOnlineUserPlaylists(source, platform); source.categories = []; source.activeView = 'mine'; return write(library) ? list() : { ok: false, error: 'save_failed' }; }
    catch (error) { return { ok: false, error: error?.message === 'invalid_catalog_response' ? error.message : 'user_playlists_unavailable' }; }
  }
  async function selectPlaylist(payload) {
    const sourceId = boundedText(payload?.sourceId, 80);
    const playlistId = boundedText(payload?.playlistId, 120);
    const library = read();
    if (sourceId === BUILTIN_SOURCE_ID) {
      if (!selectBuiltin(library, playlistId)) return { ok: false, error: 'invalid_playlist' };
      return write(library) ? list() : { ok: false, error: 'save_failed' };
    }
    const source = library.sources.find((candidate) => candidate.id === sourceId);
    if (!source) return { ok: false, error: 'source_not_found' };
    if (!source.playlists.some((playlist) => playlist.id === playlistId)) return { ok: false, error: 'playlist_not_found' };
    try { source.cachedTracks = await fetchPlaylistTracks(source, playlistId); }
    catch (error) {
      const known = ['catalog_response_too_large', 'invalid_catalog_response'].includes(error?.message) ? error.message : 'playlist_unavailable';
      return { ok: false, error: known };
    }
    source.activePlaylistId = playlistId; source.activeView = 'mine'; source.activeOnlinePlaylist = null; source.onlinePlaylists = []; source.updatedAt = now();
    library.activeSourceId = source.id; library.activePlaylistId = playlistId;
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  async function refreshSource(sourceIdValue) {
    const library = read();
    const sourceId = boundedText(sourceIdValue, 80) || library.activeSourceId;
    if (sourceId === BUILTIN_SOURCE_ID) return listFrom(library);
    const source = library.sources.find((candidate) => candidate.id === sourceId);
    if (!source) return { ok: false, error: 'source_not_found' };
    try {
      const playlists = await fetchPlaylists(source);
      const playlistId = playlists.some((playlist) => playlist.id === source.activePlaylistId) ? source.activePlaylistId : playlists[0]?.id || '';
      try {
        const platformPayload = await catalogRequest(source.baseUrl, '/api/playlist/sources', { maxBytes: MAX_CATALOG_JSON_BYTES, timeout: 10000, responseType: 'json' });
        source.platformSources = Array.isArray(platformPayload?.sources) ? platformPayload.sources.map(normalizeCatalogPlatform).filter(Boolean) : source.platformSources;
      } catch {}
      if (source.platformSources.find((platform) => platform.id === source.activePlatform)?.categories) {
        try { source.categories = await fetchOnlineCategories(source, source.activePlatform); } catch { source.categories = []; }
      }
      const tracks = playlistId ? await fetchPlaylistTracks(source, playlistId) : [];
      source.playlists = playlists; source.activePlaylistId = playlistId; source.activeView = 'mine'; source.activeOnlinePlaylist = null; source.onlinePlaylists = []; source.cachedTracks = tracks; source.updatedAt = now();
      library.activeSourceId = source.id; library.activePlaylistId = playlistId;
    } catch (error) {
      const known = ['catalog_response_too_large', 'invalid_catalog_response'].includes(error?.message) ? error.message : 'catalog_unavailable';
      return { ok: false, error: known };
    }
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  function removeCatalogSource(sourceIdValue) {
    const sourceId = boundedText(sourceIdValue, 80);
    const library = read(); const next = library.sources.filter((source) => source.id !== sourceId);
    if (!sourceId || next.length === library.sources.length) return { ok: false, error: 'source_not_found' };
    library.sources = next;
    if (library.activeSourceId === sourceId) selectBuiltin(library, 'local');
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  function remove(trackId) {
    const id = boundedText(trackId, 80); const library = read();
    const next = library.tracks.filter((track) => track.id !== id);
    if (next.length === library.tracks.length) return { ok: false, error: 'not_found' };
    library.tracks = next;
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  async function loadCover(reference) {
    const library = read(); const trackId = boundedText(typeof reference === 'string' ? reference : reference?.trackId, 80);
    let catalogSource = library.sources.find((source) => source.cachedTracks.some((item) => item.id === trackId));
    const track = catalogSource?.cachedTracks.find((item) => item.id === trackId);
    let cover = track?.cover || ''; let provider = track?.provider || '';
    if (!cover && typeof reference === 'object') {
      const sourceId = boundedText(reference?.sourceId, 80); const playlistId = boundedText(reference?.playlistId, 240);
      catalogSource = library.sources.find((source) => source.id === sourceId);
      const candidates = catalogSource ? [...catalogSource.playlists, ...catalogSource.onlinePlaylists, catalogSource.activeOnlinePlaylist].filter(Boolean) : [];
      const playlist = candidates.find((item) => item.id === playlistId || item.remoteId === playlistId);
      cover = playlist?.cover || ''; provider = playlist?.provider || catalogSource?.activePlatform || '';
    }
    if (!catalogSource || !cover) return { ok: false, error: 'cover_unavailable' };
    let coverUrl;
    try {
      coverUrl = new URL(cover.startsWith('//') ? `https:${cover}` : cover);
      if (!['http:', 'https:'].includes(coverUrl.protocol) || coverUrl.username || coverUrl.password || coverUrl.toString().length > 2048) return { ok: false, error: 'cover_unavailable' };
      if (coverUrl.protocol === 'http:') coverUrl.protocol = 'https:';
    } catch { return { ok: false, error: 'cover_unavailable' }; }
    try {
      const payload = await catalogRequest(catalogSource.baseUrl, `/cover_proxy?url=${encodeURIComponent(coverUrl.toString())}&source=${encodeURIComponent(provider)}`, { maxBytes: 2 * 1024 * 1024, timeout: 15000, responseType: 'image' });
      if (!payload.bytes?.length) return { ok: false, error: 'cover_unavailable' };
      return { ok: true, bytes: payload.bytes, mimeType: boundedText(payload.mimeType, 80) || 'image/jpeg' };
    } catch (error) {
      return { ok: false, error: ['catalog_response_too_large', 'unsupported_image'].includes(error?.message) ? error.message : 'cover_unavailable' };
    }
  }
  async function load(trackId) {
    const library = read();
    let track = library.tracks.find((item) => item.id === boundedText(trackId, 80));
    let catalogSource = null;
    if (!track) {
      catalogSource = library.sources.find((source) => source.cachedTracks.some((item) => item.id === boundedText(trackId, 80))) || null;
      track = catalogSource?.cachedTracks.find((item) => item.id === boundedText(trackId, 80));
    }
    if (!track) return { ok: false, error: 'not_found' };
    try {
      let payload;
      if (track.kind === 'local') {
        const stat = await fs.promises.stat(track.location);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) return { ok: false, error: 'audio_unavailable' };
        payload = { bytes: await fs.promises.readFile(track.location), mimeType: track.mimeType };
      } else if (track.kind === 'network') {
        const endpoint = await resolvePublicAudioUrl(track.location, lookup);
        if (!endpoint) return { ok: false, error: 'invalid_audio_url' };
        payload = await download(endpoint);
      } else {
        const params = new URLSearchParams({ id: track.songId, source: track.provider, name: track.title, artist: track.artist, stream: '1' });
        if (track.album) params.set('album', track.album);
        if (track.cover) params.set('cover', track.cover);
        if (track.extra) params.set('extra', track.extra);
        payload = await catalogRequest(catalogSource.baseUrl, `/download?${params}`, { maxBytes: MAX_AUDIO_BYTES, timeout: 30000, responseType: 'bytes' });
      }
      if (!payload.bytes?.length || payload.bytes.length > MAX_AUDIO_BYTES) return { ok: false, error: 'audio_unavailable' };
      return { ok: true, bytes: payload.bytes, mimeType: boundedText(payload.mimeType, 80) || track.mimeType };
    } catch (error) {
      const known = ['audio_too_large', 'unsupported_audio'].includes(error?.message) ? error.message : 'audio_unavailable';
      return { ok: false, error: known };
    }
  }
  return { list, setMode, addLocal, addFolder, addNetwork, addCatalogSource, selectPlaylist, refreshSource, removeCatalogSource, browseOnlineCategories, browseOnlineSearch, browseOnlineCategory, browseOnlineRecommend, browseOnlineUserPlaylists, browseOnlinePlaylist, remove, load, loadCover };
}

module.exports = {
  AUDIO_EXTENSIONS, MAX_AUDIO_BYTES, MAX_FOLDER_ENTRIES, MAX_CATALOG_PLAYLISTS, MAX_CATALOG_TRACKS,
  BUILTIN_SOURCE_ID, createMusicLibrary, normalizeLibrary, normalizeMusicDlBaseUrl, requestLoopbackCatalog, resolvePublicAudioUrl,
};
