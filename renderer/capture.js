(function () {
  const api = window.notchAPI, domain = window.CaptureDomain;
  const $ = (id) => document.getElementById(id);
  if (!$('capture-library')) return;
  let mode = 'audio', items = [], selected = '', state = { phase: 'idle' }, generation = 0, listGeneration = 0;
  const must = async (promise) => { const reply = await promise; if (!reply?.ok) throw new Error(reply?.error || 'capture_failed'); return reply.value; };
  const notice = (text) => { $('capture-status').textContent = text; $('capture-status').title = text; };
  const error = (value) => notice(domain.message(value?.message));
  const size = (bytes = 0) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  const clock = (ms) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  const globalStop = document.createElement('button'); globalStop.type = 'button'; globalStop.className = 'workspace-button compact capture-global-status'; globalStop.hidden = true;
  globalStop.addEventListener('click', () => { void must(api.stopCapture()).catch(error); });
  document.querySelector('.topbar')?.append(globalStop);
  function selectMode(next) {
    mode = next;
    document.querySelectorAll('[data-capture-tab]').forEach((button) => { const active = button.dataset.captureTab === mode; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    $('audio-library').hidden = mode !== 'audio'; $('capture-library').hidden = mode === 'audio'; $('capture-new').hidden = mode === 'audio';
    $('capture-library').setAttribute('aria-labelledby', `capture-tab-${mode === 'video' ? 'video' : 'screenshot'}`);
    $('capture-library-title').textContent = mode === 'video' ? '录屏资料库' : '截图资料库';
    $('capture-new').textContent = mode === 'video' ? '新建录屏' : '新建截图';
    if (mode === 'audio') { generation++; $('capture-detail').querySelector('video')?.pause(); }
    else { renderList(); void renderDetail(); }
  }
  function renderList() {
    const rows = items.filter((item) => item.kind === mode);
    if (!rows.some((item) => item.id === selected)) selected = rows[0]?.id || '';
    $('capture-count').textContent = `${rows.length} 项`; $('capture-list').replaceChildren();
    for (const row of rows) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'capture-row'; button.setAttribute('aria-pressed', String(row.id === selected));
      const title = document.createElement('strong'); title.textContent = row.title;
      const meta = document.createElement('small'); meta.textContent = `${new Date(row.createdAt).toLocaleString()} · ${row.status === 'incomplete' ? '未完成' : size(row.bytes)}`;
      button.append(title, meta); button.addEventListener('click', () => { selected = row.id; renderList(); void renderDetail(); });
      $('capture-list').append(button);
    }
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'capture-empty'; empty.textContent = mode === 'video' ? '录制屏幕，留下操作过程' : '保存画面，随时回看'; $('capture-list').append(empty); }
  }
  async function renderDetail() {
    const request = ++generation, container = $('capture-detail');
    container.querySelector('video')?.pause(); container.replaceChildren();
    const item = items.find((row) => row.id === selected);
    if (!item || mode === 'audio') { const empty = document.createElement('p'); empty.className = 'capture-empty'; empty.textContent = '点击右上角开始采集，文件会保存在当前数据文件夹。'; container.append(empty); return; }
    const header = document.createElement('div'); header.className = 'capture-detail-header';
    const title = document.createElement('input'); title.className = 'capture-title-input'; title.value = item.title; title.maxLength = 120; title.setAttribute('aria-label', '文件名称');
    const rename = action('保存名称', async () => { await must(api.renameCapture(item.id, title.value)); notice('名称已保存'); }); header.append(title, rename); container.append(header);
    const meta = document.createElement('p'); meta.className = 'capture-detail-meta'; meta.textContent = `${item.width} × ${item.height} · ${size(item.bytes)}${item.kind === 'video' ? ` · ${clock(item.durationMs || 0)} · ${item.audio === 'microphone' ? '麦克风' : '无声'}` : ' · PNG'}`; container.append(meta);
    const preview = document.createElement('div'); preview.className = 'capture-preview'; container.append(preview);
    const actions = document.createElement('div'); actions.className = 'capture-actions'; container.append(actions);
    if (item.kind === 'screenshot' && item.status === 'complete' && !item.missing) {
      actions.append(action('编辑标注', async () => { await must(api.editCapture(item.id)); }));
      actions.append(action('复制图片', async () => { await must(api.copyCapture(item.id)); notice('图片已复制'); }));
    }
    if (!item.missing) actions.append(action('导出', async () => { if (await must(api.exportCapture(item.id))) notice('文件已导出'); }), action('打开所在文件夹', () => must(api.revealCapture(item.id))));
    const remove = action('删除', async () => {
      if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; remove.textContent = '确认删除文件？'; return; }
      await must(api.deleteCapture(item.id));
    }); remove.classList.add('danger'); actions.append(remove);
    if (item.status !== 'complete' || item.missing) {
      const note = document.createElement('p'); note.className = 'capture-empty'; note.textContent = item.missing ? '文件不存在，可删除这条记录。' : '此录屏未完成，不能保证播放。可以导出文件尝试恢复，或删除记录。'; preview.append(note); return;
    }
    try {
      const url = await must(api.previewCapture(item.id));
      if (request !== generation) return;
      const media = document.createElement(item.kind === 'video' ? 'video' : 'img');
      if (item.kind === 'video') { media.controls = true; media.preload = 'metadata'; }
      else media.alt = item.title;
      media.addEventListener('error', () => { if (request === generation) notice('预览失败，可以导出文件使用其他应用打开。'); });
      media.src = url; preview.append(media);
    } catch (value) { if (request === generation) error(value); }
  }
  function action(label, fn) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-button compact'; button.textContent = label;
    button.addEventListener('click', async () => { button.disabled = true; try { await fn(); } catch (value) { error(value); } finally { button.disabled = false; } }); return button;
  }
  async function refresh() {
    if (!api?.listCaptures) return;
    const request = ++listGeneration;
    try { const rows = await must(api.listCaptures()); if (request !== listGeneration) return; items = rows; if (mode !== 'audio') { renderList(); await renderDetail(); } }
    catch (value) { error(value); }
  }
  function updateState(next) {
    const oldPhase = state.phase; state = next;
    const active = state.phase !== 'idle';
    $('capture-new').disabled = active || state.audioBusy === true;
    $('capture-stop').hidden = !active; globalStop.hidden = !active;
    $('capture-discard').hidden = !active || state.mode !== 'video';
    $('capture-stop').textContent = state.mode === 'video' && ['countdown', 'recording'].includes(state.phase) ? '停止并保存' : '取消采集';
    $('capture-stop').disabled = ['stopping', 'saving'].includes(state.phase); globalStop.disabled = $('capture-stop').disabled;
    $('capture-discard').disabled = $('capture-stop').disabled;
    if (state.error) notice(domain.message(state.error));
    else if (!active && oldPhase !== 'idle') notice(state.itemId ? '已保存到当前数据文件夹' : '采集已取消');
    if (state.itemId && oldPhase !== 'idle') { selected = state.itemId; if (mode !== 'audio') selectMode(state.mode); }
    tick();
    if (!active) { void refresh(); void must(api.captureSettings()).then(renderRegion).catch(error); }
    $('capture-clear-region').disabled = active;
  }
  function tick() {
    if (state.phase === 'idle') return;
    const labels = { selecting: '选择采集来源', preparing: '等待权限与画面', countdown: '录屏倒计时', recording: `录屏 ${clock(Date.now() - state.startedAt)}`, cropping: '鼠标框选区域', stopping: '正在停止', saving: '正在保存' };
    globalStop.textContent = `● ${labels[state.phase] || '采集中'} · 停止`;
    notice(labels[state.phase] || '采集中');
  }
  document.querySelectorAll('[data-capture-tab]').forEach((button) => button.addEventListener('click', () => selectMode(button.dataset.captureTab)));
  document.querySelector('.capture-tabs').addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('[data-capture-tab]')], index = tabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  });
  $('capture-new').addEventListener('click', async () => { try { await must(api.openCapture(mode)); } catch (value) { error(value); } });
  $('capture-stop').addEventListener('click', () => { void must(api.stopCapture()).catch(error); });
  $('capture-discard').addEventListener('click', () => { void must(api.discardCapture()).catch(error); });
  $('capture-settings').addEventListener('click', () => { document.getElementById('tab-button-settings')?.click(); window.NotchSettings?.select('capture'); });
  $('capture-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await must(api.saveCaptureSettings({ screenshot: $('capture-default-screenshot').value, video: $('capture-default-video').value, quality: $('capture-default-quality').value, audio: $('capture-default-audio').value, countdown: Number($('capture-default-countdown').value) }));
      $('capture-settings-status').textContent = '已保存';
    } catch (value) { $('capture-settings-status').textContent = domain.message(value.message); }
  });
  function renderRegion(settings) {
    const r = settings.fixedRegion;
    $('capture-fixed-region').textContent = r ? `已记住：${r.width} × ${r.height} 像素，位置 (${r.x}, ${r.y})；仅用于原显示器及原画面尺寸。` : '尚未记住区域。在截图或录屏中选择「框选区域」，拖动鼠标并确认即可保存。';
    $('capture-clear-region').hidden = !r;
  }
  $('capture-clear-region').addEventListener('click', async () => {
    try { renderRegion(await must(api.clearCaptureRegion())); $('capture-settings-status').textContent = '已清除记住的区域'; }
    catch (value) { $('capture-settings-status').textContent = domain.message(value.message); }
  });
  api?.onCapturesChanged?.(updateState);
  api?.onWorkspaceChanged?.(() => { selected = ''; generation++; items = []; void refresh(); });
  setInterval(tick, 1000);
  if (api?.captureSettings) {
    must(api.captureSettings()).then((settings) => {
      for (const key of ['screenshot', 'video', 'quality', 'audio', 'countdown']) $(`capture-default-${key}`).value = String(settings[key]);
      renderRegion(settings);
    }).catch(error);
    must(api.captureState()).then(updateState).catch(error);
  }
  window.NotchCapture = { refresh, selectMode };
})();
