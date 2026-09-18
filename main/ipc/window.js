function registerWindowIpc({
  ipcMain,
  isMainWindowSender,
  setMode,
  beginCollapse,
  setCollapsedHover,
  getMetrics,
  keepOpen,
  setTab,
  getHoverSpaceStatus,
}) {
  ipcMain.handle('window:set-mode', (event, mode) => {
    if (!isMainWindowSender(event.sender)) return undefined;
    return setMode(mode);
  });
  ipcMain.handle('window:begin-collapse', (event) => {
    if (!isMainWindowSender(event.sender)) return undefined;
    return beginCollapse();
  });
  ipcMain.on('window:set-collapsed-hover', (event, hovering) => {
    if (isMainWindowSender(event.sender)) setCollapsedHover(hovering === true);
  });
  ipcMain.handle('window:metrics', (event) => {
    if (!isMainWindowSender(event.sender)) return undefined;
    return getMetrics();
  });
  ipcMain.on('window:keep-open', (event) => {
    if (isMainWindowSender(event.sender)) keepOpen();
  });
  ipcMain.handle('window:set-tab', (event, tab) => {
    if (!isMainWindowSender(event.sender)) return undefined;
    return setTab(tab);
  });
  ipcMain.handle('shortcut:hover-space-status', (event) => {
    if (!isMainWindowSender(event.sender)) return undefined;
    return getHoverSpaceStatus();
  });
}

module.exports = { registerWindowIpc };
