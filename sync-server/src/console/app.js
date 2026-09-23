(() => {
  'use strict';

  const API_BASE = '/api/v1';
  const state = {
    account: null,
    csrfToken: '',
    recentAuthUntil: null,
    spaces: [],
    currentSpace: null,
    oneTimeKey: null,
    auditCursor: null,
    exportJobs: new Map(),
    lastFocused: null,
  };

  const loginView = document.querySelector('#login-view');
  const shell = document.querySelector('#console-shell');
  const viewRoot = document.querySelector('#view-root');
  const pageError = document.querySelector('#page-error');
  const pageStatus = document.querySelector('#page-status');
  const liveRegion = document.querySelector('#live-region');
  const dialog = document.querySelector('#action-dialog');
  const dialogForm = document.querySelector('#dialog-form');
  const dialogTitle = document.querySelector('#dialog-title');
  const dialogDescription = document.querySelector('#dialog-description');
  const dialogBody = document.querySelector('#dialog-body');
  const dialogActions = document.querySelector('#dialog-actions');
  const dialogError = document.querySelector('#dialog-error');

  const statusLabels = {
    active: '正常', inactive: '已停用', deleting: '待清除', revoked: '已吊销',
    bound: '已绑定', unbound: '未绑定', queued: '排队中', running: '处理中',
    verifying: '校验中', verified: '已验证', failed: '失败', unresolved: '待处理',
    resolved: '已解决', success: '成功', denied: '已拒绝', error: '错误',
  };

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([name, value]) => {
        if (value !== null && value !== undefined) node.setAttribute(name, String(value));
      });
    }
    if (options.on) {
      Object.entries(options.on).forEach(([event, handler]) => node.addEventListener(event, handler));
    }
    const list = Array.isArray(children) ? children : [children];
    list.filter(Boolean).forEach((child) => node.append(child));
    return node;
  }

  function button(text, onClick, className = 'button', attrs = {}) {
    return el('button', { className, text, attrs: { type: 'button', ...attrs }, on: { click: onClick } });
  }

  function routeLink(text, href, className = '') {
    return el('a', { className, text, attrs: { href, 'data-route': '' } });
  }

  function field(labelText, name, options = {}) {
    const id = `field-${name}`;
    const input = el(options.tag || 'input', {
      attrs: {
        id,
        name,
        type: options.type || (options.tag ? null : 'text'),
        autocomplete: options.autocomplete || null,
        required: options.required ? '' : null,
        minlength: options.minlength || null,
        maxlength: options.maxlength || null,
        value: options.value || null,
        placeholder: options.placeholder || null,
      },
    });
    return { wrapper: el('div', { className: 'field' }, [el('label', { text: labelText, attrs: { for: id } }), input]), input };
  }

  function unwrap(payload) {
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  }

  function safeMessage(error) {
    const known = {
      authentication_failed: '用户名或密码不正确，请稍后重试。',
      session_expired: '会话已过期，请重新登录。',
      recent_auth_required: '请先验证当前密码。',
      csrf_failed: '页面安全令牌已过期，请刷新后重试。',
      space_limit_reached: '已达到 10 个活动空间的上限。',
      client_limit_reached: '已达到此空间 10 个活动客户端的上限。',
      name_conflict: '此名称已在当前账户中使用。',
      resource_not_found: '找不到该资源，或你无权访问。',
      rate_limited: '尝试次数过多，请按提示稍后重试。',
      invalid_request: '请检查填写内容后重试。',
      job_not_ready: '导出仍在处理中。',
      storage_unavailable: '服务器存储暂不可用，请稍后重试。',
    };
    return known[error.code] || '操作未完成，请重试。';
  }

  class ApiError extends Error {
    constructor(status, payload, retryAfter) {
      super('API request failed');
      this.status = status;
      this.code = payload?.error?.code || 'unknown_error';
      this.retryable = Boolean(payload?.error?.retryable);
      this.details = payload?.error?.details || {};
      this.retryAfter = retryAfter;
      this.requestId = payload?.requestId || '';
    }
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD'].includes(method) && state.csrfToken) headers.set('X-CSRF-Token', state.csrfToken);
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let payload = null;
    if (response.status !== 204) {
      try { payload = await response.json(); } catch { payload = null; }
    }
    if (!response.ok) {
      throw new ApiError(response.status, payload, response.headers.get('Retry-After'));
    }
    return payload;
  }

  function announce(message) {
    liveRegion.textContent = '';
    window.requestAnimationFrame(() => { liveRegion.textContent = message; });
  }

  function showPageMessage(message, error = false) {
    const target = error ? pageError : pageStatus;
    const other = error ? pageStatus : pageError;
    other.hidden = true;
    target.textContent = message;
    target.hidden = false;
    announce(message);
  }

  function clearMessages() {
    pageError.hidden = true;
    pageStatus.hidden = true;
    pageError.textContent = '';
    pageStatus.textContent = '';
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return '未知';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = bytes;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  function prefix(value, length = 10) {
    if (!value) return '—';
    const text = String(value);
    return text.length > length ? `${text.slice(0, length)}…` : text;
  }

  function statusBadge(value) {
    const label = statusLabels[value] || value || '未知';
    const kind = ['active', 'bound', 'verified', 'success', 'resolved'].includes(value)
      ? ' success' : ['deleting', 'queued', 'running', 'verifying', 'unresolved'].includes(value)
        ? ' warning' : ['revoked', 'failed', 'denied', 'error'].includes(value) ? ' danger' : '';
    return el('span', { className: `status-badge${kind}`, text: label });
  }

  function pageHeader(title, description, action) {
    const text = el('div', { className: 'page-header-text' }, [el('h1', { text: title }), description ? el('p', { className: 'muted', text: description }) : null]);
    return el('header', { className: 'page-header' }, [text, action]);
  }

  function summaryItem(label, value, child) {
    return el('div', { className: 'summary-item' }, [el('span', { className: 'muted', text: label }), el('strong', { text: value }), child]);
  }

  function limitProgress(value, max, label) {
    return el('progress', { attrs: { value, max, 'aria-label': label } });
  }

  function table(headers, rows) {
    const head = el('thead', {}, el('tr', {}, headers.map((header) => el('th', { text: header, attrs: { scope: 'col' } }))));
    const body = el('tbody');
    rows.forEach((cells) => {
      const row = el('tr');
      cells.forEach((cell, index) => {
        const contents = cell instanceof Node ? cell : document.createTextNode(String(cell ?? '—'));
        row.append(el('td', { className: index === cells.length - 1 && contents.classList?.contains('row-actions') ? 'actions' : '', attrs: { 'data-label': headers[index] } }, contents));
      });
      body.append(row);
    });
    return el('div', { className: 'table-wrap' }, el('table', {}, [head, body]));
  }

  function emptyState(message) {
    return el('p', { className: 'empty-state', text: message });
  }

  function setBusy(busy) {
    viewRoot.setAttribute('aria-busy', String(busy));
  }

  function setAuthenticated(authenticated) {
    loginView.hidden = authenticated;
    shell.hidden = !authenticated;
    if (authenticated) document.querySelector('#account-name').textContent = state.account?.displayName || state.account?.username || '账户';
  }

  function updateNavigation(section) {
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.dataset.nav === section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function closeMobileNav() {
    const sidebar = document.querySelector('#sidebar');
    sidebar.classList.remove('open');
    document.querySelector('#nav-scrim').hidden = true;
    document.querySelector('#nav-toggle').setAttribute('aria-expanded', 'false');
  }

  function spaceTabs(spaceId, current) {
    const tabs = el('nav', { className: 'space-tabs', attrs: { 'aria-label': '空间导航' } });
    [['overview', '概览'], ['clients', '客户端'], ['conflicts', '冲突'], ['export', '导出']].forEach(([route, label]) => {
      const link = routeLink(label, `/console/spaces/${encodeURIComponent(spaceId)}/${route}`);
      if (route === current) link.setAttribute('aria-current', 'page');
      tabs.append(link);
    });
    return tabs;
  }

  function getFocusable(container) {
    return Array.from(container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
  }

  function resetDialog() {
    dialogTitle.textContent = '';
    dialogDescription.textContent = '';
    dialogBody.replaceChildren();
    dialogActions.replaceChildren();
    dialogError.hidden = true;
    dialogError.textContent = '';
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    state.oneTimeKey = null;
    resetDialog();
    if (state.lastFocused?.isConnected) state.lastFocused.focus();
  }

  function openDialog(config) {
    resetDialog();
    state.lastFocused = document.activeElement;
    dialogTitle.textContent = config.title;
    dialogDescription.textContent = config.description || '';
    (config.content || []).forEach((node) => dialogBody.append(node));
    const cancel = button(config.cancelText || '取消', closeDialog, 'button', { 'data-dialog-cancel': '' });
    const submit = button(config.submitText || '确认', async () => {
      dialogError.hidden = true;
      submit.disabled = true;
      try {
        await config.onSubmit?.();
      } catch (error) {
        dialogError.textContent = safeMessage(error);
        dialogError.hidden = false;
        submit.disabled = false;
        const invalid = dialogBody.querySelector(':invalid');
        invalid?.focus();
      }
    }, config.danger ? 'button danger' : 'button primary', { 'data-dialog-submit': '', type: 'submit' });
    dialogActions.append(cancel, submit);
    dialog.showModal();
    window.requestAnimationFrame(() => (config.danger ? cancel : (dialogBody.querySelector('input, select, textarea') || submit)).focus());
  }

  async function ensureRecentAuth(action) {
    const now = Date.now();
    if (state.recentAuthUntil && new Date(state.recentAuthUntil).getTime() > now + 1000) return action();
    const password = field('当前密码', 'reauth-password', { type: 'password', autocomplete: 'current-password', required: true });
    openDialog({
      title: '验证当前密码',
      description: '此操作影响账户或客户端安全。验证成功后将继续刚才的操作。',
      content: [password.wrapper],
      submitText: '验证并继续',
      onSubmit: async () => {
        const enteredPassword = password.input.value;
        password.input.value = '';
        const result = unwrap(await api('/account/reauthenticate', { method: 'POST', body: { password: enteredPassword } }));
        state.recentAuthUntil = result?.recentAuthUntil;
        closeDialog();
        await action();
      },
    });
  }

  function showOneTimeKey(data, reason) {
    state.oneTimeKey = data.clientKey;
    const output = el('output', { className: 'mono', text: state.oneTimeKey, attrs: { 'aria-label': '一次性客户端 Key' } });
    const saved = el('input', { attrs: { id: 'key-saved', type: 'checkbox' } });
    const done = button('完成', () => {
      if (!saved.checked) return;
      state.oneTimeKey = null;
      output.textContent = '';
      closeDialog();
      announce('一次性 Key 已从页面清除');
      renderRoute();
    }, 'button primary');
    done.disabled = true;
    saved.addEventListener('change', () => { done.disabled = !saved.checked; });
    resetDialog();
    state.lastFocused = document.activeElement;
    dialogTitle.textContent = '保存一次性 Key';
    dialogDescription.textContent = `${reason}。关闭后无法再次查看，请保存到目标设备。`;
    dialogBody.append(el('div', { className: 'key-panel' }, [
      el('p', { text: `${data.spaceName || state.currentSpace?.name || '当前空间'} · ${data.name || data.clientName || '客户端'} (${data.shortId || data.clientShortId || '—'})` }),
      el('div', { className: 'key-value' }, [output, button('复制', async () => {
        try { await navigator.clipboard.writeText(state.oneTimeKey || ''); announce('一次性 Key 已复制'); }
        catch { announce('复制失败，请手动选择 Key'); }
      }, 'button', { 'aria-label': '复制一次性客户端 Key' })]),
      el('div', { className: 'message message-warning', text: '此 Key 仅显示一次，页面不会保存副本。' }),
      el('div', { className: 'checkbox-row' }, [saved, el('label', { text: '我已保存此 Key', attrs: { for: 'key-saved' } })]),
    ]));
    dialogActions.append(done);
    dialog.showModal();
    output.focus?.();
  }

  async function loadSession() {
    try {
      const session = unwrap(await api('/account/session'));
      state.account = session.account;
      state.csrfToken = session.csrfToken;
      state.recentAuthUntil = session.recentAuthUntil;
      setAuthenticated(true);
      await renderRoute();
    } catch (error) {
      if (error.status !== 401) document.querySelector('#login-error').textContent = '无法连接服务器，请稍后重试。';
      setAuthenticated(false);
      document.querySelector('#login-username').focus();
    }
  }

  async function loadSpaces() {
    const result = unwrap(await api('/spaces'));
    state.spaces = Array.isArray(result) ? result : result?.spaces || [];
    return { spaces: state.spaces, activeCount: result?.activeCount ?? state.spaces.filter((item) => item.status === 'active').length, activeLimit: result?.activeLimit ?? 10 };
  }

  async function loadSpace(spaceId) {
    const data = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}`));
    state.currentSpace = data;
    return data;
  }

  async function renderRoute() {
    if (!state.account) return;
    state.oneTimeKey = null;
    clearMessages();
    closeMobileNav();
    setBusy(true);
    viewRoot.replaceChildren();
    const path = window.location.pathname.replace(/\/+$/, '') || '/console/spaces';
    try {
      const spaceMatch = path.match(/^\/console\/spaces\/([^/]+)\/(overview|clients|conflicts|export)$/);
      if (spaceMatch) {
        updateNavigation('spaces');
        await renderSpace(decodeURIComponent(spaceMatch[1]), spaceMatch[2]);
      } else if (path === '/console/usage') {
        updateNavigation('usage'); await renderUsage();
      } else if (path === '/console/audit') {
        updateNavigation('audit'); await renderAudit();
      } else if (path === '/console/security') {
        updateNavigation('security'); await renderSecurity();
      } else {
        if (path !== '/console/spaces') window.history.replaceState({}, '', '/console/spaces');
        updateNavigation('spaces'); await renderSpaces();
      }
    } catch (error) {
      if (error.status === 401) {
        state.account = null; state.csrfToken = ''; setAuthenticated(false); return;
      }
      showPageMessage(safeMessage(error), true);
    } finally {
      setBusy(false);
      document.querySelector('#main-content').focus();
    }
  }

  async function renderSpaces() {
    const result = await loadSpaces();
    const create = button('新建空间', showCreateSpace, 'button primary');
    viewRoot.append(pageHeader(`空间 ${result.activeCount} / ${result.activeLimit}`, '活动空间使用结构上限；停用或待清除空间仍会列出。', create));
    viewRoot.append(el('div', { className: 'summary-strip' }, [summaryItem('活动空间', `${result.activeCount} / ${result.activeLimit}`, limitProgress(result.activeCount, result.activeLimit, '活动空间上限使用量'))]));
    const search = field('搜索空间', 'space-search', { placeholder: '按名称筛选' });
    const list = el('div');
    const renderRows = () => {
      const needle = search.input.value.trim().toLocaleLowerCase();
      const spaces = result.spaces.filter((space) => String(space.name || '').toLocaleLowerCase().includes(needle));
      if (!spaces.length) { list.replaceChildren(emptyState(needle ? '没有匹配的空间。' : '尚未创建空间。')); return; }
      list.replaceChildren(table(['名称', '状态', '客户端', '记录', '对象', '冲突', '最近活动', '操作'], spaces.map((space) => {
        const actions = el('div', { className: 'row-actions' }, [
          routeLink('打开', `/console/spaces/${encodeURIComponent(space.spaceId || space.id)}/overview`, 'button'),
          button('重命名', () => showRenameSpace(space)),
          space.status === 'inactive' ? button('启用', () => updateSpace(space, { status: 'active' })) : button('停用', () => updateSpace(space, { status: 'inactive' })),
        ]);
        return [el('div', {}, [el('strong', { text: space.name }), el('div', { className: 'mono muted', text: prefix(space.spaceId || space.id) })]), statusBadge(space.status), `${space.activeClients ?? space.clientCount ?? 0} / 10`, space.recordCount ?? 0, formatBytes(space.objectBytes), space.conflictCount ?? 0, formatDate(space.lastActivityAt || space.updatedAt), actions];
      })));
    };
    search.input.addEventListener('input', renderRows);
    viewRoot.append(el('div', { className: 'toolbar' }, search.wrapper), list);
    renderRows();
  }

  function showCreateSpace() {
    const name = field('空间名称', 'space-name', { required: true, maxlength: 100 });
    openDialog({ title: '新建空间', description: '每个账户最多 10 个活动空间。', content: [name.wrapper], submitText: '创建', onSubmit: async () => {
      await api('/spaces', { method: 'POST', body: { name: name.input.value.trim() } });
      closeDialog(); showPageMessage('空间已创建。'); await renderRoute();
    } });
  }

  function showRenameSpace(space) {
    const name = field('空间名称', 'space-name', { required: true, maxlength: 100, value: space.name });
    openDialog({ title: '重命名空间', description: `空间 ID ${prefix(space.spaceId || space.id)}`, content: [name.wrapper], submitText: '保存', onSubmit: async () => {
      await api(`/spaces/${encodeURIComponent(space.spaceId || space.id)}`, { method: 'PATCH', body: { name: name.input.value.trim() } });
      closeDialog(); showPageMessage('空间名称已更新。'); await renderRoute();
    } });
  }

  async function updateSpace(space, changes) {
    try {
      await api(`/spaces/${encodeURIComponent(space.spaceId || space.id)}`, { method: 'PATCH', body: changes });
      showPageMessage(changes.status === 'active' ? '空间已启用。' : '空间已停用。'); await renderRoute();
    } catch (error) { showPageMessage(safeMessage(error), true); }
  }

  async function renderSpace(spaceId, section) {
    const space = await loadSpace(spaceId);
    viewRoot.append(pageHeader(space.name || '空间', `空间 ID ${prefix(space.spaceId || space.id)} · 恢复代次 ${prefix(space.restoreEpoch)}`));
    viewRoot.append(spaceTabs(spaceId, section));
    if (section === 'clients') await renderClients(spaceId, space);
    else if (section === 'conflicts') await renderConflicts(spaceId);
    else if (section === 'export') await renderExport(spaceId, space);
    else renderOverview(spaceId, space);
  }

  function renderOverview(spaceId, space) {
    const usage = space.usage || space;
    viewRoot.append(el('div', { className: 'summary-strip' }, [
      summaryItem('状态', statusLabels[space.status] || space.status || '未知', statusBadge(space.status)),
      summaryItem('记录', usage.recordCount ?? 0),
      summaryItem('对象', `${usage.objectCount ?? 0} · ${formatBytes(usage.objectBytes)}`),
      summaryItem('未解决冲突', space.conflictCount ?? usage.conflictCount ?? 0),
      summaryItem('同步游标年龄', space.cursorAgeSeconds == null ? '未知' : `${space.cursorAgeSeconds} 秒`),
    ]));
    const details = el('dl', { className: 'definition-grid' });
    const entries = [
      ['活动客户端', `${space.activeClientCount ?? 0} / 10`],
      ['不完整上传', usage.incompleteUploads ?? 0],
      ['引用字节', formatBytes(usage.referencedBytes ?? usage.objectBytes)],
      ['观测时间', formatDate(usage.observedAt)],
      ['已见分类', (space.categories || []).map((item) => typeof item === 'string' ? item : item.name).join('、') || '—'],
    ];
    entries.forEach(([term, value]) => details.append(el('div', {}, [el('dt', { text: term }), el('dd', { text: value })])));
    viewRoot.append(details);
    const danger = el('section', { className: 'section', attrs: { 'aria-labelledby': 'space-actions-title' } }, [
      el('div', { className: 'section-header' }, el('h2', { text: '空间操作', attrs: { id: 'space-actions-title' } })),
      el('div', { className: 'toolbar' }, [
        button('删除空间', () => showDeleteSpace(spaceId, space), 'button danger'),
        space.status === 'deleting' ? button('恢复空间', async () => {
          try { await api(`/spaces/${encodeURIComponent(spaceId)}/restore`, { method: 'POST', body: {} }); showPageMessage('空间已恢复。'); await renderRoute(); }
          catch (error) { showPageMessage(safeMessage(error), true); }
        }) : null,
      ]),
    ]);
    viewRoot.append(danger);
  }

  async function showDeleteSpace(spaceId, space) {
    try {
      const impact = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}/deletion-impact`));
      const confirmation = field('输入空间名称确认', 'confirmation-name', { required: true, autocomplete: 'off' });
      const clients = (impact.activeClients || []).map((item) => item.name || item).join('、') || '无';
      openDialog({
        title: '删除空间', danger: true, submitText: '删除空间',
        description: '空间将进入可恢复的待清除状态。此操作会中断客户端同步。',
        content: [
          el('dl', { className: 'definition-grid' }, [
            el('div', {}, [el('dt', { text: '记录' }), el('dd', { text: impact.recordCount ?? 0 })]),
            el('div', {}, [el('dt', { text: '对象' }), el('dd', { text: formatBytes(impact.objectBytes) })]),
            el('div', {}, [el('dt', { text: '活动客户端' }), el('dd', { text: clients })]),
            el('div', {}, [el('dt', { text: '可恢复至' }), el('dd', { text: formatDate(impact.recoverableUntil) })]),
          ]),
          confirmation.wrapper,
        ],
        onSubmit: async () => {
          if (confirmation.input.value.trim() !== space.name) throw new ApiError(400, { error: { code: 'invalid_request' } });
          closeDialog();
          await ensureRecentAuth(async () => {
            await api(`/spaces/${encodeURIComponent(spaceId)}/delete`, { method: 'POST', body: { confirmationName: confirmation.input.value.trim() } });
            showPageMessage('空间已进入待清除状态。'); await renderRoute();
          });
        },
      });
    } catch (error) { showPageMessage(safeMessage(error), true); }
  }

  async function renderClients(spaceId) {
    const result = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}/clients`));
    const clients = Array.isArray(result) ? result : result.clients || [];
    const activeCount = result.activeCount ?? clients.filter((item) => item.status === 'active').length;
    const activeLimit = result.activeLimit ?? 10;
    viewRoot.append(pageHeader(`客户端 ${activeCount} / ${activeLimit}`, '每个设备使用独立 Key；客户端不能移到其他空间。', button('新建客户端', () => showCreateClient(spaceId), 'button primary')));
    viewRoot.append(el('div', { className: 'summary-strip' }, [summaryItem('活动客户端', `${activeCount} / ${activeLimit}`, limitProgress(activeCount, activeLimit, '活动客户端上限使用量'))]));
    if (!clients.length) { viewRoot.append(emptyState('此空间尚无客户端。')); return; }
    viewRoot.append(table(['客户端', '平台 / 版本', 'Key', '安装绑定', '创建 / 首次连接', '最后活动', '状态', '操作'], clients.map((client) => {
      const clientId = client.clientId || client.id;
      const actions = el('div', { className: 'row-actions' }, [
        button('重命名', () => showRenameClient(spaceId, client)),
        button('轮换 Key', () => showRotateClient(spaceId, client)),
        button('重置安装', () => showResetClient(spaceId, client)),
        button('吊销', () => showRevokeClient(spaceId, client), 'button danger'),
      ]);
      return [el('div', {}, [el('strong', { text: client.name }), el('div', { className: 'mono muted', text: client.shortId || prefix(clientId) })]), `${client.platform || '未知'} / ${client.appVersion || '未知'}`, statusBadge(client.keyStatus), statusBadge(client.binding?.status), `${formatDate(client.createdAt)} / ${formatDate(client.binding?.firstConnectedAt)}`, formatDate(client.lastSeenAt), statusBadge(client.status), actions];
    })));
  }

  function showCreateClient(spaceId) {
    const name = field('客户端名称', 'client-name', { required: true, maxlength: 100 });
    openDialog({ title: '新建客户端', description: '只需填写显示名称。创建后 Key 仅显示一次。', content: [name.wrapper], submitText: '创建客户端', onSubmit: async () => {
      const data = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}/clients`, { method: 'POST', body: { name: name.input.value.trim() } }));
      showOneTimeKey(data, '客户端已创建');
    } });
  }

  function showRenameClient(spaceId, client) {
    const name = field('客户端名称', 'client-name', { required: true, maxlength: 100, value: client.name });
    openDialog({ title: '重命名客户端', description: `短 ID ${client.shortId || prefix(client.clientId)}`, content: [name.wrapper], submitText: '保存', onSubmit: async () => {
      await api(`/spaces/${encodeURIComponent(spaceId)}/clients/${encodeURIComponent(client.clientId || client.id)}`, { method: 'PATCH', body: { name: name.input.value.trim() } });
      closeDialog(); showPageMessage('客户端名称已更新。'); await renderRoute();
    } });
  }

  function showRotateClient(spaceId, client) {
    const select = el('select', { attrs: { id: 'rotation-overlap', name: 'overlapSeconds' } }, [
      el('option', { text: '立即停用旧 Key', attrs: { value: '0' } }),
      el('option', { text: '重叠 1 小时', attrs: { value: '3600' } }),
      el('option', { text: '重叠 8 小时', attrs: { value: '28800' } }),
      el('option', { text: '重叠 24 小时', attrs: { value: '86400' } }),
    ]);
    openDialog({ title: '轮换客户端 Key', description: '新 Key 只显示一次。重叠期最长 24 小时。', content: [el('div', { className: 'field' }, [el('label', { text: '旧 Key 有效期', attrs: { for: 'rotation-overlap' } }), select])], submitText: '继续', onSubmit: async () => {
      const overlapSeconds = Number(select.value);
      closeDialog(); await ensureRecentAuth(async () => {
        const data = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}/clients/${encodeURIComponent(client.clientId || client.id)}/rotate-key`, { method: 'POST', body: { overlapSeconds } }));
        showOneTimeKey(data, overlapSeconds ? 'Key 已轮换，旧 Key 将在重叠期后失效' : 'Key 已轮换，旧 Key 已失效');
      });
    } });
  }

  function showRevokeClient(spaceId, client) {
    openDialog({ title: '吊销客户端', danger: true, description: '此客户端的 Key 和实时连接将失效。本地数据不会删除，其他客户端继续运行。', submitText: '吊销客户端', onSubmit: async () => {
      closeDialog(); await ensureRecentAuth(async () => {
        await api(`/spaces/${encodeURIComponent(spaceId)}/clients/${encodeURIComponent(client.clientId || client.id)}/revoke`, { method: 'POST', body: {} });
        showPageMessage('客户端已吊销。'); await renderRoute();
      });
    } });
  }

  function showResetClient(spaceId, client) {
    openDialog({ title: '重置安装绑定', danger: true, description: '旧 Key 与实时连接会立即失效，安装绑定将清除；客户端 ID 和历史来源保持不变。', submitText: '重置并生成 Key', onSubmit: async () => {
      closeDialog(); await ensureRecentAuth(async () => {
        const data = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}/clients/${encodeURIComponent(client.clientId || client.id)}/reset-installation`, { method: 'POST', body: {} }));
        showOneTimeKey(data, '安装绑定已重置');
      });
    } });
  }

  async function renderConflicts(spaceId) {
    const result = await api(`/spaces/${encodeURIComponent(spaceId)}/conflicts?status=unresolved`);
    const conflicts = unwrap(result) || [];
    viewRoot.append(pageHeader('冲突', '解决操作会创建正常的新版本；过期选择会刷新双方内容。'));
    if (!conflicts.length) { viewRoot.append(emptyState('没有未解决冲突。')); return; }
    viewRoot.append(table(['项目', '来源', '变更字段', '发生时间', '状态', '操作'], conflicts.map((conflict) => {
      const actions = el('div', { className: 'row-actions' }, [button('查看并解决', () => showResolveConflict(spaceId, conflict), 'button primary')]);
      const sources = [conflict.currentOriginClientId, conflict.incomingOriginClientId].filter(Boolean).map(prefix).join(' / ');
      return [`${conflict.entityType || '记录'} · ${conflict.title || prefix(conflict.entityId)}`, sources || '未知', (conflict.changedFields || []).join('、') || '内容', formatDate(conflict.createdAt || conflict.occurredAt), statusBadge(conflict.status || 'unresolved'), actions];
    })));
  }

  function showResolveConflict(spaceId, conflict) {
    const choice = el('select', { attrs: { id: 'conflict-resolution', name: 'resolution' } }, [
      el('option', { text: '保留当前版本', attrs: { value: 'current' } }),
      el('option', { text: '使用传入版本', attrs: { value: 'incoming' } }),
      el('option', { text: '手动合并', attrs: { value: 'manual' } }),
    ]);
    const manual = field('手动合并内容', 'manual-payload', { tag: 'textarea' });
    manual.wrapper.hidden = true;
    choice.addEventListener('change', () => { manual.wrapper.hidden = choice.value !== 'manual'; });
    const compared = el('dl', { className: 'definition-grid' }, [
      el('div', {}, [el('dt', { text: '当前值' }), el('dd', { className: 'mono', text: JSON.stringify(conflict.currentPayload ?? {}, null, 2) })]),
      el('div', {}, [el('dt', { text: '传入值' }), el('dd', { className: 'mono', text: JSON.stringify(conflict.incomingPayload ?? {}, null, 2) })]),
    ]);
    openDialog({ title: '解决冲突', description: `${conflict.entityType || '记录'} ${prefix(conflict.entityId)} · 基础版本 ${conflict.baseRevision ?? '—'}`, content: [compared, el('div', { className: 'field' }, [el('label', { text: '解决方式', attrs: { for: 'conflict-resolution' } }), choice]), manual.wrapper], submitText: '提交解决结果', onSubmit: async () => {
      let payload;
      if (choice.value === 'manual') {
        try { payload = JSON.parse(manual.input.value); } catch { throw new ApiError(400, { error: { code: 'invalid_request' } }); }
      }
      await api(`/spaces/${encodeURIComponent(spaceId)}/conflicts/${encodeURIComponent(conflict.conflictId || conflict.id)}/resolve`, { method: 'POST', body: { resolution: choice.value, payload, baseRevision: conflict.currentRevision } });
      closeDialog(); showPageMessage('冲突已解决并创建新版本。'); await renderRoute();
    } });
  }

  async function renderUsage() {
    const usage = unwrap(await api('/usage'));
    viewRoot.append(pageHeader('用量', '这是存储观察值，无业务容量配额。字节数与图片数量不会触发配额拒绝。'));
    const aggregate = usage.account || usage.aggregate || usage;
    viewRoot.append(el('div', { className: 'summary-strip' }, [
      summaryItem('记录', aggregate.recordCount ?? 0), summaryItem('对象', aggregate.objectCount ?? 0),
      summaryItem('引用字节', formatBytes(aggregate.referencedBytes ?? aggregate.objectBytes)), summaryItem('不完整上传', aggregate.incompleteUploads ?? 0),
      summaryItem('观测时间', formatDate(aggregate.observedAt)),
    ]));
    const spaces = usage.spaces || usage.breakdown || [];
    viewRoot.append(spaces.length ? table(['空间', '记录', '对象', '引用字节', '不完整上传', '观测时间'], spaces.map((item) => [item.name || prefix(item.spaceId), item.recordCount ?? 0, item.objectCount ?? 0, formatBytes(item.referencedBytes ?? item.objectBytes), item.incompleteUploads ?? 0, formatDate(item.observedAt)])) : emptyState('尚无空间用量数据。'));
  }

  async function renderAudit() {
    viewRoot.append(pageHeader('审计', '事件只显示动作、结果和 ID 前缀，不包含业务正文、凭据或本地路径。'));
    const space = field('空间 ID', 'audit-space', { placeholder: '可选' });
    const action = field('动作', 'audit-action', { placeholder: '可选' });
    const resultSelect = el('select', { attrs: { id: 'audit-result' } }, [el('option', { text: '全部结果', attrs: { value: '' } }), el('option', { text: '成功', attrs: { value: 'success' } }), el('option', { text: '失败', attrs: { value: 'error' } })]);
    const resultField = el('div', { className: 'field' }, [el('label', { text: '结果', attrs: { for: 'audit-result' } }), resultSelect]);
    const list = el('div');
    let nextCursor = null;
    const load = async (cursor = '') => {
      const query = new URLSearchParams();
      if (space.input.value.trim()) query.set('spaceId', space.input.value.trim());
      if (action.input.value.trim()) query.set('action', action.input.value.trim());
      if (resultSelect.value) query.set('result', resultSelect.value);
      if (cursor) query.set('after', cursor);
      const response = await api(`/audit?${query.toString()}`);
      const events = unwrap(response) || [];
      nextCursor = response?.page?.next || null;
      list.replaceChildren(events.length ? table(['时间', '参与者', '动作', '目标', '空间', '结果', '请求 ID'], events.map((event) => [formatDate(event.occurredAt), `${event.actorType || '—'} · ${prefix(event.actorId)}`, event.action || '—', `${event.targetType || '—'} · ${event.targetIdPrefix || '—'}`, prefix(event.spaceId), statusBadge(event.result), prefix(event.requestId)])) : emptyState('没有匹配的审计事件。'));
      const pagination = el('nav', { className: 'pagination', attrs: { 'aria-label': '审计分页' } }, [button('下一页', () => load(nextCursor), 'button', { disabled: nextCursor ? null : '' })]);
      list.append(pagination);
    };
    const apply = button('应用筛选', () => load(), 'button primary');
    viewRoot.append(el('div', { className: 'toolbar' }, [space.wrapper, action.wrapper, resultField, apply]), list);
    await load();
  }

  async function renderSecurity() {
    const sessions = unwrap(await api('/account/sessions')) || [];
    viewRoot.append(pageHeader('安全', '更改密码、查看近期登录，并管理当前账户会话。'));
    const current = field('当前密码', 'current-password', { type: 'password', autocomplete: 'current-password', required: true });
    const next = field('新密码', 'new-password', { type: 'password', autocomplete: 'new-password', required: true, minlength: 12 });
    const confirm = field('确认新密码', 'confirm-password', { type: 'password', autocomplete: 'new-password', required: true, minlength: 12 });
    const passwordForm = el('form', { attrs: { id: 'password-form' }, on: { submit: async (event) => {
      event.preventDefault(); clearMessages();
      if (next.input.value !== confirm.input.value) { showPageMessage('两次输入的新密码不一致。', true); confirm.input.focus(); return; }
      try {
        await api('/account/password', { method: 'PUT', body: { currentPassword: current.input.value, newPassword: next.input.value } });
        current.input.value = ''; next.input.value = ''; confirm.input.value = ''; showPageMessage('密码已更新，其他会话已撤销。'); await renderRoute();
      } catch (error) { showPageMessage(safeMessage(error), true); }
    } } }, [current.wrapper, next.wrapper, confirm.wrapper, el('p', { className: 'muted', text: '新密码至少 12 个字符。' }), el('button', { className: 'button primary', text: '更改密码', attrs: { type: 'submit' } })]);
    viewRoot.append(el('section', { attrs: { 'aria-labelledby': 'password-title' } }, [el('div', { className: 'section-header' }, el('h2', { text: '更改密码', attrs: { id: 'password-title' } })), passwordForm]));
    const revoke = button('撤销其他会话', () => openDialog({ title: '撤销其他会话', danger: true, description: '除当前浏览器外，所有账户会话都将失效。', submitText: '撤销其他会话', onSubmit: async () => {
      closeDialog(); await ensureRecentAuth(async () => { await api('/account/sessions/others', { method: 'DELETE' }); showPageMessage('其他会话已撤销。'); await renderRoute(); });
    } }), 'button danger');
    const section = el('section', { className: 'section', attrs: { 'aria-labelledby': 'sessions-title' } }, [el('div', { className: 'section-header' }, [el('h2', { text: '近期登录与活动会话', attrs: { id: 'sessions-title' } }), revoke])]);
    section.append(sessions.length ? table(['创建时间', '最近活动', '网络', '客户端', '到期', '状态'], sessions.map((session) => [formatDate(session.createdAt), formatDate(session.lastSeenAt), session.network || session.coarseIp || '已隐去', session.userAgent || '未知', formatDate(session.expiresAt), session.current ? statusBadge('active') : (session.revokedAt ? statusBadge('revoked') : '其他会话')])) : emptyState('没有可显示的会话。'));
    viewRoot.append(section);
  }

  async function renderExport(spaceId, space) {
    const remembered = state.exportJobs.get(spaceId);
    const jobs = [...(space.exports || [])];
    if (remembered && !jobs.some((job) => (job.jobId || job.id) === (remembered.jobId || remembered.id))) jobs.unshift(remembered);
    viewRoot.append(pageHeader('导出', '导出包含记录、对象与校验信息，不包含密码、会话、Client Key 或服务端机密。', button('开始导出', () => showStartExport(spaceId, space), 'button primary')));
    if (!jobs.length) { viewRoot.append(emptyState('尚无导出任务。')); return; }
    viewRoot.append(table(['创建时间', '状态', '记录', '对象', '校验', '到期', '操作'], jobs.map((job) => {
      const verified = job.state === 'verified' || job.status === 'verified';
      const actions = el('div', { className: 'row-actions' }, verified ? [el('a', { className: 'button primary', text: '下载', attrs: { href: `${API_BASE}/exports/${encodeURIComponent(job.jobId || job.id)}/download` } })] : [button('刷新状态', () => refreshExport(job.jobId || job.id))]);
      return [formatDate(job.createdAt), statusBadge(job.state || job.status), job.recordCount ?? '—', `${job.objectCount ?? '—'} · ${formatBytes(job.objectBytes)}`, job.checksum ? prefix(job.checksum, 18) : '等待验证', formatDate(job.expiresAt), actions];
    })));
  }

  function showStartExport(spaceId, space) {
    openDialog({ title: '导出空间', description: `${space.name} 的导出会生成不可变清单并校验记录、对象和校验和。只有验证完成后才能下载。`, content: [el('div', { className: 'message message-warning', text: '导出不包含密码、会话、Client Key、备份设置或全局审计。' })], submitText: '开始导出', onSubmit: async () => {
      closeDialog(); await ensureRecentAuth(async () => {
        const job = unwrap(await api(`/spaces/${encodeURIComponent(spaceId)}/exports`, { method: 'POST', body: {} }));
        state.exportJobs.set(spaceId, job);
        showPageMessage('导出任务已加入队列。');
        await renderRoute();
      });
    } });
  }

  async function refreshExport(jobId) {
    try {
      const job = unwrap(await api(`/exports/${encodeURIComponent(jobId)}`));
      if (state.currentSpace) state.exportJobs.set(state.currentSpace.spaceId || state.currentSpace.id, job);
      showPageMessage(`导出状态：${statusLabels[job.state || job.status] || job.state || job.status}`); await renderRoute();
    } catch (error) { showPageMessage(safeMessage(error), true); }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-route]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState({}, '', link.href);
    renderRoute();
  });

  document.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector('#login-error');
    const delayBox = document.querySelector('#login-delay');
    errorBox.hidden = true; delayBox.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/account/login', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
      form.password.value = '';
      await loadSession();
    } catch (error) {
      form.password.value = '';
      errorBox.textContent = safeMessage(error);
      errorBox.hidden = false;
      if (error.retryAfter) { delayBox.textContent = `${error.retryAfter} 秒后可重试。`; delayBox.hidden = false; }
      form.username.focus();
    } finally { submit.disabled = false; }
  });

  document.querySelector('#logout-button').addEventListener('click', async () => {
    try { await api('/account/session', { method: 'DELETE' }); } catch { /* local view still closes */ }
    state.account = null; state.csrfToken = ''; state.recentAuthUntil = null; state.oneTimeKey = null;
    window.history.replaceState({}, '', '/console/login');
    setAuthenticated(false);
    document.querySelector('#login-password').value = '';
    document.querySelector('#login-username').focus();
  });

  document.querySelector('#nav-toggle').addEventListener('click', () => {
    const sidebar = document.querySelector('#sidebar');
    const open = sidebar.classList.toggle('open');
    document.querySelector('#nav-scrim').hidden = !open;
    document.querySelector('#nav-toggle').setAttribute('aria-expanded', String(open));
  });
  document.querySelector('#nav-scrim').addEventListener('click', closeMobileNav);
  document.querySelector('#dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialogForm.addEventListener('submit', (event) => event.preventDefault());
  window.addEventListener('popstate', renderRoute);

  loadSession();
})();
