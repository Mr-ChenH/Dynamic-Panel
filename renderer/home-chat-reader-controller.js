(function exposeHomeChatReader(root, factory) {
  const api = factory();
  if (root) root.NotchHomeChatReader = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeChatReaderApi() {
  'use strict';

  function createController(host = {}) {
    const $ = host.$ || ((id) => document.getElementById(id));
    const documentRef = host.document || document;
    const windowRef = host.window || window;
    const api = host.api || windowRef.notchAPI;
    const ChatReader = host.ChatReader || windowRef.NotchChatReader;
    const reader = $('home-chat-reader');
    const readerContent = $('home-chat-reader-content');
    const readerOutline = $('home-chat-reader-outline');
    const messages = $('home-chat-messages');
    const chatInput = $('home-chat-input');
    let readerTurn = null;
    let readerScrollTop = 0;
    let readerInertState = [];

    function setText(element, text) {
      if (element && element.textContent !== text) element.textContent = text;
    }

    function renderText(container, text) {
      if (typeof host.renderText === 'function') host.renderText(container, text);
      else if (windowRef.NotchMarkdown?.render) windowRef.NotchMarkdown.render(container, text);
      else container.textContent = text;
    }

    function setReaderStatus(text, error = false) {
      setText($('home-chat-reader-status'), text);
      $('home-chat-reader-status').dataset.error = String(error);
    }

    function reportTurnStatus(turn, text, error = false) {
      if (typeof host.setChatStatus === 'function') host.setChatStatus(text);
      if (!reader.hidden && readerTurn === turn) setReaderStatus(text, error);
    }

    function updateSaveAction() {
      const button = $('home-chat-reader-save');
      if (!readerTurn) return;
      button.disabled = Boolean(readerTurn.noteMutating);
      button.dataset.saved = String(Boolean(readerTurn.savedNote));
      button.innerHTML = readerTurn.savedNote ? host.chatIcons?.undo || '' : host.chatIcons?.save || '';
      button.setAttribute('aria-label', readerTurn.savedNote ? '撤销保存笔记' : '保存为笔记');
      button.title = button.getAttribute('aria-label');
    }

    function selectionText() {
      if (reader.hidden) return '';
      const selection = windowRef.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !readerContent.contains(selection.anchorNode) || !readerContent.contains(selection.focusNode)) return '';
      return selection.toString().trim();
    }

    function updateSelectionActions() {
      if (reader.hidden || !readerTurn) return;
      const selected = selectionText();
      $('home-chat-reader-copy-selection').disabled = !selected;
      const source = ChatReader.todoSource(readerTurn.answer, selected);
      const todos = $('home-chat-reader-todos');
      todos.disabled = false;
      todos.setAttribute('aria-disabled', String(!source.ok));
      todos.title = source.ok ? (source.scope === 'selection' ? `从选中的 ${source.length} 个字符提取待办` : '从全文提取待办')
        : source.error === 'source_too_long' ? '请先选择不超过 12000 字符的内容' : '没有可提取的内容';
    }

    function close({ focus = true } = {}) {
      if (reader.hidden) return;
      const turn = readerTurn;
      reader.hidden = true;
      readerTurn = null;
      windowRef.getSelection()?.removeAllRanges();
      messages.scrollTop = readerScrollTop;
      readerInertState.forEach(([node, inert]) => { node.inert = inert; });
      readerInertState = [];
      if (focus) (turn?.readerButton?.isConnected ? turn.readerButton : chatInput).focus({ preventScroll: true });
    }

    function open(turn) {
      if (!turn || turn.state !== 'complete' || !ChatReader.analyze(turn.answer).eligible) return;
      if (host.getRequestId?.()) {
        host.setChatStatus?.('请先停止当前生成，再打开长回答');
        return;
      }
      host.closeContextPicker?.();
      host.closeSessionPanel?.();
      readerTurn = turn;
      readerScrollTop = messages.scrollTop;
      readerInertState = [...reader.parentElement.children]
        .filter((node) => node !== reader)
        .map((node) => [node, node.inert]);
      readerInertState.forEach(([node]) => { node.inert = true; });
      const analysis = ChatReader.analyze(turn.answer);
      setText($('home-chat-reader-title'), ChatReader.title(turn.answer));
      setText($('home-chat-reader-meta'), `${analysis.charCount} 字符 · ${analysis.headings.length || 1} 个章节 · ${host.getSessionLabel?.() || '临时对话'}`);
      renderText(readerContent, turn.answer);
      readerOutline.replaceChildren();
      const headingNodes = [...readerContent.querySelectorAll('h2, h3, h4, h5')];
      headingNodes.forEach((heading, index) => {
        heading.id = `chat-reader-section-${index + 1}`;
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.dataset.level = String(Math.max(1, Number(heading.tagName.slice(1)) - 1));
        button.textContent = heading.textContent || `第 ${index + 1} 节`;
        button.title = button.textContent;
        button.addEventListener('click', () => heading.scrollIntoView({ block: 'start', behavior: windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
        readerOutline.append(button);
      });
      if (!headingNodes.length) {
        const empty = documentRef.createElement('p');
        empty.className = 'home-chat-reader-outline-empty';
        empty.textContent = '全文';
        readerOutline.append(empty);
      }
      reader.hidden = false;
      readerContent.scrollTop = 0;
      updateSaveAction();
      updateSelectionActions();
      setReaderStatus('阅读视图不会自动保存内容');
      requestAnimationFrame(() => $('home-chat-reader-close').focus({ preventScroll: true }));
    }

    async function copy(text, success, failure) {
      try {
        await (host.getApi?.() || api)?.writeClipboard?.({ text });
        setReaderStatus(success);
      } catch {
        setReaderStatus(failure, true);
      }
    }

    function handleContentClick(event) {
      const codeCopy = event.target.closest('[data-markdown-copy]');
      if (codeCopy) {
        const code = codeCopy.closest('.markdown-code')?.querySelector('code')?.textContent || '';
        void copy(code, '代码已复制', '复制代码失败');
        return;
      }
      const link = event.target.closest('[data-external-url]');
      if (link) {
        event.preventDefault();
        void (host.getApi?.() || api)?.openExternal?.(link.dataset.externalUrl).catch(() => {});
      }
    }

    const onSelectionChange = () => updateSelectionActions();
    const onReaderKeydown = (event) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        close();
      }
    };
    const onModeChange = (event) => {
      if (event.detail?.expanded === false) close({ focus: false });
    };
    $('home-chat-reader-close').addEventListener('click', () => close());
    $('home-chat-reader-copy').addEventListener('click', () => {
      if (readerTurn) void copy(readerTurn.answer, '全文已复制', '复制全文失败');
    });
    $('home-chat-reader-copy-selection').addEventListener('click', () => {
      const text = selectionText();
      if (!text) { setReaderStatus('请先在正文中选择内容', true); return; }
      void copy(text, `已复制 ${text.length} 个字符`, '复制选区失败');
    });
    $('home-chat-reader-save').addEventListener('click', () => {
      if (readerTurn) void host.toggleTurnNote?.(readerTurn);
    });
    $('home-chat-reader-todos').addEventListener('click', () => {
      if (!readerTurn) return;
      const source = ChatReader.todoSource(readerTurn.answer, selectionText());
      if (!source.ok) {
        setReaderStatus(source.error === 'source_too_long' ? '内容超过 12000 字符，请先缩小选区' : '没有可提取的内容', true);
        return;
      }
      setReaderStatus(source.scope === 'selection' ? `使用选中的 ${source.length} 个字符提取待办` : '使用全文提取待办');
      windowRef.NotchAI?.open?.({ action: 'extractTodos', sourceType: 'manual', sourceTitle: host.noteTitle?.(readerTurn.answer) || 'AI 对话回复', text: source.text, returnFocus: $('home-chat-reader-todos') });
    });
    readerContent.addEventListener('click', handleContentClick);
    reader.addEventListener('keydown', onReaderKeydown);
    documentRef.addEventListener('selectionchange', onSelectionChange);
    documentRef.addEventListener('notch:modechange', onModeChange);

    return {
      isOpen: () => !reader.hidden,
      isTurn: (turn) => readerTurn === turn,
      open,
      close,
      updateSaveAction,
      reportTurnStatus,
      selectionText,
      handleEscape() { if (reader.hidden) return false; close(); return true; },
      dispose() {
        documentRef.removeEventListener('selectionchange', onSelectionChange);
        documentRef.removeEventListener('notch:modechange', onModeChange);
      },
    };
  }

  return { createController };
});
