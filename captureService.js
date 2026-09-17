const { BrowserWindow, ipcMain, desktopCapturer, session, protocol, screen, powerMonitor, dialog, shell, clipboard, nativeImage, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { CaptureStorage, LIMITS, parseRange, dimensions } = require('./captureStorage');
const { createCaptureSources } = require('./captureSources');
const { captureCursorDisplayBitmap } = require('./captureWindowsScreen');
const { validRegion, normalizeRegion, matchingRegion, videoSize } = require('./renderer/captureDomain');

function registerCaptureScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'capture-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
}
function normalizeSettings(value = {}) {
  return {
    screenshot: ['screen', 'window', 'region'].includes(value.screenshot) ? value.screenshot : 'region',
    video: ['screen', 'window', 'region'].includes(value.video) ? value.video : 'screen',
    quality: ['720', '1080', 'native'].includes(value.quality) ? value.quality : '1080',
    audio: value.audio === 'microphone' ? 'microphone' : 'none',
    countdown: [0, 3, 5].includes(value.countdown) ? value.countdown : 3,
    fixedRegion: normalizeRegion(value.fixedRegion),
  };
}

function createCaptureService({ getMainWindow, getRoot, getSettings, saveSettings, ensureMicrophone, suspendPanel, onChange, sourceProvider, screenshotProvider, clipboardWriter = (image) => clipboard.writeImage(image) }) {
  const captureSources = sourceProvider || createCaptureSources({ getSources: (options) => desktopCapturer.getSources(options) });
  let win = null, task = null, audioOwner = null, state = { phase: 'idle' }, restorePanel = null;
  let sources = new Map(), selected = null, selectionTime = 0, mediaGranted = false;
  let resolveDone = null, done = Promise.resolve(), closing = false, stopTimer = null, maxTimer = null;
  let enumeration = 0;
  let selectionRevision = 0;
  let storageOperation = Promise.resolve();
  let taskSettings = normalizeSettings();
  let regionFrame = null, activeRegion = null, directSnapshot = null, stopNotice = '';
  const audioWatchers = new WeakSet();
  const previews = new Map();
  const store = () => new CaptureStorage(getRoot());
  const busy = () => !!win || !!task || !!audioOwner || closing;
  const emit = (patch) => {
    state = { ...state, ...patch };
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('captures:changed', state);
    onChange();
  };
  const owned = (event, owner) => owner && !owner.isDestroyed() && event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame;
  const mainOnly = (event) => { if (!owned(event, getMainWindow())) throw new Error('forbidden'); };
  const captureOnly = (event) => { if (!owned(event, win) || closing) throw new Error('forbidden'); };
  const handler = (channel, guard, fn) => ipcMain.handle(channel, async (event, payload) => {
    try { guard(event); return { ok: true, value: await fn(payload, event) }; }
    catch (error) {
      const known = /^(?:busy|invalid_[a-z_]+|size_limit|video_limit|library_full|writer_unavailable|not_found|file_missing|unsafe_path|forbidden|screen_denied|source_expired|source_not_capturable|region_changed|region_display_unknown|destination_conflict)$/;
      return { ok: false, error: known.test(error.message) ? error.message : 'capture_failed' };
    }
  });
  async function end(error = '', item = null) {
    if (closing) return done;
    closing = true;
    clearTimeout(stopTimer); clearTimeout(maxTimer); stopTimer = null; maxTimer = null;
    enumeration++;
    try { await storageOperation.catch(() => {}); await task?.abort(); }
    finally {
      task = null;
      const previous = win;
      win = null;
      if (previous && !previous.isDestroyed()) previous.destroy();
      sources.clear(); selected = null; mediaGranted = false;
      regionFrame = null; activeRegion = null; directSnapshot = null;
      restorePanel?.(); restorePanel = null;
      closing = false;
      emit({ phase: 'idle', startedAt: 0, error: error || stopNotice, itemId: item?.id || '' });
      resolveDone?.(); resolveDone = null;
    }
  }
  function stop(reason = '') {
    if (!win || closing) return done;
    if (reason) stopNotice = reason;
    if (['selecting', 'cropping'].includes(state.phase)) { void end(reason); return done; }
    if (state.phase !== 'stopping' && state.phase !== 'saving') {
      emit({ phase: 'stopping' });
      win.webContents.send('capture:stop', reason);
    }
    if (!stopTimer) stopTimer = setTimeout(() => { void end('stop_timeout'); }, 10000);
    return done;
  }
  async function open(mode) {
    if (!['screenshot', 'video'].includes(mode)) throw new Error('invalid_mode');
    if (busy()) throw new Error('busy');
    done = new Promise((resolve) => { resolveDone = resolve; });
    restorePanel = suspendPanel();
    const settings = normalizeSettings(getSettings());
    taskSettings = settings;
    regionFrame = null; activeRegion = null; directSnapshot = null; stopNotice = '';
    storageOperation = Promise.resolve();
    let target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (mode === 'screenshot') {
      if (process.platform === 'darwin' && ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))) {
        await end('screen_denied');
        throw new Error('screen_denied');
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      try {
        let image;
        if (screenshotProvider) image = await screenshotProvider(target);
        else if (process.platform === 'win32') {
          const bitmap = captureCursorDisplayBitmap();
          image = nativeImage.createFromBitmap(bitmap.pixels, { width: bitmap.width, height: bitmap.height });
        } else {
          const pixelWidth = Math.round(target.size.width * target.scaleFactor);
          const pixelHeight = Math.round(target.size.height * target.scaleFactor);
          const rows = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: pixelWidth, height: pixelHeight }, fetchWindowIcons: false });
          const source = rows.find((row) => String(row.display_id) === String(target.id)) || (rows.length === 1 ? rows[0] : null);
          image = source?.thumbnail;
        }
        const size = image?.getSize();
        if (image && !image.isEmpty() && size.width > 1 && size.height > 1) {
          selected = { source: null, identity: {}, type: 'screen', display: target };
          mediaGranted = true;
          directSnapshot = { dataUrl: image.toDataURL(), width: size.width, height: size.height };
        }
      } catch {}
    }
    const direct = !!directSnapshot;
    const captureSession = session.fromPartition('capture-tools');
    win = new BrowserWindow({
      width: direct ? target.bounds.width : Math.min(900, target.workArea.width - 24), height: direct ? target.bounds.height : Math.min(640, target.workArea.height - 24),
      x: direct ? target.bounds.x : target.workArea.x + Math.max(12, Math.round((target.workArea.width - 900) / 2)),
      y: direct ? target.bounds.y : target.workArea.y + Math.max(12, Math.round((target.workArea.height - 640) / 2)),
      title: mode === 'video' ? '录屏 · TO-DO Panel' : '截图 · TO-DO Panel',
      frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false,
      backgroundColor: '#151719', alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'capturePreload.js'), session: captureSession, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const current = win;
    current.setMenu(null);
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    current.webContents.on('will-navigate', (event) => event.preventDefault());
    current.webContents.on('will-attach-webview', (event) => event.preventDefault());
    current.webContents.on('render-process-gone', () => { if (win === current) void end('capture_crashed'); });
    current.on('close', (event) => { if (win === current) { event.preventDefault(); void stop(); } });
    captureSession.setPermissionCheckHandler((contents, permission, _origin, details) => contents === current.webContents
      && (permission === 'display-capture' || (permission === 'media' && mediaGranted && mode === 'video'
        && settings.audio === 'microphone' && details.mediaType === 'audio')));
    captureSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === current.webContents && (permission === 'display-capture'
        || (permission === 'media' && mediaGranted && mode === 'video' && settings.audio === 'microphone'
          && details.mediaTypes?.every((type) => type === 'audio'))));
    });
    captureSession.setDisplayMediaRequestHandler(async (request, callback) => {
      // Electron may destroy the requesting frame while the metadata refresh awaits.
      const respond = (streams) => { try { callback(streams); } catch {} };
      if (win !== current || closing || state.phase !== 'selecting' || request.frame !== current.webContents.mainFrame || !request.userGesture || mediaGranted || Date.now() - selectionTime > 60000 || !selected) { respond({}); return; }
      const entry = selected, generation = enumeration;
      mediaGranted = true;
      emit({ phase: 'preparing' });
      let fresh;
      try { fresh = await captureSources.revalidate(entry); } catch { fresh = null; }
      if (generation !== enumeration || win !== current || current.isDestroyed() || closing || state.phase !== 'preparing') { respond({}); return; }
      if (!fresh) {
        mediaGranted = false; selected = null;
        emit({ phase: 'selecting' });
        current.webContents.send('capture:source-unavailable');
        respond({}); return;
      }
      selected = fresh;
      respond({ video: fresh.source });
    });
    emit({ phase: direct ? 'preparing' : 'selecting', mode, error: '', itemId: '', startedAt: 0 });
    current.once('ready-to-show', () => { if (win === current && state.phase === 'selecting') { current.show(); current.focus(); } });
    try { await current.loadFile(path.join(__dirname, 'renderer', 'captureWindow.html'), { query: { mode } }); }
    catch (error) { await end('capture_failed'); throw error; }
    return true;
  }

  handler('captures:open', mainOnly, open);
  handler('captures:state', mainOnly, () => state);
  handler('captures:stop', mainOnly, () => { void stop(); return true; });
  handler('captures:list', mainOnly, () => store().list());
  handler('captures:settings', mainOnly, () => normalizeSettings(getSettings()));
  handler('captures:save-settings', mainOnly, (value) => {
    const settings = normalizeSettings({ ...value, fixedRegion: getSettings()?.fixedRegion });
    saveSettings(settings); return settings;
  });
  handler('captures:clear-region', mainOnly, () => {
    if (busy()) throw new Error('busy');
    const settings = normalizeSettings({ ...getSettings(), fixedRegion: null });
    saveSettings(settings); return settings;
  });
  handler('captures:audio-begin', mainOnly, (_, event) => {
    if (busy()) throw new Error('busy');
    audioOwner = event.sender;
    if (!audioWatchers.has(event.sender)) {
      audioWatchers.add(event.sender);
      const release = () => { if (audioOwner === event.sender) { audioOwner = null; emit({ audioBusy: false }); } };
      event.sender.on('render-process-gone', release);
      event.sender.once('destroyed', release);
    }
    emit({ audioBusy: true });
    return true;
  });
  handler('captures:audio-end', mainOnly, (_, event) => {
    if (audioOwner === event.sender) audioOwner = null;
    emit({ audioBusy: false });
    return true;
  });
  handler('captures:rename', mainOnly, ({ id, title }) => { store().rename(id, title); emit({}); });
  handler('captures:delete', mainOnly, (id) => {
    if (task?.active?.item.id === id) throw new Error('busy');
    store().remove(id); previews.clear(); emit({});
  });
  handler('captures:reveal', mainOnly, (id) => shell.showItemInFolder(store().resolve(id).file));
  handler('captures:copy', mainOnly, (id) => {
    const { item, file } = store().resolve(id, true);
    if (item.kind !== 'screenshot' || fs.statSync(file).size > LIMITS.image) throw new Error('invalid_image');
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) throw new Error('invalid_image');
    clipboard.writeImage(image);
  });
  handler('captures:export', mainOnly, async (id) => {
    const root = getRoot();
    const { item, file } = store().resolve(id);
    if (task?.active?.item.id === id) throw new Error('busy');
    const extension = item.kind === 'screenshot' ? 'png' : item.status === 'complete' ? 'webm' : 'partial';
    const safeTitle = item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
    const result = await dialog.showSaveDialog(getMainWindow(), { title: '导出采集文件', defaultPath: `${safeTitle}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (result.canceled || !result.filePath) return false;
    if (getRoot() !== root) throw new Error('source_expired');
    // Revalidate after the dialog, including symlink checks.
    const fresh = store().resolve(id);
    if (path.resolve(file) === path.resolve(result.filePath)) return true;
    await fs.promises.copyFile(fresh.file, result.filePath);
    return true;
  });
  handler('captures:preview', mainOnly, (id) => {
    store().resolve(id, true);
    const token = randomUUID();
    if (previews.size >= 64) previews.delete(previews.keys().next().value);
    previews.set(token, { root: getRoot(), id });
    return `capture-media://local/${token}`;
  });
  session.defaultSession.protocol.handle('capture-media', async (request) => {
    try {
      const url = new URL(request.url);
      const entry = previews.get(url.pathname.slice(1));
      if (url.host !== 'local' || !entry || entry.root !== getRoot() || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
      const { item, file } = store().resolve(entry.id, true);
      const size = fs.statSync(file).size;
      const range = parseRange(request.headers.get('range'), size);
      if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const headers = { 'Content-Type': item.kind === 'screenshot' ? 'image/png' : 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': String(range.end - range.start + 1), 'Cache-Control': 'no-store' };
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end })), { status: range.partial ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); }
  });

  handler('capture:init', captureOnly, () => ({ mode: state.mode, settings: taskSettings, limits: LIMITS, platform: process.platform, directSnapshot }));
  handler('capture:sources', captureOnly, async (type) => {
    if (state.phase !== 'selecting' || !['screen', 'window'].includes(type)) throw new Error('invalid_state');
    if (process.platform === 'darwin' && ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))) throw new Error('screen_denied');
    const generation = ++enumeration;
    selected = null; sources.clear();
    const results = await captureSources.list(type);
    if (generation !== enumeration || !win || state.phase !== 'selecting') throw new Error('source_expired');
    const displays = screen.getAllDisplays();
    const rows = results.map((entry) => {
      const { source, identity } = entry;
      const token = randomUUID();
      const display = displays.find((d) => String(d.id) === source.display_id)
        || (type === 'screen' && displays.length === 1 && results.length === 1 ? displays[0] : null);
      sources.set(token, { ...entry, display });
      return { token, name: source.name.slice(0, 160), thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(), width: display ? Math.round(display.size.width * display.scaleFactor) : identity.width || 0, height: display ? Math.round(display.size.height * display.scaleFactor) : identity.height || 0 };
    });
    return rows;
  });
  handler('capture:select', captureOnly, async (token) => {
    if (state.phase !== 'selecting' || !sources.has(token)) throw new Error('source_expired');
    const generation = enumeration, owner = win, revision = ++selectionRevision;
    selected = null;
    const fresh = await captureSources.revalidate(sources.get(token));
    if (revision !== selectionRevision || generation !== enumeration || owner !== win || closing || state.phase !== 'selecting') throw new Error('source_expired');
    if (!fresh) { sources.delete(token); throw new Error('source_not_capturable'); }
    selected = fresh; selectionTime = Date.now(); return true;
  });
  handler('capture:retry-source', captureOnly, () => {
    if (task || !['selecting', 'preparing'].includes(state.phase)) throw new Error('invalid_state');
    mediaGranted = false; selected = null; sources.clear(); enumeration++;
    emit({ phase: 'selecting' }); win.show(); win.focus(); return true;
  });
  handler('capture:microphone', captureOnly, async () => {
    if (!mediaGranted || state.mode !== 'video' || taskSettings.audio !== 'microphone') throw new Error('forbidden');
    return ensureMicrophone();
  });
  handler('capture:hide', captureOnly, () => {
    if (!mediaGranted) throw new Error('invalid_state');
    getMainWindow()?.hide(); win.hide(); return true;
  });
  handler('capture:crop', captureOnly, (payload) => {
    if (!mediaGranted || task || state.phase !== 'preparing' || selected?.type !== 'screen') throw new Error('invalid_state');
    const frame = payload?.frame || payload;
    regionFrame = dimensions(frame?.width, frame?.height);
    const display = screen.getAllDisplays().find((d) => d.id === selected.display?.id);
    if (!display) throw new Error('region_display_unknown');
    selected.display = display;
    const saved = payload?.fresh === true ? null : matchingRegion(taskSettings.fixedRegion, display, regionFrame);
    win.setBounds(display.bounds, false); win.show(); win.focus(); emit({ phase: 'cropping' });
    return { saved, stale: !!taskSettings.fixedRegion && !saved };
  });
  handler('capture:confirm-region', captureOnly, ({ rect, remember }) => {
    if (state.phase !== 'cropping' || !regionFrame || selected?.type !== 'screen') throw new Error('invalid_state');
    if (!validRegion(rect, regionFrame.width, regionFrame.height)) throw new Error('invalid_region');
    const display = screen.getAllDisplays().find((d) => d.id === selected.display?.id);
    const original = selected.display;
    if (!display || display.size.width !== original.size.width || display.size.height !== original.size.height
      || display.scaleFactor !== original.scaleFactor || display.rotation !== original.rotation) throw new Error('region_changed');
    activeRegion = { displayId: String(display.id), displayWidth: display.size.width, displayHeight: display.size.height,
      scaleFactor: display.scaleFactor, rotation: display.rotation, frameWidth: regionFrame.width, frameHeight: regionFrame.height,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (remember === true) saveSettings(normalizeSettings({ ...getSettings(), fixedRegion: activeRegion }));
    emit({ phase: 'preparing' });
    return activeRegion;
  });
  handler('capture:image', captureOnly, async (value) => {
    if (!mediaGranted || state.mode !== 'screenshot' || !['preparing', 'cropping'].includes(state.phase)) throw new Error('invalid_state');
    emit({ phase: 'saving' });
    const target = store();
    storageOperation = target.saveImage(value);
    const item = await storageOperation;
    const { file } = target.resolve(item.id, true);
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) throw new Error('invalid_image');
    try { clipboardWriter(image); } catch {}
    if (!closing) await end('', item);
    return item;
  });
  handler('capture:begin', captureOnly, async (meta) => {
    if (!mediaGranted || state.mode !== 'video' || task || state.phase !== 'preparing') throw new Error('invalid_state');
    if (activeRegion) {
      const expected = videoSize(activeRegion.width, activeRegion.height, taskSettings.quality);
      if (meta.width !== expected.width || meta.height !== expected.height) throw new Error('invalid_dimensions');
    }
    task = store();
    if (meta.audio !== taskSettings.audio) throw new Error('invalid_format');
    storageOperation = task.begin(meta);
    const id = await storageOperation;
    if (closing) return id;
    emit({ phase: 'countdown' });
    maxTimer = setTimeout(() => { void stop('duration_limit'); }, LIMITS.duration + 6000);
    return id;
  });
  handler('capture:recording', captureOnly, () => {
    if (state.phase !== 'countdown') throw new Error('invalid_state');
    emit({ phase: 'recording', startedAt: Date.now() }); return true;
  });
  handler('capture:append', captureOnly, ({ sequence, data }) => {
    if (!task || !['recording', 'stopping'].includes(state.phase)) throw new Error('invalid_state');
    return task.append(sequence, data);
  });
  handler('capture:finish', captureOnly, async (payload) => {
    if (!task || !['recording', 'stopping'].includes(state.phase)) throw new Error('invalid_state');
    const durationMs = typeof payload === 'number' ? payload : payload?.durationMs;
    if (payload?.reason === 'region_changed') stopNotice = 'region_changed';
    emit({ phase: 'saving' });
    storageOperation = task.finish(durationMs);
    const item = await storageOperation;
    if (!closing) await end('', item);
    return item;
  });
  handler('capture:cancel', captureOnly, () => end());
  handler('capture:fail', captureOnly, (code) => end(['permission_denied', 'no_frames', 'queue_limit', 'source_ended', 'unsupported_codec', 'write_failed', 'video_limit', 'region_changed', 'region_display_unknown'].includes(code) ? code : 'capture_failed'));
  handler('capture:privacy', captureOnly, () => process.platform === 'darwin' ? shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') : undefined);
  powerMonitor.on('lock-screen', () => { void stop('screen_locked'); });
  powerMonitor.on('suspend', () => { void stop('system_sleep'); });
  screen.on('display-removed', () => { void stop('display_changed'); });
  screen.on('display-metrics-changed', (_, display) => {
    const original = selected?.display;
    if (win && original?.id === display.id && (regionFrame || activeRegion)
      && (original.size.width !== display.size.width || original.size.height !== display.size.height
        || original.scaleFactor !== display.scaleFactor || original.rotation !== display.rotation)) void stop('region_changed');
  });
  return { busy, state: () => state, stop, abort: end, refresh: () => { previews.clear(); emit({}); } };
}

module.exports = { registerCaptureScheme, createCaptureService, normalizeSettings };
