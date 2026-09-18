function createSettingsController({
  readAppSettings,
  saveAppSettings,
  publicAppSettings,
  applyAppSettings,
  refreshTrayMenu,
  updateFeaturePreference,
  updateDefaultTabPreference,
  isMainWindowSender,
  setAutoLaunch,
  isAutoLaunchEnabled,
  isValidPanelShortcut,
  isValidOptionalShortcut,
  launcherConfig,
  writeLauncherSettings,
  setLauncherShortcut,
  setPanelShortcut,
  setActionShortcut,
  sendSettingsChanged,
}) {
  function setFeature(payload) {
    const current = readAppSettings();
    const features = updateFeaturePreference(current.features, payload && payload.featureId, payload && payload.enabled);
    if (!features) return { ok: false, error: 'invalid_feature' };
    const next = { ...current, features };
    if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
    applyAppSettings();
    refreshTrayMenu();
    return { ok: true, settings: publicAppSettings() };
  }

  function setDefaultTab(defaultTab) {
    const next = updateDefaultTabPreference(readAppSettings(), defaultTab);
    if (!next) return { ok: false, error: 'invalid_default_tab' };
    if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
    applyAppSettings();
    return { ok: true, settings: publicAppSettings() };
  }

  function setTheme(sender, theme) {
    if (!isMainWindowSender(sender)) return { ok: false, error: 'invalid_sender' };
    if (!['dark', 'light'].includes(theme)) return { ok: false, error: 'invalid_theme' };
    const next = { ...readAppSettings(), theme };
    if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
    applyAppSettings();
    return { ok: true, settings: publicAppSettings() };
  }

  function updateAutoLaunch(enabled) {
    if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
    if (!setAutoLaunch(enabled)) return { ok: false, error: 'save_failed', autoLaunch: isAutoLaunchEnabled() };
    const settings = publicAppSettings();
    sendSettingsChanged(settings);
    refreshTrayMenu();
    return { ok: true, autoLaunch: settings.autoLaunch };
  }

  function setShortcut(payload) {
    const action = typeof payload === 'string' ? 'panel' : payload?.action;
    const accelerator = typeof payload === 'string' ? payload : payload?.accelerator;
    if (!['panel', 'launcher', 'screenshot', 'screenRecording', 'audioRecording'].includes(action)
      || typeof accelerator !== 'string'
      || (action === 'panel' ? !isValidPanelShortcut(accelerator) : !isValidOptionalShortcut(accelerator))) {
      return { ok: false, error: 'invalid' };
    }
    if (action === 'launcher') {
      const previous = launcherConfig();
      if (!setLauncherShortcut(accelerator)) return { ok: false, error: 'occupied' };
      const next = { ...previous, shortcut: accelerator };
      if (!writeLauncherSettings(next)) {
        setLauncherShortcut(previous.shortcut);
        return { ok: false, error: 'save_failed' };
      }
    } else {
      const next = readAppSettings();
      const previous = action === 'panel' ? next.shortcut : next.shortcuts[action];
      const registered = action === 'panel'
        ? setPanelShortcut(accelerator)
        : setActionShortcut(action, accelerator);
      if (!registered) return { ok: false, error: 'occupied' };
      if (action === 'panel') next.shortcut = accelerator;
      else next.shortcuts[action] = accelerator;
      if (!saveAppSettings(next)) {
        if (action === 'panel') setPanelShortcut(previous);
        else setActionShortcut(action, previous);
        return { ok: false, error: 'save_failed' };
      }
    }
    const settings = publicAppSettings();
    sendSettingsChanged(settings);
    refreshTrayMenu();
    return { ok: true, action, shortcut: accelerator, settings };
  }

  return {
    get: publicAppSettings,
    setFeature,
    setDefaultTab,
    setTheme,
    setAutoLaunch: updateAutoLaunch,
    setShortcut,
  };
}

module.exports = { createSettingsController };
