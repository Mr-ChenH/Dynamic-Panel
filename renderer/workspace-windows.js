(function initWorkspaceWindows() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const HIDDEN_WINDOWS_KEY = 'notch-hidden-windows';
  const windowsRefresh = document.getElementById('windows-refresh');
  const windowsHidden = document.getElementById('windows-hidden');
  const windowList = document.getElementById('window-list');
  let windows = [];
  let hiddenWindows = new Set(loadHiddenWindows());
  let windowsLoading = false;
  let workspaceTab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  let workspaceExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  let homeWindowsVisible = window.NotchHome?.isVisible?.('windows') !== false;
  let windowDrag = null;
  let suppressWindowClickUntil = 0;

  function loadHiddenWindows() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HIDDEN_WINDOWS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch (error) {
      return [];
    }
  }

  function persistHiddenWindows() {
    try { localStorage.setItem(HIDDEN_WINDOWS_KEY, JSON.stringify([...hiddenWindows])); } catch (error) {}
  }

  function windowHideKey(windowInfo) {
    return `${String(windowInfo.appName || '').trim()}\u0000${String(windowInfo.title || '').trim()}`;
  }

  function clearWindowDragVisuals() {
    const drag = windowDrag;
    windowDrag = null;
    if (drag) {
      clearTimeout(drag.timer);
      try {
        if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
      } catch (error) {}
      drag.item.classList.remove('dragging', 'remove-ready');
      drag.item.style.removeProperty('--window-drag-x');
      drag.item.style.removeProperty('--window-drag-y');
    }
    document.querySelectorAll('.home-windows.drag-active').forEach((card) => card.classList.remove('drag-active'));
    return drag;
  }

  function renderWindows(error = '') {
    if (!windowList) return;
    clearWindowDragVisuals();
    windowList.replaceChildren();
    if (error) {
      const empty = document.createElement('div');
      empty.className = 'window-empty permission';
      const screenRecording = error === 'screen_recording_permission_required';
      const heading = document.createElement('strong');
      heading.textContent = screenRecording ? '需要“屏幕录制”权限' : '需要“辅助功能”权限';
      const hint = document.createElement('span');
      hint.textContent = `系统设置 → 隐私与安全性 → ${screenRecording ? '屏幕录制与系统录音' : '辅助功能'}，允许 Dynamic Panel 后重试。`;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'window-permission-open';
      action.textContent = '打开系统设置';
      action.addEventListener('click', () => {
        window.notchAPI?.openPrivacySettings?.(screenRecording ? 'screen-recording' : 'accessibility');
      });
      empty.append(heading, hint, action);
      windowList.appendChild(empty);
      return;
    }
    const visibleWindows = Domain.numberWindowLabels(windows.filter((item) => !hiddenWindows.has(windowHideKey(item))));
    if (windowsHidden) {
      windowsHidden.hidden = hiddenWindows.size === 0;
      windowsHidden.textContent = '隐藏';
      windowsHidden.setAttribute('aria-label', `恢复已隐藏的 ${hiddenWindows.size} 个窗口`);
    }
    if (!visibleWindows.length) {
      const empty = document.createElement('div');
      empty.className = 'window-empty';
      empty.textContent = windowsLoading ? '正在读取当前窗口…' : hiddenWindows.size ? '窗口均已隐藏 · 点击上方恢复' : '没有读取到可切换窗口';
      windowList.appendChild(empty);
      return;
    }
    visibleWindows.slice(0, 15).forEach((windowInfo) => {
      const button = document.createElement('button');
      button.className = 'window-item';
      button.type = 'button';
      button.dataset.id = windowInfo.id;
      button.title = `${windowInfo.displayName}\n${windowInfo.title}\n长按后拖出卡片可隐藏`;
      const mark = document.createElement('span');
      mark.className = 'window-app-mark';
      if (windowInfo.icon) {
        const icon = document.createElement('img');
        icon.src = windowInfo.icon;
        icon.alt = '';
        icon.draggable = false;
        mark.appendChild(icon);
      } else mark.textContent = (windowInfo.appName.charAt(0) || '·').toUpperCase();
      const appName = document.createElement('strong');
      appName.textContent = windowInfo.displayName;
      button.append(mark, appName);
      windowList.appendChild(button);
    });
  }

  async function refreshWindows(force = false) {
    if (document.getElementById('home-bento')?.hidden || !window.NotchHome?.isVisible?.('windows')) return;
    if (windowsLoading || !window.notchAPI || (!force && (!workspaceExpanded || workspaceTab !== 'home'))) return;
    windowsLoading = true;
    renderWindows();
    let result;
    try { result = await window.notchAPI.listWindows(); }
    catch (error) { result = { items: [], error: 'accessibility_permission_required' }; }
    windowsLoading = false;
    windows = result && Array.isArray(result.items) ? result.items : [];
    renderWindows(result && result.error);
  }

  windowsRefresh?.addEventListener('click', () => refreshWindows(true));
  windowsHidden?.addEventListener('click', () => {
    hiddenWindows.clear();
    persistHiddenWindows();
    renderWindows();
  });

  if (windowList) {
    windowList.addEventListener('click', (event) => {
      if (Date.now() < suppressWindowClickUntil) return;
      const item = event.target.closest('.window-item[data-id]');
      if (item) window.notchAPI?.focusWindow?.(item.dataset.id);
    });
    windowList.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || windowDrag) return;
      const item = event.target.closest('.window-item[data-id]');
      if (!item) return;
      windowDrag = { item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, removeReady: false, timer: setTimeout(() => {
        if (!windowDrag || windowDrag.item !== item) return;
        windowDrag.active = true;
        item.classList.add('dragging');
        try { item.setPointerCapture(event.pointerId); } catch (error) {}
        item.closest('.home-windows')?.classList.add('drag-active');
      }, 460) };
    });
    document.addEventListener('pointermove', (event) => {
      if (!windowDrag || windowDrag.pointerId !== event.pointerId) return;
      const dx = event.clientX - windowDrag.startX;
      const dy = event.clientY - windowDrag.startY;
      if (!windowDrag.active) {
        if (Math.hypot(dx, dy) > 8) { clearTimeout(windowDrag.timer); windowDrag = null; }
        return;
      }
      event.preventDefault();
      windowDrag.item.style.setProperty('--window-drag-x', `${dx}px`);
      windowDrag.item.style.setProperty('--window-drag-y', `${dy}px`);
      const bounds = windowList.closest('.home-windows').getBoundingClientRect();
      windowDrag.removeReady = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      windowDrag.item.classList.toggle('remove-ready', windowDrag.removeReady);
    });
    const finishWindowDrag = (event) => {
      if (!windowDrag || (event.pointerId != null && windowDrag.pointerId !== event.pointerId)) return;
      const drag = clearWindowDragVisuals();
      if (!drag || !drag.active) return;
      suppressWindowClickUntil = Date.now() + 450;
      if (drag.removeReady) {
        const windowInfo = windows.find((item) => item.id === drag.item.dataset.id);
        if (windowInfo) {
          hiddenWindows.add(windowHideKey(windowInfo));
          persistHiddenWindows();
          renderWindows();
        }
      }
    };
    document.addEventListener('pointerup', finishWindowDrag);
    document.addEventListener('pointercancel', finishWindowDrag);
    windowList.addEventListener('lostpointercapture', clearWindowDragVisuals, true);
    window.addEventListener('blur', clearWindowDragVisuals);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearWindowDragVisuals(); });
  }

  document.addEventListener('notch:tabchange', (event) => {
    clearWindowDragVisuals();
    workspaceTab = event.detail?.tab || 'home';
    if (workspaceTab === 'home') refreshWindows();
    if (workspaceTab === 'settings') window.NotchWorkspaceWindowsHost?.refreshSettingsPanel?.();
  });
  document.addEventListener('notch:modechange', (event) => {
    clearWindowDragVisuals();
    workspaceExpanded = !!event.detail?.expanded;
    if (workspaceExpanded && workspaceTab === 'home') refreshWindows();
  });
  document.addEventListener('notch:home-modules-changed', (event) => {
    const nextVisible = Array.isArray(event.detail?.visibleIds) ? event.detail.visibleIds.includes('windows') : window.NotchHome?.isVisible?.('windows') !== false;
    const restored = !homeWindowsVisible && nextVisible;
    homeWindowsVisible = nextVisible;
    window.NotchWorkspaceWindowsHost?.refreshHomeModuleSettings?.();
    if (restored && workspaceExpanded && workspaceTab === 'home') refreshWindows(true);
  });
  document.addEventListener('notch:recording-state-changed', () => window.NotchWorkspaceWindowsHost?.refreshHomeModuleSettings?.());
  document.addEventListener('notch:home-view-changed', () => refreshWindows());

  setInterval(() => refreshWindows(), 6000);
  renderWindows();
  window.NotchWorkspaceWindows = Object.freeze({ refreshWindows });
})();
