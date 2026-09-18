(() => {
  const api = window.recordingOverlayAPI;
  const time = document.getElementById('recording-time');
  const stop = document.getElementById('recording-stop');
  const discard = document.getElementById('recording-discard');
  let phase = 'preparing', startedAt = 0, countdownEndsAt = 0;
  const clockValue = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const render = () => {
    document.body.dataset.phase = phase;
    if (phase === 'recording') time.textContent = clockValue(Date.now() - startedAt);
    else if (phase === 'countdown' && countdownEndsAt > Date.now()) time.textContent = `倒计时 ${Math.max(1, Math.ceil((countdownEndsAt - Date.now()) / 1000))}`;
    else time.textContent = ({ preparing: '准备中', countdown: '准备中', stopping: '停止中', saving: '保存中' })[phase] || '录屏';
    const interactive = ['preparing', 'countdown', 'recording'].includes(phase);
    stop.disabled = !interactive; discard.disabled = !interactive;
    const saving = phase === 'recording';
    stop.title = saving ? '停止并保存' : '取消录屏';
    stop.setAttribute('aria-label', stop.title);
  };
  const pending = () => { stop.disabled = true; discard.disabled = true; };
  stop.addEventListener('click', async () => { pending(); await api.stop(); });
  discard.addEventListener('click', async () => { pending(); await api.discard(); });
  api.onState((state) => {
    phase = state.phase || phase;
    if (state.startedAt) startedAt = state.startedAt;
    countdownEndsAt = state.countdownEndsAt || 0;
    render();
  });
  render(); setInterval(render, 250);
})();
