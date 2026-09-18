function createTaskNotificationWindowFactory({
  BrowserWindow,
  preloadPath,
  htmlPath,
  getBounds,
  installLocalWebContentsGuards,
  onReady,
  onRenderProcessGone,
  onClosed,
  platform = process.platform,
}) {
  function create() {
    const window = new BrowserWindow({
      ...getBounds(),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      hiddenInMissionControl: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      roundedCorners: false,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    installLocalWebContentsGuards(window.webContents);
    window.setAlwaysOnTop(true, 'screen-saver', 1);
    if (platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(false);
    window.loadFile(htmlPath);
    window.webContents.once('did-finish-load', () => onReady(window));
    window.webContents.on('render-process-gone', () => onRenderProcessGone(window));
    window.on('closed', () => onClosed(window));
    return window;
  }

  return { create };
}

module.exports = { createTaskNotificationWindowFactory };
