(function exposeHomeChatContext(root, factory) {
  const api = factory();
  if (root) root.NotchHomeChatContext = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeChatContextApi() {
  'use strict';

  function createController(host = {}) {
    const $ = host.$ || ((id) => document.getElementById(id));
    const documentRef = host.document || document;
    const ChatContext = host.ChatContext || window.NotchChatContext;
    const contextPicker = $('home-chat-context-picker');
    const contextSearch = $('home-chat-context-search');
    const contextList = $('home-chat-context-list');
    const contextChips = $('home-chat-context-chips');
    const chatInput = $('home-chat-input');
    let selectedSources = [];
    let contextCatalog = [];
    let contextType = 'all';

    function setText(element, text) {
      if (element && element.textContent !== text) element.textContent = text;
    }

    function selectedSource(key) {
      return selectedSources.find((source) => ChatContext.sourceKey(source) === key);
    }

    function messageLength(sources = selectedSources, text = chatInput.value) {
      return ChatContext.messageContent(text, sources).length;
    }

    function renderChips() {
      contextChips.replaceChildren();
      selectedSources.forEach((source) => {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.dataset.removeChatSource = ChatContext.sourceKey(source);
        button.title = `移除${ChatContext.SOURCE_LABELS[source.sourceType]}：${source.sourceTitle}`;
        const label = documentRef.createElement('span');
        label.textContent = `${ChatContext.SOURCE_LABELS[source.sourceType]} · ${source.sourceTitle}`;
        const icon = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('aria-hidden', 'true');
        const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'm7 7 10 10M17 7 7 17');
        icon.append(path);
        button.append(label, icon);
        contextChips.append(button);
      });
      contextChips.hidden = selectedSources.length === 0;
      host.onSelectionChanged?.(selectedSources.slice());
    }

    function renderPicker() {
      const rows = ChatContext.catalog(contextCatalog, contextSearch.value, contextType);
      contextList.replaceChildren();
      rows.slice(0, 100).forEach((source) => {
        const key = ChatContext.sourceKey(source);
        const active = Boolean(selectedSource(key));
        const candidate = active ? selectedSources.filter((item) => ChatContext.sourceKey(item) !== key) : [...selectedSources, source];
        const fits = source.text.length <= 12000 && messageLength(candidate) <= 12000;
        const atLimit = !active && selectedSources.length >= ChatContext.MAX_SOURCES;
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'home-chat-context-row';
        button.dataset.chatSource = key;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(active));
        button.disabled = atLimit || (!active && !fits);
        const copy = documentRef.createElement('span');
        const title = documentRef.createElement('strong');
        title.textContent = source.sourceTitle;
        const detail = documentRef.createElement('small');
        detail.textContent = source.detail || source.text.replace(/\s+/g, ' ').slice(0, 90);
        copy.append(title, detail);
        const kind = documentRef.createElement('i');
        kind.textContent = atLimit ? '已达上限' : !active && !fits ? '超过上限' : ChatContext.SOURCE_LABELS[source.sourceType];
        button.append(copy, kind);
        contextList.append(button);
      });
      if (!rows.length) {
        const emptyState = documentRef.createElement('p');
        emptyState.className = 'home-chat-context-empty';
        emptyState.textContent = contextSearch.value ? '没有匹配的文字资料' : '当前没有可添加的文字资料';
        contextList.append(emptyState);
      }
      setText($('home-chat-context-result'), `${rows.length} 项资料${rows.length > 100 ? ' · 显示前 100 项' : ''}`);
      setText($('home-chat-context-selected'), `已选择 ${selectedSources.length} / ${ChatContext.MAX_SOURCES}`);
    }

    function close({ focus = false } = {}) {
      contextPicker.hidden = true;
      $('home-chat-context-add').setAttribute('aria-expanded', 'false');
      if (focus) chatInput.focus();
    }

    function open() {
      contextCatalog = host.collectSources?.() || [];
      contextType = 'all';
      contextSearch.value = '';
      documentRef.querySelectorAll('[data-chat-context-type]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.chatContextType === 'all')));
      renderPicker();
      contextPicker.hidden = false;
      $('home-chat-context-add').setAttribute('aria-expanded', 'true');
      contextSearch.focus();
    }

    function clear() {
      selectedSources = [];
      renderChips();
      if (!contextPicker.hidden) renderPicker();
    }

    function choose(key) {
      const active = selectedSource(key);
      if (active) {
        selectedSources = selectedSources.filter((source) => ChatContext.sourceKey(source) !== key);
      } else {
        const source = contextCatalog.find((item) => ChatContext.sourceKey(item) === key);
        if (!source) return;
        const candidate = ChatContext.normalizeSources([...selectedSources, source]);
        if (candidate.length === selectedSources.length || messageLength(candidate) > 12000) {
          host.setStatus?.('最多选择 3 份资料，且资料与问题合计不能超过 12000 字符');
          return;
        }
        selectedSources = candidate;
      }
      renderChips();
      renderPicker();
      if (!host.getRequestId?.()) host.setStatus?.(selectedSources.length ? `将随本条消息发送 ${selectedSources.length} 份资料` : '未选择参考资料');
      requestAnimationFrame(() => contextList.querySelector(`[data-chat-source="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }));
    }

    const contextTabs = [...documentRef.querySelectorAll('[data-chat-context-type]')];
    $('home-chat-context-add').addEventListener('click', () => {
      if (contextPicker.hidden) { host.closeSessionPanel?.(); open(); }
      else close({ focus: true });
    });
    $('home-chat-context-close').addEventListener('click', () => close({ focus: true }));
    contextSearch.addEventListener('input', renderPicker);
    contextTabs.forEach((button) => button.addEventListener('click', () => {
      contextType = button.dataset.chatContextType;
      contextTabs.forEach((item) => item.setAttribute('aria-selected', String(item === button)));
      renderPicker();
    }));
    contextList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-chat-source]');
      if (!button || button.disabled) return;
      choose(button.dataset.chatSource);
    });
    contextTabs.forEach((button, index) => button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? contextTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + contextTabs.length) % contextTabs.length;
      contextTabs[targetIndex].focus();
      contextTabs[targetIndex].click();
    }));
    contextChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-chat-source]');
      if (!button) return;
      choose(button.dataset.removeChatSource);
      chatInput.focus();
    });
    contextPicker.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); }
    });
    documentRef.addEventListener('pointerdown', (event) => {
      if (!contextPicker.hidden && !contextPicker.contains(event.target) && !$('home-chat-context-add').contains(event.target)) close();
    });

    return {
      isOpen: () => !contextPicker.hidden,
      getSelectedSources: () => selectedSources.slice(),
      messageLength,
      renderChips,
      renderPicker,
      open,
      close,
      clear,
      dispose() {},
    };
  }

  return { createController };
});
