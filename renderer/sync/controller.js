(function exposeSyncController(root) {
  function createController({ document: documentRef = root.document, view = root.NotchSyncView?.createView(documentRef), getApi = () => root.notchAPI?.sync } = {}) {
    let status = { state: 'disconnected' };
    let conflicts = [];
    let testedToken = '';
    let unsubscribe = null;
    const handleOnline = () => { if (status.identity && status.state !== 'paused') invoke('runNow').then(refresh).catch(() => {}); };
    const byId = (id) => documentRef?.getElementById(id);
    const selectedCategories = () => Object.fromEntries([...documentRef.querySelectorAll('[data-sync-category]')].map((input) => [input.dataset.syncCategory, input.checked]));
    const setBusy = (busy) => documentRef?.getElementById('sync-settings')?.setAttribute('aria-busy', String(busy));
    const announce = (text, error = false) => { const node = byId('sync-message'); if (!node) return; node.textContent = text || ''; node.dataset.state = error ? 'error' : 'saved'; };
    async function invoke(name, ...args) { const method = getApi()?.[name]; if (typeof method !== 'function') throw new Error('sync_api_unavailable'); return method(...args); }
    async function refresh() {
      try {
        status = await invoke('getStatus');
        if (status.identity) {
          const runtime = await invoke('getRuntimeContext').catch(() => null);
          if (runtime?.categories) documentRef?.querySelectorAll('[data-sync-category]').forEach((input) => { if (typeof runtime.categories[input.dataset.syncCategory] === 'boolean') input.checked = runtime.categories[input.dataset.syncCategory]; });
        }
        view?.render(status); return status;
      } catch (error) { status = { state: 'disconnected', error: { code: 'sync_api_unavailable' } }; view?.render(status); return status; }
    }
    async function testConnection() {
      setBusy(true); announce('正在验证连接…');
      try {
        const result = await invoke('testConnection', { baseUrl: byId('sync-base-url')?.value.trim(), clientKey: byId('sync-client-key')?.value, allowLoopbackHttp: byId('sync-loopback')?.checked === true });
        if (!result?.ok) { announce(`连接失败：${result?.error?.code || 'unknown_error'}`, true); return result; }
        testedToken = result.token; if (byId('sync-client-key')) byId('sync-client-key').value = '';
        byId('sync-identity')?.removeAttribute('hidden');
        byId('sync-identity') && (byId('sync-identity').textContent = `${result.identity.spaceName || '同步空间'} · 客户端 ${result.identity.clientIdPrefix}`);
        announce(result.warning ? `连接有效，但服务器时钟相差 ${Math.abs(result.clockSkewSeconds)} 秒，请校准时间后同步。` : result.secureStorage === 'session-only' ? '连接有效。系统安全存储不可用，密钥仅在本次运行中保留。' : '连接有效，请确认同步范围。', Boolean(result.warning));
        const local = await root.NotchSyncRuntime?.inventory?.() || {};
        const preview = await invoke('previewFirstSync', { token: result.token, categories: selectedCategories(), local });
        if (!preview?.ok) { announce(`预览失败：${preview?.error?.code || 'unknown_error'}`, true); return preview; }
        view?.renderPreview(preview);
        return { ...result, preview };
      } finally { setBusy(false); }
    }
    async function saveBinding() {
      if (!testedToken) { announce('请先测试连接。', true); return; }
      setBusy(true);
      try {
        const categories = selectedCategories();
        const local = await root.NotchSyncRuntime?.inventory?.() || {};
        const preview = await invoke('previewFirstSync', { token: testedToken, categories, local });
        if (!preview?.ok) { announce(`预览失败：${preview?.error?.code || 'unknown_error'}`, true); return; }
        view?.renderPreview(preview);
        const planId = preview.planId;
        const mode = byId('sync-first-sync-mode')?.value || 'merge';
        let confirmation = '';
        if (mode === 'local-wins' || mode === 'server-wins') {
          confirmation = mode === 'local-wins' ? 'REPLACE SERVER' : 'REPLACE THIS DEVICE';
          const target = mode === 'local-wins' ? '服务器中的所选数据' : '本机中的所选数据';
          const typed = root.prompt?.(`此操作将替换${target}。系统会先创建并验证恢复点。请输入 ${confirmation} 继续：`, '');
          if (typed !== confirmation) { await invoke('cancelFirstSync', { planId }); announce('已取消，未修改本机或服务器数据。'); return; }
        }
        const result = await invoke('saveBinding', { token: testedToken, categories, firstSync: { mode, planId } });
        if (!result?.ok) { announce(`保存失败：${result?.error?.code || 'unknown_error'}`, true); return; }
        const scanned = await root.NotchSyncRuntime?.scanNow?.();
        if (scanned?.ok === false && !scanned.skipped) { announce('本机数据扫描失败。', true); return; }
        const firstSync = await invoke('executeFirstSync', { mode, planId, confirmation, local: scanned?.inventory || local });
        if (!firstSync?.ok) { announce(`首次同步未完成：${firstSync?.error?.code || 'unknown_error'}`, true); await refresh(); return; }
        testedToken = ''; announce('同步连接已保存。'); await refresh();
      } finally { setBusy(false); }
    }
    async function togglePause() { const paused = status.state !== 'paused'; const result = await invoke('pause', paused); if (result?.status) { status = result.status; view?.render(status); } }
    async function removeBinding() { if (!root.confirm?.('只移除此设备的连接与同步状态，不删除本地内容。继续吗？')) return; const result = await invoke('removeBinding', { confirm: true }); if (result?.ok) { announce('已移除此设备的同步连接。'); await refresh(); } }
    async function loadConflicts() { const result = await invoke('listConflicts', { offset: 0, limit: 50 }); conflicts = result?.items || []; view?.renderConflicts(result); return result; }
    function bind() {
      byId('sync-test')?.addEventListener('click', testConnection);
      byId('sync-save')?.addEventListener('click', saveBinding);
      byId('sync-run-now')?.addEventListener('click', async () => { setBusy(true); await invoke('runNow').finally(() => setBusy(false)); await refresh(); });
      byId('sync-pause')?.addEventListener('click', togglePause);
      byId('sync-remove')?.addEventListener('click', removeBinding);
      byId('sync-conflicts-open')?.addEventListener('click', loadConflicts);
      byId('sync-first-sync-cancel')?.addEventListener('click', async () => { const planId = byId('sync-first-sync')?.dataset.planId; await invoke('cancelFirstSync', { planId }); testedToken = ''; byId('sync-first-sync').hidden = true; announce('已取消，未修改本机数据。'); });
      documentRef?.querySelectorAll('[data-sync-category]').forEach((input) => input.addEventListener('change', async () => {
        if (!status.identity) return;
        const result = await invoke('setCategories', selectedCategories());
        if (!result?.ok) { announce(`同步范围更新失败：${result?.error?.code || 'unknown_error'}`, true); return; }
        if (!result.confirmationRequired) { announce('同步范围已更新。'); return; }
        const labels = result.disabled.map((category) => view?.CATEGORY_LABELS?.[category] || category).join('、');
        announce(`已停止 ${labels} 的后续同步，服务器副本保持不变。`);
        if (!root.confirm?.(`已停止 ${labels} 的同步。是否另外删除服务器中的这些分类数据？`)) return;
        setBusy(true);
        try {
          const prepared = await invoke('prepareCategoryClear', { categories: result.disabled });
          if (!prepared?.ok) { announce(`无法建立恢复点：${prepared?.error?.code || 'unknown_error'}`, true); return; }
          const affected = Object.values(prepared.impact || {}).reduce((sum, row) => sum + (Number(row?.records) || 0), 0);
          const phrase = 'DELETE SERVER CATEGORY DATA';
          const typed = root.prompt?.(`已创建并验证恢复点。将为服务器中的 ${affected} 条记录写入删除墓碑。请输入 ${phrase} 继续：`, '');
          if (typed !== phrase) { await invoke('cancelFirstSync', { planId: prepared.planId }); announce('已取消服务器分类删除；本机分类仍保持停止同步。'); return; }
          const cleared = await invoke('executeCategoryClear', { planId: prepared.planId, confirmation: phrase });
          announce(cleared?.ok ? `服务器分类数据已删除，可通过恢复点 ${cleared.recoveryPointId} 恢复。` : `服务器分类删除失败：${cleared?.error?.code || 'unknown_error'}`, !cleared?.ok);
          await refresh();
        } finally { setBusy(false); }
      }));
      byId('sync-conflict-list')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-sync-conflict]'); if (!button) return;
        const input = { conflictId: button.dataset.syncConflict, decision: button.dataset.decision };
        if (input.decision === 'manual') {
          const conflict = conflicts.find((row) => row.conflictId === input.conflictId);
          const initial = JSON.stringify(conflict?.currentPayload || {}, null, 2);
          const entered = root.prompt?.('编辑合并后的 JSON 数据：', initial);
          if (entered == null) return;
          try { input.payload = JSON.parse(entered); } catch { announce('JSON 格式无效，未修改冲突。', true); return; }
        }
        const result = await invoke('resolveConflict', input);
        if (!result?.ok) announce(`冲突未解决：${result?.error?.code || 'unknown_error'}`, true);
        await loadConflicts(); await refresh();
      });
      unsubscribe = getApi()?.onStatus?.((next) => { status = next; view?.render(status); });
      root.addEventListener?.('online', handleOnline);
      return refresh();
    }
    function dispose() { unsubscribe?.(); unsubscribe = null; root.removeEventListener?.('online', handleOnline); }
    return Object.freeze({ bind, dispose, refresh, testConnection, saveBinding, loadConflicts, getStatus: () => status });
  }
  const exported = Object.freeze({ createController }); root.NotchSyncController = exported;
  if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window);
