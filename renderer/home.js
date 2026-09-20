(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = $('home-dashboard');
  if (!root) return;
  const api = window.notchAPI;
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  let signature = '';
  const visible = () => !document.hidden && $('app').classList.contains('expanded') && $('tab-home').classList.contains('active') && !root.hidden;
  function changeView(view) {
    root.hidden = view !== 'dashboard';
    $('home-chat').hidden = view !== 'chat';
    $('home-weather-detail').hidden = view !== 'weather';
    document.dispatchEvent(new CustomEvent('notch:home-view-changed', { detail: { view } }));
    if (view === 'dashboard') { refreshLists(); tick(); }
  }
  const homeWeather = window.NotchHomeWeather.createController({
    $, api, storage: localStorage, setText, changeView, document,
  });
  document.querySelectorAll('[data-home-nav]').forEach((button) => button.addEventListener('click', () => navigate({ tab: button.dataset.homeNav })));
  async function navigate(target) {
    try { await window.NotchPanel.navigate(target); }
    catch { setText($('home-capture-status'), '该功能不可用，请在设置中启用'); }
  }
  function row(title, detail, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'home-row';
    const strong = document.createElement('strong'); strong.textContent = title;
    const small = document.createElement('small'); small.textContent = detail;
    button.append(strong, small); button.addEventListener('click', callback); return button;
  }
  function notePreview(content) {
    const preview = String(content || '')
      .replace(/```[\s\S]*?```/g, '代码片段')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~`-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return preview ? preview.slice(0, 96) : '暂无正文内容';
  }
  function noteRow(note, category, tag) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'home-row home-note-row';
    const head = document.createElement('span'); head.className = 'home-note-row-head';
    const mark = document.createElement('span'); mark.className = 'home-note-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '文';
    const strong = document.createElement('strong'); strong.textContent = note.title || note.content?.split('\n')[0] || '未命名笔记';
    const time = document.createElement('time');
    const updatedAt = Number(note.updatedAt) || 0;
    time.dateTime = updatedAt ? new Date(updatedAt).toISOString() : '';
    time.textContent = updatedAt ? new Date(updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
    head.append(mark, strong, time);
    const preview = document.createElement('span'); preview.className = 'home-note-row-preview'; preview.textContent = notePreview(note.content);
    const meta = document.createElement('span'); meta.className = 'home-note-row-meta';
    const categoryLabel = document.createElement('span'); categoryLabel.className = 'home-note-category'; categoryLabel.textContent = category || '未分类';
    meta.append(categoryLabel);
    if (tag) {
      const tagLabel = document.createElement('span'); tagLabel.className = 'home-note-tag'; tagLabel.textContent = tag;
      meta.append(tagLabel);
    }
    button.append(head, preview, meta);
    button.addEventListener('click', () => navigate({ tab: 'notes', id: note.id }));
    return button;
  }
  function empty(target, text) { const p = document.createElement('p'); p.className = 'home-hint'; p.textContent = text; target.append(p); }
  function refreshLists() {
    const notes = window.NotchNotes?.list?.() || [];
    const todos = read('notch-todo-data', {}), names = read('notch-todo-category-names-v1', {}), categories = read('notch-note-categories-v1', []);
    const next = JSON.stringify([notes, todos, names, categories, new Date().toDateString()]);
    if (next === signature) return;
    signature = next;
    const recent = $('home-recent-list'); recent.replaceChildren();
    setText($('home-recent-summary'), notes.length
      ? notes.length > 5 ? `最近编辑 ${Math.min(notes.length, 5)} 篇 · 共 ${notes.length} 篇` : `最近编辑 ${notes.length} 篇`
      : '还没有笔记');
    notes.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).forEach((note) => {
      const category = Array.isArray(categories) ? categories.find((item) => item.id === note.categoryId) : null;
      const tag = Array.isArray(category?.tags) ? category.tags.find((item) => item.id === note.tagId)?.name : '';
      recent.append(noteRow(note, category?.name, tag));
    });
    if (!recent.children.length) empty(recent, '保存第一篇笔记，稍后从这里继续');
    const today = $('home-today-list'); today.replaceChildren();
    const items = ['P0', 'P1', 'P2', 'P3'].flatMap((priority) => window.NotchDomain.filterTodosByTimeScope(Array.isArray(todos[priority]) ? todos[priority] : [], 'today').filter((item) => !item.done).map((item) => ({ ...item, priority })));
    items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline)).slice(0, 3).forEach((item) => {
      const date = new Date(item.deadline), overdue = date.getTime() < Date.now();
      today.append(row(item.text, `${overdue ? '逾期 · ' : ''}${names[item.priority] || item.priority} · ${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, () => navigate({ tab: 'todo', id: item.id })));
    });
    if (!items.length) empty(today, '今天没有到期事项，可以安排下一步');
    else if (items.length > 3) empty(today, `还有 ${items.length - 3} 项，进入全部待办查看`);
  }
  const homeQuickCapture = window.NotchHomeQuickCapture.createController({
    document, storage: localStorage,
    getDomain: () => window.NotchDomain,
    getWorkspace: () => window.NotchWorkspace,
    getNotes: () => window.NotchNotes,
    setText,
    refreshLists,
  });

  const homeMusic = window.NotchHomeMusic.createController({ $, api, storage: localStorage, document, window, setText, navigate });
  const ChatContext = window.NotchChatContext;
  const ChatSessions = window.NotchChatSessions;
  const ChatReader = window.NotchChatReader;
  let chatSessionView = null;
  const messages = $('home-chat-messages'), chatInput = $('home-chat-input'), chatEmpty = $('home-chat-empty'), chatForm = $('home-chat-form');
  let chatContextView = null;
  let chatGenerationView = null;
  let chatReaderView = null;
  const chatIcons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3v5h-5"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V5M8 20v-6h8v6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 7-5 5 5 5"/><path d="M20 17a7 7 0 0 0-7-7H4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    reader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  };
  function resizeChatInput() {
    chatInput.style.height = 'auto'; chatInput.style.height = `${Math.min(132, Math.max(40, chatInput.scrollHeight))}px`;
    const length = chatContextView.messageLength(), selectedSources = chatContextView.getSelectedSources(), wasOverLimit = chatForm.dataset.overLimit === 'true', overLimit = length > 12000;
    setText($('home-chat-count'), `${length} / 12000${selectedSources.length ? ` · ${selectedSources.length} 份资料` : ''}`);
    $('home-chat-send').disabled = !chatInput.value.trim() || overLimit;
    chatForm.dataset.overLimit = String(overLimit);
    if (!chatGenerationView?.getRequestId?.() && overLimit) setText($('home-chat-status'), '问题与参考资料超过 12000 字符，请移除资料或缩短问题');
    else if (!chatGenerationView?.getRequestId?.() && wasOverLimit && !overLimit) setText($('home-chat-status'), selectedSources.length ? `将随本条消息发送 ${selectedSources.length} 份资料` : '不读取工作区 · Enter 发送，Shift + Enter 换行');
  }
  function actionButton(icon, label, handler) {
    const button = document.createElement('button'); button.type = 'button'; button.innerHTML = chatIcons[icon]; button.setAttribute('aria-label', label); button.title = label; button.addEventListener('click', handler); return button;
  }
  chatContextView = window.NotchHomeChatContext.createController({
    $, document, ChatContext,
    collectSources: () => ChatContext.catalog([
      ...(window.NotchNotes?.chatContexts?.() || []),
      ...(window.NotchWorkspace?.chatContexts?.() || []),
      ...(window.NotchTodo?.chatContexts?.() || []),
      ...(window.NotchClipboard?.chatContexts?.() || []),
    ]),
    getRequestId: () => chatGenerationView?.getRequestId?.() || '',
    setStatus: (text) => setText($('home-chat-status'), text),
    closeSessionPanel: () => chatSessionView?.close(),
    onSelectionChanged: () => { if (chatSessionView) resizeChatInput(); },
  });
  chatGenerationView = window.NotchHomeChatGeneration.createController({
    document, window, ChatContext, ChatReader, chatIcons,
    chatErrors: {
      not_configured: '尚未配置内容模型，请先完成 AI 设置。', service_busy: 'AI 正在处理其他请求，请稍后重试。', authentication_failed: '模型凭据验证失败，请检查设置。',
      cancelled: '请求已停止。', context_changed: 'AI 配置已变更，请重新生成。', timeout: '模型响应超时，请重试。', rate_limited: '请求过于频繁，请稍后重试。',
      model_not_found: '当前模型不可用，请检查模型名称。', invalid_endpoint: '服务地址不安全或不可用。', network_error: '无法连接内容模型。',
      invalid_response: '服务返回了无法使用的内容。', response_too_large: '回复超过大小限制，未保留为成功结果。', stream_incomplete: '连接提前中断，回复不完整。',
      invalid_stream: '服务返回的数据流损坏。', output_truncated: '回复达到模型输出上限，内容不完整。', content_filtered: '回复被服务过滤。', unsupported_finish_reason: '模型未正常结束生成。',
      invalid_chat_sources: '所选参考资料无效，请重新选择。', input_too_long: '问题与参考资料超过 12000 字符，请移除资料或缩短问题。',
    },
    getElements: () => ({ messages, chatEmpty, chatForm, chatInput, chatSend: $('home-chat-send'), chatStop: $('home-chat-stop'), chatStatus: $('home-chat-status') }),
    getApi: () => window.notchAPI,
    getContextView: () => chatContextView,
    getSessionView: () => chatSessionView,
    getReaderView: () => chatReaderView,
    setText,
    setStatus: (text) => setText($('home-chat-status'), text),
    actionButton,
    renderText: (container, text) => { if (window.NotchMarkdown?.render) window.NotchMarkdown.render(container, text); else container.textContent = text; },
    resizeInput: () => resizeChatInput(),
    chatSessionsMaxRecords: ChatSessions.MAX_RECORDS,
  });
  chatSessionView = window.NotchHomeChatSession.createController({
    $, api, document, window, storage: localStorage, ChatSessions, chatIcons,
    actionButton,
    getRequestId: () => chatGenerationView.getRequestId(),
    getConversationRecords: () => chatGenerationView.getConversationRecords(),
    setConversationRecords: (records) => { const target = chatGenerationView.getConversationRecords(); target.splice(0, target.length, ...(Array.isArray(records) ? records : [])); },
    getHistory: () => chatGenerationView.getHistory(),
    setHistory: (value) => chatGenerationView.setHistory(value),
    nextSequence: () => chatGenerationView.nextSequence(),
    syncWorkspaceSnapshot: () => typeof syncWorkspaceSnapshot === 'function' ? syncWorkspaceSnapshot() : Promise.resolve(false),
    setStatus: (text) => setText($('home-chat-status'), text),
    cancelChat: () => chatGenerationView.cancel(),
    resetChat: (options) => resetChat(options),
    closeReader: (options) => chatReaderView?.close(options),
    closeContextPicker: (options) => chatContextView.close(options),
    clearSelectedSources: () => chatContextView.clear(),
    clearMessages: () => { messages.replaceChildren(chatEmpty); chatEmpty.hidden = true; chatInput.value = ''; chatContextView.renderChips(); },
    message: (...args) => chatGenerationView.message(...args),
    setTurnState: (...args) => chatGenerationView.setTurnState(...args),
    addTurnActions: (...args) => chatGenerationView.addTurnActions(...args),
    resizeChatInput: () => resizeChatInput(),
    scrollMessages: () => { messages.scrollTop = messages.scrollHeight; },
  });
  chatReaderView = window.NotchHomeChatReader.createController({
    $, api, document, window, ChatReader, chatIcons,
    renderText: (container, text) => { if (window.NotchMarkdown?.render) window.NotchMarkdown.render(container, text); else container.textContent = text; },
    getApi: () => window.notchAPI,
    getRequestId: () => chatGenerationView.getRequestId(),
    getSessionLabel: () => chatSessionView.getSessionLabel(),
    setChatStatus: (text) => setText($('home-chat-status'), text),
    closeContextPicker: (options) => chatContextView.close(options), closeSessionPanel: (options) => chatSessionView.close(options), toggleTurnNote: (turn) => chatGenerationView.toggleTurnNote(turn),
    noteTitle: (answer) => ChatReader.title(answer) || 'AI 对话回复', setText,
  });
  window.NotchChatReaderView = Object.freeze({
    isOpen: () => chatReaderView.isOpen(),
    close(options) { if (!chatReaderView.isOpen()) return false; chatReaderView.close(options); return true; },
    handleEscape() { return chatReaderView.handleEscape(); },
  });
  function cancelChat() {
    chatGenerationView.cancel();
  }
  function resetChat({ keepSessionPanel = false, status = '已开始新的临时对话', force = false } = {}) {
    cancelChat();
    if (chatSessionView.isDirty() && !force) { setText($('home-chat-status'), '当前会话有未保存更改，请先处理容量或存储问题'); return false; }
    chatReaderView.close({ focus: false }); chatGenerationView.clearConversation(); chatSessionView.resetCurrent(); chatContextView.clear(); if (!keepSessionPanel) chatSessionView.close(); messages.replaceChildren(chatEmpty); chatEmpty.hidden = false; chatInput.value = ''; chatContextView.renderChips(); chatSessionView.updateHeader(); setText($('home-chat-status'), status); chatInput.focus(); return true;
  }
  async function refreshChatModel() {
    const config = await api?.getTranscriptionConfig?.().catch(() => null);
    const provider = config?.llmConfigured ? (config.llmProviderLabel || config.llmProviderId || '内容模型') : '内容模型未配置';
    const model = config?.llmConfigured ? (config.llmModel || '默认模型') : '前往设置';
    setText($('home-chat-provider'), provider); setText($('home-chat-model-name'), model); setText($('home-ai-model'), config?.llmConfigured ? `${provider} · ${model}` : '尚未配置');
  }
  async function openAISettings() { await navigate({ tab: 'settings' }); window.NotchSettings?.select('api'); }
  $('home-chat-open').addEventListener('click', () => { changeView('chat'); void refreshChatModel(); chatInput.focus(); });
  $('home-chat-close').addEventListener('click', () => { cancelChat(); chatReaderView?.close({ focus: false }); chatContextView.close(); chatSessionView.close(); changeView('dashboard'); $('home-chat-open').focus(); });
  $('home-chat-new').addEventListener('click', () => resetChat()); $('home-chat-model').addEventListener('click', openAISettings);
  document.querySelectorAll('[data-home-chat-prompt]').forEach((button) => button.addEventListener('click', () => { chatInput.value = button.dataset.homeChatPrompt || ''; resizeChatInput(); chatInput.focus(); chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); }));
  chatInput.addEventListener('input', () => { resizeChatInput(); if (chatContextView.isOpen?.()) chatContextView.renderPicker(); });
  chatInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); chatForm.requestSubmit(); } });
  resizeChatInput(); chatSessionView.updateHeader(); void refreshChatModel();
  window.addEventListener('notch:ai-settings-changed', refreshChatModel);
  api?.onWorkspaceChanged?.(() => { cancelChat(); chatReaderView.close({ focus: false }); chatGenerationView.clearConversation(); chatSessionView.resetWorkspace(); chatContextView.clear(); chatContextView.close(); messages.replaceChildren(chatEmpty); chatEmpty.hidden = false; chatInput.value = ''; chatContextView.renderChips(); chatSessionView.updateHeader(); homeWeather.invalidate(); });
  function tick() {
    if (!visible()) return;
    refreshLists();
    homeWeather.tick();
  }
  const timer = setInterval(tick, 2000);
  window.addEventListener('pagehide', () => { clearInterval(timer); cancelChat(); chatReaderView.dispose(); chatReaderView.close({ focus: false }); homeMusic.dispose(); homeWeather.dispose(); }, { once: true });
  changeView('dashboard');
})();
