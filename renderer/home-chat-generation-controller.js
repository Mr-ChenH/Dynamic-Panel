(function exposeHomeChatGeneration(root, factory) {
  const api = factory();
  if (root) root.NotchHomeChatGeneration = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeChatGenerationApi() {
  'use strict';

  function createController(host = {}) {
    const documentRef = host.document || document;
    const windowRef = host.window || window;
    const ChatContext = host.ChatContext || windowRef.NotchChatContext;
    const ChatReader = host.ChatReader || windowRef.NotchChatReader;
    const chatIcons = host.chatIcons || {};
    const chatErrors = host.chatErrors || {};
    const elements = host.getElements();
    let history = [];
    let requestId = '';
    let sequence = 0;
    let pendingTurn = null;
    const conversationRecords = [];

    const api = () => (typeof host.getApi === 'function' ? host.getApi() : windowRef.notchAPI);
    const contextView = () => host.getContextView?.();
    const sessionView = () => host.getSessionView?.();
    const readerView = () => host.getReaderView?.();
    const setStatus = (text) => host.setStatus?.(text);
    const setText = (element, text) => host.setText?.(element, text);
    const renderText = (container, text) => {
      if (typeof host.renderText === 'function') host.renderText(container, text);
      else if (windowRef.NotchMarkdown?.render) windowRef.NotchMarkdown.render(container, text);
      else container.textContent = text;
    };

    function chatControls(busy) {
      elements.chatForm.dataset.busy = String(busy);
      elements.chatSend.hidden = busy;
      elements.chatStop.hidden = !busy;
      host.resizeInput?.();
      sessionView()?.updateHeader?.();
    }

    function actionButton(icon, label, handler) {
      return host.actionButton(icon, label, handler);
    }

    function message(role, text, state = 'complete', sources = []) {
      elements.chatEmpty.hidden = true;
      const article = documentRef.createElement('article');
      article.className = 'home-chat-message';
      article.dataset.role = role;
      article.dataset.state = state;
      const body = documentRef.createElement('div');
      body.className = 'home-chat-message-body';
      if (role === 'assistant') {
        const head = documentRef.createElement('div');
        head.className = 'home-chat-message-head';
        const mark = documentRef.createElement('i');
        mark.textContent = 'AI';
        const label = documentRef.createElement('span');
        label.textContent = state === 'streaming' ? '正在回复' : 'AI 助手';
        head.append(mark, label);
        renderText(body, text);
        article.append(head, body);
      } else {
        body.textContent = text;
        article.append(body);
        if (sources.length) {
          const badges = documentRef.createElement('div');
          badges.className = 'home-chat-message-sources';
          sources.forEach((source) => {
            const badge = documentRef.createElement('span');
            badge.textContent = `${ChatContext.SOURCE_LABELS[source.sourceType]} · ${source.sourceTitle}`;
            badge.title = badge.textContent;
            badges.append(badge);
          });
          article.append(badges);
        }
      }
      elements.messages.append(article);
      return article;
    }

    function setTurnState(turn, state, detail) {
      turn.state = state;
      turn.detail = detail || '';
      turn.reply.dataset.state = state;
      const label = turn.reply.querySelector('.home-chat-message-head span');
      if (label) label.textContent = state === 'streaming' ? '正在回复' : state === 'complete' ? (turn.isVersion ? 'AI 助手 · 新版本' : 'AI 助手') : state === 'stopped' ? '已停止' : '生成失败';
      turn.reply.querySelector('.home-chat-message-state')?.remove();
      if (detail) {
        const note = documentRef.createElement('p');
        note.className = 'home-chat-message-state';
        note.textContent = detail;
        turn.reply.append(note);
      }
    }

    function noteTitle(answer) {
      return ChatReader.title(answer) || 'AI 对话回复';
    }

    async function toggleTurnNote(turn) {
      if (!turn || turn.noteMutating) return;
      turn.noteMutating = true;
      addTurnActions(turn, true);
      if (readerView()?.isTurn?.(turn)) readerView().updateSaveAction();
      if (turn.savedNote) {
        const undone = await windowRef.NotchNotes?.undoGenerated?.(turn.savedNote).catch(() => null);
        if (undone?.ok) {
          turn.savedNote = null;
          readerView()?.reportTurnStatus?.(turn, undone.workspaceSynced === false ? '已在本机撤销，工作区同步失败' : '已撤销保存笔记', undone.workspaceSynced === false);
        } else readerView()?.reportTurnStatus?.(turn, '笔记已变化，无法撤销', true);
      } else {
        const result = await windowRef.NotchNotes?.saveGenerated?.(noteTitle(turn.answer), turn.answer, 'model').catch(() => null);
        if (result?.ok) {
          turn.savedNote = result.note;
          readerView()?.reportTurnStatus?.(turn, result.workspaceSynced === false ? '已保存到本机，工作区同步失败' : '已保存为笔记', result.workspaceSynced === false);
        } else readerView()?.reportTurnStatus?.(turn, result?.error === 'capacity' ? '笔记库已达到 200 篇上限' : '保存笔记失败', true);
      }
      turn.noteMutating = false;
      addTurnActions(turn, true);
      if (readerView()?.isTurn?.(turn)) readerView().updateSaveAction();
    }

    function addTurnActions(turn, complete) {
      turn.reply.querySelector('.home-chat-message-actions')?.remove();
      const actions = documentRef.createElement('div');
      actions.className = 'home-chat-message-actions';
      if (turn.answer) actions.append(actionButton('copy', '复制回复', async () => {
        try {
          await api()?.writeClipboard?.({ text: turn.answer });
          setText(elements.chatStatus, '回复已复制');
          readerView()?.reportTurnStatus?.(turn, '回复已复制');
        } catch {
          setText(elements.chatStatus, '复制失败');
          readerView()?.reportTurnStatus?.(turn, '复制失败', true);
        }
      }));
      if (complete && ChatReader.analyze(turn.answer).eligible) {
        turn.readerButton = actionButton('reader', '打开长回答工作台', () => readerView()?.open?.(turn));
        actions.append(turn.readerButton);
      }
      actions.append(actionButton('retry', complete ? '重新生成' : '重试', () => void submit(turn.prompt, { user: turn.user, context: turn.context, sources: turn.sources, versionOf: turn })));
      if (complete) {
        const save = actionButton(turn.savedNote ? 'undo' : 'save', turn.savedNote ? '撤销保存' : '保存为笔记', () => void toggleTurnNote(turn));
        save.dataset.saved = String(Boolean(turn.savedNote));
        save.disabled = Boolean(turn.noteMutating);
        actions.append(save);
      }
      turn.reply.append(actions);
    }

    function contextFor(currentContent, source = history) {
      const context = source.slice(-12);
      while (context.length && context.reduce((sum, item) => sum + item.content.length, currentContent.length) > 12000) context.splice(0, 2);
      return context;
    }

    function cancel() {
      if (!requestId || !pendingTurn) return;
      const id = requestId;
      const turn = pendingTurn;
      requestId = '';
      pendingTurn = null;
      ++sequence;
      void api()?.cancelAI?.(id).catch(() => {});
      if (!turn.answer) turn.reply.querySelector('.home-chat-message-body').replaceChildren();
      else renderText(turn.reply.querySelector('.home-chat-message-body'), turn.answer);
      setTurnState(turn, 'stopped', turn.answer ? '生成已停止，以上内容不计入后续上下文。' : '生成已停止，本轮未计入后续上下文。');
      addTurnActions(turn, false);
      chatControls(false);
      const saved = sessionView()?.hasSession?.() ? sessionView().persist() : { ok: true };
      setStatus(saved.ok ? '已停止，可重试本轮' : sessionView()?.sessionError?.(saved.error));
      elements.chatInput.focus();
    }

    async function submit(rawText, options = {}) {
      if (requestId) return;
      const text = String(rawText || '').trim();
      if (!text) return;
      if (conversationRecords.length >= ChatSessionsMaxRecords()) {
        setStatus('此对话已达到 30 个回复上限，请新建对话');
        return;
      }
      const sources = ChatContext.normalizeSources(options.sources === undefined ? contextView()?.getSelectedSources?.() || [] : options.sources);
      const historyContent = ChatContext.messageContent(text, sources);
      if (historyContent.length > 12000) {
        setStatus('问题与参考资料超过 12000 字符，请移除资料或缩短问题');
        return;
      }
      const context = contextFor(historyContent, options.context || history);
      const user = options.user || message('user', text, 'complete', sources);
      const reply = message('assistant', '正在思考…', 'streaming');
      if (options.versionOf) {
        options.versionOf.reply.dataset.version = 'previous';
        const oldLabel = options.versionOf.reply.querySelector('.home-chat-message-head span');
        if (oldLabel) oldLabel.textContent = 'AI 助手 · 上一版本';
        reply.querySelector('.home-chat-message-head span').textContent = 'AI 助手 · 新版本';
      }
      const createdAt = Date.now();
      const turn = { id: `reply-${createdAt}-${++sequence}`, groupId: options.versionOf?.groupId || `turn-${createdAt}-${sequence}`, prompt: text, context, sources, historyContent, user, reply, answer: '', state: 'streaming', detail: '', createdAt, savedNote: null, isVersion: Boolean(options.versionOf) };
      conversationRecords.push(turn);
      pendingTurn = turn;
      elements.messages.scrollTop = elements.messages.scrollHeight;
      if (!options.user) {
        elements.chatInput.value = '';
        contextView()?.clear?.();
        contextView()?.close?.();
      }
      const seq = ++sequence;
      const id = `home-chat-${Date.now()}-${seq}`;
      requestId = id;
      chatControls(true);
      setStatus(context.length ? `使用最近 ${context.length / 2} 轮${sources.length ? `及 ${sources.length} 份资料` : ''}生成` : sources.length ? `使用 ${sources.length} 份所选资料生成` : '正在生成，可随时停止');
      const result = await api()?.runAI?.({ requestId: id, action: 'chat', interactive: true, context: { sourceType: 'manual', text, sources }, history: context, referenceTime: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }).catch(() => null);
      if (seq !== sequence || id !== requestId) return;
      requestId = '';
      pendingTurn = null;
      chatControls(false);
      if (!result?.ok) {
        if (turn.answer) renderText(reply.querySelector('.home-chat-message-body'), turn.answer);
        else reply.querySelector('.home-chat-message-body').replaceChildren();
        const detail = chatErrors[result?.error] || '生成失败，请重试。';
        setTurnState(turn, 'error', detail);
        addTurnActions(turn, false);
        const saved = sessionView()?.hasSession?.() ? sessionView().persist() : { ok: true };
        setStatus(saved.ok ? '本轮未计入上下文，可重试' : sessionView()?.sessionError?.(saved.error));
        elements.chatInput.focus();
        return;
      }
      turn.answer = String(result.text || '');
      renderText(reply.querySelector('.home-chat-message-body'), turn.answer);
      setTurnState(turn, 'complete', '');
      addTurnActions(turn, true);
      history = [...context, { role: 'user', content: historyContent }, { role: 'assistant', content: turn.answer }].slice(-12);
      const reusableTurns = contextFor('', history).length / 2;
      const saved = sessionView()?.hasSession?.() ? sessionView().persist() : { ok: true };
      setStatus(!saved.ok ? sessionView()?.sessionError?.(saved.error) : reusableTurns ? `回复完成 · 后续将使用最近 ${reusableTurns} 轮` : '回复完成 · 本轮内容过长，不加入下一轮上下文');
      elements.chatInput.focus();
    }

    function ChatSessionsMaxRecords() {
      return host.chatSessionsMaxRecords || 30;
    }

    const onAIEvent = (event) => {
      if (event?.requestId !== requestId || event.type !== 'textDelta' || !pendingTurn) return;
      const follow = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;
      const delta = String(event.text || '');
      pendingTurn.answer = (pendingTurn.answer + delta).slice(0, 65536);
      pendingTurn.reply.querySelector('.home-chat-message-body').textContent = pendingTurn.answer;
      if (follow) elements.messages.scrollTop = elements.messages.scrollHeight;
    };
    api()?.onAIEvent?.(onAIEvent);

    elements.chatForm.addEventListener('submit', (event) => { event.preventDefault(); void submit(elements.chatInput.value); });
    elements.chatStop.addEventListener('click', cancel);
    elements.messages.addEventListener('click', async (event) => {
      const codeCopy = event.target.closest('[data-markdown-copy]');
      if (codeCopy) {
        const code = codeCopy.closest('.markdown-code')?.querySelector('code')?.textContent || '';
        try { await api()?.writeClipboard?.({ text: code }); setStatus('代码已复制'); }
        catch { setStatus('复制失败'); }
        return;
      }
      const link = event.target.closest('[data-external-url]');
      if (link) { event.preventDefault(); await api()?.openExternal?.(link.dataset.externalUrl).catch(() => {}); }
    });

    return Object.freeze({
      getRequestId: () => requestId,
      getHistory: () => history,
      setHistory: (value) => { history = Array.isArray(value) ? value : []; },
      getConversationRecords: () => conversationRecords,
      nextSequence: () => ++sequence,
      clearConversation: () => { history = []; conversationRecords.length = 0; pendingTurn = null; requestId = ''; },
      message,
      setTurnState,
      addTurnActions,
      toggleTurnNote,
      submit,
      cancel,
      dispose() {},
    });
  }

  return { createController };
});
