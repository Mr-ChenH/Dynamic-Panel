const STORAGE_KEY = 'notch-todo-data';
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
const statusToast = document.getElementById('status-toast');
const statusToastMessage = document.getElementById('status-toast-message');
const statusToastAction = document.getElementById('status-toast-action');


function collectLocalStorageSnapshot() {
  const result = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) result[key] = localStorage.getItem(key);
  }
  return result;
}

async function syncWorkspaceSnapshot() {
  if (!window.notchAPI?.saveWorkspaceData) return true;
  try { return await window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()) !== false; }
  catch (error) { return false; }
}

let workspaceReloadPending = false;
async function hydratePortableWorkspace() {
  if (!window.notchAPI?.loadWorkspaceData) return;
  try {
    const snapshot = await window.notchAPI.loadWorkspaceData();
    let imported = false;
    if (sessionStorage.getItem('notch-workspace-hydrated') !== '1' && snapshot && typeof snapshot === 'object') {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
          imported = true;
        }
      });
      sessionStorage.setItem('notch-workspace-hydrated', '1');
    }
    if (imported) {
      // The current editors were initialized before the asynchronous import.
      // Their unload/visibility handlers must not overwrite recovered values.
      workspaceReloadPending = true;
      location.reload();
      return;
    }
    setInterval(() => window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).catch(() => {}), 2000);
  } catch (error) {}
}
// Do not interrupt parser-loaded workspace scripts with a recovery navigation.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydratePortableWorkspace, { once: true });
} else {
  hydratePortableWorkspace();
}
window.notchAPI?.onWorkspaceChanged?.(async () => {
  sessionStorage.removeItem('notch-workspace-hydrated');
  if (window.NotchAI?.isOpen()) await window.NotchAI.close();
  window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).finally(() => location.reload());
});

let statusToastTimer = null;
let statusToastHideTimer = null;
let statusToastActionHandler = null;
let statusToastExpireHandler = null;

function dismissStatusToast(commitPending = true) {
  if (statusToastTimer) clearTimeout(statusToastTimer);
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastTimer = null;
  statusToastHideTimer = null;
  const onExpire = statusToastExpireHandler;
  statusToastExpireHandler = null;
  statusToastActionHandler = null;
  const actionHadFocus = statusToastAction === document.activeElement;
  if (actionHadFocus) {
    const activeTabButton = document.querySelector('.tab.active');
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  if (statusToast) {
    statusToast.classList.remove('visible');
    statusToast.setAttribute('aria-hidden', 'true');
  }
  if (statusToastAction) statusToastAction.hidden = true;
  statusToastHideTimer = setTimeout(() => {
    statusToastHideTimer = null;
    if (statusToast) statusToast.hidden = true;
    if (statusToastMessage) statusToastMessage.textContent = '';
  }, 180);
  if (commitPending && onExpire) onExpire();
}

function showStatusToast(message, options = {}) {
  dismissStatusToast(true);
  if (!statusToast || !statusToastMessage) return;
  const { actionLabel, onAction, onExpire, duration = 1800 } = options;
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastHideTimer = null;
  statusToast.hidden = false;
  statusToast.setAttribute('aria-hidden', 'false');
  statusToastMessage.textContent = message;
  statusToastActionHandler = typeof onAction === 'function' ? onAction : null;
  statusToastExpireHandler = typeof onExpire === 'function' ? onExpire : null;
  if (statusToastAction && statusToastActionHandler) {
    statusToastAction.textContent = actionLabel || '撤销';
    statusToastAction.hidden = false;
  }
  statusToast.classList.add('visible');
  statusToastTimer = setTimeout(() => dismissStatusToast(true), duration);
}

if (statusToastAction) {
  statusToastAction.addEventListener('click', () => {
    const handler = statusToastActionHandler;
    dismissStatusToast(false);
    if (handler) handler();
  });
}

window.addEventListener('beforeunload', () => dismissStatusToast(true));

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { P0: [], P1: [], P2: [], P3: [] };
    const parsed = JSON.parse(raw);
    return {
      P0: normalizeTodoItems(parsed && parsed.P0),
      P1: normalizeTodoItems(parsed && parsed.P1),
      P2: normalizeTodoItems(parsed && parsed.P2),
      P3: normalizeTodoItems(parsed && parsed.P3),
    };
  } catch (e) {
    return { P0: [], P1: [], P2: [], P3: [] };
  }
}

function normalizeTodoItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text
          ? { id: generateId(), text, done: false, createdAt: Date.now() }
          : null;
      }
      if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null;
      const text = item.text.trim();
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : generateId(),
        text,
        done: item.done === true,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        deadline: Number.isFinite(Date.parse(String(item.deadline || '')))
          ? new Date(Date.parse(String(item.deadline))).toISOString()
          : '',
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      };
    })
    .filter(Boolean);
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    return false;
  }
  if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
    const reminders = PRIORITIES.flatMap((priority) => data[priority] || []);
    window.notchAPI.scheduleTodoReminders(reminders).catch(() => {});
  }
  if (typeof renderTodoPlanner === 'function') renderTodoPlanner();
  return true;
}

let data = loadData();
let todoCategoryNames = loadTodoCategoryNames();
const todoSelections = Object.fromEntries(PRIORITIES.map((priority) => [priority, new Set()]));
const todoSelectionAnchors = Object.fromEntries(PRIORITIES.map((priority) => [priority, null]));
let editingTodo = null;
const TODO_TIME_SCOPES = ['today', 'week', 'later', 'all'];
let todoTimeScope = 'today';
const todoCompletedExpanded = Object.fromEntries(PRIORITIES.map((priority) => [priority, false]));
const todoScopeButtons = Array.from(document.querySelectorAll('[data-todo-scope]'));
const todoScopePeriod = document.getElementById('todo-scope-period');
const todoOverdueJump = document.getElementById('todo-overdue-jump');
const todoOverdueCount = document.getElementById('todo-overdue-count');

function allTodoItems() {
  return PRIORITIES.flatMap((priority) => data[priority] || []);
}

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

function checkSvg() {
  return '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTodoDeadline(item, now = Date.now()) {
  const timestamp = Date.parse(String(item && item.deadline || ''));
  if (!Number.isFinite(timestamp)) return { label: '待整理', title: '截止时间无效', overdue: false };
  const deadline = new Date(timestamp);
  const bucket = window.NotchDomain.todoTimeBucket(item, now);
  const clock = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(deadline);
  const full = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(deadline);
  if (bucket === 'overdue') {
    const difference = Math.max(0, now - timestamp);
    const amount = difference < 3600000
      ? `${Math.max(1, Math.floor(difference / 60000))} 分钟`
      : difference < 86400000
        ? `${Math.floor(difference / 3600000)} 小时`
        : `${Math.floor(difference / 86400000)} 天`;
    return { label: `逾期 ${amount}`, title: full, overdue: true };
  }
  if (bucket === 'today') return { label: clock, title: full, overdue: false };
  if (bucket === 'week') {
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(deadline);
    return { label: `${weekday} ${clock}`, title: full, overdue: false };
  }
  const includeYear = deadline.getFullYear() !== new Date(now).getFullYear();
  const label = new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' } : {}), month: 'numeric', day: 'numeric',
  }).format(deadline);
  return { label, title: full, overdue: false };
}

function todoItemHtml(priority, item) {
  const deadlineState = formatTodoDeadline(item);
  const doneClass = item.done ? ' done' : '';
  const overdueClass = deadlineState.overdue ? ' overdue' : '';
  const selectedClass = todoSelections[priority]?.has(item.id) ? ' multi-selected' : '';
  const safeId = escapeHtml(item.id);
  const safeText = escapeHtml(item.text);
  const deadline = deadlineState.label;
  const toggleLabel = item.done ? `恢复未完成：${safeText}` : `标记完成：${safeText}`;
  const battery = item.done ? null : window.NotchDomain.todoTimeBattery(item, Date.now());
  // 逾期项整条填满红色并只显示一个白色感叹号：剩余 0% 是「快到了」，
  // 逾期是「已经欠账」，两者不能长得一样。
  const batteryHtml = battery
    ? `<span class="todo-battery" data-tone="${battery.tone}"${battery.overdue ? ' data-overdue="true" role="img"' : ''} title="${battery.label}" aria-label="${battery.label}"><i style="--battery:${battery.overdue ? 100 : battery.percent}%"></i><b>${battery.overdue ? '!' : `${battery.percent}%`}</b></span>`
    : '';
  const isEditing = editingTodo?.priority === priority && editingTodo?.id === item.id;
  const rescheduleDeadline = deadlineState.overdue
    ? window.NotchDomain.defaultTodoDeadlineForScope('today', new Date())
    : null;
  const rescheduleAction = rescheduleDeadline
    ? `<button class="todo-reschedule-action" type="button" data-action="reschedule-today" title="移到今天" aria-label="将${safeText}移到今天">今天</button>`
    : '';
  const contentHtml = isEditing
    ? `<div class="todo-inline-editor"><input class="todo-inline-name" value="${safeText}" maxlength="80" aria-label="修改待办名称" />${batteryHtml}<button class="todo-inline-deadline" type="button" data-action="edit-deadline">${deadline}</button><button class="todo-inline-save" type="button" data-action="save-edit" aria-label="保存修改">✓</button></div>`
    : `<div class="todo-copy-row"><button class="todo-copy" type="button" data-action="edit" title="${safeText}" aria-label="修改：${safeText}"><span class="todo-text">${safeText}</span>${batteryHtml}<time class="todo-ddl" datetime="${escapeHtml(item.deadline)}" title="${escapeHtml(deadlineState.title)}">${escapeHtml(deadline)}</time></button>${rescheduleAction}</div>`;
  return `
    <li class="todo-item${doneClass}${overdueClass}${selectedClass}" data-id="${safeId}" data-priority="${priority}">
      <button class="checkbox" type="button" data-action="toggle" aria-label="${toggleLabel}" aria-pressed="${item.done}">${checkSvg()}</button>
      ${contentHtml}
      <button class="delete" type="button" data-action="delete" aria-label="删除：${safeText}">×</button>
    </li>
  `;
}

function captureTodoPositions(priority) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return new Map();
  return new Map(Array.from(list.querySelectorAll('.todo-item[data-id]')).map((item) => (
    [item.dataset.id, item.getBoundingClientRect()]
  )));
}

function animateTodoOrder(priority, previousPositions) {
  if (!previousPositions?.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  requestAnimationFrame(() => {
    list.querySelectorAll('.todo-item[data-id]').forEach((item) => {
      const previous = previousPositions.get(item.dataset.id);
      if (!previous || typeof item.animate !== 'function') return;
      const current = item.getBoundingClientRect();
      const offset = previous.top - current.top;
      if (Math.abs(offset) < 1) return;
      item.animate([
        { transform: `translateY(${offset}px)` },
        { transform: 'translateY(0)' },
      ], {
        duration: 360,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
      });
    });
  });
}

function todosVisibleInScope(priority, now = Date.now()) {
  return window.NotchDomain.sortTodosForDisplay(
    window.NotchDomain.filterTodosByTimeScope(data[priority] || [], todoTimeScope, now)
  );
}

function completedTodoDisclosureHtml(priority, completed) {
  if (!completed.length) return '';
  const expanded = todoCompletedExpanded[priority];
  return `<li class="todo-completed-disclosure">
    <button type="button" data-todo-completed-toggle="${priority}" aria-expanded="${expanded}">
      <span>已完成</span><b>${completed.length}</b><i aria-hidden="true"></i>
    </button>
  </li>${expanded ? completed.map((item) => todoItemHtml(priority, item)).join('') : ''}`;
}

function renderList(priority, options = {}) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  const items = todosVisibleInScope(priority);
  const pending = items.filter((item) => item.done !== true);
  const completed = items.filter((item) => item.done === true);
  const empty = pending.length || completed.length
    ? ''
    : `<li class="todo-scope-empty">${todoTimeScope === 'week' && !window.NotchDomain.defaultTodoDeadlineForScope('week') ? '本周余下已安排完' : '当前范围没有待办'}</li>`;
  list.innerHTML = `${pending.map((item) => todoItemHtml(priority, item)).join('')}${completedTodoDisclosureHtml(priority, completed)}${empty}`;
  updateTodoBulkButton(priority);
  animateTodoOrder(priority, options.previousPositions);
  if (options.focusId) {
    requestAnimationFrame(() => {
      const target = list.querySelector(
        `.todo-item[data-id="${CSS.escape(options.focusId)}"] [data-action="${options.focusAction || 'toggle'}"]`
      );
      const fallback = list.querySelector(`[data-todo-completed-toggle="${priority}"]`)
        || document.querySelector(`.add-row input[data-priority="${priority}"]`);
      (target || fallback)?.focus({ preventScroll: true });
    });
  }
}

function updateTodoBulkButton(priority) {
  const button = document.querySelector(`[data-bulk-priority="${priority}"]`);
  const count = todoSelections[priority]?.size || 0;
  if (!button) return;
  button.hidden = count === 0;
  button.textContent = '删除';
  button.setAttribute('aria-label', count ? `删除 ${count} 项` : '删除所选');
}

function updateCount(priority) {
  const countEl = document.querySelector(`.count[data-priority="${priority}"]`);
  if (!countEl) return;
  const pending = todosVisibleInScope(priority).filter((todo) => todo.done !== true).length;
  countEl.textContent = String(pending);
}

function renderTodoPlanner(now = new Date()) {
  const counts = window.NotchDomain.todoTimeScopeCounts(allTodoItems(), now);
  todoScopeButtons.forEach((button) => {
    const scope = button.dataset.todoScope;
    const selected = scope === todoTimeScope;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    const count = button.querySelector('[data-todo-scope-count]');
    if (count) count.textContent = String(counts[scope] || 0);
  });
  if (todoOverdueJump && todoOverdueCount) {
    todoOverdueJump.hidden = counts.overdue === 0;
    todoOverdueCount.textContent = String(counts.overdue);
    todoOverdueJump.setAttribute('aria-label', `查看 ${counts.overdue} 项逾期待办`);
  }
  const boundaries = window.NotchDomain.todoTimeBoundaries(now);
  if (todoScopePeriod && boundaries) {
    const today = new Date(boundaries.startToday);
    const lastWeekDay = new Date(boundaries.startNextWeek - 1);
    const labels = {
      today: `${today.getMonth() + 1}月${today.getDate()}日`,
      week: boundaries.startTomorrow >= boundaries.startNextWeek
        ? '本周余下已结束'
        : `${new Date(boundaries.startTomorrow).getMonth() + 1}/${new Date(boundaries.startTomorrow).getDate()} - ${lastWeekDay.getMonth() + 1}/${lastWeekDay.getDate()}`,
      later: `${new Date(boundaries.startNextWeek).getMonth() + 1}月${new Date(boundaries.startNextWeek).getDate()}日以后`,
      all: counts.unscheduled ? `含 ${counts.unscheduled} 项待整理` : '所有未完成与已完成',
    };
    todoScopePeriod.textContent = labels[todoTimeScope];
  }
  document.querySelector('.todo-page')?.setAttribute('data-todo-scope', todoTimeScope);
}

function renderAll() {
  renderTodoPlanner();
  PRIORITIES.forEach((p) => {
    renderList(p);
    updateCount(p);
  });
}

setInterval(() => {
  if (editingTodo || todoEditorContext) return;
  renderAll();
}, 60_000);

// 渲染重建 innerHTML 后，给指定条目挂一次性动画类；动画结束即卸载，不污染后续渲染
function flashItemClass(priority, id, cls) {
  const el = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"]`
  );
  if (!el) return;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function flashCheckboxPop(priority, id) {
  const box = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"] .checkbox`
  );
  if (!box) return;
  box.classList.add('pop');
  box.addEventListener('animationend', () => box.classList.remove('pop'), { once: true });
}

function addTodo(priority, text, deadline) {
  const item = window.NotchDomain.createTodo(text, deadline, generateId(), Date.now());
  if (!item) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority].push(item);
  saveData(data);
  renderList(priority, { previousPositions });
  updateCount(priority);
  flashItemClass(priority, item.id, 'enter');
  const added = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${item.id}"]`
  );
  if (added) {
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      added.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  return true;
}

function editTodo(priority, id, text, deadline) {
  const index = (data[priority] || []).findIndex((item) => item.id === id);
  if (index < 0) return false;
  const updated = window.NotchDomain.updateTodo(data[priority][index], text, deadline);
  if (!updated) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority][index] = updated;
  saveData(data);
  renderList(priority, { previousPositions, focusId: id, focusAction: 'edit' });
  updateCount(priority);
  return true;
}

function toggleTodo(priority, id) {
  const list = data[priority];
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const previousPositions = captureTodoPositions(priority);
  const restoreFocus = document.activeElement?.closest('.todo-item')?.dataset.id === id;
  list[idx].done = !list[idx].done;
  const nowDone = list[idx].done;
  if (nowDone) todoCompletedExpanded[priority] = true;
  saveData(data);
  renderList(priority, {
    previousPositions,
    focusId: restoreFocus ? id : '',
    focusAction: 'toggle',
  });
  updateCount(priority);
  if (nowDone) requestAnimationFrame(() => flashCheckboxPop(priority, id)); // 勾选弹一下
}

function deleteTodo(priority, id) {
  const list = data[priority];
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = list.splice(index, 1);
  const itemEl = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"]`
  );
  const shouldRestoreFocus = !!(itemEl && itemEl.contains(document.activeElement));
  const nearbyId = itemEl && (itemEl.nextElementSibling || itemEl.previousElementSibling)?.dataset.id;
  saveData(data);
  renderList(priority);
  updateCount(priority);
  if (shouldRestoreFocus) {
    const nextFocus =
      (nearbyId && document.querySelector(`.todo-item[data-id="${CSS.escape(nearbyId)}"] [data-action="toggle"]`)) ||
      document.querySelector(`.add-row input[data-priority="${priority}"]`);
    if (nextFocus) nextFocus.focus({ preventScroll: true });
  }
  const summary = removed.text.length > 18 ? `${removed.text.slice(0, 18)}…` : removed.text;
  showStatusToast(`已删除“${summary}”`, {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (list.some((item) => item.id === removed.id)) return;
      list.splice(Math.min(index, list.length), 0, removed);
      saveData(data);
      renderList(priority);
      updateCount(priority);
      const restored = document.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"] [data-action="toggle"]`
      );
      if (restored) restored.focus({ preventScroll: true });
      showStatusToast('已撤销删除');
    },
  });
}

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

notch.addEventListener('mouseenter', () => {
  if (!isExpanded) window.notchAPI?.setCollapsedHover?.(true);
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
    if (shortcutRecorderActive) { closeShortcutRecorder(); return; }
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

// 布局度量（主进程按屏计算下发）：折叠条高 / 菜单栏占位高 / 各 Tab 目标尺寸
let layoutMetrics = null;

function applyLayoutMetrics(metrics) {
  if (!metrics) return;
  layoutMetrics = metrics;
  if (metrics.stripHeight) {
    document.documentElement.style.setProperty('--notch-h', `${metrics.stripHeight}px`);
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

function applyFeatureSettings(settings) {
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
      if (_tabNameForDeferred === 'notes') renderNotesLibrary();
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
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
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
// 这里绑定所有 Tab（包括启动时隐藏的剪贴板），避免功能启用后按钮仍没有事件。
const shortcutRecorder = document.getElementById('shortcut-recorder');
const shortcutRecorderTitle = document.getElementById('shortcut-recorder-title');
const shortcutRecorderValue = document.getElementById('shortcut-recorder-value');
const shortcutRecorderHint = document.getElementById('shortcut-recorder-hint');
const shortcutRecorderDisable = document.getElementById('shortcut-recorder-disable');
const shortcutRecorderCancel = document.getElementById('shortcut-recorder-cancel');
let shortcutRecorderActive = false;
let shortcutRecorderAction = 'panel';

function closeShortcutRecorder() {
  shortcutRecorderActive = false;
  if (shortcutRecorder) shortcutRecorder.hidden = true;
}

async function saveRecordedShortcut(accelerator) {
  const setter = window.notchAPI?.setShortcut;
  const result = typeof setter === 'function'
    ? await setter(shortcutRecorderAction, accelerator).catch(() => ({ ok: false }))
    : await window.notchAPI?.setPanelShortcut?.(accelerator).catch(() => ({ ok: false }));
  if (!result?.ok) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = result?.error === 'occupied' ? '该快捷键已被占用' : '无法使用该快捷键';
    return false;
  }
  showStatusToast(accelerator ? `快捷键已设为 ${shortcutLabel(accelerator)}` : '快捷键已禁用');
  setTimeout(closeShortcutRecorder, 420);
  return true;
}

function shortcutLabel(value) {
  if (!value) return '未设置';
  const mac = app.dataset.platform === 'darwin';
  return String(value).split('+').map((part) => ({
    CommandOrControl: mac ? 'Cmd' : 'Ctrl',
    Command: 'Cmd',
    Control: 'Ctrl',
    Option: 'Option',
    Alt: mac ? 'Option' : 'Alt',
  })[part] || part).join(' + ');
}

function keyEventToAccelerator(event) {
  const keyAliases = {
    ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  };
  let key = keyAliases[event.key] || event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key)) return '';
  const parts = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

shortcutRecorder?.addEventListener('keydown', async (event) => {
  if (!shortcutRecorderActive) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    closeShortcutRecorder();
    return;
  }
  const accelerator = keyEventToAccelerator(event);
  if (!accelerator) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = '请按下完整按键组合';
    return;
  }
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  if ((!hasModifier && accelerator !== 'Space') || (shortcutRecorderAction !== 'panel' && accelerator === 'Space')) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = shortcutRecorderAction === 'panel' ? '单键仅支持空格' : '请使用包含修饰键的组合键';
    return;
  }
  if (shortcutRecorderValue) shortcutRecorderValue.textContent = shortcutLabel(accelerator);
  await saveRecordedShortcut(accelerator);
});

shortcutRecorderDisable?.addEventListener('click', () => { void saveRecordedShortcut(''); });
shortcutRecorderCancel?.addEventListener('click', closeShortcutRecorder);
function openShortcutRecorder(input = {}) {
  const detail = input?.detail && typeof input.detail === 'object' ? input.detail : input;
  const action = ['panel', 'launcher', 'screenshot', 'screenRecording', 'audioRecording'].includes(detail?.action) ? detail.action : 'panel';
  const labels = {
    panel: '展开或收起面板',
    launcher: '搜索与启动器',
    screenshot: '区域截图',
    screenRecording: '区域录屏',
    audioRecording: '开始或停止录音',
  };
  if (!isExpanded) setMode(true);
  shortcutRecorderAction = action;
  shortcutRecorderActive = true;
  shortcutRecorder.hidden = false;
  shortcutRecorderTitle.textContent = `设置：${labels[action]}`;
  shortcutRecorderValue.textContent = detail?.current ? shortcutLabel(detail.current) : '等待输入…';
  shortcutRecorderHint.textContent = action === 'panel'
    ? '可直接使用空格；其他按键请搭配修饰键'
    : '请使用包含修饰键的组合键，也可禁用';
  shortcutRecorderDisable.hidden = action === 'panel';
  requestAnimationFrame(() => shortcutRecorder.focus({ preventScroll: true }));
}
window.notchAPI?.onRecordShortcut?.(() => openShortcutRecorder({ action: 'panel' }));
document.addEventListener('notch:record-shortcut', openShortcutRecorder);

if (collapseBtn) {
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(false);
  });
}

// 顶栏空白处点按收起——黑条在展开态已退场，由顶栏接替这一角色。
// 排除交互区（Tab / 按钮 / 输入 / 搜索框），品牌区与空白处都可收起（明确的收起热区）。
// 注意：home/todo 下搜索框隐藏会让 .topbar-mid 高度塌成 0，点击其实落在 .topbar 上，
// 所以必须挂在 .topbar 上并用 closest 排除，不能只认 .topbar-mid 本体。
const topbarEl = document.querySelector('.topbar');
if (topbarEl) {
  topbarEl.addEventListener('click', (e) => {
    if (e.target.closest('.tabs, button, input')) return;
    e.stopPropagation();
    setMode(false);
  });
}

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

function refreshScopedTodoDraftDeadlines(now = new Date()) {
  document.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
    if (trigger.dataset.deadlineSource === 'manual') return;
    delete trigger.dataset.deadline;
    delete trigger.dataset.deadlineSource;
    applyDefaultTodoDeadline(trigger, now);
  });
}

function setTodoTimeScope(scope, { focusOverdue = false } = {}) {
  if (!TODO_TIME_SCOPES.includes(scope)) return false;
  todoTimeScope = scope;
  editingTodo = null;
  PRIORITIES.forEach((priority) => {
    todoSelections[priority].clear();
    todoSelectionAnchors[priority] = null;
    todoCompletedExpanded[priority] = false;
  });
  closeTodoEditor();
  refreshScopedTodoDraftDeadlines();
  renderAll();
  if (focusOverdue) {
    requestAnimationFrame(() => document.querySelector('.todo-item.overdue [data-action="toggle"]')?.focus({ preventScroll: true }));
  }
  return true;
}

todoScopeButtons.forEach((button, index) => {
  button.addEventListener('click', () => setTodoTimeScope(button.dataset.todoScope));
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = todoScopeButtons[(index + offset + todoScopeButtons.length) % todoScopeButtons.length];
    next.focus({ preventScroll: true });
    setTodoTimeScope(next.dataset.todoScope);
  });
});

todoOverdueJump?.addEventListener('click', () => setTodoTimeScope('today', { focusOverdue: true }));
document.getElementById('todo-ai-add')?.addEventListener('click', () => window.NotchAI?.openText?.('extractTodos'));

window.NotchTodo = {
  getTimeScope: () => todoTimeScope,
  setTimeScope: (scope) => setTodoTimeScope(scope),
  getScopeCounts: () => ({ ...window.NotchDomain.todoTimeScopeCounts(allTodoItems()) }),
  snapshot: () => Object.fromEntries(PRIORITIES.map((priority) => [priority, (data[priority] || []).map((todo) => ({ ...todo }))])),
  chatContexts: () => PRIORITIES.flatMap((priority) => (data[priority] || []).map((todo) => ({
    sourceType: 'todo',
    sourceId: todo.id,
    sourceTitle: todo.text,
    sourceRevision: String(todo.updatedAt || todo.createdAt || ''),
    text: [`状态：${todo.done ? '已完成' : '未完成'}`, `责任领域：${todoCategoryNames[priority] || priority}`, todo.deadline ? `截止时间：${todo.deadline}` : '截止时间：未设置'].join('\n'),
    detail: `${todoCategoryNames[priority] || priority} · ${todo.done ? '已完成' : '未完成'}`,
    updatedAt: todo.updatedAt || todo.createdAt || 0,
  }))),
  async applyAIBatch(candidates) {
    const applied = window.NotchAIDomain?.createTodoBatch(data, candidates, () => generateId(), Date.now());
    if (!applied?.ok) return applied || { ok: false, error: 'invalid_candidates' };
    const previous = data;
    data = applied.next;
    if (!saveData(data)) { data = previous; return { ok: false, error: 'save_failed' }; }
    renderAll();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, count: applied.added.length, undo: applied.added, workspaceSynced };
  },
  async undoAIBatch(added) {
    const result = window.NotchAIDomain?.undoTodoBatch(data, added);
    if (!result) return { ok: false, error: 'invalid_undo' };
    const previous = data;
    data = result.next;
    if (!saveData(data)) { data = previous; return { ok: false, error: 'save_failed' }; }
    renderAll();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, removed: result.removed.length, conflicts: result.conflicts.length, workspaceSynced };
  },
};

const todoEditorBackdrop = document.getElementById('todo-date-popover');
const todoEditorMonth = document.getElementById('todo-editor-month');
const todoCalendarPrevious = document.getElementById('todo-calendar-previous');
const todoCalendarNext = document.getElementById('todo-calendar-next');
const todoCalendarGrid = document.getElementById('todo-calendar-grid');
const todoEditorHour = document.getElementById('todo-editor-hour');
const todoEditorMinute = document.getElementById('todo-editor-minute');
const todoEditorError = document.getElementById('todo-editor-error');
let todoEditorContext = null;
let todoEditorYear = new Date().getFullYear();
let todoEditorMonthIndex = new Date().getMonth();
let todoEditorDay = new Date().getDate();

function fillTodoTimeOptions() {
  if (todoEditorHour && !todoEditorHour.options.length) {
    for (let hour = 0; hour < 24; hour += 1) todoEditorHour.add(new Option(String(hour).padStart(2, '0'), String(hour)));
  }
  if (todoEditorMinute && !todoEditorMinute.options.length) {
    for (let minute = 0; minute < 60; minute += 5) todoEditorMinute.add(new Option(String(minute).padStart(2, '0'), String(minute)));
  }
}

function renderTodoCalendar() {
  if (!todoCalendarGrid) return;
  const now = new Date();
  const days = new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(todoEditorYear, todoEditorMonthIndex, 1).getDay() + 6) % 7;
  if (todoEditorMonth) todoEditorMonth.textContent = `${todoEditorYear}年 ${todoEditorMonthIndex + 1}月`;
  todoCalendarGrid.replaceChildren();
  for (let index = 0; index < firstWeekday; index += 1) todoCalendarGrid.append(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.dataset.day = String(day);
    button.className = day === todoEditorDay ? 'selected' : '';
    if (todoEditorYear === now.getFullYear() && todoEditorMonthIndex === now.getMonth() && day === now.getDate()) {
      button.classList.add('today');
    }
    todoCalendarGrid.append(button);
  }
}

function closeTodoEditor() {
  if (todoEditorBackdrop) todoEditorBackdrop.hidden = true;
  if (todoEditorContext?.mode === 'edit') {
    const { priority } = todoEditorContext;
    renderList(priority);
  }
  todoEditorContext = null;
}

function selectedTodoDeadline() {
  return window.NotchDomain.calendarDeadline({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
    day: todoEditorDay,
    hour: todoEditorHour?.value,
    minute: todoEditorMinute?.value,
  });
}

function applyTodoEditorSelection(markManual = true) {
  if (!todoEditorContext) return false;
  const deadline = selectedTodoDeadline();
  if (!deadline || Date.parse(deadline) <= Date.now()) {
    if (todoEditorError) todoEditorError.textContent = '请选择晚于当前时间的截止点';
    return false;
  }
  if (todoEditorError) todoEditorError.textContent = '';
  const { priority, id, mode } = todoEditorContext;
  if (mode === 'edit') {
    const todo = (data[priority] || []).find((item) => item.id === id);
    if (!todo) return false;
    todo.deadline = deadline;
    saveData(data);
  } else {
    const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
    if (!trigger) return false;
    trigger.dataset.deadline = deadline;
    trigger.dataset.deadlineSource = markManual ? 'manual' : (trigger.dataset.deadlineSource || 'default');
    trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(deadline));
    trigger.classList.add('selected');
    trigger.classList.remove('invalid');
  }
  return true;
}

function openTodoEditor(priority, item = null, anchor = null) {
  const now = new Date();
  const addInput = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  const candidate = item && item.deadline ? new Date(item.deadline) : trigger?.dataset.deadline ? new Date(trigger.dataset.deadline) : null;
  const selectedDate = candidate && Number.isFinite(candidate.getTime())
    ? candidate
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
  todoEditorContext = { priority, id: item && item.id || '', mode: item ? 'edit' : 'add' };
  todoEditorYear = selectedDate.getFullYear();
  todoEditorMonthIndex = selectedDate.getMonth();
  todoEditorDay = selectedDate.getDate();
  fillTodoTimeOptions();
  if (todoEditorHour) todoEditorHour.value = String(selectedDate.getHours());
  if (todoEditorMinute) todoEditorMinute.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5);
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
  if (todoEditorBackdrop) {
    const target = anchor || (item
      ? document.querySelector(`.todo-item[data-id="${CSS.escape(item.id)}"] .todo-inline-deadline`)
      : trigger);
    const quadrant = target?.closest('.quadrant') || document.querySelector(`.quadrant[data-priority="${priority}"]`);
    quadrant?.appendChild(todoEditorBackdrop);
    todoEditorBackdrop.hidden = false;
    todoEditorBackdrop.style.removeProperty('left');
    todoEditorBackdrop.style.removeProperty('top');
    todoEditorBackdrop.style.right = '12px';
    todoEditorBackdrop.style.bottom = '58px';
  }
  applyTodoEditorSelection(false);
}

todoCalendarGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  todoEditorDay = Number(button.dataset.day);
  renderTodoCalendar();
  applyTodoEditorSelection(true);
});

document.querySelectorAll('[data-todo-date-shortcut]').forEach((button) => {
  button.addEventListener('click', () => {
    const now = new Date();
    const shortcut = button.dataset.todoDateShortcut;
    let selected = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
    if (shortcut === 'tomorrow') selected.setDate(selected.getDate() + 1);
    if (shortcut === 'weekend') selected.setDate(selected.getDate() + (7 - selected.getDay()) % 7);
    if (shortcut === 'next-week') selected.setDate(selected.getDate() + (selected.getDay() === 0 ? 1 : 8 - selected.getDay()));
    if (shortcut === 'today' && selected <= now) {
      const safeToday = window.NotchDomain.defaultTodoDeadlineForScope('today', now);
      if (safeToday) selected = new Date(safeToday);
    }
    todoEditorYear = selected.getFullYear();
    todoEditorMonthIndex = selected.getMonth();
    todoEditorDay = selected.getDate();
    fillTodoTimeOptions();
    if (todoEditorHour) todoEditorHour.value = String(selected.getHours());
    if (todoEditorMinute) todoEditorMinute.value = String(selected.getMinutes());
    renderTodoCalendar();
    applyTodoEditorSelection(true);
  });
});

function moveTodoCalendar(offset) {
  const shifted = window.NotchDomain.shiftCalendarMonth({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
  }, offset);
  if (!shifted) return;
  todoEditorYear = shifted.year;
  todoEditorMonthIndex = shifted.month;
  todoEditorDay = Math.min(todoEditorDay, new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate());
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
}

todoCalendarPrevious?.addEventListener('click', () => moveTodoCalendar(-1));
todoCalendarNext?.addEventListener('click', () => moveTodoCalendar(1));
todoEditorHour?.addEventListener('change', () => applyTodoEditorSelection(true));
todoEditorMinute?.addEventListener('change', () => applyTodoEditorSelection(true));

document.addEventListener('pointerdown', (event) => {
  if (todoEditorBackdrop?.hidden) return;
  if (todoEditorBackdrop.contains(event.target) || event.target.closest('.todo-deadline-trigger, .todo-inline-deadline')) return;
  closeTodoEditor();
}, true);

function applyDefaultTodoDeadline(trigger, now = new Date()) {
  if (!trigger || (trigger.dataset.deadline && trigger.dataset.deadlineSource !== 'default')) return;
  const deadline = window.NotchDomain.defaultTodoDeadlineForScope(todoTimeScope, now);
  if (!deadline) {
    delete trigger.dataset.deadline;
    delete trigger.dataset.deadlineSource;
    trigger.querySelector('span').textContent = '选择日期';
    trigger.classList.remove('selected');
    return;
  }
  trigger.dataset.deadline = deadline;
  trigger.dataset.deadlineSource = 'default';
  trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(deadline));
  trigger.classList.add('selected');
}

function resetTodoDraftDeadline(trigger, now = new Date()) {
  if (!trigger) return;
  delete trigger.dataset.deadline;
  delete trigger.dataset.deadlineSource;
  applyDefaultTodoDeadline(trigger, now);
}

function refreshDefaultTodoDeadlines(now = new Date()) {
  document.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
    if (trigger.dataset.deadlineSource === 'manual') return;
    applyDefaultTodoDeadline(trigger, now);
  });
}

PRIORITIES.forEach((priority) => {
  const input = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const deadlineInput = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  if (!input) return;
  applyDefaultTodoDeadline(deadlineInput);

  const submitTodo = () => {
    const value = input.value;
    if (!value.trim()) return;
    if (!deadlineInput || !deadlineInput.dataset.deadline) {
      deadlineInput?.classList.add('invalid');
      openTodoEditor(priority);
      return;
    }
    if (!addTodo(priority, value, deadlineInput.dataset.deadline)) {
      deadlineInput.classList.add('invalid');
      showStatusToast('截止时间格式不正确');
      return;
    }
    input.value = '';
    if (todoEditorContext?.mode === 'add' && todoEditorContext.priority === priority) closeTodoEditor();
    resetTodoDraftDeadline(deadlineInput);
    deadlineInput.classList.remove('invalid');
    input.focus({ preventScroll: true });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (e.repeat) return;
    submitTodo();
  });
  deadlineInput?.addEventListener('click', () => openTodoEditor(priority));
});

PRIORITIES.forEach((priority) => {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  list.addEventListener('click', (e) => {
    const completedToggle = e.target.closest('[data-todo-completed-toggle]');
    if (completedToggle) {
      const targetPriority = completedToggle.dataset.todoCompletedToggle;
      todoCompletedExpanded[targetPriority] = !todoCompletedExpanded[targetPriority];
      renderList(targetPriority);
      requestAnimationFrame(() => document.querySelector(`[data-todo-completed-toggle="${targetPriority}"]`)?.focus({ preventScroll: true }));
      return;
    }
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.shiftKey) {
      e.preventDefault();
      const result = window.NotchDomain.updateRangeSelection(
        todosVisibleInScope(priority).map((todo) => todo.id),
        [...todoSelections[priority]],
        id,
        todoSelectionAnchors[priority],
        true
      );
      todoSelections[priority] = new Set(result.selected);
      todoSelectionAnchors[priority] = result.anchor;
      renderList(priority);
      return;
    }
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      toggleTodo(priority, id);
    } else if (action === 'edit') {
      const todo = (data[priority] || []).find((item) => item.id === id);
      if (todo) {
        editingTodo = { priority, id };
        renderList(priority);
        requestAnimationFrame(() => document.querySelector(`.todo-item[data-id="${CSS.escape(id)}"] .todo-inline-name`)?.focus({ preventScroll: true }));
      }
    } else if (action === 'edit-deadline') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      if (todo) openTodoEditor(priority, todo, target);
    } else if (action === 'save-edit') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      const name = item.querySelector('.todo-inline-name')?.value.trim() || '';
      if (!todo || !name || !todo.deadline) return;
      editingTodo = null;
      editTodo(priority, id, name, todo.deadline);
    } else if (action === 'reschedule-today') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      const deadline = window.NotchDomain.defaultTodoDeadlineForScope('today', new Date());
      if (!todo || !deadline) return;
      editTodo(priority, id, todo.text, deadline);
      showStatusToast('已移到今天');
    } else if (action === 'delete') {
      deleteTodo(priority, id);
    }
  });
  list.addEventListener('keydown', (event) => {
    const item = event.target.closest('.todo-item');
    if (!item || !event.target.matches('.todo-inline-name')) return;
    if (event.key === 'Escape') {
      editingTodo = null;
      renderList(priority);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      item.querySelector('[data-action="save-edit"]')?.click();
    }
  });
});

document.querySelectorAll('.todo-bulk-delete[data-bulk-priority]').forEach((button) => {
  button.addEventListener('click', () => {
    const priority = button.dataset.bulkPriority;
    const selected = todoSelections[priority];
    if (!selected || !selected.size) return;
    data[priority] = (data[priority] || []).filter((item) => !selected.has(item.id));
    selected.clear();
    todoSelectionAnchors[priority] = null;
    saveData(data);
    renderList(priority);
    updateCount(priority);
    showStatusToast('已删除所选待办');
  });
});

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
  if (dayKey !== todoScopeRefreshDay && !editingTodo && !todoEditorContext) {
    todoScopeRefreshDay = dayKey;
    renderAll();
  }
}

function refreshTodoTemporalView() {
  if (editingTodo || todoEditorContext) return;
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
const pomodoroToggle = document.getElementById('pomodoro-toggle');
const pomodoroReset = document.getElementById('pomodoro-reset');
const homePomodoro = document.getElementById('home-pomodoro');
const pomodoroEndTime = document.getElementById('pomodoro-end-time');
const pomodoroInputs = [
  document.getElementById('pomodoro-minutes'),
  document.getElementById('pomodoro-seconds'),
];
const POMODORO_DURATION_KEY = 'dynamic-panel-pomodoro-duration-v3';
let savedPomodoroParts = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(POMODORO_DURATION_KEY) || 'null');
    if (Array.isArray(value) && value.length === 3) {
      return [
        Math.max(0, Math.min(60, (Number(value[0]) || 0) * 60 + (Number(value[1]) || 0))),
        Math.max(0, Math.min(60, Number(value[2]) || 0)),
      ];
    }
    if (Array.isArray(value) && value.length === 2) {
      return value.map((part) => Math.max(0, Math.min(60, Number(part) || 0)));
    }
  } catch (error) {}
  return [5, 0];
})();
let pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
let pomodoroRemaining = pomodoroConfiguredSeconds;
let pomodoroRunning = false;
let pomodoroStarted = false;
let pomodoroTimer = null;

function secondsToParts(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.min(60, Math.floor(safe / 60)), safe % 60];
}

function setPomodoroInputs(parts) {
  pomodoroInputs.forEach((input, index) => {
    if (!input) return;
    input.value = String(parts[index]).padStart(2, '0');
    input.readOnly = pomodoroRunning;
  });
}

function formatPomodoroEndTime(seconds) {
  const target = new Date(Date.now() + Math.max(0, seconds) * 1000);
  return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
}

function renderPomodoro() {
  setPomodoroInputs(pomodoroStarted ? secondsToParts(pomodoroRemaining) : savedPomodoroParts);
  if (pomodoroEndTime) {
    pomodoroEndTime.textContent = formatPomodoroEndTime(pomodoroStarted ? pomodoroRemaining : pomodoroConfiguredSeconds);
  }
  const remainingRatio = pomodoroStarted
    ? pomodoroRemaining / Math.max(1, pomodoroConfiguredSeconds)
    : 1;
  homePomodoro?.style.setProperty('--pomodoro-progress', String(Math.max(0, Math.min(1, remainingRatio))));
  if (pomodoroToggle) {
    pomodoroToggle.innerHTML = pomodoroRunning
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5z" /></svg>';
    pomodoroToggle.setAttribute('aria-label', pomodoroRunning ? '暂停番茄钟' : '开始番茄钟');
  }
  if (pomodoroReset) pomodoroReset.hidden = !pomodoroStarted;
  homePomodoro?.setAttribute('data-state', pomodoroRunning ? 'running' : (pomodoroStarted ? 'paused' : 'idle'));
}

function commitPomodoroInputs() {
  if (pomodoroRunning) return;
  savedPomodoroParts = pomodoroInputs.map((input) => Math.max(0, Math.min(60, Number.parseInt(input?.value || '0', 10) || 0)));
  pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
  pomodoroRemaining = pomodoroConfiguredSeconds;
  pomodoroStarted = false;
  localStorage.setItem(POMODORO_DURATION_KEY, JSON.stringify(savedPomodoroParts));
  renderPomodoro();
}

pomodoroInputs.forEach((input) => {
  if (!input) return;
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 2);
  });
  input.addEventListener('blur', commitPomodoroInputs);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPomodoroInputs();
      input.blur();
    }
  });
  input.addEventListener('wheel', (event) => {
    if (pomodoroRunning) return;
    event.preventDefault();
    const current = Number.parseInt(input.value || '0', 10) || 0;
    input.value = String(Math.max(0, Math.min(60, current + (event.deltaY < 0 ? 1 : -1)))).padStart(2, '0');
    commitPomodoroInputs();
    input.focus({ preventScroll: true });
    input.select();
  }, { passive: false });
});

pomodoroToggle?.addEventListener('click', () => {
  if (!pomodoroStarted) {
    commitPomodoroInputs();
    if (pomodoroConfiguredSeconds <= 0) {
      showStatusToast('请先设置倒计时时间');
      return;
    }
    pomodoroStarted = true;
    pomodoroRemaining = pomodoroConfiguredSeconds;
  }
  pomodoroRunning = !pomodoroRunning;
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  if (pomodoroRunning) {
    pomodoroTimer = setInterval(() => {
      pomodoroRemaining -= 1;
      if (pomodoroRemaining <= 0) {
        const completedMinutes = Math.max(1, Math.round(pomodoroConfiguredSeconds / 60));
        pomodoroRemaining = pomodoroConfiguredSeconds;
        pomodoroRunning = false;
        pomodoroStarted = false;
        clearInterval(pomodoroTimer);
        pomodoroTimer = null;
        showStatusToast(`${completedMinutes} 分钟专注完成`);
        window.notchAPI?.notifyPomodoro?.(completedMinutes).catch(() => {});
      }
      renderPomodoro();
    }, 1000);
  }
  renderPomodoro();
});

pomodoroReset?.addEventListener('click', () => {
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  pomodoroRunning = false;
  pomodoroStarted = false;
  pomodoroRemaining = pomodoroConfiguredSeconds;
  renderPomodoro();
});
renderPomodoro();

// ============ 首页 · Markdown 速记 ============
// textarea 中的原始 Markdown 始终是唯一数据源；预览只用 DOM API + textContent 构建，
// 不执行用户输入的 HTML，也不自动加载远程图片。
const NOTE_KEY = 'notch-home-note';
const NOTE_ARCHIVE_KEY = 'notch-note-archive-v1';
const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
const NOTE_CATEGORIES_KEY = 'notch-note-categories-v1';
const noteInput = document.getElementById('home-note');
const notePreview = document.getElementById('home-note-preview');
const noteSaveButton = document.getElementById('note-save-btn');
const notesList = document.getElementById('notes-list');
const notesSearch = document.getElementById('notes-search');
const notesDetail = document.getElementById('notes-detail');
const notesCount = document.getElementById('notes-count');
const notesNewButton = document.getElementById('notes-new');
const notesTaxonomyTree = document.getElementById('notes-taxonomy-tree');
const notesTaxonomyCount = document.getElementById('notes-taxonomy-count');
const notesCategoryFilter = document.getElementById('notes-category-filter');
const notesCategoryAdd = document.getElementById('notes-category-add');
const notesCategoryRename = document.getElementById('notes-category-rename');
const notesCategoryDelete = document.getElementById('notes-category-delete');
const notesCategoryEditor = document.getElementById('notes-category-editor');
const notesCategoryName = document.getElementById('notes-category-name');
const notesCategorySave = document.getElementById('notes-category-save');
const notesCategoryCancel = document.getElementById('notes-category-cancel');
const notesCategoryConfirm = document.getElementById('notes-category-confirm');
const notesCategoryConfirmText = document.getElementById('notes-category-confirm-text');
const notesCategoryDeleteCancel = document.getElementById('notes-category-delete-cancel');
const notesCategoryDeleteConfirm = document.getElementById('notes-category-delete-confirm');
const notesTagToolbar = document.getElementById('notes-tag-toolbar');
const notesTagFilter = document.getElementById('notes-tag-filter');
const notesTagAdd = document.getElementById('notes-tag-add');
const notesTagRename = document.getElementById('notes-tag-rename');
const notesTagDelete = document.getElementById('notes-tag-delete');
const notesTagEditor = document.getElementById('notes-tag-editor');
const notesTagName = document.getElementById('notes-tag-name');
const notesTagSave = document.getElementById('notes-tag-save');
const notesTagCancel = document.getElementById('notes-tag-cancel');
const notesTagConfirm = document.getElementById('notes-tag-confirm');
const notesTagConfirmText = document.getElementById('notes-tag-confirm-text');
const notesTagDeleteCancel = document.getElementById('notes-tag-delete-cancel');
const notesTagDeleteConfirm = document.getElementById('notes-tag-delete-confirm');
const noteFormatActions = document.getElementById('note-format-actions');
const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
const noteEditButton = document.getElementById('note-edit-btn');
const homeNote = document.querySelector('.home-note');

const NOTE_INLINE_PATTERNS = [
  { type: 'image', regex: /!\[([^\]\n]*)\]\((note-images\/[a-z0-9-]{6,80}\/image-[a-f0-9-]{36}\.png)\)/gi },
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
  { type: 'strong', regex: /__([^_\n]+)__/g },
  { type: 'delete', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
  { type: 'emphasis', regex: /_([^_\n]+)_/g },
];

const NOTE_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const NOTE_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NOTE_ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const NOTE_QUOTE_RE = /^\s*>\s?(.*)$/;
const NOTE_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+)$/;
const NOTE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
const NOTE_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function findNextInlineToken(text, fromIndex) {
  let next = null;
  NOTE_INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = fromIndex;
    const match = pattern.regex.exec(text);
    if (
      match &&
      (!next || match.index < next.match.index ||
        (match.index === next.match.index && priority < next.priority))
    ) {
      next = { type: pattern.type, match, priority };
    }
  });
  return next;
}

function safeNoteImageReference(rawPath) {
  const normalized = String(rawPath || '').replace(/\\/g, '/');
  return /^note-images\/[a-z0-9-]{6,80}\/image-[a-f0-9-]{36}\.png$/i.test(normalized)
    ? normalized
    : null;
}

function safeMarkdownUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function appendInlineMarkdown(parent, source, depth = 0) {
  const text = String(source || '');
  if (!text || depth > 6) {
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      parent.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    const { type, match } = token;
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (type === 'image') {
      const imagePath = safeNoteImageReference(match[2]);
      if (!imagePath || !window.notchAPI?.readNoteImage) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const image = document.createElement('img');
        image.className = 'note-preview-image';
        image.alt = match[1] || '笔记图片';
        image.dataset.noteImage = imagePath;
        image.decoding = 'async';
        window.notchAPI.readNoteImage(imagePath).then((source) => {
          if (source && image.isConnected) image.src = source;
          else if (image.isConnected) image.replaceWith(document.createTextNode('[图片不可用]'));
        }).catch(() => {
          if (image.isConnected) image.replaceWith(document.createTextNode('[图片不可用]'));
        });
        parent.append(image);
      }
    } else if (type === 'code') {
      const code = document.createElement('code');
      code.textContent = match[1];
      parent.append(code);
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (!href) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const link = document.createElement('a');
        link.dataset.noteHref = href;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.rel = 'noreferrer';
        appendInlineMarkdown(link, match[1], depth + 1);
        parent.append(link);
      }
    } else {
      const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
      const formatted = document.createElement(tagName);
      appendInlineMarkdown(formatted, match[1], depth + 1);
      parent.append(formatted);
    }

    cursor = match.index + match[0].length;
  }
}

function appendMarkdownLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index > 0) parent.append(document.createElement('br'));
    appendInlineMarkdown(parent, line);
  });
}

function isMarkdownBlockStart(line) {
  if (!line.trim()) return true;
  return (
    NOTE_FENCE_RE.test(line) ||
    NOTE_HEADING_RE.test(line) ||
    NOTE_QUOTE_RE.test(line) ||
    NOTE_TASK_RE.test(line) ||
    NOTE_ORDERED_RE.test(line) ||
    NOTE_BULLET_RE.test(line) ||
    NOTE_RULE_RE.test(line)
  );
}

function buildMarkdownPreview(source) {
  const fragment = document.createDocumentFragment();
  const normalized = String(source || '').replace(/\r\n?/g, '\n');

  if (!normalized.trim()) {
    const empty = document.createElement('p');
    empty.className = 'note-preview-empty';
    empty.textContent = '写点内容后，在这里查看排版';
    fragment.append(empty);
    return fragment;
  }

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(NOTE_FENCE_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closeFence.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(NOTE_HEADING_RE);
    if (headingMatch) {
      const heading = document.createElement('h' + headingMatch[1].length);
      appendInlineMarkdown(heading, headingMatch[2]);
      fragment.append(heading);
      index += 1;
      continue;
    }

    if (NOTE_RULE_RE.test(line)) {
      fragment.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(NOTE_QUOTE_RE);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(NOTE_QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      const quote = document.createElement('blockquote');
      appendMarkdownLines(quote, quoteLines);
      fragment.append(quote);
      continue;
    }

    const taskMatch = line.match(NOTE_TASK_RE);
    if (taskMatch) {
      const list = document.createElement('ul');
      list.className = 'note-task-list';
      while (index < lines.length) {
        const match = lines[index].match(NOTE_TASK_RE);
        if (!match) break;
        const done = match[1].toLowerCase() === 'x';
        const item = document.createElement('li');
        item.className = 'note-task-item' + (done ? ' done' : '');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(done));
        const box = document.createElement('span');
        box.className = 'note-task-box';
        box.setAttribute('aria-hidden', 'true');
        box.textContent = done ? '✓' : '';
        const content = document.createElement('span');
        appendInlineMarkdown(content, match[2]);
        item.append(box, content);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const orderedMatch = line.match(NOTE_ORDERED_RE);
    if (orderedMatch) {
      const list = document.createElement('ol');
      const start = Number.parseInt(orderedMatch[1], 10);
      if (Number.isFinite(start) && start !== 1) list.start = start;
      while (index < lines.length) {
        const match = lines[index].match(NOTE_ORDERED_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const bulletMatch = line.match(NOTE_BULLET_RE);
    if (bulletMatch) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        if (NOTE_TASK_RE.test(lines[index])) break;
        const match = lines[index].match(NOTE_BULLET_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[1]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendMarkdownLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}

function renderNotePreview() {
  if (!noteInput || !notePreview) return;
  notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
}

function replaceNoteText(
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd,
  selectionDirection = 'none'
) {
  if (!noteInput) return;
  noteInput.setRangeText(replacement, start, end, 'end');
  noteInput.focus({ preventScroll: true });
  noteInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapNoteSelection(open, close, placeholder) {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);

  const hasOuterMarkers =
    selected &&
    start >= open.length &&
    noteInput.value.slice(start - open.length, start) === open &&
    noteInput.value.slice(end, end + close.length) === close;
  if (hasOuterMarkers) {
    replaceNoteText(
      start - open.length,
      end + close.length,
      selected,
      start - open.length,
      end - open.length,
      direction
    );
    return;
  }

  if (selected && selected.startsWith(open) && selected.endsWith(close)) {
    const unwrapped = selected.slice(open.length, selected.length - close.length);
    replaceNoteText(start, end, unwrapped, start, start + unwrapped.length, direction);
    return;
  }

  const content = selected || placeholder;
  const replacement = open + content + close;
  replaceNoteText(
    start,
    end,
    replacement,
    start + open.length,
    start + open.length + content.length,
    direction
  );
}

function stripNoteBlockPrefix(line) {
  return line.replace(
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/,
    ''
  );
}

function applyNoteLineFormat(type) {
  if (!noteInput) return;
  const value = noteInput.value;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd;
  if (end > start && value[end - 1] === '\n') {
    lineEnd = end - 1;
  } else {
    const nextBreak = value.indexOf('\n', end);
    lineEnd = nextBreak === -1 ? value.length : nextBreak;
  }

  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const matchers = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
    ordered: /^\d+[.)]\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };
  const matcher = matchers[type];
  if (!matcher) return;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => matcher.test(line.trimStart()));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    if (shouldRemove) return indentation + body.replace(matcher, '');
    const content = stripNoteBlockPrefix(body) || (
      type === 'heading' ? '标题' :
      type === 'task' ? '待办' :
      type === 'quote' ? '引用' : '项目'
    );
    if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
    if (type === 'heading') return indentation + '# ' + content;
    if (type === 'task') return indentation + '- [ ] ' + content;
    if (type === 'quote') return indentation + '> ' + content;
    return indentation + '- ' + content;
  }).join('\n');

  const emptySingleLine = lines.length === 1 && !original.trim() && !shouldRemove;
  let nextStart = lineStart;
  let nextEnd = lineStart + transformed.length;
  if (emptySingleLine) {
    const indentationLength = original.match(/^\s*/)[0].length;
    const prefixLength =
      type === 'heading' ? 2 :
      type === 'task' ? 6 :
      type === 'ordered' ? 3 : 2;
    nextStart += indentationLength + prefixLength;
  }
  replaceNoteText(lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
}

function applyNoteLink() {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);
  const label = selected || '链接文字';
  const url = 'https://';
  const replacement = '[' + label + '](' + url + ')';
  if (selected) {
    const urlStart = start + label.length + 3;
    replaceNoteText(start, end, replacement, urlStart, urlStart + url.length, direction);
  } else {
    replaceNoteText(start, end, replacement, start + 1, start + 1 + label.length, direction);
  }
}

let noteComposing = false;

function applyNoteFormat(type) {
  if (!noteInput || noteComposing) return;
  if (type === 'bold') return wrapNoteSelection('**', '**', '加粗文字');
  if (type === 'italic') return wrapNoteSelection('*', '*', '斜体文字');
  if (type === 'code') return wrapNoteSelection('`', '`', '代码');
  if (type === 'link') return applyNoteLink();
  applyNoteLineFormat(type);
}

let noteMode = 'edit';
let noteSelection = { start: 0, end: 0, direction: 'none', scrollTop: 0 };

function setNoteMode(mode, focusTarget = true) {
  if (!noteInput || !notePreview) return;
  const previousMode = noteMode;
  noteMode = mode === 'preview' ? 'preview' : 'edit';
  const isPreview = noteMode === 'preview';

  if (isPreview) {
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
    renderNotePreview();
  } else if (previousMode === 'edit') {
    // 重复点击已选中的“编辑”时保留用户当下光标，而不是恢复旧选区。
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
  }

  noteInput.hidden = isPreview;
  notePreview.hidden = !isPreview;
  if (noteFormatActions) noteFormatActions.hidden = isPreview;
  if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
  noteModeButtons.forEach((button) => {
    const active = button.dataset.noteMode === noteMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (noteEditButton) {
    noteEditButton.classList.toggle('active', !isPreview);
    noteEditButton.textContent = isPreview ? '编辑' : '完成';
    noteEditButton.setAttribute('aria-pressed', String(!isPreview));
  }

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) {
      notePreview.focus({ preventScroll: true });
    } else {
      noteInput.focus({ preventScroll: true });
      noteInput.setSelectionRange(
        noteSelection.start,
        noteSelection.end,
        noteSelection.direction
      );
      noteInput.scrollTop = noteSelection.scrollTop;
    }
  });
}

function applyNoteTabIndentation(editor, event) {
  if (
    !editor ||
    event.key !== 'Tab' ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing
  ) {
    return false;
  }
  event.preventDefault();
  const change = window.NotchDomain.adjustNoteIndentation(
    editor.value,
    editor.selectionStart,
    editor.selectionEnd,
    event.shiftKey
  );
  if (change.value === editor.value) return true;
  const direction = editor.selectionDirection;
  editor.setRangeText(change.replacement, change.replaceStart, change.replaceEnd, 'end');
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(change.selectionStart, change.selectionEnd, direction);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function continueNoteList(event) {
  if (
    !noteInput ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing ||
    noteInput.selectionStart !== noteInput.selectionEnd
  ) {
    return false;
  }

  const value = noteInput.value;
  const cursor = noteInput.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const patterns = [
    {
      regex: /^(\s*)[-*+]\s+\[[ xX]\]\s*(.*)$/,
      prefix: () => '- [ ] ',
    },
    {
      regex: /^(\s*)(\d+)[.)]\s+(.*)$/,
      prefix: (match) => String(Number.parseInt(match[2], 10) + 1) + '. ',
    },
    {
      regex: /^(\s*)[-*+]\s+(.*)$/,
      prefix: () => '- ',
    },
    {
      regex: /^(\s*)>\s?(.*)$/,
      prefix: () => '> ',
    },
  ];

  const definition = patterns.find((candidate) => candidate.regex.test(line));
  if (!definition) return false;
  const match = line.match(definition.regex);
  const content = match[match.length - 1];
  const indentation = match[1];
  event.preventDefault();

  if (!content.trim()) {
    replaceNoteText(
      lineStart,
      lineEnd,
      indentation,
      lineStart + indentation.length,
      lineStart + indentation.length
    );
    return true;
  }

  const prefix = indentation + definition.prefix(match);
  const insertion = '\n' + prefix;
  replaceNoteText(cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

if (noteInput) {
  try {
    noteInput.value = localStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    // ignore
  }

  let noteTimer = null;
  const saveNote = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    if (workspaceReloadPending) return;
    try {
      localStorage.setItem(NOTE_KEY, noteInput.value);
    } catch (e) {
      // ignore quota errors
    }
  };

  noteInput.addEventListener('input', () => {
    if (!noteInput.value.trim()) localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    renderNotePreview();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 300);
  });
  noteInput.addEventListener('blur', saveNote);
  noteInput.addEventListener('compositionstart', () => {
    noteComposing = true;
  });
  noteInput.addEventListener('compositionend', () => {
    noteComposing = false;
  });
  noteInput.addEventListener('keydown', (event) => {
    if (applyNoteTabIndentation(noteInput, event)) return;
    if (continueNoteList(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    applyNoteFormat(key === 'b' ? 'bold' : 'italic');
  });

  window.addEventListener('beforeunload', saveNote);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNote();
  });

  noteInput.hidden = false;
}

function loadNoteCategories() {
  try {
    return window.NotchDomain.normalizeNoteCategories(JSON.parse(localStorage.getItem(NOTE_CATEGORIES_KEY) || '[]'));
  } catch (error) {
    return [];
  }
}

function loadNoteArchive() {
  try {
    const parsed = window.NotchDomain.normalizeNoteArchive(JSON.parse(localStorage.getItem(NOTE_ARCHIVE_KEY) || '[]'));
    const categories = new Map(loadNoteCategories().map((category) => [category.id, new Set(category.tags.map((tag) => tag.id))]));
    return parsed.map((note) => {
      const tags = categories.get(note.categoryId);
      if (!tags) return { ...note, categoryId: '', tagId: '' };
      return tags.has(note.tagId) ? note : { ...note, tagId: '' };
    });
  } catch (error) {
    return [];
  }
}

function noteCategoryName(note, categories = loadNoteCategories()) {
  return categories.find((category) => category.id === String(note && note.categoryId || ''))?.name || '未分类';
}

function noteTagName(note, categories = loadNoteCategories()) {
  const category = categories.find((item) => item.id === String(note && note.categoryId || ''));
  return category?.tags.find((tag) => tag.id === String(note && note.tagId || ''))?.name || '';
}

function saveNoteCategories(categories) {
  const normalized = window.NotchDomain.normalizeNoteCategories(categories);
  localStorage.setItem(NOTE_CATEGORIES_KEY, JSON.stringify(normalized));
  return normalized;
}

let selectedNoteId = '';
let noteCategoryEditorMode = '';
let noteTagEditorMode = '';
const expandedNoteCategories = new Set();

function noteArchiveTitle(note) {
  return String(note && note.title || '').trim() || '未命名笔记';
}

function noteArchiveExcerpt(note) {
  const content = String(note && note.content || '')
    .replace(/!\[([^\]]*)\]\(note-images\/[^)]+\)/gi, '$1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.join(' ').replace(/[#*_~`>\[\]]/g, '').slice(0, 86);
}

function noteArchiveTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

const NOTES_TOOL_ICONS = {
  heading: '<b>H</b>',
  bold: '<b>B</b>',
  italic: '<i>I</i>',
  bullet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="6" height="6" rx="1"/><path d="m4.5 7 1.5 1.5L8.5 6M13 7h8M3 17h6M13 17h8"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 8H4v4h4v4H4M17 8h-3v4h4v4h-4"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>',
};
let notesEditorMode = 'edit';

function noteActionButton(action, label, icon, className = 'notes-icon-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

function selectedNoteCategory(categories = loadNoteCategories()) {
  const id = String(notesCategoryFilter?.value || '');
  return categories.find((category) => category.id === id) || null;
}

function renderNoteCategoryControls(categories, archive) {
  if (!notesCategoryFilter) return;
  const selected = notesCategoryFilter.value;
  const counts = new Map(categories.map((category) => [category.id, 0]));
  let uncategorized = 0;
  archive.forEach((note) => {
    if (counts.has(note.categoryId)) counts.set(note.categoryId, counts.get(note.categoryId) + 1);
    else uncategorized += 1;
  });
  notesCategoryFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = `全部分类 (${archive.length})`;
  const empty = document.createElement('option');
  empty.value = '__uncategorized__';
  empty.textContent = `未分类 (${uncategorized})`;
  notesCategoryFilter.append(all, empty);
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = `${category.name} (${counts.get(category.id) || 0})`;
    notesCategoryFilter.append(option);
  });
  notesCategoryFilter.value = [...notesCategoryFilter.options].some((option) => option.value === selected) ? selected : '';
  const customSelected = Boolean(selectedNoteCategory(categories));
  if (notesCategoryAdd) notesCategoryAdd.disabled = categories.length >= 40;
  if (notesCategoryRename) notesCategoryRename.disabled = !customSelected;
  if (notesCategoryDelete) notesCategoryDelete.disabled = !customSelected;
}

function selectedNoteTag(category = selectedNoteCategory()) {
  const id = String(notesTagFilter?.value || '');
  return category?.tags.find((tag) => tag.id === id) || null;
}

function renderNoteTagControls(category, archive) {
  if (!notesTagToolbar || !notesTagFilter) return;
  notesTagToolbar.hidden = !category;
  if (!category) {
    notesTagFilter.replaceChildren();
    if (notesTagEditor) notesTagEditor.hidden = true;
    if (notesTagConfirm) notesTagConfirm.hidden = true;
    return;
  }
  const selected = notesTagFilter.value;
  const categoryNotes = archive.filter((note) => note.categoryId === category.id);
  const counts = new Map(category.tags.map((tag) => [tag.id, 0]));
  let untagged = 0;
  categoryNotes.forEach((note) => {
    if (counts.has(note.tagId)) counts.set(note.tagId, counts.get(note.tagId) + 1);
    else untagged += 1;
  });
  notesTagFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = `全部标签 (${categoryNotes.length})`;
  const empty = document.createElement('option');
  empty.value = '__untagged__';
  empty.textContent = `无标签 (${untagged})`;
  notesTagFilter.append(all, empty);
  category.tags.forEach((tag) => {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = `${tag.name} (${counts.get(tag.id) || 0})`;
    notesTagFilter.append(option);
  });
  notesTagFilter.value = [...notesTagFilter.options].some((option) => option.value === selected) ? selected : '';
  const customSelected = Boolean(selectedNoteTag(category));
  if (notesTagAdd) notesTagAdd.disabled = category.tags.length >= 30;
  if (notesTagRename) notesTagRename.disabled = !customSelected;
  if (notesTagDelete) notesTagDelete.disabled = !customSelected;
}

function notesTaxonomyAction(action, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notes-taxonomy-action';
  button.dataset.notesTaxonomyAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

function notesTaxonomySelect(label, count, scope, selected, categoryId = '', tagId = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `notes-taxonomy-select${selected ? ' active' : ''}`;
  button.dataset.notesTaxonomyScope = scope;
  if (categoryId) button.dataset.categoryId = categoryId;
  if (tagId) button.dataset.tagId = tagId;
  button.setAttribute('aria-current', selected ? 'true' : 'false');
  const name = document.createElement('span');
  name.textContent = label;
  const total = document.createElement('small');
  total.textContent = String(count);
  button.append(name, total);
  return button;
}

function renderNotesTaxonomy(categories, archive) {
  if (!notesTaxonomyTree) return;
  if (notesTaxonomyCount) notesTaxonomyCount.textContent = `${categories.length} 个分类`;
  const selectedCategoryId = String(notesCategoryFilter?.value || '');
  const selectedTagId = String(notesTagFilter?.value || '');
  notesTaxonomyTree.replaceChildren();
  notesTaxonomyTree.append(
    notesTaxonomySelect('全部笔记', archive.length, 'all', !selectedCategoryId),
    notesTaxonomySelect('未分类', archive.filter((note) => !note.categoryId).length, 'uncategorized', selectedCategoryId === '__uncategorized__')
  );
  const plusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 16 9.5-9.5 4 4L8 20H4zM12 8l4 4"/></svg>';
  const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  categories.forEach((category) => {
    const group = document.createElement('section');
    group.className = 'notes-taxonomy-group';
    const row = document.createElement('div');
    row.className = 'notes-taxonomy-row';
    const expanded = expandedNoteCategories.has(category.id);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'notes-taxonomy-toggle';
    toggle.dataset.notesTaxonomyToggle = category.id;
    toggle.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}${category.name}`);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>';
    const count = archive.filter((note) => note.categoryId === category.id).length;
    const select = notesTaxonomySelect(category.name, count, 'category', selectedCategoryId === category.id && !selectedTagId, category.id);
    const actions = document.createElement('div');
    actions.className = 'notes-taxonomy-actions';
    const addTag = notesTaxonomyAction('add-tag', `在${category.name}中新建标签`, plusIcon);
    addTag.dataset.categoryId = category.id;
    const rename = notesTaxonomyAction('rename-category', `重命名${category.name}`, editIcon);
    rename.dataset.categoryId = category.id;
    const remove = notesTaxonomyAction('delete-category', `删除${category.name}`, deleteIcon);
    remove.dataset.categoryId = category.id;
    remove.classList.add('danger');
    actions.append(addTag, rename, remove);
    row.append(toggle, select, actions);
    group.append(row);
    if (expanded) {
      const children = document.createElement('div');
      children.className = 'notes-taxonomy-children';
      const untagged = archive.filter((note) => note.categoryId === category.id && !note.tagId).length;
      children.append(notesTaxonomySelect('无标签', untagged, 'untagged', selectedCategoryId === category.id && selectedTagId === '__untagged__', category.id, '__untagged__'));
      category.tags.forEach((tag) => {
        const tagRow = document.createElement('div');
        tagRow.className = 'notes-taxonomy-row tag';
        const tagCount = archive.filter((note) => note.categoryId === category.id && note.tagId === tag.id).length;
        const tagSelect = notesTaxonomySelect(tag.name, tagCount, 'tag', selectedCategoryId === category.id && selectedTagId === tag.id, category.id, tag.id);
        const tagActions = document.createElement('div');
        tagActions.className = 'notes-taxonomy-actions';
        const renameTag = notesTaxonomyAction('rename-tag', `重命名${tag.name}`, editIcon);
        renameTag.dataset.categoryId = category.id;
        renameTag.dataset.tagId = tag.id;
        const removeTag = notesTaxonomyAction('delete-tag', `删除${tag.name}`, deleteIcon);
        removeTag.dataset.categoryId = category.id;
        removeTag.dataset.tagId = tag.id;
        removeTag.classList.add('danger');
        tagActions.append(renameTag, removeTag);
        tagRow.append(tagSelect, tagActions);
        children.append(tagRow);
      });
      group.append(children);
    }
    notesTaxonomyTree.append(group);
  });
}

function closeNoteTagControls() {
  noteTagEditorMode = '';
  if (notesTagEditor) notesTagEditor.hidden = true;
  if (notesTagConfirm) notesTagConfirm.hidden = true;
  if (notesTagName) {
    notesTagName.value = '';
    notesTagName.removeAttribute('aria-invalid');
  }
}

function closeNoteCategoryControls() {
  noteCategoryEditorMode = '';
  if (notesCategoryEditor) notesCategoryEditor.hidden = true;
  if (notesCategoryConfirm) notesCategoryConfirm.hidden = true;
  if (notesCategoryName) {
    notesCategoryName.value = '';
    notesCategoryName.removeAttribute('aria-invalid');
  }
}

function openNoteTagEditor(mode) {
  closeNoteCategoryControls();
  const category = selectedNoteCategory();
  const tag = selectedNoteTag(category);
  if (!category || (mode === 'rename' && !tag)) return;
  noteTagEditorMode = mode;
  if (notesTagConfirm) notesTagConfirm.hidden = true;
  if (notesTagEditor) notesTagEditor.hidden = false;
  if (notesTagName) {
    notesTagName.value = mode === 'rename' ? tag.name : '';
    notesTagName.removeAttribute('aria-invalid');
    requestAnimationFrame(() => {
      notesTagName.focus({ preventScroll: true });
      notesTagName.select();
    });
  }
}

function openNoteCategoryEditor(mode) {
  closeNoteTagControls();
  const category = selectedNoteCategory();
  if (mode === 'rename' && !category) return;
  noteCategoryEditorMode = mode;
  if (notesCategoryConfirm) notesCategoryConfirm.hidden = true;
  if (notesCategoryEditor) notesCategoryEditor.hidden = false;
  if (notesCategoryName) {
    notesCategoryName.value = mode === 'rename' ? category.name : '';
    notesCategoryName.removeAttribute('aria-invalid');
    requestAnimationFrame(() => {
      notesCategoryName.focus({ preventScroll: true });
      notesCategoryName.select();
    });
  }
}

function renderNotesDetail(notes = loadNoteArchive()) {
  if (!notesDetail) return;
  notesDetail.replaceChildren();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) {
    const empty = document.createElement('div');
    empty.className = 'notes-detail-empty';
    const hasArchive = loadNoteArchive().length > 0;
    empty.innerHTML = hasArchive
      ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的笔记</strong><p>试试搜索其他关键词。</p>'
      : '<span class="notes-empty-mark" aria-hidden="true">✎</span><strong>还没有笔记</strong><button class="notes-empty-create" type="button" data-action="create-note">新建笔记</button>';
    notesDetail.append(empty);
    return;
  }

  const header = document.createElement('header');
  header.className = 'notes-detail-head';
  const heading = document.createElement('div');
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'notes-detail-title';
  title.dataset.noteId = note.id;
  title.value = String(note.title || '');
  title.placeholder = '未命名笔记';
  title.maxLength = 80;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.setAttribute('aria-label', '笔记标题');
  const meta = document.createElement('div');
  meta.className = 'notes-detail-meta';
  const category = document.createElement('select');
  category.className = 'notes-detail-category';
  category.dataset.noteId = note.id;
  category.setAttribute('aria-label', '笔记分类');
  const uncategorized = document.createElement('option');
  uncategorized.value = '';
  uncategorized.textContent = '未分类';
  category.append(uncategorized);
  const noteCategories = loadNoteCategories();
  noteCategories.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    category.append(option);
  });
  category.value = note.categoryId || '';
  const tag = document.createElement('select');
  tag.className = 'notes-detail-tag';
  tag.dataset.noteId = note.id;
  tag.setAttribute('aria-label', '笔记标签');
  const untagged = document.createElement('option');
  untagged.value = '';
  untagged.textContent = note.categoryId ? '无标签' : '先选择分类';
  tag.append(untagged);
  const noteCategory = noteCategories.find((item) => item.id === note.categoryId);
  noteCategory?.tags.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    tag.append(option);
  });
  tag.value = note.tagId || '';
  tag.disabled = !noteCategory;
  const time = document.createElement('time');
  time.className = 'notes-detail-time';
  time.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  meta.append(category, tag, time);
  heading.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'notes-detail-actions';
  const modes = document.createElement('div');
  modes.className = 'notes-mode-control';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', '笔记显示模式');
  for (const [mode, label] of [['edit', '编辑'], ['preview', '预览']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = `note-mode-${mode}`;
    button.textContent = label;
    button.classList.toggle('active', notesEditorMode === mode);
    button.setAttribute('aria-pressed', String(notesEditorMode === mode));
    modes.append(button);
  }
  const nameWithAI = noteActionButton(
    'name-note-ai',
    '生成标题',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
    'notes-icon-button ai-note-organize'
  );
  const organize = noteActionButton(
    'organize-note',
    '整理笔记',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
    'notes-icon-button ai-note-organize'
  );
  nameWithAI.disabled = !String(note.content || '').trim();
  organize.disabled = !String(note.content || '').trim();
  const attach = noteActionButton(
    'attach-note-image',
    '添加图片',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="3"/></svg>'
  );
  const remove = noteActionButton(
    'delete-note',
    '删除笔记',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>',
    'notes-icon-button danger'
  );
  actions.append(modes, nameWithAI, organize, attach, remove);
  header.append(heading, actions);

  const toolbar = document.createElement('div');
  toolbar.className = 'notes-format-toolbar';
  toolbar.hidden = notesEditorMode !== 'edit';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '笔记格式');
  const labels = {
    heading: '标题', bold: '加粗', italic: '斜体', bullet: '项目列表',
    task: '待办列表', quote: '引用', code: '行内代码', link: '链接',
  };
  for (const type of Object.keys(labels)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.notesFormat = type;
    button.setAttribute('aria-label', labels[type]);
    button.title = labels[type];
    button.innerHTML = NOTES_TOOL_ICONS[type];
    toolbar.append(button);
  }

  const content = document.createElement('div');
  content.className = 'notes-content';
  const editor = document.createElement('textarea');
  editor.id = 'notes-editor';
  editor.className = 'notes-editor';
  editor.dataset.noteId = note.id;
  editor.value = note.content;
  editor.placeholder = '开始写作…';
  editor.setAttribute('aria-label', `编辑笔记：${noteArchiveTitle(note)}`);
  editor.spellcheck = true;
  editor.hidden = notesEditorMode !== 'edit';
  const preview = document.createElement('article');
  preview.id = 'notes-preview';
  preview.className = 'note-preview notes-preview';
  preview.tabIndex = 0;
  preview.hidden = notesEditorMode !== 'preview';
  if (notesEditorMode === 'preview') preview.replaceChildren(buildMarkdownPreview(note.content));
  content.append(editor, preview);
  notesDetail.append(header, toolbar, content);
  requestNoteTitle(note);
}

let notesSaveTimer = null;
let pendingNotesEditor = null;
const noteTitleAttempts = new Set();

async function requestNoteTitle(note) {
  if (
    !note
    || note.title
    || note.titleSource === 'user'
    || !String(note.content || '').trim()
    || noteTitleAttempts.has(note.id)
    || window.NotchAISettings?.autoNameNotes !== true
    || !window.notchAPI?.organizeMaterial
  ) return;
  noteTitleAttempts.add(note.id);
  const expectedContent = note.content;
  const result = await window.notchAPI.organizeMaterial({ kind: 'note', sourceId: note.id, text: expectedContent }).catch(() => null);
  if (!result?.ok || !result.title) {
    noteTitleAttempts.delete(note.id);
    return;
  }
  const next = window.NotchDomain.applyGeneratedNoteTitle(
    loadNoteArchive(),
    note.id,
    result.title,
    expectedContent
  );
  const updated = next.find((item) => item.id === note.id);
  if (!updated?.title || updated.titleSource !== 'model') {
    noteTitleAttempts.delete(note.id);
    return;
  }
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next.slice(0, 200)));
  updateSavedNotePresentation(updated);
  await syncWorkspaceSnapshot();
}

function updateSavedNotePresentation(note) {
  if (!note) return;
  const title = noteArchiveTitle(note);
  const detailTitle = notesDetail?.querySelector('.notes-detail-title');
  const detailTime = notesDetail?.querySelector('.notes-detail-time');
  if (detailTitle && document.activeElement !== detailTitle) detailTitle.value = note.title || '';
  if (detailTime) detailTime.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  const row = notesList?.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!row) return;
  const rowTitle = row.querySelector('strong');
  const rowExcerpt = row.querySelector('span');
  const rowTime = row.querySelector('time');
  if (rowTitle) rowTitle.textContent = title;
  if (rowExcerpt) rowExcerpt.textContent = noteArchiveExcerpt(note);
  if (rowTime) rowTime.textContent = noteArchiveTime(note.updatedAt);
}

function persistNotesEditor(editor) {
  if (!editor || !editor.dataset.noteId) return;
  const notes = window.NotchDomain.updateNoteInArchive(
    loadNoteArchive(),
    editor.dataset.noteId,
    editor.value,
    Date.now()
  );
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  const updated = notes.find((note) => note.id === editor.dataset.noteId);
  if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === editor.dataset.noteId && noteInput) {
    noteInput.value = editor.value;
    localStorage.setItem(NOTE_KEY, editor.value);
    renderNotePreview();
  }
  updateSavedNotePresentation(updated);
  void requestNoteTitle(updated);
  if (pendingNotesEditor === editor) pendingNotesEditor = null;
}

function flushNotesEditorSave() {
  if (workspaceReloadPending) return;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  const editor = pendingNotesEditor;
  pendingNotesEditor = null;
  if (editor) persistNotesEditor(editor);
}

function scheduleNotesEditorSave(editor) {
  pendingNotesEditor = editor;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在保存…';
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    const pending = pendingNotesEditor;
    pendingNotesEditor = null;
    if (pending) persistNotesEditor(pending);
  }, 220);
}

function renderNotesLibrary() {
  if (!notesList) return;
  const categories = loadNoteCategories();
  const archive = loadNoteArchive();
  renderNoteCategoryControls(categories, archive);
  const selectedCategory = selectedNoteCategory(categories);
  renderNoteTagControls(selectedCategory, archive);
  renderNotesTaxonomy(categories, archive);
  const categoryId = notesCategoryFilter?.value || '';
  const tagId = selectedCategory ? notesTagFilter?.value || '' : '';
  const searchQuery = notesSearch?.value || '';
  const scopedNotes = window.NotchDomain.filterNotes(archive, '', categoryId, tagId);
  const notes = window.NotchDomain.filterNotes(scopedNotes, searchQuery);
  if (notesCount) {
    notesCount.textContent = searchQuery.trim() && notes.length !== scopedNotes.length
      ? `${notes.length} / ${scopedNotes.length} 篇`
      : `${scopedNotes.length} 篇`;
  }
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0]?.id || '';
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    empty.textContent = !archive.length
      ? '保存的笔记会出现在这里'
      : scopedNotes.length
        ? '没有匹配的笔记'
        : '当前范围还没有笔记';
    notesList.append(empty);
    renderNotesDetail(notes);
    return;
  }
  notes.forEach((note) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notes-list-item${note.id === selectedNoteId ? ' active' : ''}`;
    button.dataset.noteId = note.id;
    button.dataset.lineSidebarItem = '';
    button.setAttribute('aria-pressed', String(note.id === selectedNoteId));
    const title = document.createElement('strong');
    title.textContent = noteArchiveTitle(note);
    const time = document.createElement('time');
    time.textContent = noteArchiveTime(note.updatedAt);
    const excerpt = document.createElement('span');
    excerpt.textContent = noteArchiveExcerpt(note);
    const category = document.createElement('small');
    category.className = 'notes-list-category';
    const tag = noteTagName(note, categories);
    category.textContent = tag ? `${noteCategoryName(note, categories)} · ${tag}` : noteCategoryName(note, categories);
    button.append(title, time, excerpt, category);
    notesList.append(button);
  });
  renderNotesDetail(notes);
}

function createNote() {
  flushNotesEditorSave();
  const now = Date.now();
  const selectedCategoryId = selectedNoteCategory()?.id || '';
  const selectedTagId = selectedCategoryId ? selectedNoteTag()?.id || '' : '';
  const note = {
    id: generateId(),
    title: '',
    titleSource: '',
    categoryId: selectedCategoryId,
    tagId: selectedTagId,
    content: '',
    createdAt: now,
    updatedAt: now,
  };
  const notes = [note, ...loadNoteArchive()].slice(0, 200);
  try {
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
  } catch (error) {
    showStatusToast('无法创建笔记，请检查存储空间');
    return null;
  }
  selectedNoteId = note.id;
  notesEditorMode = 'edit';
  if (notesSearch) notesSearch.value = '';
  if (notesCategoryFilter && selectedCategoryId) notesCategoryFilter.value = selectedCategoryId;
  renderNotesLibrary();
  requestAnimationFrame(() => notesDetail?.querySelector('.notes-detail-title')?.focus({ preventScroll: true }));
  return note;
}

function replaceNotesEditorText(editor, start, end, replacement, selectionStart, selectionEnd) {
  editor.setRangeText(replacement, start, end, 'end');
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(selectionStart, selectionEnd);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyNotesEditorFormat(editor, type) {
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const inline = {
    bold: ['**', '**', '加粗文字'],
    italic: ['*', '*', '斜体文字'],
    code: ['`', '`', '代码'],
  }[type];
  if (inline) {
    const content = selected || inline[2];
    const replacement = inline[0] + content + inline[1];
    replaceNotesEditorText(
      editor, start, end, replacement,
      start + inline[0].length,
      start + inline[0].length + content.length
    );
    return;
  }
  if (type === 'link') {
    const label = selected || '链接文字';
    const replacement = `[${label}](https://)`;
    const urlStart = start + label.length + 3;
    replaceNotesEditorText(editor, start, end, replacement, urlStart, urlStart + 8);
    return;
  }
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const prefixes = { heading: '# ', bullet: '- ', task: '- [ ] ', quote: '> ' };
  const prefix = prefixes[type];
  if (!prefix) return;
  const matcher = type === 'heading' ? /^#{1,6}\s+/ :
    type === 'task' ? /^[-*+]\s+\[[ xX]\]\s+/ :
      type === 'quote' ? /^>\s?/ : /^[-*+]\s+/;
  const remove = lines.filter((line) => line.trim()).every((line) => matcher.test(line.trimStart()));
  const replacement = lines.map((line) => {
    if (!line.trim()) return remove ? '' : prefix;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    return indentation + (remove ? body.replace(matcher, '') : prefix + stripNoteBlockPrefix(body));
  }).join('\n');
  replaceNotesEditorText(editor, lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length);
}

function continueNotesEditorList(editor, event) {
  if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey
    || event.isComposing || editor.selectionStart !== editor.selectionEnd) return false;
  const cursor = editor.selectionStart;
  const lineStart = editor.value.lastIndexOf('\n', cursor - 1) + 1;
  const line = editor.value.slice(lineStart, cursor);
  const match = line.match(/^(\s*)([-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)(.*)$/);
  if (!match) return false;
  event.preventDefault();
  if (!match[3].trim()) {
    replaceNotesEditorText(editor, lineStart, cursor, match[1], lineStart + match[1].length, lineStart + match[1].length);
    return true;
  }
  let prefix = match[2];
  const ordered = prefix.match(/^(\d+)[.)]\s+$/);
  if (ordered) prefix = `${Number(ordered[1]) + 1}. `;
  if (/^[-*+]\s+\[[ xX]\]\s+$/i.test(prefix)) prefix = '- [ ] ';
  const insertion = `\n${match[1]}${prefix}`;
  replaceNotesEditorText(editor, cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

function markdownImageAlt(name) {
  return String(name || '图片').replace(/[\[\]\\]/g, '').trim().slice(0, 80) || '图片';
}

function insertNoteImageReferences(editor, images) {
  const rows = (Array.isArray(images) ? images : []).filter((image) => safeNoteImageReference(image && image.imagePath));
  if (!editor || !rows.length) return false;
  const markdown = rows.map((image) => `![${markdownImageAlt(image.name)}](${image.imagePath})`).join('\n\n');
  const before = editor.value.slice(0, editor.selectionStart);
  const after = editor.value.slice(editor.selectionEnd);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
  const replacement = prefix + markdown + suffix;
  const start = editor.selectionStart;
  replaceNotesEditorText(editor, start, editor.selectionEnd, replacement, start + replacement.length, start + replacement.length);
  flushNotesEditorSave();
  return true;
}

async function saveNoteImageFiles(editor, files) {
  const noteId = editor?.dataset.noteId;
  const imageFiles = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/')).slice(0, 12);
  if (!noteId || !imageFiles.length || !window.notchAPI?.saveNoteImage) return false;
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在添加图片…';
  const saved = [];
  for (const file of imageFiles) {
    try {
      const result = await window.notchAPI.saveNoteImage({
        noteId,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (result?.ok) saved.push({ ...result, name: file.name || '粘贴的图片' });
    } catch (error) {}
  }
  if (!insertNoteImageReferences(editor, saved)) {
    if (time) time.textContent = '图片添加失败';
    return false;
  }
  showStatusToast(saved.length === 1 ? '图片已添加' : `已添加 ${saved.length} 张图片`);
  return true;
}

function setNotesEditorMode(mode) {
  const next = mode === 'preview' ? 'preview' : 'edit';
  if (next === notesEditorMode) return;
  flushNotesEditorSave();
  notesEditorMode = next;
  renderNotesDetail(loadNoteArchive());
  requestAnimationFrame(() => notesDetail?.querySelector(next === 'preview' ? '#notes-preview' : '#notes-editor')?.focus({ preventScroll: true }));
}

notesNewButton?.addEventListener('click', createNote);
document.addEventListener('keydown', (event) => {
  if (activeTab !== 'notes' || event.altKey || event.shiftKey || event.isComposing
    || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'n') return;
  event.preventDefault();
  createNote();
});

window.NotchNotes = {
  create: createNote,
  context(noteId = selectedNoteId, includeSelection = true) {
    const editor = notesDetail?.querySelector('#notes-editor');
    const selection = includeSelection && editor && editor.dataset.noteId === noteId && editor.selectionEnd > editor.selectionStart
      ? { start: editor.selectionStart, end: editor.selectionEnd, text: editor.value.slice(editor.selectionStart, editor.selectionEnd) }
      : null;
    flushNotesEditorSave();
    const note = loadNoteArchive().find((item) => item.id === noteId);
    return note ? { sourceType: 'note', sourceId: note.id, sourceTitle: noteArchiveTitle(note), text: selection?.text || note.content, selection, createdAt: note.createdAt } : null;
  },
  async applyAIName(noteId, expectedText, expectedTitle, nextTitle) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === noteId);
    const title = String(nextTitle || '').trim().slice(0, 80);
    if (!note || note.content.trim() !== String(expectedText || '').trim() || noteArchiveTitle(note) !== expectedTitle) return { ok: false, error: 'source_changed' };
    if (!title) return { ok: false, error: 'missing_title' };
    const updated = window.NotchDomain.updateNoteTitle(notes, noteId, title, Date.now());
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(updated)); } catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot(), undo: { noteId, before: note.title, after: title, expectedText: note.content.trim() } };
  },
  async undoAIName(token) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === token?.noteId);
    if (!note || noteArchiveTitle(note) !== token.after || note.content.trim() !== token.expectedText) return { ok: false, error: 'conflict' };
    const updated = window.NotchDomain.updateNoteTitle(notes, note.id, token.before, Date.now());
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(updated)); } catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async replaceAISelection(noteId, selection, expected, replacement) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === noteId);
    const start = Number(selection && selection.start), end = Number(selection && selection.end);
    if (!note || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
      || note.content.slice(start, end) !== String(expected || '')) return { ok: false, error: 'source_changed' };
    const nextContent = note.content.slice(0, start) + String(replacement || '') + note.content.slice(end);
    const next = window.NotchDomain.updateNoteInArchive(notes, noteId, nextContent, Date.now());
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next)); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, workspaceSynced, undo: { noteId, start, before: expected, after: String(replacement || ''), contentAfter: nextContent } };
  },
  async undoAISelection(token) {
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === token?.noteId);
    if (!note || note.content !== token.contentAfter || note.content.slice(token.start, token.start + token.after.length) !== token.after) return { ok: false, error: 'conflict' };
    const content = note.content.slice(0, token.start) + token.before + note.content.slice(token.start + token.after.length);
    const next = window.NotchDomain.updateNoteInArchive(notes, token.noteId, content, Date.now());
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next)); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async undoGenerated(snapshot) {
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === snapshot?.id);
    if (!note || note.title !== snapshot.title || note.content !== snapshot.content || note.categoryId !== snapshot.categoryId || note.tagId !== snapshot.tagId || note.createdAt !== snapshot.createdAt) return { ok: false, error: 'conflict' };
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.filter((item) => item.id !== note.id))); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    if (selectedNoteId === note.id) selectedNoteId = null;
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async saveCaptured(content) {
    const result = await window.NotchNotes.saveGenerated('', content, '');
    if (result.ok && result.note) void requestNoteTitle(result.note);
    return result;
  },
  async saveGenerated(title, content, titleSource = 'model') {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    if (notes.length >= 200) return { ok: false, error: 'capacity' };
    const now = Date.now();
    const note = { id: generateId(), title: String(title || '').slice(0, 80), titleSource, categoryId: '', tagId: '', content: String(content || ''), createdAt: now, updatedAt: now };
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify([note, ...notes])); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, noteId: note.id, note: { ...note }, workspaceSynced };
  },
  select: (noteId) => {
    if (!loadNoteArchive().some((note) => note.id === noteId)) return false;
    selectedNoteId = noteId;
    if (notesSearch) notesSearch.value = '';
    if (notesCategoryFilter) notesCategoryFilter.value = '';
    if (notesTagFilter) notesTagFilter.value = '';
    renderNotesLibrary();
    return true;
  },
  list: () => loadNoteArchive().map((note) => ({ ...note })),
  chatContexts: () => {
    flushNotesEditorSave();
    const categories = loadNoteCategories();
    return loadNoteArchive().filter((note) => note.content.trim()).map((note) => {
      const category = categories.find((item) => item.id === note.categoryId);
      const tag = category?.tags?.find((item) => item.id === note.tagId);
      return {
        sourceType: 'note',
        sourceId: note.id,
        sourceTitle: noteArchiveTitle(note),
        sourceRevision: String(note.updatedAt || note.createdAt || ''),
        text: note.content,
        detail: [category?.name || '未分类', tag?.name].filter(Boolean).join(' · '),
        updatedAt: note.updatedAt || note.createdAt || 0,
      };
    });
  },
};

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast('先写点内容再存档');
    return;
  }
  const notes = loadNoteArchive();
  let activeId = localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) || '';
  const existing = notes.find((item) => item.id === activeId);
  if (existing) {
    existing.content = content;
    existing.updatedAt = Date.now();
  } else {
    activeId = generateId();
    notes.unshift({ id: activeId, categoryId: '', tagId: '', content, createdAt: Date.now(), updatedAt: Date.now() });
  }
  localStorage.setItem(NOTE_ACTIVE_ARCHIVE_KEY, activeId);
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  localStorage.setItem(NOTE_KEY, noteInput.value);
  selectedNoteId = activeId;
  renderNotesLibrary();
  showStatusToast('笔记已保存');
});

notesList?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-note-id]');
  if (!row) return;
  flushNotesEditorSave();
  selectedNoteId = row.dataset.noteId;
  renderNotesLibrary();
});

notesSearch?.addEventListener('input', () => {
  flushNotesEditorSave();
  renderNotesLibrary();
});

function selectNotesTaxonomy(categoryId, tagId = '') {
  flushNotesEditorSave();
  closeNoteCategoryControls();
  closeNoteTagControls();
  if (notesCategoryFilter) notesCategoryFilter.value = categoryId;
  if (notesTagFilter) notesTagFilter.value = '';
  if (categoryId && categoryId !== '__uncategorized__') expandedNoteCategories.add(categoryId);
  renderNotesLibrary();
  if (notesTagFilter && tagId) {
    notesTagFilter.value = tagId;
    renderNotesLibrary();
  }
}

notesTaxonomyTree?.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-notes-taxonomy-toggle]');
  if (toggle) {
    const categoryId = toggle.dataset.notesTaxonomyToggle;
    if (expandedNoteCategories.has(categoryId)) expandedNoteCategories.delete(categoryId);
    else expandedNoteCategories.add(categoryId);
    renderNotesTaxonomy(loadNoteCategories(), loadNoteArchive());
    return;
  }
  const action = event.target.closest('[data-notes-taxonomy-action]');
  if (action) {
    const categoryId = action.dataset.categoryId || '';
    const tagId = action.dataset.tagId || '';
    selectNotesTaxonomy(categoryId, tagId);
    if (action.dataset.notesTaxonomyAction === 'add-tag') notesTagAdd?.click();
    if (action.dataset.notesTaxonomyAction === 'rename-category') notesCategoryRename?.click();
    if (action.dataset.notesTaxonomyAction === 'delete-category') notesCategoryDelete?.click();
    if (action.dataset.notesTaxonomyAction === 'rename-tag') notesTagRename?.click();
    if (action.dataset.notesTaxonomyAction === 'delete-tag') notesTagDelete?.click();
    return;
  }
  const item = event.target.closest('[data-notes-taxonomy-scope]');
  if (!item) return;
  const scope = item.dataset.notesTaxonomyScope;
  if (scope === 'all') selectNotesTaxonomy('');
  else if (scope === 'uncategorized') selectNotesTaxonomy('__uncategorized__');
  else selectNotesTaxonomy(item.dataset.categoryId || '', scope === 'category' ? '' : item.dataset.tagId || '');
});

notesTaxonomyTree?.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const items = [...notesTaxonomyTree.querySelectorAll('.notes-taxonomy-select')];
  const index = items.indexOf(document.activeElement);
  if (index < 0 || !items.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});

notesCategoryFilter?.addEventListener('change', () => {
  flushNotesEditorSave();
  closeNoteCategoryControls();
  closeNoteTagControls();
  if (notesTagFilter) notesTagFilter.value = '';
  const category = selectedNoteCategory();
  if (category) expandedNoteCategories.add(category.id);
  renderNotesLibrary();
});

notesCategoryAdd?.addEventListener('click', () => openNoteCategoryEditor('create'));
notesCategoryRename?.addEventListener('click', () => openNoteCategoryEditor('rename'));
notesCategoryCancel?.addEventListener('click', closeNoteCategoryControls);
notesCategoryDeleteCancel?.addEventListener('click', closeNoteCategoryControls);
notesCategoryDelete?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  if (!category || !notesCategoryConfirm) return;
  noteCategoryEditorMode = '';
  if (notesCategoryEditor) notesCategoryEditor.hidden = true;
  notesCategoryConfirm.hidden = false;
  if (notesCategoryConfirmText) notesCategoryConfirmText.textContent = `删除“${category.name}”？其中笔记将移至未分类。`;
  notesCategoryDeleteCancel?.focus({ preventScroll: true });
});

function saveNoteCategoryEdit() {
  if (!noteCategoryEditorMode || !notesCategoryName) return;
  const editingMode = noteCategoryEditorMode;
  const name = window.NotchDomain.normalizeNoteCategoryName(notesCategoryName.value);
  const categories = loadNoteCategories();
  const current = selectedNoteCategory(categories);
  const duplicate = categories.some((category) => category.id !== current?.id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!name || duplicate || (noteCategoryEditorMode === 'create' && categories.length >= 40)) {
    notesCategoryName.setAttribute('aria-invalid', 'true');
    showStatusToast(!name ? '请输入分类名称' : duplicate ? '已有同名分类' : '最多创建 40 个分类');
    return;
  }
  const categoryId = editingMode === 'rename' && current ? current.id : `note-category-${generateId()}`;
  const next = editingMode === 'rename'
    ? categories.map((category) => category.id === categoryId ? { ...category, name } : category)
    : [...categories, { id: categoryId, name, tags: [] }];
  try {
    saveNoteCategories(next);
  } catch (error) {
    showStatusToast('分类保存失败，请检查存储空间');
    return;
  }
  closeNoteCategoryControls();
  renderNotesLibrary();
  showStatusToast(editingMode === 'rename' ? '分类已重命名' : '分类已创建');
  void syncWorkspaceSnapshot();
}

notesCategorySave?.addEventListener('click', saveNoteCategoryEdit);
notesCategoryName?.addEventListener('input', () => notesCategoryName.removeAttribute('aria-invalid'));
notesCategoryName?.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); saveNoteCategoryEdit(); }
  if (event.key === 'Escape') { event.preventDefault(); closeNoteCategoryControls(); notesCategoryFilter?.focus(); }
});
notesCategoryDeleteConfirm?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  if (!category) return;
  flushNotesEditorSave();
  const result = window.NotchDomain.removeNoteCategory(loadNoteCategories(), loadNoteArchive(), category.id, Date.now());
  try {
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(result.notes.slice(0, 200)));
    saveNoteCategories(result.categories);
  } catch (error) {
    showStatusToast('分类删除失败，请检查存储空间');
    return;
  }
  closeNoteCategoryControls();
  closeNoteTagControls();
  if (notesCategoryFilter) notesCategoryFilter.value = '__uncategorized__';
  renderNotesLibrary();
  showStatusToast('分类已删除，笔记已移至未分类');
  void syncWorkspaceSnapshot();
});

notesTagFilter?.addEventListener('change', () => {
  flushNotesEditorSave();
  closeNoteTagControls();
  renderNotesLibrary();
});
notesTagAdd?.addEventListener('click', () => openNoteTagEditor('create'));
notesTagRename?.addEventListener('click', () => openNoteTagEditor('rename'));
notesTagCancel?.addEventListener('click', closeNoteTagControls);
notesTagDeleteCancel?.addEventListener('click', closeNoteTagControls);
notesTagDelete?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  const tag = selectedNoteTag(category);
  if (!category || !tag || !notesTagConfirm) return;
  noteTagEditorMode = '';
  if (notesTagEditor) notesTagEditor.hidden = true;
  notesTagConfirm.hidden = false;
  if (notesTagConfirmText) notesTagConfirmText.textContent = `删除“${tag.name}”？笔记将保留在“${category.name}”。`;
  notesTagDeleteCancel?.focus({ preventScroll: true });
});

function saveNoteTagEdit() {
  if (!noteTagEditorMode || !notesTagName) return;
  const editingMode = noteTagEditorMode;
  const name = window.NotchDomain.normalizeNoteCategoryName(notesTagName.value);
  const categories = loadNoteCategories();
  const category = selectedNoteCategory(categories);
  const current = selectedNoteTag(category);
  if (!category) return;
  const duplicate = category.tags.some((tag) => tag.id !== current?.id && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!name || duplicate || (editingMode === 'create' && category.tags.length >= 30)) {
    notesTagName.setAttribute('aria-invalid', 'true');
    showStatusToast(!name ? '请输入标签名称' : duplicate ? '当前分类已有同名标签' : '每个分类最多创建 30 个标签');
    return;
  }
  const tagId = editingMode === 'rename' && current ? current.id : `note-tag-${generateId()}`;
  const tags = editingMode === 'rename'
    ? category.tags.map((tag) => tag.id === tagId ? { ...tag, name } : tag)
    : [...category.tags, { id: tagId, name }];
  try {
    saveNoteCategories(categories.map((item) => item.id === category.id ? { ...item, tags } : item));
  } catch (error) {
    showStatusToast('标签保存失败，请检查存储空间');
    return;
  }
  closeNoteTagControls();
  renderNotesLibrary();
  showStatusToast(editingMode === 'rename' ? '标签已重命名' : '标签已创建');
  void syncWorkspaceSnapshot();
}

notesTagSave?.addEventListener('click', saveNoteTagEdit);
notesTagName?.addEventListener('input', () => notesTagName.removeAttribute('aria-invalid'));
notesTagName?.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); saveNoteTagEdit(); }
  if (event.key === 'Escape') { event.preventDefault(); closeNoteTagControls(); notesTagFilter?.focus(); }
});
notesTagDeleteConfirm?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  const tag = selectedNoteTag(category);
  if (!category || !tag) return;
  flushNotesEditorSave();
  const result = window.NotchDomain.removeNoteTag(loadNoteCategories(), loadNoteArchive(), category.id, tag.id, Date.now());
  try {
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(result.notes.slice(0, 200)));
    saveNoteCategories(result.categories);
  } catch (error) {
    showStatusToast('标签删除失败，请检查存储空间');
    return;
  }
  closeNoteTagControls();
  if (notesTagFilter) notesTagFilter.value = '__untagged__';
  renderNotesLibrary();
  showStatusToast('标签已删除，笔记已移至无标签');
  void syncWorkspaceSnapshot();
});

notesDetail?.addEventListener('change', (event) => {
  const category = event.target.closest('.notes-detail-category');
  const tag = event.target.closest('.notes-detail-tag');
  if (!category?.dataset.noteId && !tag?.dataset.noteId) return;
  flushNotesEditorSave();
  const categories = loadNoteCategories();
  const notes = loadNoteArchive();
  let updated;
  if (category) {
    const categoryId = categories.some((item) => item.id === category.value) ? category.value : '';
    updated = window.NotchDomain.updateNoteCategory(notes, category.dataset.noteId, categoryId, Date.now());
  } else {
    const note = notes.find((item) => item.id === tag.dataset.noteId);
    const parent = categories.find((item) => item.id === note?.categoryId);
    const tagId = parent?.tags.some((item) => item.id === tag.value) ? tag.value : '';
    updated = window.NotchDomain.updateNoteTag(notes, tag.dataset.noteId, tagId, Date.now());
  }
  try {
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(updated.slice(0, 200)));
  } catch (error) {
    showStatusToast(category ? '笔记分类保存失败' : '笔记标签保存失败');
    renderNotesLibrary();
    return;
  }
  selectedNoteId = (category || tag).dataset.noteId;
  renderNotesLibrary();
  void syncWorkspaceSnapshot();
});

notesDetail?.addEventListener('input', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const notes = window.NotchDomain.updateNoteTitle(
      loadNoteArchive(),
      title.dataset.noteId,
      title.value,
      Date.now()
    );
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
    updateSavedNotePresentation(notes.find((note) => note.id === title.dataset.noteId));
    return;
  }
  const editor = event.target.closest('#notes-editor');
  if (editor) {
    notesDetail.querySelectorAll('[data-action="organize-note"], [data-action="name-note-ai"]').forEach((button) => button.toggleAttribute('disabled', !editor.value.trim()));
    scheduleNotesEditorSave(editor);
  }
});

notesDetail?.addEventListener('focusout', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const note = loadNoteArchive().find((item) => item.id === title.dataset.noteId);
    if (note) title.value = note.title;
  }
  if (event.target.closest('#notes-editor')) flushNotesEditorSave();
});

notesDetail?.addEventListener('mousedown', (event) => {
  if (event.target.closest('[data-notes-format]')) event.preventDefault();
});

notesDetail?.addEventListener('click', async (event) => {
  const format = event.target.closest('[data-notes-format]')?.dataset.notesFormat;
  if (format) {
    applyNotesEditorFormat(notesDetail.querySelector('#notes-editor'), format);
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'create-note') {
    createNote();
    return;
  }
  if (action === 'note-mode-edit' || action === 'note-mode-preview') {
    setNotesEditorMode(action.endsWith('preview') ? 'preview' : 'edit');
    return;
  }
  flushNotesEditorSave();
  const notes = loadNoteArchive();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) return;
  if (action === 'organize-note') {
    window.NotchAI?.openNote?.('summarize');
    return;
  }
  if (action === 'name-note-ai') {
    window.NotchAI?.openNote?.('nameNote');
    return;
  }
  if (action === 'attach-note-image') {
    const editor = notesDetail.querySelector('#notes-editor');
    if (notesEditorMode !== 'edit') {
      notesEditorMode = 'edit';
      renderNotesDetail(notes);
    }
    const activeEditor = notesDetail.querySelector('#notes-editor') || editor;
    const time = notesDetail.querySelector('.notes-detail-time');
    if (time) time.textContent = '正在选择图片…';
    const result = await window.notchAPI?.chooseNoteImages?.(note.id).catch(() => null);
    if (result?.images?.length) insertNoteImageReferences(activeEditor, result.images);
    else if (time) time.textContent = result?.canceled ? `已保存 · ${noteArchiveTime(note.updatedAt)}` : '图片添加失败';
    return;
  }
  if (action === 'delete-note') {
    const next = notes.filter((item) => item.id !== note.id);
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next));
    if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === note.id) {
      localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    }
    void window.notchAPI?.deleteNoteImages?.(note.id).catch(() => false);
    selectedNoteId = next[0]?.id || '';
    notesEditorMode = 'edit';
    renderNotesLibrary();
    showStatusToast('笔记已删除');
  }
});

notesDetail?.addEventListener('keydown', (event) => {
  const editor = event.target.closest('#notes-editor');
  if (!editor) return;
  if (applyNoteTabIndentation(editor, event)) return;
  if (continueNotesEditorList(editor, event)) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (key !== 'b' && key !== 'i') return;
  event.preventDefault();
  applyNotesEditorFormat(editor, key === 'b' ? 'bold' : 'italic');
});

notesDetail?.addEventListener('paste', (event) => {
  const editor = event.target.closest('#notes-editor');
  if (!editor) return;
  const images = Array.from(event.clipboardData?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  void saveNoteImageFiles(editor, images);
});

notesDetail?.addEventListener('dragover', (event) => {
  const editor = event.target.closest('#notes-editor')
    || (event.target.closest('.notes-content') && notesDetail.querySelector('#notes-editor'));
  if (!editor || !Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  notesDetail.classList.add('is-image-dragging');
});

notesDetail?.addEventListener('dragleave', (event) => {
  if (!notesDetail.contains(event.relatedTarget)) notesDetail.classList.remove('is-image-dragging');
});

notesDetail?.addEventListener('drop', (event) => {
  notesDetail.classList.remove('is-image-dragging');
  const editor = event.target.closest('#notes-editor')
    || (event.target.closest('.notes-content') && notesDetail.querySelector('#notes-editor'));
  if (!editor) return;
  const images = Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  void saveNoteImageFiles(editor, images);
});

notesDetail?.addEventListener('click', (event) => {
  const link = event.target.closest('#notes-preview [data-note-href]');
  if (!link) return;
  event.preventDefault();
  const href = safeMarkdownUrl(link.dataset.noteHref);
  if (href) window.notchAPI?.openExternal?.(href).catch(() => {});
});

document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab !== 'notes') flushNotesEditorSave();
});
window.addEventListener('beforeunload', flushNotesEditorSave);

if (noteFormatActions) {
  noteFormatActions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-note-format]')) event.preventDefault();
  });
  noteFormatActions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-format]');
    if (!button) return;
    applyNoteFormat(button.dataset.noteFormat);
  });
}

noteModeButtons.forEach((button) => {
  button.addEventListener('click', () => setNoteMode(button.dataset.noteMode));
});
noteEditButton?.addEventListener('click', () => setNoteMode(noteMode === 'preview' ? 'edit' : 'preview'));

if (notePreview) {
  notePreview.addEventListener('click', (event) => {
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
  notePreview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
}

// ============ 首页 · 自适应 Bento 布局（长按换位 + 迷你/小/中/大组件） ============
const HOME_ORDER_KEY = 'notch-home-order-v3';
const HOME_SIZES_KEY = 'notch-home-widget-sizes-v2';
const HOME_HIDDEN_MODULES_KEY = 'notch-home-hidden-modules-v1';
const HOME_MODULE_REGISTRY = ['music', 'pomodoro', 'recorder', 'windows', 'note', 'commands'];
const unavailableHomeModules = window.NotchPlatform.capabilities(window.notchAPI?.platform || 'darwin').unavailableHomeModules;
const effectiveHomeHidden = (hidden) => window.NotchPlatform.effectiveHiddenModules(hidden, HOME_MODULE_REGISTRY, unavailableHomeModules);
const HOME_ORDER_DEFAULTS = ['music', 'pomodoro', 'windows', 'recorder', 'note', 'commands'];
const HOME_SIZE_DEFAULTS = {
  music: 'medium',
  windows: 'large',
  recorder: 'small',
  note: 'medium',
  commands: 'mini',
  pomodoro: 'mini',
};
const HOME_SIZE_LABELS = { mini: '迷你', small: '小', medium: '中', large: '大' };
const homeBento = document.getElementById('home-bento');
const homeTiles = homeBento
  ? Array.from(homeBento.querySelectorAll('[data-home-module]'))
  : [];

function loadHomeOrder() {
  try {
    const rawSaved = JSON.parse(localStorage.getItem(HOME_ORDER_KEY) || 'null');
    const saved = Array.isArray(rawSaved)
      ? rawSaved.map((id) => id === 'character' ? 'music' : id)
      : rawSaved;
    if (
      Array.isArray(saved)
      && saved.length === HOME_ORDER_DEFAULTS.length
      && new Set(saved).size === HOME_ORDER_DEFAULTS.length
      && saved.every((id) => HOME_ORDER_DEFAULTS.includes(id))
    ) return saved;

    // 从旧固定槽位布局平滑迁移；原时钟 / 人物位置由音乐组件接管。
    const legacy = JSON.parse(localStorage.getItem('notch-home-layout-v2') || 'null');
    const legacySlots = ['tall-left', 'small-top', 'medium-top', 'square-top', 'tall-right', 'wide-bottom'];
    if (legacy && typeof legacy === 'object') {
      const migrated = Object.entries(legacy)
        .sort((a, b) => legacySlots.indexOf(a[1]) - legacySlots.indexOf(b[1]))
        .map(([id]) => id === 'clock' || id === 'character' ? 'music' : id)
        .filter((id) => HOME_ORDER_DEFAULTS.includes(id));
      if (migrated.length === HOME_ORDER_DEFAULTS.length && new Set(migrated).size === migrated.length) {
        return migrated;
      }
    }
  } catch (error) {
    // 使用默认顺序。
  }
  return [...HOME_ORDER_DEFAULTS];
}

function loadHomeSizes() {
  try {
    return window.NotchDomain.normalizeHomeWidgetSizes(
      JSON.parse(localStorage.getItem(HOME_SIZES_KEY) || 'null'),
      HOME_SIZE_DEFAULTS,
      '',
      48
    );
  } catch (error) {
    return { ...HOME_SIZE_DEFAULTS };
  }
}

function loadHiddenHomeModules() {
  try {
    const rawText = localStorage.getItem(HOME_HIDDEN_MODULES_KEY);
    if (rawText === null) return { hiddenIds: [], needsRepair: false };
    const parsed = JSON.parse(rawText);
    const hiddenIds = window.NotchDomain.normalizeHiddenHomeModules(parsed, HOME_MODULE_REGISTRY);
    return {
      hiddenIds,
      needsRepair: JSON.stringify(parsed) !== JSON.stringify(hiddenIds),
    };
  } catch (error) {
    return { hiddenIds: [], needsRepair: true };
  }
}

let homeOrder = loadHomeOrder();
let homeSizes = loadHomeSizes();
const loadedHomeVisibility = loadHiddenHomeModules();
let hiddenHomeModules = loadedHomeVisibility.hiddenIds;
let homeVisibilityPersisted = true;
let homeLayoutReadOnly = false;
let homeLayoutMotionGeneration = 0;
let homeLayoutMotionAnimations = [];
const HOME_LAYOUT_MOTION_MS = 560;
const HOME_LAYOUT_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function saveHomeLayout() {
  try {
    localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(homeOrder));
    localStorage.setItem(HOME_SIZES_KEY, JSON.stringify(homeSizes));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话内的布局。
  }
}

function saveHiddenHomeModules() {
  try {
    localStorage.setItem(HOME_HIDDEN_MODULES_KEY, JSON.stringify(hiddenHomeModules));
    homeVisibilityPersisted = true;
    return true;
  } catch (error) {
    homeVisibilityPersisted = false;
    return false;
  }
}

if (loadedHomeVisibility.needsRepair) saveHiddenHomeModules();

function resolveValidatedHomeLayout(hiddenIds, order = homeOrder, sizes = homeSizes) {
  hiddenIds = effectiveHomeHidden(hiddenIds);
  const visibleIds = HOME_MODULE_REGISTRY.filter((id) => !hiddenIds.includes(id));
  const layout = window.NotchDomain.resolveHomeWidgetLayout(order, sizes, hiddenIds, 12, 4);
  return window.NotchDomain.validateHomeWidgetLayout(layout, visibleIds, 12, 4)
    ? layout
    : null;
}

function cancelHomeLayoutMotion() {
  homeLayoutMotionGeneration += 1;
  homeLayoutMotionAnimations.forEach((animation) => animation.cancel());
  homeLayoutMotionAnimations = [];
  homeBento?.classList.remove('layout-motion-active');
}

function captureHomeLayoutVisualState() {
  if (!homeBento) return null;
  const surface = homeBento.getBoundingClientRect();
  if (!surface.width || !surface.height) return null;
  const tiles = new Map();
  homeTiles.forEach((tile) => {
    if (tile.hidden) return;
    const rect = tile.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tiles.set(tile.dataset.homeModule, {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  });
  return { surface: { left: surface.left, top: surface.top }, tiles };
}

function animateCommittedHomeLayout(reason, beforeState) {
  if (!homeBento || !beforeState || reason === 'initial' || reason === 'rollback'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const generation = homeLayoutMotionGeneration;
  const finalTiles = new Map();
  homeTiles.forEach((tile) => {
    if (tile.hidden) return;
    const rect = tile.getBoundingClientRect();
    if (rect.width && rect.height) finalTiles.set(tile.dataset.homeModule, { tile, rect });
  });
  homeBento.classList.add('layout-motion-active');

  finalTiles.forEach(({ tile, rect }, moduleId) => {
    const previous = beforeState.tiles.get(moduleId);
    const dx = previous ? previous.rect.left - rect.left : 0;
    const dy = previous ? previous.rect.top - rect.top : 0;
    const scaleX = previous ? previous.rect.width / Math.max(1, rect.width) : 1;
    const scaleY = previous ? previous.rect.height / Math.max(1, rect.height) : 1;
    const moved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5;
    const resized = Math.abs(scaleX - 1) >= 0.01 || Math.abs(scaleY - 1) >= 0.01;
    if (previous && !moved && !resized) return;
    const animation = tile.animate(
      previous
        ? [
          { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
          { opacity: 1, transform: 'translate(0, 0) scale(1, 1)' },
        ]
        : [
          { opacity: 0.72, transform: 'translateY(8px) scale(0.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
      { duration: HOME_LAYOUT_MOTION_MS, easing: HOME_LAYOUT_MOTION_EASING }
    );
    homeLayoutMotionAnimations.push(animation);
  });

  Promise.allSettled(homeLayoutMotionAnimations.map((animation) => animation.finished))
    .then(() => {
      if (generation !== homeLayoutMotionGeneration) return;
      homeLayoutMotionAnimations = [];
      homeBento.classList.remove('layout-motion-active');
    });
}

function applyHomeLayout(layout, { reason = 'initial' } = {}) {
  if (!homeBento || !layout) throw new Error('A validated homepage layout is required.');
  cancelHomeLayoutMotion();
  const beforeState = reason === 'initial' || reason === 'rollback'
    ? null
    : captureHomeLayoutVisualState();
  const automaticLayout = !homeLayoutReadOnly;
  homeBento.dataset.layoutMode = homeLayoutReadOnly ? 'safe' : automaticLayout ? 'automatic' : 'preferred';
  homeTiles.forEach((tile) => {
    const moduleId = tile.dataset.homeModule;
    const orderIndex = Math.max(0, homeOrder.indexOf(moduleId));
    const size = homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    const placement = layout.placements[moduleId];
    tile.style.order = String(orderIndex);
    tile.dataset.widgetSize = size;
    tile.style.setProperty('--bento-index', String(orderIndex));
    tile.hidden = !placement;
    tile.setAttribute('aria-hidden', String(!placement));
    if (placement) {
      tile.dataset.layoutVariant = layout.variants[moduleId];
      tile.dataset.layoutColumn = String(placement.column);
      tile.dataset.layoutRow = String(placement.row);
      tile.dataset.layoutWidth = String(placement.width);
      tile.dataset.layoutHeight = String(placement.height);
      tile.style.gridColumn = `${placement.column + 1} / span ${placement.width}`;
      tile.style.gridRow = `${placement.row + 1} / span ${placement.height}`;
    } else {
      delete tile.dataset.layoutVariant;
      delete tile.dataset.layoutColumn;
      delete tile.dataset.layoutRow;
      delete tile.dataset.layoutWidth;
      delete tile.dataset.layoutHeight;
      tile.style.removeProperty('grid-column');
      tile.style.removeProperty('grid-row');
    }
    const sizeButton = tile.querySelector('[data-widget-size-cycle]');
    if (sizeButton) {
      sizeButton.dataset.currentSize = size;
      sizeButton.setAttribute('aria-label', `${HOME_SIZE_LABELS[size]}组件，点击切换尺寸`);
      sizeButton.title = `组件尺寸：${HOME_SIZE_LABELS[size]}`;
      sizeButton.hidden = automaticLayout || homeLayoutReadOnly;
      sizeButton.disabled = automaticLayout || homeLayoutReadOnly;
      sizeButton.tabIndex = automaticLayout || homeLayoutReadOnly ? -1 : 0;
    }
  });
  animateCommittedHomeLayout(reason, beforeState);
}

homeTiles.forEach((tile) => {
  const sizeButton = document.createElement('button');
  sizeButton.type = 'button';
  sizeButton.className = 'widget-size-control motion-icon';
  sizeButton.dataset.widgetSizeCycle = tile.dataset.homeModule;
  sizeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>';
  tile.appendChild(sizeButton);
});

const homeModuleIds = new Set(homeTiles.map((tile) => tile.dataset.homeModule));
if (homeTiles.length !== HOME_MODULE_REGISTRY.length
  || homeModuleIds.size !== HOME_MODULE_REGISTRY.length
  || !HOME_MODULE_REGISTRY.every((id) => homeModuleIds.has(id))) {
  throw new Error('Homepage module registry does not match the rendered tiles.');
}

let initialHomeLayout = resolveValidatedHomeLayout(hiddenHomeModules);
if (!initialHomeLayout) {
  initialHomeLayout = resolveValidatedHomeLayout([], HOME_ORDER_DEFAULTS, HOME_SIZE_DEFAULTS);
  homeLayoutReadOnly = true;
  console.error('Homepage layout validation failed; using read-only defaults.');
}
if (!initialHomeLayout) throw new Error('Default homepage layout validation failed.');
applyHomeLayout(initialHomeLayout, { reason: 'initial' });

function visibilitySnapshot() {
  const effectiveHiddenIds = effectiveHomeHidden(homeLayoutReadOnly ? [] : hiddenHomeModules);
  return {
    hiddenIds: [...effectiveHiddenIds],
    visibleIds: HOME_MODULE_REGISTRY.filter((id) => !effectiveHiddenIds.includes(id)),
    storedHiddenIds: [...hiddenHomeModules],
    automaticLayout: !homeLayoutReadOnly && effectiveHiddenIds.length > 0,
    unavailableIds: [...unavailableHomeModules],
    readOnly: homeLayoutReadOnly,
    persisted: homeVisibilityPersisted,
  };
}

function setHomeModuleVisible(moduleId, visible) {
  const current = [...hiddenHomeModules];
  if (unavailableHomeModules.includes(moduleId)) return { ok: false, changed: false, error: 'unsupported', hiddenIds: current, persisted: homeVisibilityPersisted };
  const currentlyVisible = visibilitySnapshot().visibleIds;
  if (!visible && currentlyVisible.includes(moduleId) && currentlyVisible.length === 1) {
    return { ok: false, changed: false, error: 'at_least_one_required', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (homeLayoutReadOnly) {
    return { ok: false, changed: false, error: 'layout_read_only', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const next = window.NotchDomain.updateHomeModuleVisibility(
    current,
    HOME_MODULE_REGISTRY,
    moduleId,
    visible
  );
  if (!next.ok) return { ...next, changed: false, persisted: homeVisibilityPersisted };
  const changed = JSON.stringify(next.hiddenIds) !== JSON.stringify(current);
  if (!changed) {
    return { ok: true, changed: false, hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (moduleId === 'recorder' && visible === false
    && window.NotchWorkspace?.isRecordingActive?.()) {
    return { ok: false, changed: false, error: 'recording_active', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const layout = resolveValidatedHomeLayout(next.hiddenIds);
  const currentLayout = resolveValidatedHomeLayout(current);
  if (!layout || !currentLayout) {
    return { ok: false, changed: false, error: 'layout_invalid', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  try {
    const activeElement = document.activeElement;
    const changingTile = homeTiles.find((tile) => tile.dataset.homeModule === moduleId);
    if (visible === false && changingTile?.contains(activeElement)) activeElement.blur();
    hiddenHomeModules = next.hiddenIds;
    applyHomeLayout(layout, { reason: 'visibility' });
  } catch (error) {
    hiddenHomeModules = current;
    try { applyHomeLayout(currentLayout, { reason: 'rollback' }); } catch (rollbackError) {}
    return { ok: false, changed: false, error: 'dom_apply_failed', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const persisted = saveHiddenHomeModules();
  const detail = visibilitySnapshot();
  document.dispatchEvent(new CustomEvent('notch:home-modules-changed', { detail }));
  return { ok: true, changed: true, hiddenIds: [...hiddenHomeModules], persisted };
}

window.NotchHome = Object.freeze({
  getVisibility: visibilitySnapshot,
  isVisible: (moduleId) => visibilitySnapshot().visibleIds.includes(String(moduleId || '')),
  setModuleVisible: setHomeModuleVisible,
});

document.dispatchEvent(new CustomEvent('notch:home-modules-changed', {
  detail: visibilitySnapshot(),
}));
if (homeLayoutReadOnly) document.dispatchEvent(new CustomEvent('notch:home-layout-error'));

if (homeBento) {
  let pendingLongPress = null;
  let dragState = null;
  let suppressHomeClickUntil = 0;

  const clearDropTarget = () => {
    homeTiles.filter((tile) => !tile.hidden).forEach((tile) => tile.classList.remove('layout-drop-target'));
  };

  const finishHomeDrag = (event, cancelled = false) => {
    if (pendingLongPress) clearTimeout(pendingLongPress.timer);
    pendingLongPress = null;
    if (!dragState) return;
    const { tile, target, pointerId } = dragState;
    if (tile.hasPointerCapture?.(pointerId)) tile.releasePointerCapture(pointerId);
    tile.classList.remove('is-dragging', 'hit-test-off');
    tile.style.removeProperty('--home-drag-x');
    tile.style.removeProperty('--home-drag-y');
    homeBento.classList.remove('layout-dragging');
    clearDropTarget();
    if (!cancelled && target && target !== tile) {
      const sourceId = tile.dataset.homeModule;
      const targetId = target.dataset.homeModule;
      const sourceIndex = homeOrder.indexOf(sourceId);
      const targetIndex = homeOrder.indexOf(targetId);
      [homeOrder[sourceIndex], homeOrder[targetIndex]] = [homeOrder[targetIndex], homeOrder[sourceIndex]];
      const layout = resolveValidatedHomeLayout(hiddenHomeModules);
      if (layout) {
        applyHomeLayout(layout, { reason: 'reorder' });
        saveHomeLayout();
        showStatusToast('首页布局已更新');
      } else {
        [homeOrder[sourceIndex], homeOrder[targetIndex]] = [homeOrder[targetIndex], homeOrder[sourceIndex]];
        showStatusToast('布局未更新，请重试');
      }
    }
    dragState = null;
    suppressHomeClickUntil = Date.now() + 260;
  };

  homeBento.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const tile = event.target.closest('[data-home-module]');
    if (!tile || tile.hidden || event.target.closest('button, input, textarea, select, a, audio, [contenteditable]')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    pendingLongPress = {
      tile,
      startX,
      startY,
      pointerId: event.pointerId,
      timer: setTimeout(() => {
        if (!pendingLongPress) return;
        tile.setPointerCapture?.(event.pointerId);
        homeBento.classList.add('layout-dragging');
        tile.classList.add('is-dragging');
        dragState = {
          tile,
          target: null,
          pointerId: event.pointerId,
          startX,
          startY,
        };
        pendingLongPress = null;
        if (navigator.vibrate) navigator.vibrate(18);
      }, 420),
    };
  });

  homeBento.addEventListener('click', (event) => {
    const sizeButton = event.target.closest('[data-widget-size-cycle]');
    if (!sizeButton) return;
    event.preventDefault();
    event.stopPropagation();
    if (effectiveHomeHidden(hiddenHomeModules).length > 0 || homeLayoutReadOnly) return;
    const moduleId = sizeButton.dataset.widgetSizeCycle;
    const sequence = ['mini', 'small', 'medium', 'large'];
    const current = homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    const requested = sequence[(sequence.indexOf(current) + 1) % sequence.length];
    homeSizes = window.NotchDomain.normalizeHomeWidgetSizes({
      ...homeSizes,
      [moduleId]: requested,
    }, HOME_SIZE_DEFAULTS, moduleId, 48);
    const layout = resolveValidatedHomeLayout(hiddenHomeModules);
    if (layout) {
      applyHomeLayout(layout, { reason: 'size' });
      saveHomeLayout();
      showStatusToast(`${HOME_SIZE_LABELS[homeSizes[moduleId]]}组件 · 其他模块已自适应`);
    }
  });

  homeBento.addEventListener('pointermove', (event) => {
    if (pendingLongPress) {
      const moved = Math.hypot(
        event.clientX - pendingLongPress.startX,
        event.clientY - pendingLongPress.startY
      );
      if (moved > 8) {
        clearTimeout(pendingLongPress.timer);
        pendingLongPress = null;
      }
      return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { tile, startX, startY } = dragState;
    tile.style.setProperty('--home-drag-x', `${event.clientX - startX}px`);
    tile.style.setProperty('--home-drag-y', `${event.clientY - startY}px`);
    tile.classList.add('hit-test-off');
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-home-module]');
    tile.classList.remove('hit-test-off');
    clearDropTarget();
    dragState.target = hovered && !hovered.hidden && hovered !== tile && homeBento.contains(hovered) ? hovered : null;
    dragState.target?.classList.add('layout-drop-target');
  });

  homeBento.addEventListener('pointerup', (event) => finishHomeDrag(event));
  homeBento.addEventListener('pointercancel', (event) => finishHomeDrag(event, true));
  homeBento.addEventListener('pointerleave', () => {
    if (!dragState && pendingLongPress) {
      clearTimeout(pendingLongPress.timer);
      pendingLongPress = null;
    }
  });
  homeBento.addEventListener('click', (event) => {
    if (Date.now() >= suppressHomeClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

// ============ 距离感应 Dock 悬浮 ============
function bindDockSurface(surface, selector, maxScale = 1.14) {
  if (!surface) return;
  let frame = null;
  const reset = () => {
    surface.querySelectorAll(selector).forEach((item) => {
      item.style.removeProperty('--dock-scale');
      item.style.removeProperty('--dock-lift');
      item.style.removeProperty('--dock-glow');
    });
  };
  surface.addEventListener('pointermove', (event) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      surface.querySelectorAll(selector).forEach((item) => {
        const rect = item.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
        const radius = Math.max(72, Math.min(150, rect.width * 2.2));
        const strength = Math.max(0, 1 - distance / radius) ** 2;
        item.style.setProperty('--dock-scale', (1 + (maxScale - 1) * strength).toFixed(3));
        item.style.setProperty('--dock-lift', `${(-5 * strength).toFixed(2)}px`);
        item.style.setProperty('--dock-glow', strength.toFixed(3));
      });
    });
  });
  surface.addEventListener('pointerleave', reset);
}

[
  ['#window-list', '.window-item', 1.12],
].forEach(([surfaceSelector, itemSelector, scale]) => {
  document.querySelectorAll(surfaceSelector).forEach((surface) => {
    bindDockSurface(surface, itemSelector, scale);
  });
});

// ============ 首页 · 收藏剪贴 ============
const clipfavListEl = document.getElementById('clipfav-list');

function renderClipFavs() {
  if (!clipfavListEl) return;
  // 脏标记：clipHistory / clipFavorites / clipImageCache 均未变则跳过重建
  if (clipDataVersion === lastRenderedFavsVersion) return;

  // 按 clipFavorites 顺序取条目（过滤掉已删的）
  const favEntries = clipFavorites
    .map((id) => clipHistory.find((e) => e.id === id))
    .filter(Boolean);

  if (!favEntries.length) {
    clipfavListEl.innerHTML =
      '<button class="clipfav-empty" type="button" data-action="goto-clip">' +
      '去"剪贴板"Tab 给常用记录加星 →' +
      '</button>';
    lastRenderedFavsVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  // 渲染每条收藏
  clipfavListEl.innerHTML = favEntries
    .map((entry) => {
      const safeId = escapeHtml(entry.id);

      if (entry.type === 'image') {
        const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
        const mediaHtml = dataUrl
          ? `<img class="clipfav-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
          : `<div class="clipfav-thumb-placeholder">图</div>`;
        return (
          `<div class="clipfav-item clip-type-image" data-id="${safeId}" role="button" tabindex="0" title="图片">` +
          mediaHtml +
          `<span class="clipfav-text">图片</span>` +
          `</div>`
        );
      }

      // text | url
      const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
      const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
      let preview = entry.text || '';
      if (isUrl) {
        try {
          preview = new URL(entry.text).hostname || entry.text;
        } catch (_) {
          preview = entry.text || '';
        }
      }
      const safePreview = escapeHtml(preview);
      const safeTitle = escapeHtml(entry.text || '');
      return (
        `<div class="clipfav-item ${typeClass}" data-id="${safeId}" role="button" tabindex="0" title="${safeTitle}">` +
        `<span class="clipfav-text">${safePreview}</span>` +
        `</div>`
      );
    })
    .join('');
  lastRenderedFavsVersion = clipDataVersion; // 标记本次渲染版本

  // 按需预加载图片缩略图（命中后二次渲染刷新）
  // preloadClipImage 会自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  const missingImageEntries = favEntries.filter(
    (e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath)
  );
  if (missingImageEntries.length > 0) {
    Promise.all(missingImageEntries.map((e) => preloadClipImage(e.imagePath))).then(() => {
      const anyLoaded = missingImageEntries.some((e) => clipImageCache.has(e.imagePath));
      if (anyLoaded) renderClipFavs();
    });
  }
}

if (clipfavListEl) {
  clipfavListEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 空态：跳转 clip Tab
    if (e.target.closest('[data-action="goto-clip"]')) {
      setActiveTab('clip');
      return;
    }
    // 条目点击：复制
    const item = e.target.closest('.clipfav-item[data-id]');
    if (item) {
      const id = item.dataset.id;
      if (await copyClipEntry(id)) {
        item.classList.add('copied');
        setTimeout(() => item.classList.remove('copied'), 800);
      }
    }
  });
  clipfavListEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    const item = e.target.closest('.clipfav-item[data-id]');
    if (!item) return;
    e.preventDefault();
    if (await copyClipEntry(item.dataset.id)) {
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 800);
    }
  });
}

// ============ 剪贴板历史 ============
const CLIP_HISTORY_KEY = 'notch-clip-history';
const CLIP_FAV_KEY = 'notch-clip-favorites';
const CLIP_MAX = 100;
const CLIP_URL_RE = /^https?:\/\//i;
const starOutlineSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const starFilledSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';

function loadClipHistory() {
  try {
    const raw = localStorage.getItem(CLIP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeClipEntry).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function normalizeClipEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = ['text', 'url', 'image'].includes(entry.type) ? entry.type : 'text';
  const text = typeof entry.text === 'string' ? entry.text : null;
  const imagePath = typeof entry.imagePath === 'string' ? entry.imagePath : null;
  if (type === 'image' ? !imagePath : text === null) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
    type,
    text,
    imagePath,
    timestamp: Number.isFinite(entry.timestamp) && !Number.isNaN(new Date(entry.timestamp).getTime())
      ? entry.timestamp
      : Date.now(),
  };
}

function saveClipHistory(list) {
  try {
    localStorage.setItem(CLIP_HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

function loadClipFavorites() {
  try {
    const raw = localStorage.getItem(CLIP_FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === 'string');
  } catch (e) {
    return [];
  }
}

function saveClipFavorites(list) {
  try {
    localStorage.setItem(CLIP_FAV_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

let clipHistory = loadClipHistory();
let clipFavorites = loadClipFavorites();
let clipFilter = 'all'; // all | text | image | faved
const clipImageCache = new Map(); // imagePath -> dataUrl，仅内存

// 脏标记 —— 单调递增版本号：凡影响 renderClipList / renderClipFavs 输出的变更都自增。
// 宁可多自增（多一次重建）也不能漏（界面不更新）。
// 注意：preloadClipImage 在图片入缓存后也要自增，确保二次渲染不被脏标记挡掉。
let clipDataVersion = 0;
let lastRenderedClipVersion = -1; // renderClipList 上次渲染时的版本号
let lastRenderedFavsVersion = -1; // renderClipFavs 上次渲染时的版本号

const clipListEl = document.getElementById('clip-list');
const clipToolbarEl = document.getElementById('clip-toolbar');
const clipResultCountEl = document.getElementById('clip-result-count');
const clipClearBtn = document.getElementById('clip-clear-btn');
let clipClearArmed = false;

// 防重入标志：renderClipList 内按需图片预加载完成后的二次渲染
let clipRenderPending = false;

async function preloadClipImage(imagePath) {
  if (!imagePath) return;
  if (clipImageCache.has(imagePath)) return;
  if (!window.notchAPI || typeof window.notchAPI.readClipImage !== 'function') return;
  try {
    const dataUrl = await window.notchAPI.readClipImage(imagePath);
    if (dataUrl) {
      clipImageCache.set(imagePath, dataUrl);
      clipDataVersion++; // 图片入缓存 → 版本自增，确保二次渲染不被脏标记挡掉（缩略图必须显示）
    }
  } catch (e) {
    // ignore read errors
  }
}

async function addClipEntry(raw) {
  const id = generateId();
  const entry = {
    id,
    type: raw.type || 'text',
    text: raw.text || null,
    imagePath: raw.imagePath || null,
    timestamp: Date.now(),
  };

  // 每一次系统复制都是独立历史事件；相同内容也必须保留为两条记录。
  const updated = window.NotchDomain.prependClipboardHistory(clipHistory, entry, CLIP_MAX);
  clipHistory = updated.history;
  const evicted = updated.evicted;
  if (evicted.length > 0) {
    const evictedPaths = evicted
      .filter((e) => e.type === 'image' && e.imagePath)
      .map((e) => e.imagePath);
    if (evictedPaths.length > 0) {
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages(evictedPaths).catch(() => {});
      }
      evictedPaths.forEach((p) => clipImageCache.delete(p));
    }
  }

  saveClipHistory(clipHistory);

  // 图片条目预加载缩略图
  if (entry.type === 'image' && entry.imagePath) {
    await preloadClipImage(entry.imagePath);
  }

  clipDataVersion++; // clipHistory 已变（含 FIFO 淘汰）
  renderClipList();
  renderClipFavs();
}

function clipDayKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatClipDay(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const today = new Date(now);
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayDifference = Math.round((currentDay - targetDay) / 86400000);
  if (dayDifference === 0) return '今天';
  if (dayDifference === 1) return '昨天';
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return date.getFullYear() === today.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
}

function formatClipMoment(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const difference = Math.max(0, now - timestamp);
  let relative = '';
  if (difference < 60000) relative = '刚刚';
  else if (difference < 3600000) relative = `${Math.floor(difference / 60000)} 分钟前`;
  else if (difference < 86400000) relative = `${Math.floor(difference / 3600000)} 小时前`;
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const full = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
  return { clock, relative, full, iso: date.toISOString() };
}

function groupClipItemsByDay(items) {
  const groups = [];
  const groupsByKey = new Map();
  items.forEach((entry) => {
    const key = clipDayKey(entry.timestamp);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(entry);
      return;
    }
    const group = { key, timestamp: entry.timestamp, items: [entry] };
    groupsByKey.set(key, group);
    groups.push(group);
  });
  return groups;
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? '取消收藏' : '收藏';
  const moment = formatClipMoment(entry.timestamp);
  const relative = moment.relative ? `<span class="clip-time-relative">${escapeHtml(moment.relative)}</span>` : '';
  const timeHtml = `<time class="clip-time" datetime="${escapeHtml(moment.iso)}" title="${escapeHtml(moment.full)}"><span>${escapeHtml(moment.clock)}</span>${relative}</time>`;
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? `<img class="clip-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
      : `<span class="clip-thumb-placeholder">图片加载中…</span>`;
    return `<div class="clip-item clip-item-image clip-type-image" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制图片">
    <span class="clip-thumb-wrap">${thumbHtml}</span>
    <span class="clip-meta">${timeHtml}</span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '空白内容'
  );
  return `<div class="clip-item clip-item-text ${typeClass}" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制：${accessiblePreview}">
    <span class="clip-text">${safeText}</span>
    <span class="clip-meta">${timeHtml}</span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
}

function getFilteredClipItems() {
  if (clipFilter === 'all') return clipHistory;
  if (clipFilter === 'text') return clipHistory.filter((e) => e.type === 'text' || e.type === 'url');
  if (clipFilter === 'image') return clipHistory.filter((e) => e.type === 'image');
  if (clipFilter === 'faved') {
    const favSet = new Set(clipFavorites);
    return clipHistory.filter((e) => favSet.has(e.id));
  }
  return clipHistory;
}

function renderClipList() {
  if (!clipListEl) return;
  // 脏标记：数据/过滤器/图片缓存均未变则跳过全量重建
  if (clipDataVersion === lastRenderedClipVersion) return;

  const items = getFilteredClipItems();
  const favSet = new Set(clipFavorites);
  if (clipResultCountEl) clipResultCountEl.textContent = `${items.length} 条`;

  if (items.length === 0) {
    clipListEl.innerHTML =
      '<div class="clip-empty">' +
      (clipHistory.length ? '没有符合条件的记录' : '复制点什么，历史会出现在这里') +
      '</div>';
    lastRenderedClipVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  clipListEl.innerHTML = groupClipItemsByDay(items).map((group) => {
    const headingId = `clip-day-${group.key}`;
    return `<section class="clip-timeline-group" aria-labelledby="${headingId}">
  <div class="clip-timeline-heading">
    <span class="clip-timeline-node" aria-hidden="true"></span>
    <time id="${headingId}" datetime="${group.key}">${escapeHtml(formatClipDay(group.timestamp))}</time>
    <span>${group.items.length} 条</span>
  </div>
  <div class="clip-timeline-items">${group.items.map((entry) => clipEntryHtml(entry, favSet.has(entry.id))).join('')}</div>
</section>`;
  }).join('');
  lastRenderedClipVersion = clipDataVersion; // 标记本次渲染版本（在预加载之前）

  // 按需预加载图片：收集当前 items 里 cache 未命中的 image 条目
  // preloadClipImage 成功后自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  if (clipRenderPending) return; // 防重入：已有预加载任务在途
  const missingPaths = items
    .filter((e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath))
    .map((e) => e.imagePath);

  if (missingPaths.length === 0) return;

  clipRenderPending = true;
  Promise.all(missingPaths.map((p) => preloadClipImage(p)))
    .then(() => {
      clipRenderPending = false;
      // 只有至少有一条路径成功填入 cache 才重渲，避免无意义刷新
      const anyLoaded = missingPaths.some((p) => clipImageCache.has(p));
      if (anyLoaded) renderClipList();
    })
    .catch(() => {
      clipRenderPending = false;
    });
}

// ---- 工具栏事件委托 ----
if (clipToolbarEl) {
  clipToolbarEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const filterBtn = e.target.closest('.clip-filter');
    if (filterBtn) {
      clipFilter = filterBtn.dataset.filter || 'all';
      clipToolbarEl.querySelectorAll('.clip-filter').forEach((b) => {
        const selected = b === filterBtn;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      clipDataVersion++; // clipFilter 已变 → 输出变化
      renderClipList();
      return;
    }
    if (e.target.closest('#clip-clear-btn')) {
      requestClearClipHistory();
    }
  });
  clipToolbarEl.querySelectorAll('.clip-filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
}

// ---- 列表事件委托 ----
if (clipListEl) {
  clipListEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.clip-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    // 优先判断子按钮
    const favoriteButton = e.target.closest('.clip-fav-btn');
    if (favoriteButton) {
      toggleClipFavorite(id, {
        restoreFocus: document.activeElement === favoriteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    const deleteButton = e.target.closest('.clip-del-btn');
    if (deleteButton) {
      deleteClipEntry(id, {
        restoreFocus: document.activeElement === deleteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    if (e.target.closest('[data-action="copy"]')) copyClipEntry(id);
  });
}

function focusClipControl(ids, action = 'copy') {
  if (!clipListEl) return;
  for (const id of ids.filter(Boolean)) {
    const target = clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`
    );
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  const activeFilter = clipToolbarEl && clipToolbarEl.querySelector('.clip-filter.active');
  if (activeFilter) activeFilter.focus({ preventScroll: true });
}

function toggleClipFavorite(id, focusContext = null) {
  const idx = clipFavorites.indexOf(id);
  if (idx === -1) {
    clipFavorites.push(id);
  } else {
    clipFavorites.splice(idx, 1);
  }
  clipDataVersion++; // clipFavorites 已变
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    const sameItemButton = clipListEl && clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="fav"]`
    );
    if (sameItemButton) {
      sameItemButton.focus({ preventScroll: true });
    } else {
      focusClipControl([focusContext.nextId, focusContext.previousId]);
    }
  }
}

function deleteClipEntry(id, focusContext = null) {
  const idx = clipHistory.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const entry = clipHistory[idx];
  const favoriteIndex = clipFavorites.indexOf(id);
  clipHistory.splice(idx, 1);
  clipFavorites = clipFavorites.filter((fid) => fid !== id);
  clipDataVersion++; // clipHistory + clipFavorites 已变
  saveClipHistory(clipHistory);
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    focusClipControl([focusContext.nextId, focusContext.previousId]);
  }
  showStatusToast('已删除剪贴记录', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (clipHistory.some((item) => item.id === id)) return;
      clipHistory.splice(Math.min(idx, clipHistory.length), 0, entry);
      if (favoriteIndex !== -1) {
        clipFavorites.splice(Math.min(favoriteIndex, clipFavorites.length), 0, id);
      }
      clipDataVersion++;
      saveClipHistory(clipHistory);
      saveClipFavorites(clipFavorites);
      renderClipList();
      renderClipFavs();
      focusClipControl([id]);
      showStatusToast('已撤销删除');
    },
    onExpire: () => {
      if (entry.type !== 'image' || !entry.imagePath) return;
      clipImageCache.delete(entry.imagePath);
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages([entry.imagePath]).catch(() => {});
      }
    },
  });
}

function resetClipClearConfirmation() {
  clipClearArmed = false;
  if (clipClearBtn) {
    clipClearBtn.classList.remove('confirming');
    clipClearBtn.setAttribute('aria-label', '清空历史');
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast('剪贴板历史已是空的');
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', `再次点击确认清空 ${clipHistory.length} 条历史`);
    }
    showStatusToast(`再点一次垃圾桶，清空 ${clipHistory.length} 条记录`, {
      duration: 3000,
      onExpire: resetClipClearConfirmation,
    });
    return;
  }
  resetClipClearConfirmation();
  clearClipHistory();
}

if (clipClearBtn) {
  clipClearBtn.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  });
}

function clearClipHistory() {
  const removedCount = clipHistory.length;
  const imagePaths = clipHistory
    .filter((e) => e.type === 'image' && e.imagePath)
    .map((e) => e.imagePath);
  clipHistory = [];
  clipFavorites = [];
  clipImageCache.clear();
  clipDataVersion++; // 全部数据已清空
  saveClipHistory([]);
  saveClipFavorites([]);
  if (imagePaths.length > 0 && window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
    window.notchAPI.deleteClipImages(imagePaths).catch(() => {});
  }
  renderClipList();
  renderClipFavs();
  showStatusToast(`已清空 ${removedCount} 条剪贴记录`);
}

async function copyClipEntry(id) {
  const entry = clipHistory.find((e) => e.id === id);
  if (!entry) return false;
  if (!window.notchAPI) return false;
  try {
    const result = typeof window.notchAPI.pasteClipboard === 'function'
      ? await window.notchAPI.pasteClipboard(entry)
      : { ok: await window.notchAPI.writeClipboard(entry), pasted: false };
    if (!result?.ok) {
      showStatusToast('复制失败，请重试');
      return false;
    }
    showStatusToast(result.pasted
      ? '已填入刚才的输入框'
      : result.permissionRequired
        ? '请开启辅助功能权限；内容已复制'
        : entry.type === 'image' ? '图片已复制，可直接粘贴' : '已复制，可直接粘贴');
  } catch (e) {
    showStatusToast('复制失败，请重试');
    return false;
  }
  // 视觉反馈：800ms 后移除 copied 类
  const itemEl = clipListEl && clipListEl.querySelector(`.clip-item[data-id="${CSS.escape(id)}"]`);
  if (itemEl) {
    itemEl.classList.add('copied');
    setTimeout(() => itemEl.classList.remove('copied'), 800);
  }
  return true;
}

// ---- IPC 推送监听 ----
if (window.notchAPI && typeof window.notchAPI.onNewClipEntry === 'function') {
  window.notchAPI.onNewClipEntry((raw) => {
    addClipEntry(raw);
  });
}

window.NotchClipboard = Object.freeze({
  chatContexts: () => clipHistory.filter((entry) => entry.type !== 'image' && entry.text?.trim()).map((entry) => ({
    sourceType: 'clipboard',
    sourceId: entry.id,
    sourceTitle: entry.type === 'url' ? '剪贴板链接' : String(entry.text).replace(/\s+/g, ' ').trim().slice(0, 48),
    sourceRevision: String(entry.timestamp || ''),
    text: entry.text,
    detail: new Date(entry.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    updatedAt: entry.timestamp || 0,
  })),
});

renderAll();
renderClipList(); // 首屏确保 clip-list DOM 就绪时渲染一次（幂等）
renderClipFavs(); // 首屏渲染收藏剪贴块
initTab();

window.NotchPanel = {
  isExpanded: () => isExpanded,
  busy: () => modeBusy,
  setNativeMode: ipcSetMode,
  validateTarget(target) {
    if (target.tab && !TABS.includes(target.tab)) throw Error('该功能尚未启用');
    if (target.id && target.tab === 'notes' && !loadNoteArchive().some((n) => n.id === target.id)) throw Error('笔记已不存在');
    if (target.id && target.tab === 'todo' && !PRIORITIES.some((p) => (data[p] || []).some((t) => String(t.id) === String(target.id)))) throw Error('待办已不存在');
    if (target.id && target.tab === 'links' && !window.NotchWorkspace.hasLink(target.id)) throw Error('链接已不存在');
  },
  async navigate(target) {
    window.NotchPanel.validateTarget(target);
    await setMode(true);
    await setActiveTab(target.tab || 'home');
    if (target.aiAction) { window.NotchAI?.openText?.(target.aiAction); return; }
    if (target.tab === 'notes' && target.id && !window.NotchNotes.select(target.id)) throw Error('笔记已不存在');
    if (target.tab === 'links' && target.id && !window.NotchWorkspace.selectLink(target.id)) throw Error('链接已不存在');
    if (target.create === 'note') window.NotchNotes.create();
    if (target.tab === 'todo') {
      setTodoTimeScope('all');
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
