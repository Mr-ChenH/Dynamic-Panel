function createWorkspaceController({
  fs,
  path,
  getUserDataPath,
  getSettingsPath,
  readJsonFile,
  writeJsonFile,
  workspaceSettingsFile,
  workspaceDataFile,
  recordingsDirName,
  clipImagesDirName,
  noteImagesDirName,
  portableMediaPath,
  persistenceGate,
  copyCaptures,
  isCaptureBusy,
  showMessageBox,
  showOwnedOpenDialog,
  openPath,
  onContextChanged,
  onWorkspaceChanged,
  now = () => Date.now(),
  maxSnapshotBytes = 8 * 1024 * 1024,
}) {
  const assetDirectories = [recordingsDirName, clipImagesDirName, noteImagesDirName];

  function root() {
    const settings = readJsonFile(getSettingsPath(workspaceSettingsFile));
    const configured = String(settings.path || '').trim();
    return configured && path.isAbsolute(configured) ? configured : getUserDataPath();
  }

  function workspacePath(name) {
    return path.join(root(), name);
  }

  function copyAssets(sourceRoot, targetRoot) {
    if (!sourceRoot || !targetRoot || path.resolve(sourceRoot) === path.resolve(targetRoot)) return;
    for (const directory of assetDirectories) {
      const source = path.join(sourceRoot, directory);
      const target = path.join(targetRoot, directory);
      try {
        if (!fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) continue;
        fs.mkdirSync(target, { recursive: true });
        fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
      } catch (error) {}
    }
    const source = path.join(sourceRoot, workspaceDataFile);
    const target = path.join(targetRoot, workspaceDataFile);
    try {
      if (fs.existsSync(source) && fs.lstatSync(source).isFile() && !fs.existsSync(target)) {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {}
  }

  async function choose() {
    if (isCaptureBusy()) {
      await showMessageBox({ type: 'info', message: '请先结束录音或屏幕采集并等待保存，再更换数据文件夹。' });
      return false;
    }
    const result = await showOwnedOpenDialog({
      title: '选择 Dynamic Panel 数据文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    const selected = !result.canceled && result.filePaths && result.filePaths[0];
    if (!selected || isCaptureBusy()) return false;
    const previousRoot = root();
    try {
      copyCaptures(previousRoot, selected);
    } catch (error) {
      await showMessageBox({
        type: 'error',
        message: '截图与录屏资料复制失败，数据文件夹未切换。',
        detail: '请检查目标目录权限、剩余空间及是否存在冲突文件。',
      });
      return false;
    }
    copyAssets(previousRoot, selected);
    if (!writeJsonFile(getSettingsPath(workspaceSettingsFile), { path: selected })) return false;
    onContextChanged();
    for (const directory of assetDirectories) {
      try { fs.mkdirSync(path.join(selected, directory), { recursive: true }); } catch (error) {}
    }
    onWorkspaceChanged(selected);
    return true;
  }

  function normalizePortableStorage(storage) {
    const portable = { ...storage };
    const normalizers = [
      ['notch-recordings', 'audioPath', recordingsDirName],
      ['notch-clip-history', 'imagePath', clipImagesDirName],
    ];
    for (const [storageKey, property, directory] of normalizers) {
      try {
        const rows = JSON.parse(portable[storageKey]);
        if (!Array.isArray(rows)) continue;
        portable[storageKey] = JSON.stringify(rows.map((row) => {
          if (!row || typeof row !== 'object' || !row[property]) return row;
          return { ...row, [property]: portableMediaPath(directory, row[property]) };
        }));
      } catch (error) {}
    }
    return portable;
  }

  function info() {
    const selectedRoot = root();
    return { path: selectedRoot, portable: selectedRoot !== getUserDataPath() };
  }

  function loadData() {
    const payload = readJsonFile(workspacePath(workspaceDataFile), {});
    return payload && payload.localStorage && typeof payload.localStorage === 'object'
      ? payload.localStorage : {};
  }

  function saveData(storage) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return false;
    const portableStorage = normalizePortableStorage(storage);
    const serialized = JSON.stringify(portableStorage);
    if (Buffer.byteLength(serialized) > maxSnapshotBytes) return false;
    const destination = workspacePath(workspaceDataFile);
    if (!persistenceGate.shouldWrite(portableStorage, destination)) return true;
    const written = writeJsonFile(destination, {
      version: 1,
      updatedAt: now(),
      localStorage: portableStorage,
    });
    if (written) persistenceGate.markWritten(portableStorage, destination);
    return written;
  }

  return {
    root,
    path: workspacePath,
    info,
    loadData,
    saveData,
    open: () => openPath(root()),
    choose,
    normalizePortableStorage,
    copyAssets,
  };
}

module.exports = { createWorkspaceController };
