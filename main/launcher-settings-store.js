function createLauncherSettingsStore(options = {}) {
  const readJsonFile = options.readJsonFile;
  const writeJsonFile = options.writeJsonFile;
  const getSettingsPath = options.getSettingsPath;
  const statFile = options.statFile;
  const fileName = options.fileName || 'launcher-settings.json';
  const defaultSources = {
    apps: true,
    workspace: true,
    clipboard: false,
    extensions: true,
  };

  function read() {
    const file = getSettingsPath(fileName);
    let candidate = {};
    try {
      if (statFile(file).size <= 65536) candidate = readJsonFile(file, {});
    } catch (error) {}
    const stored = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
    const sources = Object.fromEntries(Object.entries(defaultSources).map(([key, value]) => [
      key,
      typeof stored.sources?.[key] === 'boolean' ? stored.sources[key] : value,
    ]));
    return {
      executeTimeoutMs: Math.max(500, Math.min(10000, Number(stored.executeTimeoutMs) || 5000)),
      queryTimeoutMs: Math.max(300, Math.min(5000, Number(stored.queryTimeoutMs) || 800)),
      shortcut: typeof stored.shortcut === 'string' && stored.shortcut.length <= 100
        ? stored.shortcut
        : 'Alt+Space',
      sources,
    };
  }

  function write(settings) {
    return writeJsonFile(getSettingsPath(fileName), settings);
  }

  return Object.freeze({ read, write });
}

module.exports = { createLauncherSettingsStore };
