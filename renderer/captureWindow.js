(async function () {
  const api = window.captureAPI, domain = window.CaptureDomain;
  const $ = (id) => document.getElementById(id);
  const must = async (promise) => { const reply = await promise; if (!reply?.ok) throw new Error(reply?.error || 'capture_failed'); return reply.value; };
  let config, selected, sourceStream, microphoneStream, recorder, snapshot, selection;
  let active = false, cancelled = false, stopping = false, fatal = '', sequence = 0, queuedBytes = 0;
  let writing = Promise.resolve(), startedAt = 0, timer, generation = 0;
  let sourceUnavailable = false, selectionAttempt = 0;
  let croppedStream, cropTimer, captureRegion = null, stopNotice = '', confirming = false;
  const stopTracks = () => { clearInterval(cropTimer); croppedStream?.getTracks().forEach((track) => track.stop()); sourceStream?.getTracks().forEach((track) => track.stop()); microphoneStream?.getTracks().forEach((track) => track.stop()); };
  function fail(error) {
    fatal = error?.name === 'NotAllowedError' ? 'permission_denied' : error?.message || 'capture_failed';
    clearTimeout(timer); stopTracks();
    void api.fail(fatal);
  }
  async function refresh() {
    const request = ++generation;
    selected = null; $('start').disabled = true; $('sources').replaceChildren(); $('status').textContent = '正在读取来源…';
    try {
      const rows = await must(api.sources($('type').value === 'window' ? 'window' : 'screen'));
      if (request !== generation) return;
      $('status').textContent = rows.length
        ? (config.platform === 'win32' && $('type').value === 'window' ? '请选择窗口；已排除不可用窗口，窗口列表不预先抓取画面。' : '请选择要采集的屏幕或窗口')
        : '没有可用来源。请打开或恢复窗口后刷新，也可手动选择整个屏幕。';
      for (const row of rows) {
        const button = document.createElement('button'); button.className = 'source'; button.type = 'button'; button.setAttribute('aria-pressed', 'false');
        const image = document.createElement(row.thumbnail ? 'img' : 'div');
        if (row.thumbnail) { image.src = row.thumbnail; image.alt = ''; }
        else { image.className = 'source-placeholder'; image.textContent = '窗口'; image.setAttribute('aria-hidden', 'true'); }
        const name = document.createElement('span'); name.textContent = row.name; button.append(image, name);
        button.addEventListener('click', async () => {
          const attempt = ++selectionAttempt;
          selected = null;
          $('start').disabled = true;
          try {
            await must(api.select(row.token));
            if (attempt !== selectionAttempt || request !== generation || active) return;
            selected = row;
            $('sources').querySelectorAll('button').forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
            $('start').disabled = false;
          } catch (error) { if (attempt === selectionAttempt && request === generation) { button.disabled = error.message === 'source_not_capturable'; $('status').textContent = domain.message(error.message); } }
        });
        $('sources').append(button);
      }
    } catch (error) { if (request === generation) $('status').textContent = domain.message(error.message); }
  }
  function nextFrame(video) {
    return new Promise((resolve, reject) => {
      let callback;
      const timeout = setTimeout(() => { if (callback !== undefined) video.cancelVideoFrameCallback(callback); reject(new Error('no_frames')); }, 6000);
      callback = video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
    });
  }
  async function currentFrame() {
    const video = $('source-video');
    await nextFrame(video); await nextFrame(video);
    if (!video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > config.limits.pixels) throw new Error('no_frames');
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas;
  }
  async function saveImage(canvas) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > config.limits.image) throw new Error('size_limit');
    await must(api.image(await blob.arrayBuffer()));
  }
  async function showCrop(fresh = false) {
    $('picker').hidden = true; $('cropper').hidden = false;
    const canvas = $('crop-canvas'); canvas.width = snapshot.width; canvas.height = snapshot.height;
    canvas.getContext('2d').drawImage(snapshot, 0, 0);
    const preset = await must(api.crop({ width: snapshot.width, height: snapshot.height }, fresh));
    selection = preset.saved ? { x: preset.saved.x, y: preset.saved.y, width: preset.saved.width, height: preset.saved.height } : null;
    $('crop-save').textContent = config.mode === 'video' ? '录制此区域' : '复制到剪贴板';
    syncRegionFields(); redraw();
    if (preset.saved) $('crop-size').textContent = `已载入上次框选 ${selection.width} × ${selection.height} 像素 · 可重新拖动调整`;
    else if (preset.stale) $('crop-size').textContent = '显示器或画面尺寸已变化，请重新框选区域';
  }
  async function start() {
    if (active || !selected) return;
    active = true;
    $('start').disabled = true; $('type').disabled = true; $('refresh').disabled = true;
    $('sources').querySelectorAll('button').forEach((button) => { button.disabled = true; });
    $('status').textContent = '正在请求采集权限…';
    try {
      const videoMode = config.mode === 'video';
      const regional = $('type').value === 'region';
      // Region coordinates refer to the full source frame; scale only the cropped output.
      const resolution = videoMode && !regional ? domain.videoSize(selected.width || 3840, selected.height || 2160, config.settings.quality) : { width: selected.width || 7680, height: selected.height || 4320 };
      // Keep getDisplayMedia directly in this focused window's click handler.
      sourceUnavailable = false;
      try {
        sourceStream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { width: { ideal: resolution.width }, height: { ideal: resolution.height }, frameRate: videoMode ? { ideal: 30, max: 30 } : { ideal: 10 } } });
      } catch (error) {
        if (!cancelled && (sourceUnavailable || ['NotReadableError', 'AbortError', 'NotFoundError'].includes(error.name))) {
          await must(api.retrySource());
          active = false; selected = null;
          $('type').disabled = false; $('refresh').disabled = false;
          await refresh();
          $('status').textContent = domain.message('source_not_capturable');
          return;
        }
        throw error;
      }
      if (cancelled) { stopTracks(); return; }
      const video = $('source-video'); video.srcObject = sourceStream; await video.play();
      sourceStream.getVideoTracks()[0].addEventListener('ended', () => { void stop(); }, { once: true });
      if (!videoMode || regional) {
        await must(api.hide());
        await new Promise((resolve) => setTimeout(resolve, 180));
        snapshot = await currentFrame();
        if (!videoMode) stopTracks();
        if (regional) await showCrop();
        else await saveImage(snapshot);
        return;
      }
      await startVideo();
    } catch (error) { if (!cancelled) fail(error); }
  }
  async function startVideo() {
    if (config.settings.audio === 'microphone') {
      if (!(await must(api.microphone()))) throw new DOMException('Microphone denied', 'NotAllowedError');
      if (cancelled) return;
      microphoneStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
      if (cancelled) { stopTracks(); return; }
    }
    const sourceTrack = sourceStream.getVideoTracks()[0];
    let videoTrack = sourceTrack, drawRegion = null;
    if (captureRegion) {
      const size = domain.videoSize(captureRegion.width, captureRegion.height, config.settings.quality);
      const output = document.createElement('canvas'); output.width = size.width; output.height = size.height;
      const context = output.getContext('2d', { alpha: false });
      croppedStream = output.captureStream(0); videoTrack = croppedStream.getVideoTracks()[0];
      drawRegion = () => {
        const video = $('source-video');
        if (video.videoWidth !== snapshot.width || video.videoHeight !== snapshot.height) {
          void stop('region_changed'); return false;
        }
        context.drawImage(video, captureRegion.x, captureRegion.y, captureRegion.width, captureRegion.height, 0, 0, output.width, output.height);
        videoTrack.requestFrame();
        return true;
      };
    } else {
      const settings = videoTrack.getSettings();
      const size = domain.videoSize(settings.width, settings.height, config.settings.quality);
      await videoTrack.applyConstraints({ width: { max: size.width }, height: { max: size.height }, frameRate: { max: 30 } });
    }
    const actual = videoTrack.getSettings();
    const audioTracks = microphoneStream?.getAudioTracks() || [];
    const mime = (audioTracks.length ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8']).find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('unsupported_codec');
    recorder = new MediaRecorder(new MediaStream([videoTrack, ...audioTracks]), { mimeType: mime, videoBitsPerSecond: config.settings.quality === '720' ? 2500000 : 6000000 });
    await must(api.begin({ width: actual.width, height: actual.height, mimeType: recorder.mimeType, audio: audioTracks.length ? 'microphone' : 'none' }));
    if (cancelled) { stopTracks(); return; }
    for (const track of [videoTrack, ...audioTracks]) track.addEventListener('ended', () => { void stop(); }, { once: true });
    await must(api.hide());
    await new Promise((resolve) => setTimeout(resolve, 180));
    for (let seconds = config.settings.countdown; seconds > 0 && !cancelled; seconds--) await new Promise((resolve) => setTimeout(resolve, 1000));
    if (cancelled) return;
    await nextFrame($('source-video'));
    await nextFrame($('source-video'));
    if (cancelled) return;
    recorder.ondataavailable = (event) => {
      if (!event.data.size || fatal) return;
      queuedBytes += event.data.size;
      if (queuedBytes > config.limits.queue) { fatal = 'queue_limit'; void stop(); return; }
      writing = writing.then(async () => {
        for (let offset = 0; offset < event.data.size; offset += config.limits.chunk) {
          if (fatal) return;
          const data = await event.data.slice(offset, offset + config.limits.chunk).arrayBuffer();
          await must(api.append(sequence++, data));
        }
      }).catch((error) => { fatal = error.message === 'video_limit' ? 'video_limit' : 'write_failed'; void stop(); })
        .finally(() => { queuedBytes -= event.data.size; });
    };
    recorder.onerror = () => { fatal = 'capture_failed'; void stop(); };
    recorder.onstop = async () => {
      const duration = performance.now() - startedAt;
      stopTracks(); clearTimeout(timer);
      await writing;
      if (fatal) { await api.fail(fatal); return; }
      try { await must(api.finish({ durationMs: duration, reason: stopNotice })); } catch (error) { fail(error); }
    };
    await must(api.recording());
    if (cancelled) return;
    recorder.start(1000); startedAt = performance.now();
    if (drawRegion) {
      if (!drawRegion()) return;
      cropTimer = setInterval(drawRegion, 1000 / 30);
    }
    timer = setTimeout(() => { void stop(); }, config.limits.duration);
  }
  async function stop(reason = '') {
    if (stopping) return;
    if (reason === 'region_changed') stopNotice = reason;
    stopping = true; clearTimeout(timer);
    if (recorder?.state === 'recording') { recorder.stop(); stopTracks(); }
    else { cancelled = true; stopTracks(); await api.cancel(); }
  }
  let anchor = null;
  const canvas = $('crop-canvas');
  function syncRegionFields() {
    for (const key of ['x', 'y', 'width', 'height']) $(`crop-${key}`).value = selection ? String(selection[key]) : '';
    $('crop-save').disabled = confirming || !domain.validRegion(selection, canvas.width, canvas.height);
  }
  function redraw() {
    const context = canvas.getContext('2d'); context.drawImage(snapshot, 0, 0);
    if (!domain.validRegion(selection, canvas.width, canvas.height)) {
      if (config?.directSnapshot) { context.fillStyle = 'rgba(0,0,0,.28)'; context.fillRect(0, 0, canvas.width, canvas.height); }
      $('crop-size').textContent = config?.directSnapshot ? '拖动鼠标框选 · 松开复制 · Esc 取消' : '拖动框选或输入位置与宽高（至少 2 × 2 像素）· Esc 取消';
      return;
    }
    const r = selection;
    context.fillStyle = 'rgba(0,0,0,.5)';
    context.fillRect(0, 0, canvas.width, r.y); context.fillRect(0, r.y + r.height, canvas.width, canvas.height - r.y - r.height);
    context.fillRect(0, r.y, r.x, r.height); context.fillRect(r.x + r.width, r.y, canvas.width - r.x - r.width, r.height);
    context.strokeStyle = '#82b5ff'; context.lineWidth = Math.max(2, canvas.width / canvas.clientWidth * 2); context.strokeRect(r.x, r.y, r.width, r.height);
    $('crop-size').textContent = `${r.width} × ${r.height} 像素 · 重新拖动可调整`;
  }
  function updatePointerSelection(event) {
    if (confirming || !anchor) return;
    selection = domain.cropRect(anchor, { x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    redraw(); syncRegionFields();
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (confirming || event.button !== 0) return;
    anchor = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    selection = null; syncRegionFields(); redraw();
  });
  canvas.addEventListener('pointermove', updatePointerSelection);
  async function finalizeRegion() {
    if (confirming || !domain.validRegion(selection, canvas.width, canvas.height)) return;
    confirming = true;
    for (const id of ['crop-save', 'crop-reset', 'crop-x', 'crop-y', 'crop-width', 'crop-height', 'crop-remember']) $(id).disabled = true;
    const rect = { ...selection };
    try {
      await must(api.confirmRegion(rect, $('crop-remember').checked));
      if (cancelled) return;
      if (config.mode === 'video') { captureRegion = rect; await startVideo(); }
      else {
        const output = document.createElement('canvas'); output.width = rect.width; output.height = rect.height;
        output.getContext('2d').drawImage(snapshot, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        await saveImage(output);
      }
    } catch (error) { if (!cancelled) fail(error); }
  }
  canvas.addEventListener('pointerup', async (event) => {
    updatePointerSelection(event); anchor = null;
    if (config?.mode === 'screenshot') await finalizeRegion();
  });
  canvas.addEventListener('pointercancel', () => { anchor = null; });
  canvas.addEventListener('lostpointercapture', () => { anchor = null; });
  for (const key of ['x', 'y', 'width', 'height']) $(`crop-${key}`).addEventListener('input', () => {
    if (confirming) return;
    const value = Object.fromEntries(['x', 'y', 'width', 'height'].map((name) => [name, $(`crop-${name}`).valueAsNumber]));
    selection = domain.validRegion(value, canvas.width, canvas.height) ? value : null;
    $('crop-save').disabled = !selection; redraw();
  });
  $('crop-reset').addEventListener('click', () => { selection = null; syncRegionFields(); redraw(); });
  $('crop-save').addEventListener('click', finalizeRegion);
  $('start').addEventListener('click', start);
  $('cancel').addEventListener('click', stop); $('crop-cancel').addEventListener('click', stop);
  $('refresh').addEventListener('click', refresh); $('type').addEventListener('change', refresh);
  $('privacy').addEventListener('click', () => { void api.privacy(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') void stop(); });
  window.addEventListener('beforeunload', stopTracks);
  api.onStop(stop);
  api.onSourceUnavailable(() => { sourceUnavailable = true; });
  function loadSnapshot(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('no_frames'));
      image.src = dataUrl;
    });
  }
  try {
    config = await must(api.init());
    if (config.directSnapshot) {
      document.body.classList.add('direct-screenshot');
      $('crop-remember').checked = false;
      snapshot = await loadSnapshot(config.directSnapshot.dataUrl);
      if (snapshot.width !== config.directSnapshot.width || snapshot.height !== config.directSnapshot.height) throw new Error('no_frames');
      await showCrop(true);
      return;
    }
    $('privacy').hidden = config.platform !== 'darwin';
    $('heading').textContent = config.mode === 'video' ? '选择要录制的画面' : '捕捉屏幕上的内容';
    $('type').value = config.mode === 'video' ? config.settings.video : config.settings.screenshot;
    $('start').textContent = config.mode === 'video' ? '开始录屏' : '截取画面';
    $('summary').textContent = config.mode === 'video' ? `${config.settings.audio === 'microphone' ? '麦克风' : '无声'} · ${config.settings.countdown} 秒倒计时 · 托盘可停止` : 'PNG 图片 · 仅保存在本机';
    await refresh();
  } catch (error) { $('status').textContent = domain.message(error.message); }
})();
