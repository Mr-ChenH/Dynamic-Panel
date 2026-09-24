(function exposeSyncView(root) {
  const CATEGORY_LABELS = Object.freeze({ todo: '待办与分类', notes: '笔记与图片', links: '链接与分组', preferences: '基础偏好', clipboard: '剪贴板文字与图片', screenshots: '完整截图', aiSessions: '已保存 AI 对话', finance: '行情自选', commands: '常用指令', launcher: '启动器收藏与别名', location: '天气地点' });
  const STATE_LABELS = Object.freeze({ disconnected: '未连接', connecting: '正在连接', online: '已同步', offline: '离线', paused: '已暂停', blocked: '需要处理' });
  const CATEGORY_RISK = Object.freeze({ clipboard: '敏感', screenshots: '敏感', aiSessions: '敏感', location: '敏感', commands: '敏感', notes: '含附件' });
  function setText(node, value) { if (node) node.textContent = String(value == null ? '' : value); }
  function formatBytes(value) { const bytes = Math.max(0, Number(value) || 0); if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  function formatTime(value) { if (!value) return '尚未同步'; try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch (error) { return '尚未同步'; } }
  function createView(documentRef = root.document) {
    const byId = (id) => documentRef?.getElementById(id);
    function render(status = {}) {
      const state = status.state || 'disconnected';
      const section = byId('sync-settings'); if (section) section.dataset.state = state;
      setText(byId('sync-status-label'), STATE_LABELS[state] || STATE_LABELS.disconnected);
      setText(byId('sync-status-detail'), status.identity ? `${status.identity.spaceName || '同步空间'} · ${status.identity.spaceIdPrefix || ''} · 协议 v${status.protocolVersion || 1}` : '连接后可在多台设备间同步所选数据');
      setText(byId('sync-last-sync'), formatTime(status.lastSyncAt));
      setText(byId('sync-queue-count'), `${Number(status.queued) || 0} 项待同步`);
      setText(byId('sync-conflict-count'), `${Number(status.conflicts) || 0} 个冲突`);
      const error = byId('sync-error');
      if (error) { error.hidden = !status.error; setText(error, status.error ? `同步未完成：${status.error.code}` : ''); }
      const connected = Boolean(status.identity);
      byId('sync-setup')?.toggleAttribute('hidden', connected);
      byId('sync-connected')?.toggleAttribute('hidden', !connected);
      const pause = byId('sync-pause'); if (pause) { pause.textContent = state === 'paused' ? '继续同步' : '暂停'; pause.setAttribute('aria-pressed', String(state === 'paused')); }
      const run = byId('sync-run-now'); if (run) run.disabled = state === 'connecting' || state === 'paused';
    }
    function renderPreview(preview) {
      const panel = byId('sync-first-sync'); if (!panel) return;
      panel.hidden = !preview?.ok;
      setText(byId('sync-first-sync-summary'), preview?.ok ? `本机 ${preview.local?.totalRecords || 0} 条 / ${formatBytes(preview.local?.totalBytes)}，服务器 ${Object.values(preview.remote || {}).reduce((sum, row) => sum + (Number(row?.records) || 0), 0)} 条 / ${formatBytes(Object.values(preview.remote || {}).reduce((sum, row) => sum + (Number(row?.bytes) || 0), 0))}` : '');
      const impact = byId('sync-first-sync-impact');
      if (impact) {
        impact.replaceChildren();
        for (const [category, enabled] of Object.entries(preview?.categories || {})) {
          if (!enabled) continue;
          const row = documentRef.createElement('div');
          const label = documentRef.createElement('strong'); label.textContent = CATEGORY_LABELS[category] || category;
          const risk = documentRef.createElement('small'); risk.textContent = CATEGORY_RISK[category] || '普通';
          const local = preview.local?.categories?.[category] || {};
          const remote = preview.remote?.[category] || {};
          const counts = documentRef.createElement('span'); counts.textContent = `本机 ${Number(local.records) || 0} 条 / ${formatBytes(local.bytes)} · 服务器 ${Number(remote.records) || 0} 条 / ${formatBytes(remote.bytes)}`;
          row.append(label, risk, counts); impact.append(row);
        }
      }
      const mode = byId('sync-first-sync-mode'); if (mode && preview?.recommended) mode.value = preview.recommended;
      if (preview?.planId) panel.dataset.planId = preview.planId;
    }
    function renderConflicts(result = {}) {
      const list = byId('sync-conflict-list'); if (!list) return;
      list.replaceChildren();
      for (const conflict of result.items || []) {
        const row = documentRef.createElement('div'); row.className = 'sync-conflict-row'; row.tabIndex = 0;
        const detail = documentRef.createElement('div'); detail.className = 'sync-conflict-detail';
        const title = conflict.currentPayload?.title || conflict.incomingPayload?.title || conflict.currentPayload?.text || conflict.incomingPayload?.text || conflict.entityId || '';
        const heading = documentRef.createElement('strong'); heading.textContent = `${conflict.entityType || '数据'} · ${title}`;
        const sources = [conflict.currentOriginClientId, conflict.incomingOriginClientId].filter(Boolean).map((value) => String(value).slice(0, 12)).join(' / ');
        const fields = Array.isArray(conflict.changedFields) && conflict.changedFields.length ? conflict.changedFields.join('、') : '整条记录';
        const meta = documentRef.createElement('small'); meta.textContent = `${formatTime(conflict.createdAt)} · 来源 ${sources || '待同步'} · 差异 ${fields}`;
        detail.append(heading, meta);
        const actions = documentRef.createElement('div'); actions.className = 'sync-conflict-actions';
        const local = documentRef.createElement('button'); local.type = 'button'; local.dataset.syncConflict = conflict.conflictId; local.dataset.decision = 'local'; local.textContent = '保留本机';
        const remote = documentRef.createElement('button'); remote.type = 'button'; remote.dataset.syncConflict = conflict.conflictId; remote.dataset.decision = 'remote'; remote.textContent = '保留服务器';
        const manual = documentRef.createElement('button'); manual.type = 'button'; manual.dataset.syncConflict = conflict.conflictId; manual.dataset.decision = 'manual'; manual.textContent = '手动合并';
        const complete = Boolean(conflict.currentPayload && conflict.incomingPayload); local.disabled = !complete; remote.disabled = !complete; manual.disabled = !complete;
        actions.append(local, remote, manual); row.append(detail, actions); list.append(row);
      }
      list.hidden = !(result.items || []).length;
    }
    return Object.freeze({ render, renderPreview, renderConflicts, CATEGORY_LABELS, STATE_LABELS });
  }
  const exported = Object.freeze({ createView, CATEGORY_LABELS, STATE_LABELS });
  root.NotchSyncView = exported;
  if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window);
