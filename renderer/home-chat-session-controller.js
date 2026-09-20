(function exposeHomeChatSession(root, factory) {
  const api = factory();
  if (root) root.NotchHomeChatSession = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeChatSessionApi() {
  'use strict';

  function createController(host = {}) {
    const $ = host.$ || ((id) => document.getElementById(id));
    const documentRef = host.document || document;
    const windowRef = host.window || window;
    const storage = host.storage || windowRef.localStorage;
    const ChatSessions = host.ChatSessions || windowRef.NotchChatSessions;
    const sessionPanel = $('home-chat-session-panel');
    const sessionSearch = $('home-chat-session-search');
    const sessionList = $('home-chat-session-list');
    const chatInput = $('home-chat-input');
    let savedSessions = ChatSessions.parseSessions(storage.getItem(ChatSessions.STORAGE_KEY));
    let currentSessionId = '';
    let currentSessionTitle = '';
    let currentSessionCreatedAt = 0;
    let sessionDirty = false;
    let editingSessionId = '';
    let confirmDeleteSessionId = '';

    function setText(element, text) {
      if (element && element.textContent !== text) element.textContent = text;
    }

    function records() {
      return typeof host.getConversationRecords === 'function' ? host.getConversationRecords() : [];
    }

    function settledRecords() {
      return records().filter((record) => ['complete', 'stopped', 'error'].includes(record.state));
    }

    function defaultSessionTitle() {
      return String(settledRecords()[0]?.prompt || '已保存对话').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 48) || '已保存对话';
    }

    function sessionSnapshot(id, title, createdAt, updatedAt) {
      return {
        id,
        title,
        createdAt,
        updatedAt,
        records: settledRecords().map((record) => ({
          id: record.id,
          groupId: record.groupId,
          prompt: record.prompt,
          sources: record.sources,
          context: record.context,
          answer: record.answer,
          state: record.state,
          detail: record.detail || '',
          createdAt: record.createdAt,
        })),
        history: host.getHistory?.() || [],
      };
    }

    function sessionError(error) {
      return error === 'record_limit' ? '此对话已达到 30 个回复上限'
        : error === 'session_limit' ? '当前工作区已达到 30 个会话上限'
          : error === 'session_too_large' ? '此对话超过 512000 字符，未保存新更改'
            : error === 'storage_limit' ? '对话历史超过 2000000 字符，请删除旧会话后重试'
              : '对话保存失败';
    }

    function updateHeader() {
      setText($('home-chat-title'), currentSessionId ? currentSessionTitle : '临时对话');
      const state = $('home-chat-session-state');
      const dot = documentRef.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      state.replaceChildren(dot, documentRef.createTextNode(currentSessionId ? (sessionDirty ? '未保存更改' : '已保存到当前工作区') : '仅本次会话'));
      state.dataset.saved = String(Boolean(currentSessionId) && !sessionDirty);
      const save = $('home-chat-session-save');
      save.dataset.saved = String(Boolean(currentSessionId) && !sessionDirty);
      save.disabled = Boolean(host.getRequestId?.()) || !settledRecords().length || (Boolean(currentSessionId) && !sessionDirty);
      save.title = currentSessionId ? (sessionDirty ? '保存未同步的更改' : '对话已保存') : '保存到当前工作区';
      save.setAttribute('aria-label', save.title);
    }

    function commitStorage(result) {
      if (!result?.ok) return result;
      try {
        if (result.next.length) storage.setItem(ChatSessions.STORAGE_KEY, result.serialized);
        else storage.removeItem(ChatSessions.STORAGE_KEY);
      } catch {
        return { ok: false, error: 'write_failed' };
      }
      savedSessions = result.next;
      if (!sessionPanel.hidden) renderPanel();
      return result;
    }

    function syncWorkspace(sessionId) {
      if (typeof host.syncWorkspaceSnapshot !== 'function') return;
      void host.syncWorkspaceSnapshot().then((synced) => {
        if (!synced && currentSessionId === sessionId) host.setStatus?.('已保存在本机，当前工作区同步失败');
      });
    }

    function persist({ create = false } = {}) {
      const currentRecords = settledRecords();
      if (!currentRecords.length) return { ok: false, error: 'empty_session' };
      const now = Date.now();
      const proposedId = currentSessionId || (create ? `chat-${now}-${host.nextSequence?.() || now}` : '');
      if (!proposedId) return { ok: false, error: 'temporary_session' };
      const proposedTitle = currentSessionTitle || defaultSessionTitle();
      const result = commitStorage(ChatSessions.upsertSession(savedSessions, sessionSnapshot(proposedId, proposedTitle, currentSessionCreatedAt || now, now)));
      if (!result.ok) {
        sessionDirty = Boolean(currentSessionId);
        updateHeader();
        return result;
      }
      currentSessionId = proposedId;
      currentSessionTitle = proposedTitle;
      currentSessionCreatedAt ||= now;
      sessionDirty = false;
      updateHeader();
      syncWorkspace(proposedId);
      return result;
    }

    function formatSessionTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      return date.toDateString() === now.toDateString()
        ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }

    function close({ focus = false } = {}) {
      sessionPanel.hidden = true;
      $('home-chat-sessions').setAttribute('aria-expanded', 'false');
      editingSessionId = '';
      confirmDeleteSessionId = '';
      if (focus) chatInput.focus();
    }

    function rename(sessionId, title) {
      const result = commitStorage(ChatSessions.renameSession(savedSessions, sessionId, title, Date.now()));
      if (!result.ok) {
        host.setStatus?.(result.error === 'invalid_title' ? '会话标题不能为空' : '无法重命名会话');
        return;
      }
      if (currentSessionId === sessionId) {
        currentSessionTitle = result.next.find((session) => session.id === sessionId)?.title || currentSessionTitle;
        updateHeader();
      }
      editingSessionId = '';
      renderPanel();
      syncWorkspace(sessionId);
      host.setStatus?.('会话已重命名');
    }

    function remove(sessionId) {
      if (currentSessionId === sessionId && host.getRequestId?.()) host.cancelChat?.();
      const result = commitStorage(ChatSessions.removeSession(savedSessions, sessionId));
      if (!result.ok) {
        host.setStatus?.('无法删除会话');
        return;
      }
      if (currentSessionId === sessionId) host.resetChat?.({ keepSessionPanel: true, status: '已删除会话，并开始新的临时对话', force: true });
      confirmDeleteSessionId = '';
      renderPanel();
      syncWorkspace(sessionId);
    }

    function renderPanel() {
      const rows = ChatSessions.searchSessions(savedSessions, sessionSearch.value);
      sessionList.replaceChildren();
      rows.forEach((session) => {
        const row = documentRef.createElement('div');
        row.className = 'home-chat-session-row';
        row.dataset.active = String(session.id === currentSessionId);
        if (editingSessionId === session.id) {
          const edit = documentRef.createElement('form');
          edit.className = 'home-chat-session-edit';
          const input = documentRef.createElement('input');
          input.maxLength = 48;
          input.value = session.title;
          input.setAttribute('aria-label', '会话标题');
          const confirm = host.actionButton('check', '确认重命名', () => {});
          confirm.type = 'submit';
          const cancel = host.actionButton('close', '取消重命名', () => { editingSessionId = ''; renderPanel(); });
          edit.addEventListener('submit', (event) => { event.preventDefault(); rename(session.id, input.value); });
          edit.append(input, confirm, cancel);
          row.append(edit);
          sessionList.append(row);
          requestAnimationFrame(() => { input.focus(); input.select(); });
          return;
        }
        const open = documentRef.createElement('button');
        open.type = 'button';
        open.className = 'home-chat-session-open';
        const title = documentRef.createElement('strong');
        title.textContent = session.title;
        const detail = documentRef.createElement('span');
        detail.textContent = `${session.records.length} 个回复 · ${formatSessionTime(session.updatedAt)}`;
        open.append(title, detail);
        open.addEventListener('click', () => openSaved(session.id));
        const actions = documentRef.createElement('div');
        actions.className = 'home-chat-session-actions';
        if (confirmDeleteSessionId === session.id) {
          const cancel = host.actionButton('close', '取消删除', () => { confirmDeleteSessionId = ''; renderPanel(); });
          const removeButton = documentRef.createElement('button');
          removeButton.type = 'button';
          removeButton.dataset.confirm = 'true';
          removeButton.textContent = '确认删除';
          removeButton.addEventListener('click', () => remove(session.id));
          actions.append(cancel, removeButton);
        } else {
          actions.append(
            host.actionButton('edit', '重命名会话', () => { editingSessionId = session.id; confirmDeleteSessionId = ''; renderPanel(); }),
            host.actionButton('trash', '删除会话', () => { confirmDeleteSessionId = session.id; editingSessionId = ''; renderPanel(); }),
          );
        }
        row.append(open, actions);
        sessionList.append(row);
      });
      if (!rows.length) {
        const empty = documentRef.createElement('p');
        empty.className = 'home-chat-session-empty';
        empty.textContent = sessionSearch.value ? '没有匹配的对话' : '当前工作区还没有保存的对话';
        sessionList.append(empty);
      }
      setText($('home-chat-session-count'), `${savedSessions.length} / ${ChatSessions.MAX_SESSIONS} 个会话`);
      $('home-chat-session-confirm-save').hidden = Boolean(currentSessionId) || !settledRecords().length || Boolean(host.getRequestId?.());
    }

    function openSaved(sessionId) {
      if (sessionId === currentSessionId) { close({ focus: true }); return; }
      if (host.getRequestId?.()) host.cancelChat?.();
      host.closeReader?.({ focus: false });
      if (sessionDirty) {
        host.setStatus?.('当前会话有未保存更改，请先处理容量或存储问题');
        return;
      }
      const session = savedSessions.find((item) => item.id === sessionId);
      if (!session) return;
      currentSessionId = session.id;
      currentSessionTitle = session.title;
      currentSessionCreatedAt = session.createdAt;
      sessionDirty = false;
      host.setHistory?.(session.history);
      host.setConversationRecords?.([]);
      host.clearSelectedSources?.();
      host.closeContextPicker?.();
      close();
      host.clearMessages?.();
      const users = new Map();
      session.records.forEach((saved) => {
        let user = users.get(saved.groupId);
        if (!user) {
          user = host.message?.('user', saved.prompt, 'complete', saved.sources);
          users.set(saved.groupId, user);
        }
        const reply = host.message?.('assistant', saved.answer, saved.state);
        const turn = { ...saved, user, reply, savedNote: null, isVersion: session.records.filter((item) => item.groupId === saved.groupId).length > 1 };
        host.setTurnState?.(turn, saved.state, saved.detail);
        host.addTurnActions?.(turn, saved.state === 'complete');
        host.getConversationRecords?.().push(turn);
      });
      const conversation = host.getConversationRecords?.() || [];
      for (const groupId of users.keys()) {
        const versions = conversation.filter((record) => record.groupId === groupId && record.state === 'complete');
        if (versions.length > 1) versions.forEach((record, index) => {
          const label = record.reply.querySelector('.home-chat-message-head span');
          if (label) label.textContent = index === versions.length - 1 ? 'AI 助手 · 新版本' : 'AI 助手 · 上一版本';
          record.reply.dataset.version = index === versions.length - 1 ? 'current' : 'previous';
        });
      }
      updateHeader();
      host.resizeChatInput?.();
      host.scrollMessages?.();
      host.setStatus?.(`已打开“${session.title}”`);
      chatInput.focus();
    }

    function open() {
      host.closeContextPicker?.();
      sessionSearch.value = '';
      renderPanel();
      sessionPanel.hidden = false;
      $('home-chat-sessions').setAttribute('aria-expanded', 'true');
      sessionSearch.focus();
    }

    function resetCurrent() {
      currentSessionId = '';
      currentSessionTitle = '';
      currentSessionCreatedAt = 0;
      sessionDirty = false;
      updateHeader();
    }

    function resetWorkspace() {
      savedSessions = [];
      resetCurrent();
      close();
    }

    $('home-chat-session-save').addEventListener('click', () => {
      if (!currentSessionId) {
        open();
        host.setStatus?.('确认保存范围后，将对话写入当前工作区');
        $('home-chat-session-confirm-save').focus();
        return;
      }
      const result = persist();
      host.setStatus?.(result.ok ? '对话更改已保存' : sessionError(result.error));
    });
    $('home-chat-sessions').addEventListener('click', () => { if (sessionPanel.hidden) open(); else close({ focus: true }); });
    $('home-chat-session-close').addEventListener('click', () => close({ focus: true }));
    $('home-chat-session-confirm-save').addEventListener('click', () => {
      const result = persist({ create: true });
      if (result.ok) { renderPanel(); host.setStatus?.('对话及资料文字快照已保存到当前工作区'); }
      else host.setStatus?.(sessionError(result.error));
    });
    $('home-chat-session-new').addEventListener('click', () => host.resetChat?.({ status: '已开始新的临时对话' }));
    sessionSearch.addEventListener('input', renderPanel);
    sessionPanel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); } });

    return {
      getSessionId: () => currentSessionId,
      getSessionTitle: () => currentSessionTitle,
      getSessionLabel: () => currentSessionId ? currentSessionTitle : '临时对话',
      hasSession: () => Boolean(currentSessionId),
      isDirty: () => sessionDirty,
      persist,
      sessionError,
      updateHeader,
      open,
      close,
      resetCurrent,
      resetWorkspace,
      dispose() {},
    };
  }

  return { createController };
});
