function registerSettingsIpc({ ipcMain, settingsController }) {
  ipcMain.handle('settings:get', () => settingsController.get());
  ipcMain.handle('settings:set-feature', (_event, payload) => settingsController.setFeature(payload));
  ipcMain.handle('settings:set-default-tab', (_event, defaultTab) => settingsController.setDefaultTab(defaultTab));
  ipcMain.handle('settings:set-theme', (event, theme) => settingsController.setTheme(event.sender, theme));
  ipcMain.handle('settings:set-notch-height', (event, preference) => settingsController.setNotchHeight(event.sender, preference));
  ipcMain.handle('settings:set-auto-launch', (_event, enabled) => settingsController.setAutoLaunch(enabled));
  ipcMain.handle('settings:set-shortcut', (_event, payload) => settingsController.setShortcut(payload));
}

module.exports = { registerSettingsIpc };
