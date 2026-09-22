const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TODO_CATEGORY_KEY = 'notch-todo-category-names-v1';
const TODO_CATEGORY_DEFAULTS = {
  P0: '学习与课程',
  P1: '内容与创作',
  P2: '产品与开发',
  P3: '生活与事务',
};
const LEGACY_TODO_CATEGORY_DEFAULTS = {
  P0: '课程',
  P1: '自媒体&写作',
  P2: 'Vibe coding',
  P3: '日常',
};

const app = document.getElementById('app');
app.dataset.platform = window.notchAPI?.platform || 'darwin';
const notch = document.getElementById('notch');
const panel = document.getElementById('panel');

var data = loadData();
let todoCategoryNames = loadTodoCategoryNames();
const todoSelections = Object.fromEntries(PRIORITIES.map((priority) => [priority, new Set()]));
const todoSelectionAnchors = Object.fromEntries(PRIORITIES.map((priority) => [priority, null]));
let editingTodo = null;
let todoTimeScope = 'today';
const todoCompletedExpanded = Object.fromEntries(PRIORITIES.map((priority) => [priority, false]));

function loadTodoCategoryNames() {
  try {
    return window.NotchDomain.migrateTodoCategoryNames(
      JSON.parse(localStorage.getItem(TODO_CATEGORY_KEY) || 'null'),
      TODO_CATEGORY_DEFAULTS,
      LEGACY_TODO_CATEGORY_DEFAULTS
    );
  } catch (error) {
    return { ...TODO_CATEGORY_DEFAULTS };
  }
}

function persistTodoCategoryNames() {
  try {
    localStorage.setItem(TODO_CATEGORY_KEY, JSON.stringify(todoCategoryNames));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话中的分类名。
  }
}

function applyTodoCategoryNames() {
  PRIORITIES.forEach((categoryId) => {
    const name = todoCategoryNames[categoryId];
    const input = document.querySelector(`.todo-category-name[data-category="${categoryId}"]`);
    const addInput = document.querySelector(`.add-row input[data-priority="${categoryId}"]`);
    const deadlineButton = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${categoryId}"]`);
    if (input) input.value = name;
    if (addInput) addInput.setAttribute('aria-label', `添加${name}待办`);
    if (deadlineButton) deadlineButton.setAttribute('aria-label', `选择${name}待办截止时间`);
  });
}
if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
  window.notchAPI
    .scheduleTodoReminders(PRIORITIES.flatMap((priority) => data[priority] || []))
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onTodoReminder === 'function') {
  window.notchAPI.onTodoReminder((payload) => {
    if (!payload || !payload.id) return;
    let changed = false;
    PRIORITIES.forEach((priority) => {
      const item = (data[priority] || []).find((todo) => (
        todo.id === payload.id && String(todo.deadline || '') === String(payload.deadline || '')
      ));
      if (!item) return;
      item.remindedAt = Math.max(0, Number(payload.remindedAt) || Date.now());
      changed = true;
    });
    if (changed) saveData(data);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const todoListController = window.NotchTodoList.createTodoListController({
  priorities: PRIORITIES,
  document,
  window,
  domain: window.NotchDomain,
  getData: () => data,
  getTimeScope: () => todoTimeScope,
  getEditingTodo: () => editingTodo,
  getSelections: () => todoSelections,
  getCompletedExpanded: () => todoCompletedExpanded,
});
const {
  escapeHtml,
  formatTodoDeadline,
  todosVisibleInScope,
  captureTodoPositions,
  renderList,
  renderTodoPlanner,
  renderAll,
  updateCount,
  updateTodoBulkButton,
} = todoListController;
window.renderList = renderList;
window.renderTodoPlanner = renderTodoPlanner;

setInterval(() => {
  if (editingTodo || isTodoEditorOpen?.()) return;
  renderAll();
}, 60_000);

let isExpanded = false;
let modeBusy = false;
let pendingMode = null;
let restoreNotchFocusAfterCollapse = false;
// 从折叠态展开的瞬间置 true，岛体落定后自动清除；
// setActiveTab 读取此标志决定是否延后重活，已展开态切 Tab 不受影响。
let _justExpanded = false;

const PANEL_MOTION_FALLBACK_MS = 440;
const OPENING_SETTLE_MS = 360;
const HEAVY_LOAD_AFTER_OPEN_MS = 360;

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitForPanelMotion() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (
        event.target === panel &&
        event.propertyName === 'opacity' &&
        event.pseudoElement === '::before'
      ) {
        finish();
      }
    };
    const timer = setTimeout(finish, PANEL_MOTION_FALLBACK_MS);
    panel.addEventListener('transitionend', onEnd);
  });
}

async function ipcSetMode(mode) {
  if (!window.notchAPI || typeof window.notchAPI.setMode !== 'function') return;
  try {
    await window.notchAPI.setMode(mode);
  } catch (e) {
    // ignore
  }
}

async function ipcBeginCollapse() {
  if (!window.notchAPI || typeof window.notchAPI.beginCollapse !== 'function') return;
  try {
    await window.notchAPI.beginCollapse();
  } catch (e) {
    // ignore
  }
}

function syncPanelAccessibility(expanded) {
  const focusWasInPanel = !!(panel && panel.contains(document.activeElement));
  if (!expanded) {
    restoreNotchFocusAfterCollapse = document.hasFocus();
    if (focusWasInPanel) document.activeElement.blur();
  } else {
    restoreNotchFocusAfterCollapse = false;
  }
  if (panel) {
    panel.inert = !expanded;
    panel.setAttribute('aria-hidden', String(!expanded));
  }
  if (!notch) return;
  notch.setAttribute('aria-expanded', String(expanded));
  notch.setAttribute('aria-label', expanded ? '收起 Dynamic Panel' : '展开 Dynamic Panel');
  if (expanded && document.activeElement === notch) {
    const activeTabButton = document.querySelector(`.tab[data-tab="${activeTab}"]`);
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  notch.setAttribute('aria-hidden', String(expanded));
  notch.tabIndex = expanded ? -1 : 0;
}

// 原生窗口提供透明画布；用户看到的岛体由 CSS 连续形变。
// 退场完成后再收紧原生区域：Windows 保留画布并设置 shape，macOS 缩小窗口。
async function setMode(expanded) {
  if (modeBusy) {
    pendingMode = expanded;
    return;
  }
  if (expanded === isExpanded) return;
  modeBusy = true;
  isExpanded = expanded;
  try {
    if (expanded) {
      // 每次召回使用设置中的默认页，不沿用上次收起时的停留页。
      _justExpanded = true;
      setTimeout(() => {
        _justExpanded = false;
      }, OPENING_SETTLE_MS);
      const openingTab = window.NotchDomain.resolveDefaultPanelTab(defaultOpenTab, TABS);
      if (activeTab !== openingTab) await setActiveTab(openingTab);
      else applyTabDom(openingTab);
      syncPanelAccessibility(true);
      app.classList.remove('collapsed', 'closing');
      app.classList.add('opening');
      void panel.offsetWidth;
      // offsetWidth 只强制布局，不强制绘制；而 rAF 回调发生在绘制之前。
      // 必须等两帧、确认 .opening 的透明折叠条真的进了合成器，再让主进程放大窗口，
      // 否则放大时被钉在新原点上的仍是那条黑色折叠条（菜单栏黑块闪烁的成因）。
      if (app.dataset.platform !== 'win32') {
        await nextAnimationFrame();
        await nextAnimationFrame();
      }
      await ipcSetMode('expanded');
      if (app.dataset.platform !== 'win32') {
        await nextAnimationFrame();
        await nextAnimationFrame();
      }
      app.classList.remove('opening');
      app.classList.add('expanded');
      // 展开后面板从隐藏变为可见，tab 尺寸此时才可量，校准激活胶囊位置
      requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
      setTimeout(() => {
        if (!isExpanded) return;
        if (activeTab === 'clip') renderClipList();
      }, HEAVY_LOAD_AFTER_OPEN_MS);
    } else {
      const motion = waitForPanelMotion();
      syncPanelAccessibility(false);
      await ipcBeginCollapse();
      app.classList.add('closing');
      await nextAnimationFrame();
      await motion;
      await nextAnimationFrame();
      await nextAnimationFrame();
      // 收起目标在缩窗前后保持相同外观；不要插入透明帧或重新播放淡入。
      await ipcSetMode('collapsed');
      app.classList.remove('expanded', 'closing', 'opening');
      app.classList.add('collapsed');
      if (restoreNotchFocusAfterCollapse && document.hasFocus() && notch) {
        notch.focus({ preventScroll: true });
      }
      restoreNotchFocusAfterCollapse = false;
    }
    document.dispatchEvent(new CustomEvent('notch:modechange', {
      detail: { expanded: isExpanded },
    }));
  } finally {
    modeBusy = false;
    if (pendingMode !== null) {
      const nextMode = pendingMode;
      pendingMode = null;
      if (nextMode !== isExpanded) setMode(nextMode);
    }
  }
}

const COLLAPSED_HOVER_MAX_HEIGHT = 30;

notch.addEventListener('mouseenter', () => {
  if (!isExpanded && isCollapsedHoverEnabled()) window.notchAPI?.setCollapsedHover?.(true);
});

notch.addEventListener('mouseleave', () => {
  window.notchAPI?.setCollapsedHover?.(false);
});

notch.addEventListener('click', (e) => {
  e.stopPropagation();
  setMode(!isExpanded);
});

notch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  setMode(!isExpanded);
});

document.addEventListener('keydown', (event) => {
  if (window.NotchLauncher?.isOpen()) return;
  const target = event.target instanceof Element ? event.target : null;
  const editable = Boolean(target && target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), audio, video'
  ));
  if (!window.NotchDomain.shouldTogglePanelForSpace({
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    isComposing: event.isComposing,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    editable,
  })) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setMode(!isExpanded);
}, true);

syncPanelAccessibility(false);

panel.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Esc 收起面板（菜单栏会拦截顶部刘海条的点击，给收起多一条可靠路径）；
// 焦点在输入框/速记里时，第一次 Esc 只退出输入。
// Escape 不会原生到达页面（被浏览器层吞掉），由主进程 before-input-event 转发
if (window.notchAPI && typeof window.notchAPI.onEscape === 'function') {
  window.notchAPI.onEscape(() => {
    if (shortcutRecorderController.isActive()) { shortcutRecorderController.close(); return; }
    if (window.NotchAI?.isOpen()) { window.NotchAI.close(); return; }
    if (window.NotchLauncher?.handleEscape()) return;
    if (window.NotchChatReaderView?.handleEscape()) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur();
      return;
    }
    if (document.querySelector('.multi-selected')) {
      PRIORITIES.forEach((priority) => {
        todoSelections[priority].clear();
        todoSelectionAnchors[priority] = null;
        renderList(priority);
      });
      document.dispatchEvent(new CustomEvent('notch:clear-selection'));
      return;
    }
    if (isExpanded) setMode(false);
  });
}

if (window.notchAPI && typeof window.notchAPI.onToggleShortcut === 'function') {
  window.notchAPI.onToggleShortcut(async () => {
    if (window.NotchAI?.isOpen()) await window.NotchAI.close();
    if (window.NotchLauncher?.isOpen()) await window.NotchLauncher.close();
    setMode(!isExpanded);
  });
}

// 失焦与点击收起共用同一个状态机，保证退场节奏一致。
if (window.notchAPI && typeof window.notchAPI.onCollapseRequest === 'function') {
  window.notchAPI.onCollapseRequest(async () => {
    if (window.NotchAI?.isOpen()) await window.NotchAI.close();
    if (window.NotchLauncher?.isOpen()) { window.NotchLauncher.close(); return; }
    if (isExpanded) setMode(false);
  });
}

// 全局快捷键召唤也走同一套 Tab 与展开状态机，避免出现另一种突兀的入场路径。
if (window.notchAPI && typeof window.notchAPI.onOpenClip === 'function') {
  window.notchAPI.onOpenClip(async () => {
    await setActiveTab('clip');
    if (!isExpanded) await setMode(true);
  });
}

// 折叠高度超过 hover 展开目标高度时，保持静态刘海，避免 hover 后反而产生第二次尺寸变化。
function isCollapsedHoverEnabled() {
  if (app.dataset.platform !== 'win32') return false;
  if (!layoutMetrics || !Number.isFinite(Number(layoutMetrics.notchHeight))) return true;
  return Number(layoutMetrics.notchHeight) <= COLLAPSED_HOVER_MAX_HEIGHT;
}

// 布局度量（主进程按屏计算下发）：折叠条高 / 菜单栏占位高 / 各 Tab 目标尺寸
let layoutMetrics = null;

function applyLayoutMetrics(metrics) {
  if (!metrics) return;
  layoutMetrics = metrics;
  const notchHeight = Number(metrics.notchHeight);
  const hoverDisabled = app.dataset.platform === 'win32'
    && Number.isFinite(notchHeight)
    && notchHeight > COLLAPSED_HOVER_MAX_HEIGHT;
  app.toggleAttribute('data-notch-hover-disabled', hoverDisabled);
  if (hoverDisabled && !isExpanded) window.notchAPI?.setCollapsedHover?.(false);
  if (metrics.stripHeight) {
    document.documentElement.style.setProperty('--notch-h', `${metrics.stripHeight}px`);
  }
  if (metrics.notchHeight) {
    document.documentElement.style.setProperty('--notch-compact-h', `${metrics.notchHeight}px`);
  }
  if (metrics.menuBarHeight) {
    document.documentElement.style.setProperty('--mb-h', `${metrics.menuBarHeight}px`);
  }
}

if (window.notchAPI && typeof window.notchAPI.getMetrics === 'function') {
  window.notchAPI
    .getMetrics()
    .then(applyLayoutMetrics)
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onMetricsChanged === 'function') {
  window.notchAPI.onMetricsChanged(applyLayoutMetrics);
}

// ============ Tab 切换 ============
const TAB_KEY = 'notch-active-tab';
const ALL_TABS = ['home', 'todo', 'finance', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'];
let TABS = ALL_TABS.filter((name) => name !== 'clip');
let tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const tabIndicator = document.getElementById('tab-indicator');
const collapseBtn = document.getElementById('collapse-btn');

let activeTab = 'home';
let defaultOpenTab = 'home';

function applyThemeSettings(settings) {
  document.documentElement.dataset.theme = settings?.theme === 'light' ? 'light' : 'dark';
}

function applyFeatureSettings(settings) {
  applyThemeSettings(settings);
  const features = { ...(settings && settings.features || {}), home: true, settings: true };
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    const enabled = button.dataset.tab === 'home'
      || button.dataset.tab === 'settings'
      || features[button.dataset.tab] !== false;
    button.hidden = !enabled;
    button.setAttribute('aria-hidden', String(!enabled));
  });
  TABS = window.NotchDomain.visiblePanelTabs(ALL_TABS, features);
  defaultOpenTab = window.NotchDomain.resolveDefaultPanelTab(settings?.defaultTab, TABS);
  tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
  tabButtons.forEach((button) => button.classList.remove('tab-split-start'));
  document.getElementById('tabs')?.classList.toggle('is-split', tabButtons.length > 4);
  if (tabButtons.length > 4) {
    tabButtons[Math.ceil(tabButtons.length / 2)]?.classList.add('tab-split-start');
  }
  if (!TABS.includes(activeTab)) setActiveTab('home');
  requestAnimationFrame(positionIndicator);
}

if (window.notchAPI?.getAppSettings) {
  window.notchAPI.getAppSettings().then(applyFeatureSettings).catch(() => {});
  window.notchAPI.onAppSettingsChanged?.(applyFeatureSettings);
}

function positionIndicator() {
  const btn = tabButtons.find((b) => b.dataset.tab === activeTab);
  if (!btn || !tabIndicator) return;
  tabIndicator.style.width = `${btn.offsetWidth}px`;
  tabIndicator.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function applyTabDom(name) {
  tabButtons.forEach((b) => {
    const selected = b.dataset.tab === name;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  tabPanels.forEach((p) => {
    const selected = p.id === `tab-${name}`;
    p.classList.toggle('active', selected);
    p.inert = !selected;
    p.setAttribute('aria-hidden', String(!selected));
  });
  positionIndicator();
  requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
  document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: name } }));
}

async function ipcSetTab(name) {
  if (!window.notchAPI || typeof window.notchAPI.setTab !== 'function') return;
  try {
    await window.notchAPI.setTab(name);
  } catch (e) {
    // ignore
  }
}

// 固定展开尺寸下，Tab 只切换内容与指示器，不再改变原生窗口边界。
async function morphToTab(name) {
  await ipcSetTab(name);
  applyTabDom(name);
  positionIndicator();
}

let tabBusy = false;
let pendingTab = null;

async function setActiveTab(name) {
  if (!TABS.includes(name)) name = 'home';
  if (tabBusy) {
    pendingTab = name; // 补间中连点：记住最后目标，结束后追赶
    return;
  }
  if (name === activeTab) {
    applyTabDom(name);
    return;
  }
  tabBusy = true;
  activeTab = name;
  try {
    // 图片预加载等重活的调度策略：
    //   - 已展开态切 Tab：_justExpanded=false → 立即执行，保持即时响应
    //   - 从折叠态展开（_justExpanded=true）：延后到展开动画基本落定后再跑，
    //     避免与面板 scale 手势争首帧 CPU/GPU，消除展开卡顿
    // renderClipList 延后只是缩略图晚一点出现，可接受。
    const _tabNameForDeferred = name; // 闭包捕获当前目标 Tab
    const runHeavyLoads = () => {
      if (_tabNameForDeferred === 'todo') refreshTodoTemporalView();
      if (_tabNameForDeferred === 'clip') renderClipList();
      if (_tabNameForDeferred === 'notes') notesController.render();
    };
    if (_justExpanded) {
      // 双帧后再延迟重活，让岛体形变先完成，避免抢首帧 CPU/GPU。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(runHeavyLoads, HEAVY_LOAD_AFTER_OPEN_MS))
      );
    } else {
      // 已展开态切 Tab：立即执行，无感知延迟
      runHeavyLoads();
    }
    if (isExpanded) {
      await morphToTab(name);
    } else {
      // 折叠态只记录目标尺寸（主进程不变形），展开时一步到位
      await ipcSetTab(name);
      applyTabDom(name);
    }
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch (e) {
      // ignore quota errors
    }
  } finally {
    tabBusy = false;
    if (pendingTab && pendingTab !== activeTab) {
      const next = pendingTab;
      pendingTab = null;
      setActiveTab(next);
    } else {
      pendingTab = null;
    }
  }
}

// 胶囊滑动结束后兜底再校准一次（窗口变形期间布局可能回流）
if (tabIndicator) {
  tabIndicator.addEventListener('transitionend', positionIndicator);
}

Array.from(document.querySelectorAll('.tab[data-tab]')).forEach((btn) => {
  btn.addEventListener('pointerdown', () => {
    window.notchAPI?.keepPanelOpen?.();
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.notchAPI?.keepPanelOpen?.();
    setActiveTab(btn.dataset.tab);
  });
  btn.addEventListener('keydown', (e) => {
    const currentIndex = tabButtons.indexOf(btn);
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    }
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextButton = tabButtons[nextIndex];
    nextButton.focus({ preventScroll: true });
    setActiveTab(nextButton.dataset.tab);
  });
});

// 托盘里的“设置快捷键…”会把设置入口以内联浮层放到面板中。
// 快捷键解析、校验、保存和浮层焦点生命周期由独立 controller 管理。
const shortcutRecorderController = window.NotchShortcutRecorder.createController({
  document,
  window,
  notchAPI: window.notchAPI,
  platform: app.dataset.platform,
  setMode,
  showStatusToast,
});

if (collapseBtn) {
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(false);
  });
}

/* 顶栏空白区域保持为安全的非操作区域，面板只通过明确的收起入口关闭。 */

function initTab() {
  setActiveTab('home');
}

document.querySelectorAll('.todo-category-name[data-category]').forEach((input) => {
  const finishCategoryEdit = () => {
    const categoryId = input.dataset.category;
    todoCategoryNames = window.NotchDomain.normalizeTodoCategoryNames({
      ...todoCategoryNames,
      [categoryId]: input.value,
    }, TODO_CATEGORY_DEFAULTS);
    persistTodoCategoryNames();
    applyTodoCategoryNames();
  };
  input.addEventListener('change', finishCategoryEdit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      input.value = todoCategoryNames[input.dataset.category];
      input.blur();
    }
  });
});

applyTodoCategoryNames();

document.getElementById('todo-ai-add')?.addEventListener('click', () => window.NotchAI?.openText?.('extractTodos'));

const todoApiController = window.NotchTodoApi.createTodoApiController({
  priorities: PRIORITIES,
  domain: window.NotchDomain,
  getData: () => data,
  setData: (next) => { data = next; },
  getTimeScope: () => todoTimeScope,
  setTimeScope: (scope) => todoScopeController.setTimeScope(scope),
  getCategoryNames: () => todoCategoryNames,
  generateId,
  saveData,
  renderAll,
  syncWorkspaceSnapshot,
});
window.NotchTodo = todoApiController;

const todoEditorController = window.NotchTodoEditor.createTodoEditorController({
  document,
  window,
  domain: window.NotchDomain,
  getData: () => data,
  getTimeScope: () => todoTimeScope,
  saveData,
  renderList,
});
const {
  applyDefaultDeadline: applyDefaultTodoDeadline,
  close: closeTodoEditor,
  isOpen: isTodoEditorOpen,
  open: openTodoEditor,
  refreshDefaultDeadlines: refreshDefaultTodoDeadlines,
  resetDraftDeadline: resetTodoDraftDeadline,
} = todoEditorController;
window.NotchTodoEditorApi = todoEditorController;
window.openTodoEditor = openTodoEditor;
window.closeTodoEditor = closeTodoEditor;
window.applyTodoEditorSelection = todoEditorController.applySelection;
window.renderTodoCalendar = todoEditorController.renderCalendar;
window.moveTodoCalendar = todoEditorController.moveCalendar;
window.applyDefaultTodoDeadline = applyDefaultTodoDeadline;
window.resetTodoDraftDeadline = resetTodoDraftDeadline;
window.refreshDefaultTodoDeadlines = refreshDefaultTodoDeadlines;

const todoMutationController = window.NotchTodoMutation.createTodoMutationController({
  priorities: PRIORITIES,
  document,
  window,
  domain: window.NotchDomain,
  getData: () => data,
  saveData,
  generateId,
  captureTodoPositions,
  renderList,
  renderAll,
  updateCount,
  todosVisibleInScope,
  getTimeScope: () => todoTimeScope,
  getSelections: () => todoSelections,
  getSelectionAnchors: () => todoSelectionAnchors,
  setSelection: (priority, value) => { todoSelections[priority] = value; },
  setSelectionAnchor: (priority, value) => { todoSelectionAnchors[priority] = value; },
  getCompletedExpanded: () => todoCompletedExpanded,
  getEditingTodo: () => editingTodo,
  setEditingTodo: (value) => { editingTodo = value; },
  openTodoEditor,
  closeTodoEditor,
  applyDefaultTodoDeadline,
  resetTodoDraftDeadline,
  getTodoEditorContext: () => todoEditorController.getContext(),
  showStatusToast,
});
todoMutationController.bindAddRows();
todoMutationController.bindLists();
todoMutationController.bindBulkDelete();

const todoScopeController = window.NotchTodoScope.createTodoScopeController({
  priorities: PRIORITIES,
  scopes: ['today', 'week', 'later', 'all'],
  document,
  window,
  getData: () => data,
  getScope: () => todoTimeScope,
  setScope: (scope) => { todoTimeScope = scope; },
  getSelections: () => todoSelections,
  getSelectionAnchors: () => todoSelectionAnchors,
  getCompletedExpanded: () => todoCompletedExpanded,
  setEditingTodo: (value) => { editingTodo = value; },
  closeTodoEditor,
  applyDefaultDeadline: applyDefaultTodoDeadline,
  renderAll,
  showOverdueFocus: () => document.querySelector('.todo-item.overdue [data-action="toggle"]')?.focus({ preventScroll: true }),
});
todoScopeController.bindControls();
document.getElementById('todo-ai-add')?.addEventListener('click', () => window.NotchAI?.openText?.('extractTodos'));

// ============ 首页 · 时钟·日期 ============
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const clockDateEl = document.getElementById('clock-date');
const clockHEl = document.getElementById('clock-h');
const clockMEl = document.getElementById('clock-m');
const clockSsEl = document.getElementById('clock-ss');
let todoDefaultRefreshKey = '';
let todoScopeRefreshDay = '';

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function tickClock() {
  if (!clockHEl || !clockMEl) return;
  const now = new Date();
  const h = pad2(now.getHours());
  const m = pad2(now.getMinutes());
  if (clockHEl.textContent !== h) clockHEl.textContent = h;
  if (clockMEl.textContent !== m) clockMEl.textContent = m;
  if (clockSsEl) clockSsEl.textContent = pad2(now.getSeconds());
  if (clockDateEl) {
    const dateStr = `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}/${now.getDate()}`;
    if (clockDateEl.textContent !== dateStr) clockDateEl.textContent = dateStr;
  }
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const refreshKey = `${dayKey}-${now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() >= 30)}`;
  if (refreshKey !== todoDefaultRefreshKey) {
    todoDefaultRefreshKey = refreshKey;
    refreshDefaultTodoDeadlines(now);
  }
  if (dayKey !== todoScopeRefreshDay && !editingTodo && !isTodoEditorOpen()) {
    todoScopeRefreshDay = dayKey;
    renderAll();
  }
}

function refreshTodoTemporalView() {
  if (editingTodo || isTodoEditorOpen()) return;
  refreshDefaultTodoDeadlines(new Date());
  renderAll();
}

window.addEventListener('focus', refreshTodoTemporalView);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshTodoTemporalView();
});

tickClock();
setInterval(tickClock, 1000);

// ============ 首页 · 番茄钟 ============
const pomodoroController = window.NotchPomodoroController.createController({
  showStatusToast,
  notchAPI: window.notchAPI,
});

// ============ 首页 · Markdown 速记 ============
const notesController = window.NotchNotesController.createController({
  generateId,
  showStatusToast,
  syncWorkspaceSnapshot,
  getActiveTab: () => activeTab,
});
window.NotchNotes = notesController;

// ============ 首页 · 自适应 Bento 布局（长按换位 + 迷你/小/中/大组件） ============
const homeLayoutController = window.NotchHomeLayoutController.createController({
  showStatusToast,
  isRecordingActive: () => window.NotchWorkspace?.isRecordingActive?.() || false,
});
window.NotchHome = homeLayoutController;

// ============ 首页 · 收藏剪贴 ============
const clipboardStore = window.NotchClipboardStore.createController({
  generateId,
  Domain: window.NotchDomain,
  notchAPI: window.notchAPI,
  maxEntries: 100,
});
const clipboardController = window.NotchClipboardController.createController({
  generateId,
  escapeHtml,
  showStatusToast,
  setActiveTab,
  store: clipboardStore,
});
window.NotchClipboard = clipboardController;

renderAll();
clipboardController.render();
initTab();

window.NotchPanelHost = {
  isExpanded: () => isExpanded,
  busy: () => modeBusy,
  setNativeMode: ipcSetMode,
  validateTarget(target) {
    if (target.tab && !TABS.includes(target.tab)) throw Error('该功能尚未启用');
    if (target.id && target.tab === 'notes' && !window.NotchNotes?.list?.().some((n) => n.id === target.id)) throw Error('笔记已不存在');
    if (target.id && target.tab === 'todo' && !PRIORITIES.some((p) => (data[p] || []).some((t) => String(t.id) === String(target.id)))) throw Error('待办已不存在');
    if (target.id && target.tab === 'links' && !window.NotchWorkspace.hasLink(target.id)) throw Error('链接已不存在');
  },
  async navigate(target) {
    this.validateTarget(target);
    await setMode(true);
    await setActiveTab(target.tab || 'home');
    if (target.aiAction) { window.NotchAI?.openText?.(target.aiAction); return; }
    if (target.tab === 'notes' && target.id && !window.NotchNotes.select(target.id)) throw Error('笔记已不存在');
    if (target.tab === 'links' && target.id && !window.NotchWorkspace.selectLink(target.id)) throw Error('链接已不存在');
    if (target.create === 'note') window.NotchNotes.create();
    if (target.tab === 'todo') {
      todoScopeController.setTimeScope('all');
      if (target.id) {
        const priority = PRIORITIES.find((p) => (data[p] || []).some((t) => String(t.id) === String(target.id)));
        if (priority) { todoCompletedExpanded[priority] = true; renderList(priority); }
      }
      requestAnimationFrame(() => {
        if (target.id) document.querySelector(`[data-id="${CSS.escape(String(target.id))}"]`)?.scrollIntoView({ block: 'center' });
        else document.querySelector('#tab-todo .add-row input')?.focus();
      });
    }
  },
};
