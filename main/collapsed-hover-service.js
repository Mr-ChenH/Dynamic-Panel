'use strict';

function createCollapsedHoverService({
  platform,
  screen,
  getMainWindow,
  getMode,
  getDisplay,
  getNotchHeight,
  getLayout,
  applyCollapsedGeometry,
  intervalMs = 120,
  shapeWatchdogIntervalMs = 1000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let hovering = false;
  let reconcileTimer = null;
  let shapeWatchdogTimer = null;

  function eligible() {
    const window = getMainWindow();
    return platform === 'win32'
      && Boolean(window && !window.isDestroyed() && window.isVisible())
      && getMode() === 'collapsed';
  }

  function cursorInsideHoveredIsland() {
    const display = getDisplay();
    const layout = getLayout(display, false, true, getNotchHeight(display));
    const island = layout?.shape?.[0];
    if (!island) return false;
    const point = screen.getCursorScreenPoint();
    const left = layout.bounds.x + island.x;
    const top = layout.bounds.y + island.y;
    return point.x >= left
      && point.x < left + island.width
      && point.y >= top
      && point.y < top + island.height;
  }

  function stopReconcileTimer() {
    if (reconcileTimer) clearIntervalFn(reconcileTimer);
    reconcileTimer = null;
  }

  function stopShapeWatchdog() {
    if (shapeWatchdogTimer) clearIntervalFn(shapeWatchdogTimer);
    shapeWatchdogTimer = null;
  }

  function repairCollapsedShape() {
    if (!eligible()) {
      stopShapeWatchdog();
      return;
    }
    try {
      if (hovering && !cursorInsideHoveredIsland()) {
        reset();
        return;
      }
      // Windows may drop the transparent window region after a long-lived
      // DWM/compositor transition. Reapply the shape even when not hovering.
      applyCollapsedGeometry();
    } catch (error) {
      reset({ applyGeometry: false });
    }
  }

  function start() {
    if (!eligible() || shapeWatchdogTimer) return;
    shapeWatchdogTimer = setIntervalFn(repairCollapsedShape, shapeWatchdogIntervalMs);
    shapeWatchdogTimer?.unref?.();
  }

  function stop() {
    stopShapeWatchdog();
    stopReconcileTimer();
  }

  function reset({ applyGeometry = true } = {}) {
    const changed = hovering;
    hovering = false;
    stopReconcileTimer();
    if (changed && applyGeometry && eligible()) applyCollapsedGeometry();
    return changed;
  }

  function reconcile() {
    if (!hovering) {
      stopReconcileTimer();
      return;
    }
    if (!eligible()) {
      reset({ applyGeometry: false });
      return;
    }
    try {
      if (!cursorInsideHoveredIsland()) reset();
    } catch (error) {
      reset();
    }
  }

  function ensureReconcileTimer() {
    if (!hovering || reconcileTimer) return;
    reconcileTimer = setIntervalFn(reconcile, intervalMs);
    reconcileTimer?.unref?.();
  }

  function setHovering(value) {
    const next = value === true && eligible();
    if (next === hovering) {
      if (next) ensureReconcileTimer();
      return false;
    }
    hovering = next;
    if (hovering) ensureReconcileTimer();
    if (eligible()) {
      start();
      applyCollapsedGeometry();
    } else {
      stopShapeWatchdog();
    }
    return true;
  }

  function dispose() {
    hovering = false;
    stop();
  }

  return {
    setHovering,
    reset,
    reconcile,
    start,
    stop,
    dispose,
    isHovering: () => hovering,
  };
}

module.exports = { createCollapsedHoverService };
