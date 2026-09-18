function registerWindowsIpc({ ipcMain, listWindows, focusWindow }) {
  ipcMain.handle('windows:list', (_event) => listWindows());
  ipcMain.handle('windows:focus', (_event, windowId) => focusWindow(windowId));
}

module.exports = { registerWindowsIpc };
