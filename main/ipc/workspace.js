function registerWorkspaceIpc({ ipcMain, workspaceController }) {
  ipcMain.handle('workspace:get', () => workspaceController.info());
  ipcMain.handle('workspace:load-data', () => workspaceController.loadData());
  ipcMain.handle('workspace:save-data', (_event, storage) => workspaceController.saveData(storage));
  ipcMain.handle('workspace:open', () => workspaceController.open());
  ipcMain.handle('workspace:choose', () => workspaceController.choose());
}

module.exports = { registerWorkspaceIpc };
