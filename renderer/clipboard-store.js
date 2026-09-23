(function exposeClipboardStore() {
  const HISTORY_KEY = 'notch-clip-history';
  const FAVORITES_KEY = 'notch-clip-favorites';
  const DEFAULT_MAX_ENTRIES = 100;

  function normalizeEntry(entry, generateId) {
    if (!entry || typeof entry !== 'object') return null;
    const type = ['text', 'url', 'image'].includes(entry.type) ? entry.type : 'text';
    const text = typeof entry.text === 'string' ? entry.text : null;
    const imagePath = typeof entry.imagePath === 'string' ? entry.imagePath : null;
    if (type === 'image' ? !imagePath : text === null) return null;
    return {
      id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
      type,
      text,
      imagePath,
      timestamp: Number.isFinite(entry.timestamp) && !Number.isNaN(new Date(entry.timestamp).getTime())
        ? entry.timestamp
        : Date.now(),
    };
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed === null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function createController(host = {}) {
    const generateId = host.generateId || (() => `${Date.now()}-${Math.random()}`);
    const domain = host.Domain || window.NotchDomain;
    const notchApi = host.notchAPI || window.notchAPI;
    const maxEntries = Number.isInteger(host.maxEntries) && host.maxEntries > 0
      ? host.maxEntries
      : DEFAULT_MAX_ENTRIES;
    let history = [];
    let favorites = [];
    const imageCache = new Map();
    const listeners = new Set();
    let version = 0;

    const notify = (reason) => {
      listeners.forEach((listener) => {
        try { listener({ reason, version }); } catch (error) {}
      });
    };

    const touch = (reason = 'changed') => {
      version += 1;
      notify(reason);
      return version;
    };

    function load() {
      const rawHistory = readJson(HISTORY_KEY, []);
      history = Array.isArray(rawHistory)
        ? rawHistory.map((entry) => normalizeEntry(entry, generateId)).filter(Boolean)
        : [];
      const rawFavorites = readJson(FAVORITES_KEY, []);
      favorites = Array.isArray(rawFavorites)
        ? rawFavorites.filter((id) => typeof id === 'string')
        : [];
    }

    function persistHistory(next = history) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return true;
      } catch (error) {
        return false;
      }
    }

    function persistFavorites(next = favorites) {
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
        return true;
      } catch (error) {
        return false;
      }
    }

    function deleteImageFiles(imagePaths) {
      const paths = [...new Set((Array.isArray(imagePaths) ? imagePaths : []).filter(Boolean))];
      paths.forEach((path) => imageCache.delete(path));
      if (paths.length && typeof notchApi?.deleteClipImages === 'function') {
        notchApi.deleteClipImages(paths).catch(() => {});
      }
      return paths;
    }

    async function preloadImage(imagePath, { notifyChange = true } = {}) {
      if (!imagePath || imageCache.has(imagePath) || typeof notchApi?.readClipImage !== 'function') return null;
      try {
        const dataUrl = await notchApi.readClipImage(imagePath);
        if (!dataUrl) return null;
        imageCache.set(imagePath, dataUrl);
        if (notifyChange) touch('image-loaded');
        return dataUrl;
      } catch (error) {
        return null;
      }
    }

    async function addEntry(raw) {
      const entry = normalizeEntry({
        id: generateId(),
        type: raw?.type || 'text',
        text: raw?.text || null,
        imagePath: raw?.imagePath || null,
        timestamp: Date.now(),
      }, generateId);
      if (!entry) return null;

      const updated = domain.prependClipboardHistory(history, entry, maxEntries);
      const protectedEntries = updated.evicted.filter((item) => favorites.includes(item.id));
      const evicted = updated.evicted.filter((item) => !favorites.includes(item.id));
      history = [...updated.history, ...protectedEntries];
      const evictedPaths = evicted
        .filter((item) => item.type === 'image' && item.imagePath)
        .map((item) => item.imagePath);
      deleteImageFiles(evictedPaths);
      persistHistory();
      if (entry.type === 'image' && entry.imagePath) {
        await preloadImage(entry.imagePath, { notifyChange: false });
      }
      touch('entry-added');
      return { entry, evicted };
    }

    function toggleFavorite(id) {
      const index = favorites.indexOf(id);
      if (index === -1) favorites.push(id);
      else favorites.splice(index, 1);
      persistFavorites();
      touch('favorite-changed');
      return index === -1;
    }

    function removeEntry(id) {
      const index = history.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      const entry = history[index];
      const favoriteIndex = favorites.indexOf(id);
      history.splice(index, 1);
      favorites = favorites.filter((favoriteId) => favoriteId !== id);
      persistHistory();
      persistFavorites();
      touch('entry-removed');
      return { entry, historyIndex: index, favoriteIndex };
    }

    function restoreEntry(snapshot) {
      if (!snapshot?.entry || history.some((entry) => entry.id === snapshot.entry.id)) return false;
      history.splice(Math.min(snapshot.historyIndex, history.length), 0, snapshot.entry);
      if (snapshot.favoriteIndex >= 0) {
        favorites.splice(Math.min(snapshot.favoriteIndex, favorites.length), 0, snapshot.entry.id);
      }
      persistHistory();
      persistFavorites();
      touch('entry-restored');
      return true;
    }

    function clear() {
      const imagePaths = history
        .filter((entry) => entry.type === 'image' && entry.imagePath)
        .map((entry) => entry.imagePath);
      history = [];
      favorites = [];
      imageCache.clear();
      persistHistory([]);
      persistFavorites([]);
      touch('cleared');
      return imagePaths;
    }

    function replaceHistory(next) {
      history = Array.isArray(next) ? next : [];
      touch('history-replaced');
    }

    function replaceFavorites(next) {
      favorites = Array.isArray(next) ? next.filter((id) => typeof id === 'string') : [];
      touch('favorites-replaced');
    }

    load();
    if (typeof notchApi?.onNewClipEntry === 'function') {
      notchApi.onNewClipEntry((raw) => { void addEntry(raw); });
    }

    return Object.freeze({
      history: () => history,
      favorites: () => favorites,
      imageCache: () => imageCache,
      version: () => version,
      setVersion(value) {
        version = Number.isFinite(value) ? value : version;
        notify('version-set');
        return version;
      },
      touch,
      replaceHistory,
      replaceFavorites,
      persistHistory,
      persistFavorites,
      preloadImage,
      addEntry,
      toggleFavorite,
      removeEntry,
      restoreEntry,
      clear,
      deleteImageFiles,
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
  }

  window.NotchClipboardStore = Object.freeze({ createController });
})();
