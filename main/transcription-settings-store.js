function createTranscriptionSettingsStore({
  fs,
  path,
  getUserDataPath,
  getLegacyAppDataPath,
  fileName,
  selectSettings,
}) {
  function settingsPath() {
    return path.join(getUserDataPath(), fileName);
  }

  function readSettings(settingsFile) {
    try {
      const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  }

  function read() {
    const currentPath = settingsPath();
    const legacyPath = path.join(getLegacyAppDataPath(), 'notch-todo', fileName);
    const current = readSettings(currentPath);
    const legacy = currentPath === legacyPath ? {} : readSettings(legacyPath);
    const selected = selectSettings(current, legacy);
    if (!Object.keys(current).length && Object.keys(selected).length && currentPath !== legacyPath) {
      try {
        fs.mkdirSync(path.dirname(currentPath), { recursive: true });
        fs.writeFileSync(currentPath, JSON.stringify(selected), { mode: 0o600 });
      } catch (error) {
        // Keep reading the legacy path when migration cannot be written.
      }
    }
    return selected;
  }

  function write(settings) {
    const target = settingsPath();
    const temporaryPath = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(settings), { mode: 0o600 });
    fs.renameSync(temporaryPath, target);
  }

  return Object.freeze({ path: settingsPath, read, write });
}

module.exports = { createTranscriptionSettingsStore };
