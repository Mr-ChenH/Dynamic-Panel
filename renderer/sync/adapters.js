(function exposeSyncAdapters(root, factory) {
const scanner = typeof module !== 'undefined' ? require('./scanner') : root.NotchSyncScanner;
const categories = typeof module !== 'undefined' ? require('./categories') : root.NotchSyncCategories;
const exported = factory(scanner, categories);
root.NotchSyncAdapters = exported;
if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window, function createSyncAdapters({ assertPortableValue }, { normalizeCategories }) {

function text(value, max = 512000) { return String(value == null ? '' : value).slice(0, max); }
function id(value) { const result = text(value, 240).trim(); if (!result) throw new TypeError('entity_id_required'); return result; }
function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function bool(value) { return value === true; }
function strings(value, maxItems = 100) { return (Array.isArray(value) ? value : []).slice(0, maxItems).map((item) => text(item, 240)); }
function parse(raw, fallback) { if (typeof raw !== 'string') return raw == null ? fallback : raw; try { return JSON.parse(raw); } catch (error) { return fallback; } }
function utf8Bytes(value) { const source = String(value); if (typeof TextEncoder === 'function') return new TextEncoder().encode(source).byteLength; return unescape(encodeURIComponent(source)).length; }
function stableDigest(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value); let hash = 2166136261;
  for (let offset = 0; offset < input.length; offset += 1) hash = Math.imul(hash ^ input.charCodeAt(offset), 16777619);
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function stableLegacyId(type, value, index) {
  return `legacy-${type}-${stableDigest(`${type}:${index}:${JSON.stringify(value)}`).slice(8)}`;
}
function entityId(type, value, index = 0) { return value?.id ? id(value.id) : stableLegacyId(type, value, index); }
function objectId(context, purpose, localReference) {
  if (!localReference) return null;
  if (typeof context?.resolveObjectReference !== 'function') throw new TypeError(`unresolved_${purpose}_object`);
  const result = context.resolveObjectReference(purpose, localReference);
  if (!result || typeof result !== 'string') throw new TypeError(`unresolved_${purpose}_object`);
  return id(result);
}
function record(entityType, entityIdValue, category, payload) {
  assertPortableValue(payload);
  return Object.freeze({ entityType, entityId: id(entityIdValue), category, schemaVersion: 1, payload: Object.freeze(payload) });
}

const SERIALIZERS = Object.freeze({
  todo(value, context = {}) { return record('todo', entityId('todo', value, context.index), 'todo', { quadrant: ['P0', 'P1', 'P2', 'P3'].includes(context.quadrant) ? context.quadrant : 'P0', text: text(value?.text, 2000).trim(), done: bool(value?.done), createdAt: number(value?.createdAt), deadline: text(value?.deadline, 48), remindedAt: Math.max(0, number(value?.remindedAt)), sortKey: text(context.sortKey ?? context.index ?? 0, 80) }); },
  todoCategory(value) { return record('todoCategory', id(value?.quadrant), 'todo', { displayName: text(value?.displayName, 80).trim() }); },
  note(value, context = {}) {
    let body = text(value?.content ?? value?.body);
    const imageObjectIds = [];
    body = body.replace(/(!\[[^\]]*\]\()([^\s)]+)(\))/g, (match, prefix, reference, suffix) => {
      if (!/(?:^|\/)note-images\//i.test(reference)) return match;
      const logicalId = objectId(context, 'note-image', reference); imageObjectIds.push(logicalId); return `${prefix}object:${logicalId}${suffix}`;
    });
    return record('note', entityId('note', value, context.index), 'notes', { title: text(value?.title, 80), titleSource: ['model', 'user'].includes(value?.titleSource) ? value.titleSource : '', body, categoryId: text(value?.categoryId, 80), tagId: text(value?.tagId, 80), createdAt: number(value?.createdAt), updatedAt: number(value?.updatedAt), imageObjectIds });
  },
  noteTaxon(value, context = {}) { return record('noteTaxon', entityId('noteTaxon', value, context.index), 'notes', { kind: context.kind === 'tag' ? 'tag' : 'category', name: text(value?.name, 24).trim(), parentId: text(context.parentId, 80) }); },
  link(value, context = {}) { const url = text(value?.url, 4096); const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('invalid_link_url'); return record('link', entityId('link', value, context.index), 'links', { groupId: id(context.groupId), url: parsed.toString(), title: text(value?.title, 500), description: text(value?.description, 4000), tags: strings(value?.tags, 100), favorite: bool(value?.favorite), read: bool(value?.read), note: text(value?.note, 12000), createdAt: number(value?.createdAt), updatedAt: number(value?.updatedAt), lastOpenedAt: number(value?.lastOpenedAt), sortKey: text(context.sortKey ?? context.index ?? 0, 80) }); },
  linkGroup(value, context = {}) { return record('linkGroup', entityId('linkGroup', value, context.index), 'links', { name: text(value?.name, 120).trim(), sortKey: text(context.sortKey ?? context.index ?? 0, 80) }); },
  preference(value) { const key = text(value?.key, 40); if (!['theme', 'features', 'defaultTab'].includes(key)) throw new TypeError('invalid_preference'); let portableValue = value?.value; if (key === 'features') portableValue = Object.fromEntries(Object.entries(portableValue || {}).filter(([, enabled]) => typeof enabled === 'boolean').map(([name, enabled]) => [text(name, 40), enabled])); else portableValue = text(portableValue, 80); return record('preference', key, 'preferences', { key, value: portableValue }); },
  clipboardEntry(value, context = {}) { const type = ['text', 'url', 'image'].includes(value?.type) ? value.type : 'text'; return record('clipboardEntry', entityId('clipboardEntry', value, context.index), 'clipboard', { type, text: type === 'image' ? null : text(value?.text, 12000), imageObjectId: type === 'image' ? objectId(context, 'clipboard-image', value?.imagePath) : null, timestamp: number(value?.timestamp) }); },
  clipboardFavorite(value) { return record('clipboardFavorite', id(value?.entryId), 'clipboard', { entryId: id(value?.entryId) }); },
  screenshot(value, context = {}) { if (value?.kind !== 'screenshot' || value?.status !== 'complete' || value?.mimeType !== 'image/png') throw new TypeError('ineligible_screenshot'); return record('screenshot', entityId('screenshot', value, context.index), 'screenshots', { title: text(value?.title, 200), createdAt: number(value?.createdAt), mimeType: 'image/png', bytes: Math.max(0, number(value?.bytes)), width: Math.max(0, number(value?.width)), height: Math.max(0, number(value?.height)), objectId: objectId(context, 'screenshot', value?.path) }); },
  aiSession(value, context = {}) { const cleanHistory = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ role: row?.role === 'assistant' ? 'assistant' : 'user', content: text(row?.content, 12000) })); const cleanSources = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ sourceType: text(row?.sourceType, 40), sourceId: text(row?.sourceId, 240), sourceTitle: text(row?.sourceTitle, 240), sourceRevision: text(row?.sourceRevision, 120), text: text(row?.text, 12000), detail: text(row?.detail, 12000), updatedAt: number(row?.updatedAt) })); const records = (Array.isArray(value?.records) ? value.records : []).slice(0, 30).map((row, index) => ({ id: entityId('aiRecord', row, index), groupId: text(row?.groupId, 240), prompt: text(row?.prompt, 12000), sources: cleanSources(row?.sources), context: cleanHistory(row?.context), answer: text(row?.answer, 512000), state: ['complete', 'stopped', 'error'].includes(row?.state) ? row.state : 'error', detail: text(row?.detail, 12000), createdAt: number(row?.createdAt) })); return record('aiSession', entityId('aiSession', value, context.index), 'aiSessions', { title: text(value?.title, 200), createdAt: number(value?.createdAt), updatedAt: number(value?.updatedAt), records, history: cleanHistory(value?.history) }); },
  financeWatchlist(value) { const assets = Object.fromEntries(Object.entries(value?.assets || {}).map(([key, asset]) => [text(key, 240), { id: text(asset?.id || key, 240), provider: text(asset?.provider, 40), providerAssetId: text(asset?.providerAssetId, 160), market: text(asset?.market, 20), type: text(asset?.type, 20), symbol: text(asset?.symbol, 32), name: text(asset?.name, 120), exchange: text(asset?.exchange, 40), currency: text(asset?.currency, 8), addedAt: text(asset?.addedAt, 48) }])); const lists = (Array.isArray(value?.lists) ? value.lists : []).map((row) => ({ id: text(row?.id, 80), name: text(row?.name, 40), assetIds: strings(row?.assetIds, 1000) })); const preferences = Object.fromEntries(['defaultView', 'defaultMarket', 'defaultSource', 'defaultRanking', 'refreshSeconds'].filter((key) => value?.preferences?.[key] !== undefined).map((key) => [key, key === 'refreshSeconds' ? number(value.preferences[key]) : text(value.preferences[key], 80)])); return record('financeWatchlist', 'finance', 'finance', { lists, assets, preferences }); },
  command(value, context = {}) { return record('command', entityId('command', value, context.index), 'commands', { text: text(value?.text, 12000), createdAt: number(value?.createdAt) }); },
  launcherFavorite(value) { const resultId = id(value?.resultId); return record('launcherFavorite', resultId, 'launcher', { resultId }); },
  launcherAlias(value) { const resultId = id(value?.resultId); return record('launcherAlias', resultId, 'launcher', { resultId, alias: text(value?.alias, 240) }); },
  weatherLocation(value) { const locationId = id(value?.id || value?.locationId); return record('weatherLocation', locationId, 'location', { name: text(value?.name, 160), country: text(value?.country, 80), admin1: text(value?.admin1, 120), latitude: number(value?.latitude), longitude: number(value?.longitude), timezone: text(value?.timezone, 80) }); },
});

function serializeEntity(entityType, value, context) { const serializer = SERIALIZERS[entityType]; if (!serializer) throw new TypeError(`unsupported_entity_type:${entityType}`); return serializer(value, context); }

function inventoryLocalData(snapshot = {}, categoriesInput, context = {}) {
  const categories = normalizeCategories(categoriesInput); const records = []; const add = (type, value, extra) => records.push(serializeEntity(type, value, { ...context, ...extra }));
  if (categories.todo) {
    const todo = parse(snapshot['notch-todo-data'], {}); for (const quadrant of ['P0', 'P1', 'P2', 'P3']) (Array.isArray(todo?.[quadrant]) ? todo[quadrant] : []).forEach((value, index) => add('todo', value, { quadrant, index }));
    const names = parse(snapshot['notch-todo-category-names-v1'], {}); for (const quadrant of ['P0', 'P1', 'P2', 'P3']) add('todoCategory', { quadrant, displayName: names?.[quadrant] || '' });
  }
  if (categories.notes) {
    (parse(snapshot['notch-note-archive-v1'], []) || []).forEach((value, index) => add('note', value, { index }));
    (parse(snapshot['notch-note-categories-v1'], []) || []).forEach((value, index) => { add('noteTaxon', value, { index, kind: 'category' }); (value?.tags || []).forEach((tag, tagIndex) => add('noteTaxon', tag, { index: tagIndex, kind: 'tag', parentId: value.id })); });
  }
  if (categories.links) (parse(snapshot['notch-link-groups'], []) || []).forEach((group, index) => { const groupId = entityId('linkGroup', group, index); add('linkGroup', group, { index }); (group?.links || []).forEach((link, linkIndex) => add('link', link, { groupId, index: linkIndex })); });
  if (categories.preferences) for (const key of ['theme', 'features', 'defaultTab']) if (context.settings?.[key] !== undefined) add('preference', { key, value: context.settings[key] });
  if (categories.clipboard) { (parse(snapshot['notch-clip-history'], []) || []).forEach((value, index) => add('clipboardEntry', value, { index })); (parse(snapshot['notch-clip-favorites'], []) || []).forEach((entryId) => add('clipboardFavorite', { entryId })); }
  if (categories.screenshots) (context.screenshots || []).filter((row) => row?.kind === 'screenshot' && row?.status === 'complete').forEach((value, index) => add('screenshot', value, { index }));
  if (categories.aiSessions) { const store = parse(snapshot['notch-ai-chat-sessions-v1'], {}); (Array.isArray(store) ? store : store?.sessions || []).forEach((value, index) => add('aiSession', value, { index })); }
  if (categories.finance) add('financeWatchlist', { ...(parse(snapshot['notch-finance-watchlists-v1'], {}) || {}), preferences: parse(snapshot['notch-finance-view-preferences-v1'], {}) || {} });
  if (categories.commands) (parse(snapshot['notch-home-commands'], []) || []).forEach((value, index) => add('command', value, { index }));
  if (categories.launcher) { (parse(snapshot['notch-launcher-favorites-v1'], []) || []).forEach((resultId) => add('launcherFavorite', { resultId })); for (const [resultId, alias] of Object.entries(parse(snapshot['notch-launcher-aliases-v1'], {}) || {})) add('launcherAlias', { resultId, alias }); }
  if (categories.location) { const location = parse(snapshot['notch-home-weather-v1'], null); if (location) add('weatherLocation', location); }
  const byCategory = {}; for (const item of records) { const row = byCategory[item.category] ||= { records: 0, bytes: 0, digest: '' }; row.records += 1; row.bytes += utf8Bytes(JSON.stringify(item)); }
  for (const [category, row] of Object.entries(byCategory)) row.digest = stableDigest(records.filter((item) => item.category === category));
  return Object.freeze({ records: Object.freeze(records), categories: Object.freeze(byCategory), totalRecords: records.length, totalBytes: Object.values(byCategory).reduce((sum, row) => sum + row.bytes, 0) });
}

return Object.freeze({ SERIALIZERS, serializeEntity, inventoryLocalData, stableDigest, stableLegacyId });
});
