function registerClipboardIpc({
  ipcMain,
  fs,
  getSafeClipImagePath,
  writeClipboardEntry,
  automaticPaste,
  isAccessibilityTrusted,
  getPreviousPasteTarget,
  requestRendererCollapse,
  waitForCollapsedPanel,
  pasteToPreviousApp,
}) {
  ipcMain.handle('clipboard:readImage', async (_event, imagePath) => {
    const safePath = getSafeClipImagePath(imagePath);
    if (!safePath) return null;
    try {
      const buffer = await fs.promises.readFile(safePath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('clipboard:deleteImages', async (_event, paths) => {
    if (!Array.isArray(paths)) return;
    for (const imagePath of paths) {
      const safePath = getSafeClipImagePath(imagePath);
      if (!safePath) continue;
      try {
        await fs.promises.unlink(safePath);
      } catch (error) {}
    }
  });

  ipcMain.handle('clipboard:write', (_event, entry) => writeClipboardEntry(entry));

  ipcMain.handle('clipboard:paste', async (_event, entry) => {
    if (!await writeClipboardEntry(entry)) return { ok: false, pasted: false };
    if (!automaticPaste) return { ok: true, pasted: false };
    if (!isAccessibilityTrusted()) return { ok: true, pasted: false, permissionRequired: true };
    const target = getPreviousPasteTarget();
    requestRendererCollapse();
    await waitForCollapsedPanel();
    const pasted = await pasteToPreviousApp(target);
    return { ok: true, pasted };
  });
}

module.exports = { registerClipboardIpc };
