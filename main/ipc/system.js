function privacySettingsPanesFor(platform) {
  return platform === 'win32' ? {
    microphone: 'ms-settings:privacy-microphone',
  } : {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  };
}

function registerSystemIpc({
  ipcMain,
  requestMicrophoneAccess,
  validatePublicHttpUrl,
  openExternal,
  openPath,
  isAbsolutePath,
  privacySettingsPanes,
}) {
  ipcMain.handle('media:microphone', () => requestMicrophoneAccess());

  ipcMain.handle('shell:openExternal', async (_event, value) => {
    const url = await validatePublicHttpUrl(value);
    if (!url) return false;
    await openExternal(url.toString());
    return true;
  });

  ipcMain.handle('shell:openPath', (_event, value) => {
    if (typeof value === 'string' && isAbsolutePath(value)) return openPath(value);
    return undefined;
  });

  ipcMain.handle('shell:open-privacy-settings', (_event, pane) => {
    const target = privacySettingsPanes[String(pane || '')];
    if (!target) return false;
    openExternal(target);
    return true;
  });
}

module.exports = { privacySettingsPanesFor, registerSystemIpc };
