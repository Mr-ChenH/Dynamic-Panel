function registerNotesIpc({
  ipcMain,
  fs,
  path,
  validNoteId,
  persistNoteImage,
  showOwnedOpenDialog,
  getSafeNoteImagePath,
  getNoteImagesDir,
  getNoteImageDirectory,
  noteImageMaxBytes,
}) {
  ipcMain.handle('notes:save-image', (_event, payload) => persistNoteImage(payload && payload.noteId, payload && payload.bytes));

  ipcMain.handle('notes:choose-images', async (_event, noteId) => {
    if (!validNoteId(noteId)) return { ok: false, error: 'invalid_note', images: [] };
    const result = await showOwnedOpenDialog({
      title: '添加图片到笔记',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (result.canceled) return { ok: true, canceled: true, images: [] };
    const images = [];
    for (const filePath of (result.filePaths || []).slice(0, 12)) {
      try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile() || stat.size > noteImageMaxBytes) continue;
        const saved = await persistNoteImage(noteId, await fs.promises.readFile(filePath));
        if (saved.ok) images.push({ ...saved, name: path.parse(filePath).name.slice(0, 80) });
      } catch (error) {}
    }
    return images.length
      ? { ok: true, canceled: false, images }
      : { ok: false, error: 'no_valid_images', images: [] };
  });

  ipcMain.handle('notes:read-image', async (_event, imagePath) => {
    const safePath = getSafeNoteImagePath(imagePath);
    if (!safePath) return null;
    try {
      const stat = await fs.promises.stat(safePath);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return null;
      const buffer = await fs.promises.readFile(safePath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('notes:delete-images', async (_event, noteId) => {
    const directory = getNoteImageDirectory(noteId);
    if (!directory) return false;
    try {
      const root = path.resolve(getNoteImagesDir());
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== root) return false;
      const rootStat = await fs.promises.lstat(root);
      const stat = await fs.promises.lstat(resolved);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()
        || stat.isSymbolicLink() || !stat.isDirectory()) return false;
      await fs.promises.rm(resolved, { recursive: true, force: true });
      return true;
    } catch (error) {
      return error && error.code === 'ENOENT';
    }
  });
}

module.exports = { registerNotesIpc };
