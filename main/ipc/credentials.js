function registerCredentialsIpc({
  ipcMain,
  credentialsVault,
  clipboard,
  schedule = setTimeout,
  clearDelayMs = 60_000,
}) {
  ipcMain.handle('credentials:list', () => credentialsVault.list());
  ipcMain.handle('credentials:get', (_event, id) => credentialsVault.get(id));
  ipcMain.handle('credentials:save', (_event, payload) => credentialsVault.save(payload));
  ipcMain.handle('credentials:delete-many', (_event, ids) => credentialsVault.deleteMany(ids));
  ipcMain.handle('credentials:copy', async (_event, payload) => {
    const id = String(payload && payload.id || '');
    const field = payload && payload.field === 'password'
      ? 'password'
      : payload && payload.field === 'account' ? 'account' : '';
    if (!id || !field) return false;
    const value = credentialsVault.value(id, field);
    if (value === null) return false;
    await clipboard.writeText(value);
    if (field === 'password') {
      schedule(() => {
        void clipboard.readText()
          .then((currentValue) => {
            if (currentValue === value) return clipboard.clear();
            return undefined;
          })
          .catch(() => {});
      }, clearDelayMs).unref?.();
    }
    return true;
  });
}

module.exports = { registerCredentialsIpc };
