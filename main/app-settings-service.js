function createAppSettingsService(options = {}) {
  const readJsonFile = options.readJsonFile;
  const writeJsonFile = options.writeJsonFile;
  const getSettingsPath = options.getSettingsPath;
  const fileName = options.fileName || 'app-settings.json';
  const defaultFeatures = { ...(options.defaultFeatures || {}) };
  const normalizeDefaultTabPreference = options.normalizeDefaultTabPreference;
  const isValidPanelShortcut = options.isValidPanelShortcut;
  const isValidOptionalShortcut = options.isValidOptionalShortcut;
  const launcherConfig = options.launcherConfig;
  const isAutoLaunchEnabled = options.isAutoLaunchEnabled;
  const normalizeNotchHeightPreference = options.normalizeNotchHeightPreference || (() => ({ mode: 'small', custom: 24 }));
  const platform = options.platform || 'darwin';

  function read() {
    const stored = readJsonFile(getSettingsPath(fileName));
    const features = { ...defaultFeatures, ...(stored.features || {}), home: true };
    const shortcuts = stored.shortcuts && typeof stored.shortcuts === 'object' && !Array.isArray(stored.shortcuts)
      ? stored.shortcuts : {};
    return {
      features,
      shortcut: isValidPanelShortcut(stored.shortcut) ? stored.shortcut : 'Space',
      shortcuts: {
        screenshot: isValidOptionalShortcut(shortcuts.screenshot) ? shortcuts.screenshot : '',
        screenRecording: isValidOptionalShortcut(shortcuts.screenRecording) ? shortcuts.screenRecording : '',
        audioRecording: isValidOptionalShortcut(shortcuts.audioRecording) ? shortcuts.audioRecording : '',
      },
      defaultTab: normalizeDefaultTabPreference(stored.defaultTab, features),
      theme: stored.theme === 'light' ? 'light' : 'dark',
      notchHeight: normalizeNotchHeightPreference(stored.notchHeight, platform),
    };
  }

  function publicSettings() {
    const settings = read();
    return {
      ...settings,
      shortcuts: { ...settings.shortcuts, launcher: launcherConfig().shortcut },
      autoLaunch: isAutoLaunchEnabled(),
    };
  }

  function save(settings) {
    return writeJsonFile(getSettingsPath(fileName), settings);
  }

  return Object.freeze({ read, publicSettings, save });
}

module.exports = { createAppSettingsService };
