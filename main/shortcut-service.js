const ACTION_NAMES = Object.freeze(['screenshot', 'screenRecording', 'audioRecording']);

function createShortcutService({
  globalShortcut,
  isValidPanelShortcut,
  isValidOptionalShortcut,
  shortcutAssignmentConflict,
  platform = 'darwin',
  hoverSpacePollingPolicy,
  getPanelState,
  getCursorPoint,
  getCollapsedBounds,
  onPanelShortcut,
  onHoverSpaceShortcut,
  onLauncherShortcut,
  onActionShortcut,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let panelShortcut = '';
  let launcherShortcut = '';
  let actionShortcuts = { screenshot: '', screenRecording: '', audioRecording: '' };
  let hoverTimer = null;
  let hoverRegistered = false;

  function assignments() {
    return { panel: panelShortcut, launcher: launcherShortcut, ...actionShortcuts };
  }

  function hasConflict(action, shortcut) {
    return shortcutAssignmentConflict(assignments(), action, shortcut, platform);
  }

  function register(accelerator, callback) {
    try {
      return globalShortcut.register(accelerator, callback) === true;
    } catch (error) {
      return false;
    }
  }

  function setHoverRegistration(enabled) {
    if (enabled === hoverRegistered) return;
    if (!enabled) {
      if (globalShortcut.isRegistered('Space')) globalShortcut.unregister('Space');
      hoverRegistered = false;
      return;
    }
    try {
      const registered = globalShortcut.register('Space', onHoverSpaceShortcut);
      hoverRegistered = registered === true && globalShortcut.isRegistered('Space');
    } catch (error) {
      hoverRegistered = false;
    }
  }

  function hoverPolicy() {
    const panel = getPanelState();
    return hoverSpacePollingPolicy({
      shortcut: panelShortcut,
      visible: panel.visible,
      mode: panel.mode,
    });
  }

  function stopHoverSpacePolling() {
    if (hoverTimer) clearIntervalFn(hoverTimer);
    hoverTimer = null;
    setHoverRegistration(false);
  }

  function startHoverSpacePolling() {
    const policy = hoverPolicy();
    if (!policy.enabled || hoverTimer) return;
    hoverTimer = setIntervalFn(() => {
      const currentPolicy = hoverPolicy();
      if (!currentPolicy.enabled) {
        stopHoverSpacePolling();
        return;
      }
      const point = getCursorPoint();
      const bounds = getCollapsedBounds();
      const hovering = point.x >= bounds.x && point.x < bounds.x + bounds.width
        && point.y >= bounds.y && point.y < bounds.y + bounds.height;
      setHoverRegistration(hovering);
    }, policy.intervalMs);
  }

  function syncHoverSpacePolling() {
    if (hoverPolicy().enabled) startHoverSpacePolling();
    else stopHoverSpacePolling();
  }

  function setPanelShortcut(shortcut) {
    if (!isValidPanelShortcut(shortcut) || hasConflict('panel', shortcut)) return false;
    if (shortcut === panelShortcut) return true;
    const previousShortcut = panelShortcut;
    stopHoverSpacePolling();
    if (previousShortcut && previousShortcut !== 'Space') globalShortcut.unregister(previousShortcut);
    if (shortcut === 'Space') {
      panelShortcut = shortcut;
      startHoverSpacePolling();
      return true;
    }
    if (register(shortcut, onPanelShortcut)) {
      panelShortcut = shortcut;
      return true;
    }
    panelShortcut = previousShortcut;
    if (previousShortcut === 'Space') startHoverSpacePolling();
    else if (previousShortcut && !register(previousShortcut, onPanelShortcut)) panelShortcut = '';
    return false;
  }

  function setLauncherShortcut(shortcut) {
    if (!isValidOptionalShortcut(shortcut) || hasConflict('launcher', shortcut)) return false;
    if (shortcut === launcherShortcut) return true;
    const previousShortcut = launcherShortcut;
    if (previousShortcut) globalShortcut.unregister(previousShortcut);
    if (!shortcut || register(shortcut, onLauncherShortcut)) {
      launcherShortcut = shortcut;
      return true;
    }
    launcherShortcut = previousShortcut;
    if (previousShortcut && !register(previousShortcut, onLauncherShortcut)) launcherShortcut = '';
    return false;
  }

  function setActionShortcut(action, shortcut) {
    if (!Object.hasOwn(actionShortcuts, action)
      || !isValidOptionalShortcut(shortcut)
      || hasConflict(action, shortcut)) return false;
    if (shortcut === actionShortcuts[action]) return true;
    const previousShortcut = actionShortcuts[action];
    if (previousShortcut) globalShortcut.unregister(previousShortcut);
    const callback = () => onActionShortcut(action);
    if (!shortcut || register(shortcut, callback)) {
      actionShortcuts = { ...actionShortcuts, [action]: shortcut };
      return true;
    }
    actionShortcuts = { ...actionShortcuts, [action]: previousShortcut };
    if (previousShortcut && !register(previousShortcut, callback)) {
      actionShortcuts = { ...actionShortcuts, [action]: '' };
    }
    return false;
  }

  function state() {
    return {
      panel: panelShortcut,
      launcher: launcherShortcut,
      actions: { ...actionShortcuts },
      hoverRegistered: hoverRegistered && globalShortcut.isRegistered('Space'),
    };
  }

  return {
    actionNames: () => [...ACTION_NAMES],
    state,
    setPanelShortcut,
    setLauncherShortcut,
    setActionShortcut,
    syncHoverSpacePolling,
    stopHoverSpacePolling,
  };
}

module.exports = { ACTION_NAMES, createShortcutService };
