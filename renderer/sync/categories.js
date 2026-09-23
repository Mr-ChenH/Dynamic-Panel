(function exposeSyncCategories(root, factory) {
const exported = factory();
root.NotchSyncCategories = exported;
if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window, function createSyncCategories() {
const CATEGORY_POLICY = Object.freeze({
  todo: Object.freeze({ defaultEnabled: true, entityTypes: ['todo', 'todoCategory'] }),
  notes: Object.freeze({ defaultEnabled: true, entityTypes: ['note', 'noteTaxon'], objects: ['note-image'] }),
  links: Object.freeze({ defaultEnabled: true, entityTypes: ['link', 'linkGroup'] }),
  preferences: Object.freeze({ defaultEnabled: true, entityTypes: ['preference'] }),
  clipboard: Object.freeze({ defaultEnabled: false, entityTypes: ['clipboardEntry', 'clipboardFavorite'], objects: ['clipboard-image'], atomic: true }),
  screenshots: Object.freeze({ defaultEnabled: false, entityTypes: ['screenshot'], objects: ['screenshot'] }),
  aiSessions: Object.freeze({ defaultEnabled: false, entityTypes: ['aiSession'] }),
  finance: Object.freeze({ defaultEnabled: false, entityTypes: ['financeWatchlist'] }),
  commands: Object.freeze({ defaultEnabled: false, entityTypes: ['command'] }),
  launcher: Object.freeze({ defaultEnabled: false, entityTypes: ['launcherFavorite', 'launcherAlias'] }),
  location: Object.freeze({ defaultEnabled: false, entityTypes: ['weatherLocation'] }),
});

function defaultCategories() {
  return Object.fromEntries(Object.entries(CATEGORY_POLICY).map(([name, policy]) => [name, policy.defaultEnabled]));
}

function normalizeCategories(value = {}) {
  const result = defaultCategories();
  for (const [name, enabled] of Object.entries(value || {})) {
    if (!Object.hasOwn(CATEGORY_POLICY, name) || typeof enabled !== 'boolean') throw new TypeError(`invalid_category:${name}`);
    result[name] = enabled;
  }
  return Object.freeze(result);
}

function categoryAllows(categories, entityType) {
  const policy = Object.entries(CATEGORY_POLICY).find(([, row]) => row.entityTypes.includes(entityType));
  return Boolean(policy && normalizeCategories(categories)[policy[0]]);
}

return Object.freeze({ CATEGORY_POLICY, defaultCategories, normalizeCategories, categoryAllows });
});
