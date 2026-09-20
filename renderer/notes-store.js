(function exposeNotesStore() {
  const DEFAULT_KEYS = Object.freeze({
    archive: 'notch-note-archive-v1',
    categories: 'notch-note-categories-v1',
  });

  function createStore(host = {}) {
    const storage = host.storage || window.localStorage;
    const domain = host.domain || window.NotchDomain;
    const keys = { ...DEFAULT_KEYS, ...(host.keys || {}) };

    function readJson(key, fallback) {
      try {
        const parsed = JSON.parse(storage.getItem(key) || 'null');
        return parsed === null ? fallback : parsed;
      } catch (error) {
        return fallback;
      }
    }

    function loadCategories() {
      return domain.normalizeNoteCategories(readJson(keys.categories, []));
    }

    function loadArchive() {
      const parsed = domain.normalizeNoteArchive(readJson(keys.archive, []));
      const categories = new Map(loadCategories().map((category) => [
        category.id,
        new Set(category.tags.map((tag) => tag.id)),
      ]));
      return parsed.map((note) => {
        const tags = categories.get(note.categoryId);
        if (!tags) return { ...note, categoryId: '', tagId: '' };
        return tags.has(note.tagId) ? note : { ...note, tagId: '' };
      });
    }

    function saveArchive(notes) {
      const normalized = domain.normalizeNoteArchive(notes).slice(0, 200);
      storage.setItem(keys.archive, JSON.stringify(normalized));
      return normalized;
    }

    function saveCategories(categories) {
      const normalized = domain.normalizeNoteCategories(categories);
      storage.setItem(keys.categories, JSON.stringify(normalized));
      return normalized;
    }

    function categoryName(note, categories = loadCategories()) {
      return categories.find((category) => category.id === String(note?.categoryId || ''))?.name || '未分类';
    }

    function tagName(note, categories = loadCategories()) {
      const category = categories.find((item) => item.id === String(note?.categoryId || ''));
      return category?.tags.find((tag) => tag.id === String(note?.tagId || ''))?.name || '';
    }

    return Object.freeze({
      keys: Object.freeze({ ...keys }),
      loadCategories,
      loadArchive,
      saveArchive,
      saveCategories,
      categoryName,
      tagName,
    });
  }

  window.NotchNotesStore = Object.freeze({ createStore });
})();
