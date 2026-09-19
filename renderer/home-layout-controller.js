(function exposeHomeLayoutController() {
  function createController(host = {}) {
    const { showStatusToast = () => {}, isRecordingActive = () => false } = host;

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
    && isRecordingActive()) {
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

const api = Object.freeze({
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


    return api;
  }

  window.NotchHomeLayoutController = Object.freeze({ createController });
})();
