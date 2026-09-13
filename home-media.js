'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { isPrivateAddress } = require('./main-services');

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'webm']);
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_TRACKS = 200;
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
  return { schemaVersion: 1, mode: value?.mode === 'network' ? 'network' : 'local', tracks };
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

function createMusicLibrary({ filePath, now = Date.now, uuid = crypto.randomUUID, lookup, download = downloadRemoteAudio } = {}) {
  function read() {
    try { return normalizeLibrary(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
    catch { return normalizeLibrary(null); }
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
    else { try { detail = new URL(track.location).hostname; } catch {} }
    return { id: track.id, kind: track.kind, title: track.title, detail, mimeType: track.mimeType };
  }
  function list() {
    const library = read();
    return { ok: true, mode: library.mode, tracks: library.tracks.map(publicTrack) };
  }
  function setMode(mode) {
    if (!['local', 'network'].includes(mode)) return { ok: false, error: 'invalid_mode' };
    const library = read(); library.mode = mode;
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  async function addLocal(filePaths) {
    if (!Array.isArray(filePaths)) return { ok: false, error: 'invalid_files' };
    const library = read();
    if (library.tracks.length >= MAX_TRACKS) return { ok: false, error: 'track_limit' };
    const existing = new Set(library.tracks.filter((track) => track.kind === 'local').map((track) => process.platform === 'win32' ? track.location.toLowerCase() : track.location));
    let added = 0;
    for (const candidate of filePaths.slice(0, 50)) {
      const location = path.resolve(String(candidate || ''));
      const identity = process.platform === 'win32' ? location.toLowerCase() : location;
      if (existing.has(identity) || !AUDIO_EXTENSIONS.has(extensionFor(location)) || library.tracks.length >= MAX_TRACKS) continue;
      let stat;
      try { stat = await fs.promises.stat(location); } catch { continue; }
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) continue;
      library.tracks.push({ id: uuid(), kind: 'local', title: defaultTrackTitle(location, 'local'), location, mimeType: detectMime(location), createdAt: now() });
      existing.add(identity); added += 1;
    }
    library.mode = 'local';
    return write(library) ? { ...list(), added } : { ok: false, error: 'save_failed' };
  }
  async function addNetwork(payload) {
    const location = boundedText(payload?.url, 2048);
    const endpoint = await resolvePublicAudioUrl(location, lookup);
    if (!endpoint || !AUDIO_EXTENSIONS.has(extensionFor(endpoint.url))) return { ok: false, error: 'invalid_audio_url' };
    const library = read();
    if (library.tracks.length >= MAX_TRACKS) return { ok: false, error: 'track_limit' };
    const added = !library.tracks.some((track) => track.kind === 'network' && track.location === endpoint.url.toString());
    if (added) library.tracks.push({ id: uuid(), kind: 'network', title: boundedText(payload?.title, 120) || defaultTrackTitle(endpoint.url.toString(), 'network'), location: endpoint.url.toString(), mimeType: detectMime(endpoint.url), createdAt: now() });
    library.mode = 'network';
    return write(library) ? { ...list(), added } : { ok: false, error: 'save_failed' };
  }
  function remove(trackId) {
    const id = boundedText(trackId, 80); const library = read();
    const next = library.tracks.filter((track) => track.id !== id);
    if (next.length === library.tracks.length) return { ok: false, error: 'not_found' };
    library.tracks = next;
    return write(library) ? list() : { ok: false, error: 'save_failed' };
  }
  async function load(trackId) {
    const track = read().tracks.find((item) => item.id === boundedText(trackId, 80));
    if (!track) return { ok: false, error: 'not_found' };
    try {
      let payload;
      if (track.kind === 'local') {
        const stat = await fs.promises.stat(track.location);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) return { ok: false, error: 'audio_unavailable' };
        payload = { bytes: await fs.promises.readFile(track.location), mimeType: track.mimeType };
      } else {
        const endpoint = await resolvePublicAudioUrl(track.location, lookup);
        if (!endpoint) return { ok: false, error: 'invalid_audio_url' };
        payload = await download(endpoint);
      }
      if (!payload.bytes?.length || payload.bytes.length > MAX_AUDIO_BYTES) return { ok: false, error: 'audio_unavailable' };
      return { ok: true, bytes: payload.bytes, mimeType: boundedText(payload.mimeType, 80) || track.mimeType };
    } catch (error) {
      const known = ['audio_too_large', 'unsupported_audio'].includes(error?.message) ? error.message : 'audio_unavailable';
      return { ok: false, error: known };
    }
  }
  return { list, setMode, addLocal, addNetwork, remove, load };
}

module.exports = { AUDIO_EXTENSIONS, MAX_AUDIO_BYTES, createMusicLibrary, normalizeLibrary, resolvePublicAudioUrl };
