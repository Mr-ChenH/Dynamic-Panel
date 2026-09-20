(function exposeHomeQuickCapture(root, factory) {
  const api = factory();
  if (root) root.NotchHomeQuickCapture = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeQuickCaptureApi() {
  'use strict';

  const DRAFT_KEY = 'notch-home-capture-v1';

  function createController(host = {}) {
    const documentRef = host.document || document;
    const storage = host.storage || window.localStorage;
    const elements = host.getElements ? host.getElements() : {
      card: documentRef.querySelector('.home-capture'),
      input: documentRef.getElementById('home-capture-input'),
      save: documentRef.getElementById('home-capture-save'),
      status: documentRef.getElementById('home-capture-status'),
      modes: [...documentRef.querySelectorAll('[data-home-capture-mode]')],
    };
    const getDomain = () => host.getDomain?.() || window.NotchDomain;
    const getWorkspace = () => host.getWorkspace?.() || window.NotchWorkspace;
    const getNotes = () => host.getNotes?.() || window.NotchNotes;
    let captureMode = 'auto';
    let captureBusy = false;

    const setText = (element, text) => host.setText?.(element, text);
    const plan = () => getDomain().classifyHomeCapture(elements.input.value, captureMode);

    function updatePresentation(message = '') {
      const current = plan();
      elements.card.dataset.captureKind = current.kind;
      elements.modes.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.homeCaptureMode === captureMode)));
      elements.save.textContent = current.content ? (current.kind === 'link' ? '保存链接' : '保存笔记') : '收集';
      elements.save.disabled = captureBusy || !current.content || (current.kind === 'link' && !current.url);
      if (message) setText(elements.status, message);
      else if (!current.content) setText(elements.status, captureMode === 'auto' ? '自动识别文字或链接' : `固定保存到${captureMode === 'link' ? '链接' : '笔记'}库`);
      else if (current.kind === 'link' && !current.url) setText(elements.status, '请输入一个完整的公开网址');
      else setText(elements.status, captureMode === 'auto' ? `已识别为${current.kind === 'link' ? '链接' : '笔记'}` : `将保存到${current.kind === 'link' ? '链接' : '笔记'}库`);
      return current;
    }

    async function save() {
      const current = plan();
      if (!current.content || (current.kind === 'link' && !current.url)) { elements.input.focus(); return; }
      captureBusy = true;
      elements.input.readOnly = true;
      updatePresentation(current.kind === 'link' ? '正在加入链接库…' : '正在保存笔记…');
      try {
        const result = current.kind === 'link'
          ? await getWorkspace()?.saveCapturedLink?.(current.url)
          : await getNotes()?.saveCaptured?.(current.content);
        if (!result?.ok) {
          const errors = { capacity: '笔记已满，请先整理笔记库', duplicate: '链接已存在，内容已保留', invalid_url: '请输入一个完整的公开网址' };
          updatePresentation(errors[result?.error] || '保存失败，内容已保留');
          return;
        }
        elements.input.value = '';
        storage.removeItem(DRAFT_KEY);
        const destination = current.kind === 'link' ? '链接库' : '笔记库';
        const detail = current.kind === 'link' ? '，正在补全网页信息' : '';
        updatePresentation(result.workspaceSynced === false ? `已存本机${destination}，工作区同步失败` : `已保存到${destination}${detail}`);
        host.refreshLists?.();
      } catch {
        updatePresentation('保存未完成，内容已保留');
      } finally {
        captureBusy = false;
        elements.input.readOnly = false;
        updatePresentation(elements.status.textContent);
      }
    }

    elements.input.value = storage.getItem(DRAFT_KEY) || '';
    elements.modes.forEach((button) => button.addEventListener('click', () => {
      if (captureBusy) return;
      captureMode = button.dataset.homeCaptureMode;
      updatePresentation();
      elements.input.focus();
    }));
    elements.input.addEventListener('input', () => {
      try { storage.setItem(DRAFT_KEY, elements.input.value); }
      catch { updatePresentation('草稿保存失败，请复制内容'); return; }
      updatePresentation();
    });
    elements.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      elements.save.click();
    });
    elements.save.addEventListener('click', () => void save());
    updatePresentation();

    return Object.freeze({ updatePresentation, save, mode: () => captureMode, dispose() {} });
  }

  return { createController };
});
