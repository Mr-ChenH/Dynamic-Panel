function registerRecordingsIpc({
  ipcMain,
  saveRecording,
  readRecording,
  deleteRecording,
  getSafeRecordingPath,
  revealItem,
}) {
  ipcMain.handle('recordings:save', (_event, payload) => saveRecording(payload));
  ipcMain.handle('recordings:read', (_event, audioPath) => readRecording(audioPath));
  ipcMain.handle('recordings:delete', (_event, audioPath) => deleteRecording(audioPath));
  ipcMain.handle('recordings:reveal', (_event, audioPath) => {
    const safePath = getSafeRecordingPath(audioPath);
    if (!safePath) return false;
    revealItem(safePath);
    return true;
  });
}

module.exports = { registerRecordingsIpc };
