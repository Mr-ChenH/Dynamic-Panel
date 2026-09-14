(function initAIWorkspace() {
  const root = document.getElementById('ai-workspace');
  if (!root || !window.NotchAIDomain) return;
  const title = document.getElementById('ai-workspace-title');
  const sourceLabel = document.getElementById('ai-workspace-source');
  const meta = document.getElementById('ai-workspace-meta');
  const actionSelect = document.getElementById('ai-action-select');
  const languageLabel = document.getElementById('ai-language-label');
  const targetLanguage = document.getElementById('ai-target-language');
  const sourceText = document.getElementById('ai-source-text');
  const count = document.getElementById('ai-character-count');
  const resultPane = document.getElementById('ai-result-pane');
  const empty = document.getElementById('ai-empty-result');
  const textResult = document.getElementById('ai-text-result');
  const metadataResult = document.getElementById('ai-metadata-result');
  const metadataTitle = document.getElementById('ai-metadata-title');
  const metadataCategory = document.getElementById('ai-metadata-category');
  const todoResults = document.getElementById('ai-todo-results');
  const status = document.getElementById('ai-workspace-status');
  const generate = document.getElementById('ai-generate');
  const stop = document.getElementById('ai-stop');
  const copy = document.getElementById('ai-copy');
  const saveNote = document.getElementById('ai-save-note');
  const replaceSelection = document.getElementById('ai-replace-selection');
  const applyMetadata = document.getElementById('ai-apply-metadata');
  const applyTodos = document.getElementById('ai-apply-todos');
  const closeButtons = [document.getElementById('ai-workspace-back'), document.getElementById('ai-workspace-close')];
  let returnFocus = null;
  const actionNames = {
    summarize: '摘要文字', shorten: '精简文字', translate: '翻译文字',
    extractTodos: '从文字提取待办', organizeRecording: '整理录音',
    nameNote: '生成笔记标题', nameRecording: '生成录音名称', nameLink: '生成链接名称',
  };
  const errorMessages = {
    not_configured: '尚未配置内容整理服务，请前往“设置 → AI 与转写”。',
    input_too_long: '内容超过 12000 字符，请缩小整理范围。',
    timeout: '服务等待超时，原文已保留，可重新生成。',
    cancelled: '已停止生成，原文未变更。',
    authentication_failed: 'API Key 无效或没有访问权限。',
    rate_limited: '服务请求过于频繁，请稍后重试。',
    service_busy: '已有内容整理请求正在执行，请稍后重试。',
    model_not_found: '当前模型不可用，请检查模型名称。',
    invalid_endpoint: '服务地址不安全或不可用。',
    invalid_response: '服务返回的格式无法使用，请重试或更换模型。',
    invalid_evidence: '结果中的原文依据无法验证，未允许保存。',
    response_too_large: '服务返回内容过长，未允许保存。',
    stream_incomplete: '连接提前中断，结果不完整，未允许保存。',
    invalid_stream: '服务返回的数据流损坏，未允许保存。',
    output_truncated: '结果达到服务输出上限，内容不完整，未允许保存。',
    content_filtered: '结果被服务过滤，未允许保存。',
    unsupported_finish_reason: '服务未正常结束生成，未允许保存。',
    stale_context: '工作区或 AI 配置已经变化，请重新生成。',
    queue_expired: '自动请求等待过久，已取消。',
    too_many_todos: '服务返回超过 20 项待办，未允许保存。',
    network_error: '无法连接内容整理服务，原文已保留。',
  };
  let state = null;
  let requestSequence = 0;

  function categories() {
    const defaults = { P0: '学习与课程', P1: '内容与创作', P2: '产品与开发', P3: '生活与事务' };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('notch-todo-category-names-v1') || '{}') }; }
    catch (error) { return defaults; }
  }

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.className = kind;
  }

  function restoreRequestControls() {
    if (!state) return;
    generate.disabled = false;
    generate.hidden = false;
    stop.hidden = true;
    sourceText.readOnly = state.source.sourceType !== 'manual';
    actionSelect.disabled = state.source.sourceType === 'recording' || state.action.startsWith('name');
    targetLanguage.disabled = false;
  }

  async function withMutation(button, operation) {
    if (!state || state.mutating) return;
    const session = state;
    state.mutating = true;
    button.disabled = true;
    try { await operation(session); }
    finally {
      if (state !== session) return;
      state.mutating = false;
      if (button === applyTodos) updateApplyLabel();
      else button.disabled = false;
    }
  }

  function resetResult() {
    empty.hidden = false;
    const emptyTitle = empty.querySelector('strong');
    const emptyHint = empty.querySelector('span');
    if (emptyTitle) emptyTitle.textContent = '生成结果会显示在这里';
    if (emptyHint) emptyHint.textContent = '结果不会自动保存，你可以先检查和修改。';
    textResult.hidden = true;
    textResult.value = '';
    textResult.readOnly = false;
    metadataResult.hidden = true;
    metadataTitle.value = '';
    metadataCategory.value = '';
    applyMetadata.hidden = true;
    applyMetadata.disabled = false;
    applyMetadata.textContent = '采用名称';
    todoResults.hidden = true;
    todoResults.replaceChildren();
    resultPane.querySelectorAll('.ai-recording-section').forEach((section) => section.remove());
    copy.hidden = true;
    saveNote.hidden = true;
    saveNote.disabled = false;
    saveNote.textContent = '保存为笔记';
    replaceSelection.hidden = true;
    replaceSelection.textContent = '替换选区';
    replaceSelection.disabled = false;
    applyTodos.hidden = true;
    applyTodos.textContent = '加入待办';
  }

  function canonicalSourceText(value) {
    return String(value == null ? '' : value).trim();
  }

  function sourceStillCurrent() {
    if (!state) return false;
    if (state.source.sourceType === 'manual') return canonicalSourceText(sourceText.value) === state.source.text;
    const current = state.source.sourceType === 'note'
      ? window.NotchNotes?.context?.(state.source.sourceId)
      : state.source.sourceType === 'link'
        ? window.NotchWorkspace?.linkContext?.(state.source.sourceId)
        : window.NotchWorkspace?.recordingContext?.(state.source.sourceId);
    if (!current) return false;
    return window.NotchAIDomain.sourceRevision({ ...current, text: canonicalSourceText(current.text) }) === state.sourceRevision;
  }

  function updateCount() {
    const length = sourceText.value.length;
    count.textContent = `${length} / 12000 字符`;
    count.classList.toggle('error', length > 12000);
  }

  function updateSourceMeta() {
    if (!state) return;
    let service = '已配置的内容整理服务';
    try { service = new URL(window.NotchAISettings?.llmBaseUrl || '').hostname || service; } catch (error) {}
    const range = state.source.sourceType === 'manual' ? '手动输入'
      : state.source.selection ? '当前选区'
        : state.source.sourceType === 'note' ? '整篇笔记' : state.source.sourceType === 'link' ? '网址与当前标题' : '完整转写';
    const reference = new Date(state.referenceTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    meta.textContent = `发送至 ${service} · ${range} · 参考 ${reference} ${state.timeZone} · 结果不会自动保存`;
  }

  function open(options = {}) {
    if (root.hidden) {
      const requested = options.returnFocus;
      const active = requested instanceof HTMLElement ? requested : document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    requestSequence += 1;
    const action = actionNames[options.action] ? options.action : 'summarize';
    const source = {
      sourceType: ['note', 'recording', 'link'].includes(options.sourceType) ? options.sourceType : 'manual',
      sourceId: String(options.sourceId || ''),
      sourceTitle: String(options.sourceTitle || ''),
      text: String(options.text || ''),
      createdAt: Number(options.createdAt) || Date.now(),
      selection: options.selection && Number.isInteger(options.selection.start) && Number.isInteger(options.selection.end) ? { ...options.selection } : null,
    };
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const referenceTime = new Date(source.sourceType === 'recording' ? source.createdAt : Date.now()).toISOString();
    state = { action, source, sourceRevision: window.NotchAIDomain.sourceRevision(source), result: null, candidates: [], requestId: '', applied: null, savedNote: null, metadataUndo: null, referenceTime, timeZone, mutating: false };
    title.textContent = actionNames[action];
    actionSelect.value = action;
    actionSelect.querySelector('[value="organizeRecording"]').disabled = source.sourceType !== 'recording';
    actionSelect.disabled = source.sourceType === 'recording' || action.startsWith('name');
    targetLanguage.disabled = false;
    languageLabel.hidden = action !== 'translate';
    sourceLabel.textContent = source.sourceType === 'note' ? `笔记 · ${source.sourceTitle || '未命名笔记'}`
      : source.sourceType === 'recording' ? `录音 · ${source.sourceTitle || '未命名录音'}`
        : source.sourceType === 'link' ? `链接 · ${source.sourceTitle || '未命名链接'}` : '手动输入';
    sourceText.value = source.text;
    sourceText.readOnly = source.sourceType !== 'manual';
    updateSourceMeta();
    root.hidden = false;
    document.querySelectorAll('.panels, .topbar').forEach((node) => node.setAttribute('inert', ''));
    restoreRequestControls();
    resetResult();
    updateCount();
    setStatus('尚未保存');
    requestAnimationFrame(() => (source.sourceType === 'manual' ? sourceText : generate).focus({ preventScroll: true }));
  }

  async function close() {
    const closing = state;
    const focusTarget = returnFocus;
    returnFocus = null;
    requestSequence += 1;
    state = null;
    root.hidden = true;
    document.querySelectorAll('.panels, .topbar').forEach((node) => node.removeAttribute('inert'));
    if (focusTarget?.isConnected && !focusTarget.closest('[inert]')) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
    if (closing?.requestId) await window.notchAPI?.cancelAI?.(closing.requestId).catch(() => {});
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function renderTodos(items) {
    const names = categories();
    state.candidates = window.NotchAIDomain.prepareTodoCandidates(items, names, Date.now());
    todoResults.replaceChildren();
    const todoSnapshot = window.NotchTodo?.snapshot?.() || {};
    state.candidates.forEach((candidate, index) => {
      const initialDuplicate = window.NotchAIDomain.duplicateFor(candidate, todoSnapshot)
        || window.NotchAIDomain.duplicateCandidateFor(candidate, state.candidates.slice(0, index));
      if (initialDuplicate) candidate.selected = false;
      const row = document.createElement('section');
      row.className = 'ai-todo-candidate';
      row.dataset.candidateId = candidate.candidateId;
      const selected = document.createElement('input'); selected.type = 'checkbox'; selected.checked = candidate.selected; selected.setAttribute('aria-label', `选择待办：${candidate.text}`);
      const copyWrap = document.createElement('div'); copyWrap.className = 'ai-todo-copy';
      const todoTitle = document.createElement('input'); todoTitle.className = 'ai-todo-title'; todoTitle.maxLength = 80; todoTitle.value = candidate.text; todoTitle.setAttribute('aria-label', '待办名称');
      copyWrap.append(todoTitle);
      const fields = document.createElement('div'); fields.className = 'ai-todo-fields';
      const category = document.createElement('select'); category.className = 'ai-todo-category'; category.setAttribute('aria-label', '责任领域');
      category.append(new Option('选择责任领域', ''));
      Object.entries(names).forEach(([id, name]) => category.append(new Option(name, id)));
      category.value = candidate.categoryId;
      const deadline = document.createElement('input'); deadline.className = 'ai-todo-deadline'; deadline.type = 'datetime-local'; deadline.value = toLocalInput(candidate.deadline); deadline.setAttribute('aria-label', '截止时间');
      const dateShortcuts = document.createElement('div'); dateShortcuts.className = 'ai-todo-date-shortcuts';
      [['today', '今天'], ['week', '本周'], ['later', '以后']].forEach(([scope, label]) => {
        const shortcut = document.createElement('button'); shortcut.type = 'button'; shortcut.textContent = label;
        const value = window.NotchDomain?.defaultTodoDeadlineForScope?.(scope, new Date());
        shortcut.disabled = !value;
        shortcut.addEventListener('click', () => { deadline.value = toLocalInput(value); deadline.dispatchEvent(new Event('change', { bubbles: true })); });
        dateShortcuts.append(shortcut);
      });
      fields.append(category, deadline, dateShortcuts);
      const evidence = document.createElement('div'); evidence.className = 'ai-todo-evidence'; evidence.textContent = `原文：“${candidate.evidence?.quote || '无可验证依据'}”`;
      const warning = document.createElement('p'); warning.className = 'ai-todo-warning';
      const sync = () => {
        candidate.text = todoTitle.value.trim();
        candidate.categoryId = category.value;
        candidate.deadline = deadline.value ? new Date(deadline.value).toISOString() : '';
        const checked = window.NotchAIDomain.validateCandidate(candidate).ok;
        const duplicate = window.NotchAIDomain.duplicateFor(candidate, todoSnapshot);
        const batchDuplicate = window.NotchAIDomain.duplicateCandidateFor(candidate, state.candidates);
        candidate.complete = checked;
        candidate.selected = selected.checked;
        warning.textContent = !checked ? (!candidate.text ? '请填写待办名称' : !candidate.categoryId ? '请选择责任领域' : '请选择未来的截止时间')
          : duplicate ? `已有相似的未完成待办“${duplicate.text}”；勾选表示仍要新增`
            : batchDuplicate ? `本批次有相似候选“${batchDuplicate.text}”；请确认是否重复` : '';
        updateApplyLabel();
      };
      selected.addEventListener('change', sync); todoTitle.addEventListener('input', sync); category.addEventListener('change', sync); deadline.addEventListener('change', sync);
      row.append(selected, copyWrap, fields, evidence, warning);
      todoResults.append(row); sync();
    });
    todoResults.hidden = false;
    empty.hidden = true;
    applyTodos.hidden = false;
    if (!state.candidates.length) {
      applyTodos.hidden = true;
      empty.hidden = false;
      empty.querySelector('strong').textContent = '未发现明确行动项';
      empty.querySelector('span').textContent = '原文仍保留，可以修改内容后重新生成。';
    }
  }

  function updateApplyLabel() {
    if (!state) return;
    if (state.applied) { applyTodos.textContent = '撤销已添加'; applyTodos.disabled = false; return; }
    const selected = state.candidates.filter((candidate) => candidate.selected);
    const ready = selected.filter((candidate) => window.NotchAIDomain.validateCandidate(candidate).ok);
    applyTodos.textContent = ready.length ? `加入 ${ready.length} 项待办` : '加入待办';
    applyTodos.disabled = !selected.length || ready.length !== selected.length;
  }

  function recordingText(result, summary = result.summary) {
    const parts = [];
    if (summary) parts.push(`# 摘要\n\n${summary}`);
    if (result.decisions && result.decisions.length) parts.push(`# 明确决定\n\n${result.decisions.map((item) => `- ${item.text}\n  - 原文：${item.evidence.quote}`).join('\n')}`);
    return parts.join('\n\n');
  }

  function renderResult(result) {
    resetResult();
    state.result = result;
    if (result.kind === 'text') {
      empty.hidden = true; textResult.hidden = false; textResult.value = result.text;
      copy.hidden = false; saveNote.hidden = false;
      replaceSelection.hidden = !(state.source.sourceType === 'note' && state.source.selection && ['shorten', 'translate'].includes(state.action) && !/!\[[^\]]*\]\([^)]+\)/.test(state.source.text));
    } else if (result.kind === 'metadata') {
      empty.hidden = true; metadataResult.hidden = false; metadataTitle.value = result.title; metadataCategory.maxLength = state.action === 'nameLink' ? 14 : 24; metadataCategory.value = result.category || ''; metadataCategory.closest('label').hidden = state.action === 'nameNote'; applyMetadata.hidden = false;
    } else if (result.kind === 'todos') {
      renderTodos(result.todos);
    } else if (result.kind === 'recording') {
      const text = recordingText(result);
      if (result.summary) { empty.hidden = true; textResult.hidden = false; textResult.value = result.summary; }
      if (text) { copy.hidden = false; saveNote.hidden = false; }
      renderTodos(result.todos);
      if (result.decisions?.length) {
        const section = document.createElement('section'); section.className = 'ai-recording-section';
        const heading = document.createElement('h3'); heading.textContent = '明确决定';
        const list = document.createElement('ul'); result.decisions.forEach((item) => { const li = document.createElement('li'); li.textContent = `${item.text}（原文：${item.evidence.quote}）`; list.append(li); });
        section.append(heading, list); resultPane.insertBefore(section, todoResults);
      }
      if (!result.todos.length) applyTodos.hidden = true;
      if (text) empty.hidden = true;
    }
    setStatus('生成完成 · 尚未保存');
  }

  async function run() {
    if (!state || generate.disabled) return;
    if (state.applied || state.replacementUndo || state.savedNote || state.metadataUndo) { setStatus('请先撤销已保存的结果，再重新生成。', 'error'); return; }
    const text = canonicalSourceText(sourceText.value);
    if (!text) { setStatus('请先输入要整理的内容。', 'error'); sourceText.focus(); return; }
    if (text.length > 12000) { setStatus(errorMessages.input_too_long, 'error'); return; }
    state.source.expectedText = state.source.selection ? sourceText.value : text;
    state.source.text = text;
    state.sourceRevision = window.NotchAIDomain.sourceRevision(state.source);
    const session = state;
    const generation = ++requestSequence;
    const requestId = `ai-ui-${Date.now().toString(36)}-${generation}`;
    state.requestId = requestId;
    generate.disabled = true; generate.hidden = true; stop.hidden = false; sourceText.readOnly = true; actionSelect.disabled = true; targetLanguage.disabled = true; resetResult(); textResult.readOnly = true;
    empty.querySelector('strong').textContent = '正在生成'; empty.querySelector('span').textContent = '可以停止，原文不会改变。';
    setStatus('正在等待内容整理服务…');
    if (state.source.sourceType !== 'recording') state.referenceTime = new Date().toISOString();
    updateSourceMeta();
    const result = await window.notchAPI?.runAI?.({
      requestId,
      action: state.action,
      interactive: true,
      context: { ...state.source, sourceRevision: state.sourceRevision, text },
      referenceTime: state.referenceTime,
      timeZone: state.timeZone,
      categories: categories(),
      targetLanguage: targetLanguage.value || '中文',
    }).catch(() => ({ ok: false, error: 'network_error' }));
    if (generation !== requestSequence || state !== session || state.requestId !== requestId) return;
    state.requestId = ''; restoreRequestControls(); textResult.readOnly = false;
    if (!result?.ok) {
      resetResult();
      setStatus(errorMessages[result?.error] || `生成失败：${result?.error || '请重试'}`, 'error');
      return;
    }
    if (!sourceStillCurrent()) { resetResult(); setStatus('来源内容已发生变化，请重新打开后生成。', 'error'); return; }
    renderResult(result);
  }

  async function stopRequest() {
    if (!state?.requestId) return;
    const requestId = state.requestId;
    requestSequence += 1; state.requestId = '';
    restoreRequestControls();
    await window.notchAPI?.cancelAI?.(requestId).catch(() => {});
    resetResult(); setStatus(errorMessages.cancelled);
  }

  async function copyResult() {
    if (!state?.result) return;
    const text = state.result.kind === 'recording' ? recordingText(state.result, textResult.value.trim()) : textResult.value;
    const response = await window.notchAPI?.writeClipboard?.({ type: 'text', text }).catch(() => false);
    setStatus(response === false || response?.ok === false ? '复制失败，请重试。' : '结果已复制。', response === false || response?.ok === false ? 'error' : 'success');
  }

  function generatedNoteContent() {
    if (!state?.result) return '';
    return state.result.kind === 'recording' ? recordingText(state.result, textResult.value.trim()) : textResult.value.trim();
  }

  async function saveGeneratedNote(session) {
    if (state !== session) return;
    if (state.savedNote) {
      const undone = await window.NotchNotes?.undoGenerated?.(state.savedNote);
      if (state !== session) return;
      if (!undone?.ok) { setStatus('该笔记已经变化，无法自动撤销。', 'error'); return; }
      state.savedNote = null; saveNote.textContent = '保存为笔记'; generate.disabled = false; actionSelect.disabled = state.source.sourceType === 'recording'; setStatus(undone.workspaceSynced === false ? '已在本机撤销；工作区同步失败，将自动重试。' : '已撤销保存笔记。', undone.workspaceSynced === false ? 'error' : 'success');
      return;
    }
    if (!sourceStillCurrent()) { setStatus('来源已变化，未保存。请重新生成。', 'error'); return; }
    const content = generatedNoteContent();
    if (!content) return;
    const noteTitle = state.source.sourceTitle ? `${actionNames[state.action]} · ${state.source.sourceTitle}` : actionNames[state.action];
    const result = await window.NotchNotes?.saveGenerated?.(noteTitle, content);
    if (state !== session) return;
    if (!result?.ok) { setStatus(result?.error === 'capacity' ? '笔记已达 200 篇上限，请先整理笔记库。' : '保存笔记失败，请检查存储空间。', 'error'); return; }
    state.savedNote = result.note; saveNote.textContent = '撤销保存'; generate.disabled = true; actionSelect.disabled = true; setStatus(result.workspaceSynced === false ? '已保存在本机；工作区同步失败，将自动重试。' : '已保存为笔记。', result.workspaceSynced === false ? 'error' : 'success');
  }

  async function replaceNoteSelection(session) {
    if (state !== session || !state?.result || state.result.kind !== 'text' || !state.source.selection) return;
    if (state.replacementUndo) {
      const undone = await window.NotchNotes?.undoAISelection?.(state.replacementUndo);
      if (state !== session) return;
      if (!undone?.ok) { setStatus('选区已继续编辑，无法自动撤销；结果仍可复制。', 'error'); return; }
      state.replacementUndo = null; replaceSelection.textContent = '替换选区'; generate.disabled = false; actionSelect.disabled = false; setStatus(undone.workspaceSynced === false ? '已在本机撤销；工作区同步失败，将自动重试。' : '已撤销选区替换。', undone.workspaceSynced === false ? 'error' : 'success');
      return;
    }
    const result = await window.NotchNotes?.replaceAISelection?.(state.source.sourceId, state.source.selection, state.source.expectedText ?? state.source.text, textResult.value);
    if (state !== session) return;
    if (!result?.ok) { setStatus(result?.error === 'source_changed' ? '原笔记已经变化，未替换选区。' : '替换失败，请检查存储空间。', 'error'); return; }
    state.replacementUndo = result.undo; replaceSelection.textContent = '撤销替换'; generate.disabled = true; actionSelect.disabled = true; setStatus(result.workspaceSynced === false ? '已在本机替换；工作区同步失败，将自动重试。' : '已替换笔记选区。', result.workspaceSynced === false ? 'error' : 'success');
  }

  async function applyMetadataResult(session) {
    if (state !== session || !state?.result || state.result.kind !== 'metadata') return;
    if (state.metadataUndo) {
      const result = state.source.sourceType === 'note'
        ? await window.NotchNotes?.undoAIName?.(state.metadataUndo)
        : await window.NotchWorkspace?.undoAIName?.(state.metadataUndo);
      if (state !== session) return;
      if (!result?.ok) { setStatus('名称已被继续修改，无法自动撤销。', 'error'); return; }
      state.metadataUndo = null; applyMetadata.textContent = '采用名称'; generate.disabled = false;
      setStatus(result.workspaceSynced === false ? '已在本机撤销；工作区同步失败，将自动重试。' : '已撤销名称修改。', result.workspaceSynced === false ? 'error' : 'success');
      return;
    }
    if (!sourceStillCurrent()) { setStatus('来源已变化，未采用名称。请重新生成。', 'error'); return; }
    const result = state.source.sourceType === 'note'
      ? await window.NotchNotes?.applyAIName?.(state.source.sourceId, state.source.text, state.source.sourceTitle, metadataTitle.value)
      : await window.NotchWorkspace?.applyAIName?.(state.source, metadataTitle.value, metadataCategory.value);
    if (state !== session) return;
    if (!result?.ok) { setStatus(result?.error === 'source_changed' ? '名称或来源已经变化，未覆盖。' : '名称保存失败。', 'error'); return; }
    state.metadataUndo = result.undo; applyMetadata.textContent = '撤销采用'; generate.disabled = true;
    setStatus(result.workspaceSynced === false ? '已在本机采用名称；工作区同步失败，将自动重试。' : '已采用生成名称。', result.workspaceSynced === false ? 'error' : 'success');
  }

  async function applyTodoBatch(session) {
    if (state !== session) return;
    if (state.applied) {
      const result = await window.NotchTodo?.undoAIBatch?.(state.applied);
      if (state !== session) return;
      if (!result?.ok) { setStatus('撤销失败，请检查待办。', 'error'); return; }
      state.applied = null; applyTodos.disabled = false; generate.disabled = false; actionSelect.disabled = state.source.sourceType === 'recording'; updateApplyLabel();
      const syncWarning = result.workspaceSynced === false ? ' 工作区同步失败，将自动重试。' : '';
      setStatus((result.conflicts ? `已撤销 ${result.removed} 项，${result.conflicts} 项已被修改并保留。` : `已撤销 ${result.removed} 项。`) + syncWarning, result.conflicts || result.workspaceSynced === false ? 'error' : 'success');
      return;
    }
    if (!sourceStillCurrent()) { setStatus('来源已变化，未加入待办。请重新生成。', 'error'); return; }
    const result = await window.NotchTodo?.applyAIBatch?.(state.candidates);
    if (state !== session) return;
    if (!result?.ok) { setStatus(result?.error === 'save_failed' ? '待办保存失败，请检查存储空间。' : '请补齐已选任务的责任领域和截止时间。', 'error'); return; }
    state.applied = result.undo;
    generate.disabled = true; actionSelect.disabled = true;
    updateApplyLabel();
    setStatus(result.workspaceSynced === false ? `已在本机加入 ${result.count} 项；工作区同步失败，将自动重试。` : `已加入 ${result.count} 项待办。`, result.workspaceSynced === false ? 'error' : 'success');
  }

  actionSelect.addEventListener('change', () => {
    if (!state || state.source.sourceType === 'recording') return;
    if (state.requestId || state.mutating) { actionSelect.value = state.action; setStatus('当前操作完成后再切换整理方式。', 'error'); return; }
    if (state.applied || state.replacementUndo || state.savedNote || state.metadataUndo) { actionSelect.value = state.action; setStatus('请先撤销已保存的结果，再切换操作。', 'error'); return; }
    state.action = actionNames[actionSelect.value] ? actionSelect.value : 'summarize';
    title.textContent = actionNames[state.action];
    languageLabel.hidden = state.action !== 'translate';
    state.result = null; state.candidates = []; state.applied = null;
    resetResult(); setStatus('尚未保存');
  });
  sourceText.addEventListener('input', updateCount);
  sourceText.addEventListener('keydown', (event) => {
    if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    event.preventDefault(); run();
  });
  window.notchAPI?.onAIEvent?.((event) => {
    if (!state?.requestId || event?.requestId !== state.requestId || event.type !== 'textDelta') return;
    empty.hidden = true; textResult.hidden = false; textResult.readOnly = true; textResult.value += String(event.text || '');
  });
  generate.addEventListener('click', run);
  stop.addEventListener('click', stopRequest);
  copy.addEventListener('click', copyResult);
  saveNote.addEventListener('click', () => withMutation(saveNote, saveGeneratedNote));
  replaceSelection.addEventListener('click', () => withMutation(replaceSelection, replaceNoteSelection));
  applyMetadata.addEventListener('click', () => withMutation(applyMetadata, applyMetadataResult));
  applyTodos.addEventListener('click', () => withMutation(applyTodos, applyTodoBatch));
  closeButtons.forEach((button) => button?.addEventListener('click', close));
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); state?.requestId ? stopRequest() : close(); } });

  window.NotchAI = Object.freeze({
    open,
    openText: (action = 'extractTodos') => open({ action, sourceType: 'manual' }),
    openNote(action = 'summarize') {
      const context = window.NotchNotes?.context?.(undefined, action !== 'nameNote');
      if (context?.text) open({ action, ...context });
      return Boolean(context?.text);
    },
    openRecording(recordingId) {
      const context = window.NotchWorkspace?.recordingContext?.(recordingId);
      if (context?.text) open({ action: 'organizeRecording', ...context });
      return Boolean(context?.text);
    },
    openRecordingName(recordingId) {
      const context = window.NotchWorkspace?.recordingContext?.(recordingId);
      if (context?.text) open({ action: 'nameRecording', ...context });
      return Boolean(context?.text);
    },
    openLinkName(linkId) {
      const context = window.NotchWorkspace?.linkContext?.(linkId);
      if (context?.text) open({ action: 'nameLink', ...context });
      return Boolean(context?.text);
    },
    isOpen: () => !root.hidden,
    close,
  });
})();
