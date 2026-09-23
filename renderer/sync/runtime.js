(function exposeSyncRuntime(root) {
  'use strict';

  const { CATEGORY_POLICY } = root.NotchSyncCategories;
  const { inventoryLocalData } = root.NotchSyncAdapters;
  const { DurableSyncState } = root.NotchSyncState;
  const { IndexedDbTransactionalStore } = root.NotchSyncIndexedDb;
  const { projectInboxBatch } = root.NotchSyncProjection;
  const database = new IndexedDbTransactionalStore();
  const states = new Map();
  let context = null;
  let projecting = false;
  let scanning = null;
  let timer = null;
  let projectionUnsubscribe = null;
  let workspaceUnsubscribe = null;

  const api = () => root.notchAPI?.sync;
  const parse = (key, fallback) => { try { return JSON.parse(root.localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const canonical = (value) => value && typeof value === 'object' ? (Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))) : value;
  const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  const stateFor = (namespace) => { if (!states.has(namespace)) states.set(namespace, new DurableSyncState(database, namespace)); return states.get(namespace); };

  function storageSnapshot() {
    const snapshot = {};
    for (let index = 0; index < root.localStorage.length; index += 1) {
      const key = root.localStorage.key(index);
      if (key) snapshot[key] = root.localStorage.getItem(key);
    }
    return snapshot;
  }

  function writeJson(key, value) {
    const serialized = value == null ? null : JSON.stringify(value);
    if (serialized == null) root.localStorage.removeItem(key); else root.localStorage.setItem(key, serialized);
    try { root.dispatchEvent(new StorageEvent('storage', { key, newValue: serialized, storageArea: root.localStorage, url: root.location.href })); } catch {}
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    if (root.crypto?.subtle) {
      const result = await root.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(result)].map((part) => part.toString(16).padStart(2, '0')).join('');
    }
    let a = 2166136261, b = 2246822519;
    for (const part of bytes) { a = Math.imul(a ^ part, 16777619); b = Math.imul(b ^ part, 3266489917); }
    return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
  }

  async function currentContext() {
    const next = await api()?.getRuntimeContext?.();
    context = next?.configured ? next : null;
    return context;
  }

  async function captures() {
    try {
      const result = await root.notchAPI?.capture?.list?.();
      return Array.isArray(result) ? result : Array.isArray(result?.value) ? result.value : [];
    } catch { return []; }
  }

  function cleanReference(value) {
    let result = String(value || '').replace(/^\.\//, '');
    try { result = decodeURIComponent(result); } catch {}
    return result;
  }

  async function mediaReferences(snapshot, categories, screenshotRows) {
    const rows = new Map();
    if (categories.notes) {
      const notes = (() => { try { return JSON.parse(snapshot['notch-note-archive-v1'] || '[]'); } catch { return []; } })();
      for (const note of Array.isArray(notes) ? notes : []) {
        const body = String(note?.content ?? note?.body ?? '');
        for (const match of body.matchAll(/!\[[^\]]*\]\(([^\s)]+)\)/g)) {
          const relativePath = cleanReference(match[1]);
          if (/^note-images\//i.test(relativePath)) rows.set(relativePath, { relativePath, purpose: 'note-image' });
        }
      }
    }
    if (categories.clipboard) {
      const history = (() => { try { return JSON.parse(snapshot['notch-clip-history'] || '[]'); } catch { return []; } })();
      for (const entry of Array.isArray(history) ? history : []) if (entry?.type === 'image' && entry.imagePath) {
        const relativePath = cleanReference(entry.imagePath);
        rows.set(relativePath, { relativePath, purpose: 'clipboard-image' });
      }
    }
    if (categories.screenshots) for (const screenshot of screenshotRows) if (screenshot?.kind === 'screenshot' && screenshot?.status === 'complete' && screenshot.path) {
      const relativePath = cleanReference(screenshot.path);
      rows.set(relativePath, { relativePath, purpose: 'screenshot' });
    }
    return [...rows.values()];
  }

  async function ensureMedia(state, references) {
    const mapping = new Map();
    for (const reference of references) {
      const key = `local:${reference.relativePath}`;
      let descriptor = await state.tx(['objectMap'], (tx) => tx.get('objectMap', key));
      if (!descriptor?.objectId) {
        const uploaded = await api()?.uploadObject?.(reference);
        if (!uploaded || uploaded.ok === false || !uploaded.objectId) throw Object.assign(new Error(uploaded?.error?.code || 'object_upload_failed'), { code: uploaded?.error?.code || 'object_upload_failed' });
        descriptor = { ...uploaded.descriptor, objectId: uploaded.objectId, relativePath: reference.relativePath, purpose: reference.purpose };
        await state.tx(['objectMap'], async (tx) => { await tx.put('objectMap', key, descriptor); await tx.put('objectMap', descriptor.objectId, descriptor); });
      }
      mapping.set(reference.relativePath, descriptor.objectId);
    }
    return mapping;
  }

  async function inventory() {
    const active = await currentContext();
    const categories = active?.categories || Object.fromEntries(Object.entries(CATEGORY_POLICY).map(([name, policy]) => [name, policy.defaultEnabled]));
    const snapshot = storageSnapshot();
    const screenshotRows = categories.screenshots ? await captures() : [];
    const references = await mediaReferences(snapshot, categories, screenshotRows);
    let objectMapping = new Map();
    if (active) objectMapping = await ensureMedia(stateFor(active.namespace), references);
    else references.forEach((reference, index) => objectMapping.set(reference.relativePath, `pending:${index}`));
    let settings = {};
    try { settings = await root.notchAPI?.settings?.get?.() || {}; } catch {}
    return inventoryLocalData(snapshot, categories, {
      settings: { theme: settings.theme, features: settings.features, defaultTab: settings.defaultTab },
      screenshots: screenshotRows,
      resolveObjectReference(_purpose, reference) { return objectMapping.get(cleanReference(reference)); },
    });
  }

  function enabledEntityTypes(categories) {
    const result = new Set();
    for (const [name, policy] of Object.entries(CATEGORY_POLICY)) if (categories?.[name]) for (const type of policy.entityTypes) result.add(type);
    return result;
  }

  async function scanNow() {
    if (projecting) return { ok: false, skipped: 'projecting' };
    if (scanning) return scanning;
    scanning = (async () => {
      const active = await currentContext();
      if (!active) return { ok: false, skipped: 'disconnected' };
      const state = stateFor(active.namespace);
      const local = await inventory();
      if (!context || context.namespace !== active.namespace || context.generation !== active.generation) return { ok: false, skipped: 'generation_changed' };
      const current = new Map(local.records.map((record) => [`${record.entityType}:${record.entityId}`, record]));
      const mirrorEntries = await state.tx(['entityMirror'], (tx) => tx.entries('entityMirror'));
      const mirror = new Map(mirrorEntries);
      let queued = 0;
      for (const [key, record] of current) {
        const previous = mirror.get(key);
        if (previous && previous.deleted !== true && same(previous.payload, record.payload)) continue;
        const baseRevision = Number.isInteger(previous?.revision) ? previous.revision : 0;
        const operationId = `local:${(await digest({ namespace: active.namespace, key, baseRevision, payload: record.payload })).slice(0, 64)}`;
        const operation = { operationId, entityType: record.entityType, entityId: record.entityId, category: record.category, schemaVersion: record.schemaVersion, baseRevision, kind: 'upsert', payload: record.payload };
        const result = await api()?.enqueue?.(operation);
        if (result?.ok === false) throw Object.assign(new Error(result.error?.code || 'sync_enqueue_failed'), { code: result.error?.code || 'sync_enqueue_failed' });
        queued += 1;
      }
      const allowedTypes = enabledEntityTypes(active.categories);
      for (const [key, previous] of mirror) {
        if (current.has(key) || previous?.deleted === true) continue;
        const separator = key.indexOf(':');
        const entityType = key.slice(0, separator), entityId = key.slice(separator + 1);
        if (!allowedTypes.has(entityType) || !Number.isInteger(previous?.revision)) continue;
        const operationId = `local:${(await digest({ namespace: active.namespace, key, baseRevision: previous.revision, deleted: true })).slice(0, 64)}`;
        const operation = { operationId, entityType, entityId, category: previous.category || Object.entries(CATEGORY_POLICY).find(([, policy]) => policy.entityTypes.includes(entityType))?.[0], schemaVersion: 1, baseRevision: previous.revision, kind: 'delete' };
        const result = await api()?.enqueue?.(operation);
        if (result?.ok === false) throw Object.assign(new Error(result.error?.code || 'sync_enqueue_failed'), { code: result.error?.code || 'sync_enqueue_failed' });
        queued += 1;
      }
      return { ok: true, inventory: local, queued };
    })().finally(() => { scanning = null; });
    return scanning;
  }

  function listValue(key) { const value = parse(key, []); return Array.isArray(value) ? value : []; }
  function upsert(list, id, value) { const index = list.findIndex((row) => row?.id === id); if (index < 0) list.push(value); else list[index] = { ...list[index], ...value }; return list; }
  function remove(list, id) { return list.filter((row) => row?.id !== id); }

  async function saveDownloadedObject(state, relativePath, objectId, result, purpose) {
    const descriptor = { ...(result?.descriptor || {}), objectId, relativePath, purpose };
    await state.tx(['objectMap'], async (tx) => { await tx.put('objectMap', `local:${relativePath}`, descriptor); await tx.put('objectMap', objectId, descriptor); });
  }

  function createProjectionAdapters(state) {
    return {
      todo: { async apply(record) {
        const data = parse('notch-todo-data', {}); for (const quadrant of ['P0', 'P1', 'P2', 'P3']) data[quadrant] = (Array.isArray(data[quadrant]) ? data[quadrant] : []).filter((row) => row?.id !== record.entityId);
        if (!record.deleted) { const payload = record.payload; const quadrant = payload.quadrant; data[quadrant].push({ id: record.entityId, text: payload.text, done: payload.done, createdAt: payload.createdAt, deadline: payload.deadline, remindedAt: payload.remindedAt }); }
        writeJson('notch-todo-data', data);
      } },
      todoCategory: { async apply(record) { const data = parse('notch-todo-category-names-v1', {}); if (record.deleted) delete data[record.entityId]; else data[record.entityId] = record.payload.displayName; writeJson('notch-todo-category-names-v1', data); } },
      note: { async apply(record) {
        let notes = listValue('notch-note-archive-v1');
        if (record.deleted) notes = remove(notes, record.entityId);
        else {
          let body = record.payload.body; const imagePaths = [];
          for (const objectId of record.payload.imageObjectIds || []) {
            const relativePath = `note-images/${record.entityId}/${objectId}.png`;
            const downloaded = await api()?.downloadObject?.({ objectId, purpose: 'note-image', relativePath });
            if (!downloaded || downloaded.ok === false) throw Object.assign(new Error(downloaded?.error?.code || 'object_download_failed'), { code: downloaded?.error?.code || 'object_download_failed' });
            await saveDownloadedObject(state, relativePath, objectId, downloaded, 'note-image');
            body = body.replaceAll(`object:${objectId}`, relativePath); imagePaths.push(relativePath);
          }
          notes = upsert(notes, record.entityId, { id: record.entityId, title: record.payload.title, titleSource: record.payload.titleSource, content: body, categoryId: record.payload.categoryId, tagId: record.payload.tagId, createdAt: record.payload.createdAt, updatedAt: record.payload.updatedAt, imagePaths });
        }
        writeJson('notch-note-archive-v1', notes);
      } },
      noteTaxon: { async apply(record) {
        let categories = listValue('notch-note-categories-v1');
        for (const category of categories) category.tags = Array.isArray(category.tags) ? category.tags : [];
        if (record.payload?.kind === 'tag' || (!record.payload && categories.some((category) => category.tags.some((tag) => tag.id === record.entityId)))) {
          for (const category of categories) category.tags = remove(category.tags, record.entityId);
          if (!record.deleted) { let parent = categories.find((row) => row.id === record.payload.parentId); if (!parent) { parent = { id: record.payload.parentId, name: '', tags: [] }; categories.push(parent); } upsert(parent.tags, record.entityId, { id: record.entityId, name: record.payload.name }); }
        } else {
          if (record.deleted) categories = remove(categories, record.entityId); else categories = upsert(categories, record.entityId, { id: record.entityId, name: record.payload.name, tags: categories.find((row) => row.id === record.entityId)?.tags || [] });
        }
        writeJson('notch-note-categories-v1', categories);
      } },
      linkGroup: { async apply(record) { let groups = listValue('notch-link-groups'); if (record.deleted) groups = remove(groups, record.entityId); else groups = upsert(groups, record.entityId, { id: record.entityId, name: record.payload.name, links: groups.find((row) => row.id === record.entityId)?.links || [] }); writeJson('notch-link-groups', groups); } },
      link: { async apply(record) {
        const groups = listValue('notch-link-groups'); for (const group of groups) group.links = remove(Array.isArray(group.links) ? group.links : [], record.entityId);
        if (!record.deleted) { let group = groups.find((row) => row.id === record.payload.groupId); if (!group) { group = { id: record.payload.groupId, name: '', links: [] }; groups.push(group); } group.links.push({ id: record.entityId, ...record.payload }); }
        writeJson('notch-link-groups', groups);
      } },
      preference: { async apply(record) {
        if (record.deleted) return;
        if (record.payload.key === 'theme') await root.notchAPI?.settings?.setTheme?.(record.payload.value);
        else if (record.payload.key === 'defaultTab') await root.notchAPI?.settings?.setDefaultTab?.(record.payload.value);
        else if (record.payload.key === 'features') for (const [name, enabled] of Object.entries(record.payload.value || {})) await root.notchAPI?.settings?.setFeature?.(name, enabled);
      } },
      clipboardEntry: { async apply(record) { let rows = listValue('notch-clip-history'); if (record.deleted) rows = remove(rows, record.entityId); else { let imagePath = null; if (record.payload.imageObjectId) { imagePath = `clipboard-images/sync-${record.payload.imageObjectId}.png`; const result = await api()?.downloadObject?.({ objectId: record.payload.imageObjectId, purpose: 'clipboard-image', relativePath: imagePath }); if (!result || result.ok === false) throw Object.assign(new Error(result?.error?.code || 'object_download_failed'), { code: result?.error?.code || 'object_download_failed' }); await saveDownloadedObject(state, imagePath, record.payload.imageObjectId, result, 'clipboard-image'); } rows = upsert(rows, record.entityId, { id: record.entityId, type: record.payload.type, text: record.payload.text, imagePath, timestamp: record.payload.timestamp }); } writeJson('notch-clip-history', rows); } },
      clipboardFavorite: { async apply(record) { const values = new Set(listValue('notch-clip-favorites')); if (record.deleted) values.delete(record.entityId); else values.add(record.payload.entryId); writeJson('notch-clip-favorites', [...values]); } },
      screenshot: { async apply(record) {
        if (record.deleted) { await root.notchAPI?.capture?.delete?.(record.entityId); return; }
        const relativePath = `captures/screenshots/${record.entityId}.png`;
        const result = await api()?.downloadObject?.({ objectId: record.payload.objectId, purpose: 'screenshot', relativePath, screenshot: { entityId: record.entityId, title: record.payload.title, createdAt: record.payload.createdAt, width: record.payload.width, height: record.payload.height } });
        if (!result || result.ok === false) throw Object.assign(new Error(result?.error?.code || 'object_download_failed'), { code: result?.error?.code || 'object_download_failed' });
        await saveDownloadedObject(state, relativePath, record.payload.objectId, result, 'screenshot');
      } },
      aiSession: { async apply(record) { const store = parse('notch-ai-chat-sessions-v1', { schemaVersion: 1, sessions: [] }); let sessions = Array.isArray(store) ? store : Array.isArray(store.sessions) ? store.sessions : []; sessions = record.deleted ? remove(sessions, record.entityId) : upsert(sessions, record.entityId, { id: record.entityId, ...record.payload }); writeJson('notch-ai-chat-sessions-v1', { schemaVersion: 1, sessions }); } },
      financeWatchlist: { async apply(record) { if (record.deleted) { root.localStorage.removeItem('notch-finance-watchlists-v1'); root.localStorage.removeItem('notch-finance-view-preferences-v1'); } else { writeJson('notch-finance-watchlists-v1', { lists: record.payload.lists, assets: record.payload.assets }); writeJson('notch-finance-view-preferences-v1', record.payload.preferences); } } },
      command: { async apply(record) { let rows = listValue('notch-home-commands'); rows = record.deleted ? remove(rows, record.entityId) : upsert(rows, record.entityId, { id: record.entityId, ...record.payload }); writeJson('notch-home-commands', rows); } },
      launcherFavorite: { async apply(record) { const values = new Set(listValue('notch-launcher-favorites-v1')); if (record.deleted) values.delete(record.entityId); else values.add(record.payload.resultId); writeJson('notch-launcher-favorites-v1', [...values]); } },
      launcherAlias: { async apply(record) { const values = parse('notch-launcher-aliases-v1', {}); if (record.deleted) delete values[record.entityId]; else values[record.payload.resultId] = record.payload.alias; writeJson('notch-launcher-aliases-v1', values); } },
      weatherLocation: { async apply(record) { if (record.deleted) root.localStorage.removeItem('notch-home-weather-v1'); else writeJson('notch-home-weather-v1', { id: record.entityId, ...record.payload }); } },
    };
  }

  async function applyBatch(batch) {
    const active = await currentContext();
    if (!active || batch.namespace !== active.namespace) throw Object.assign(new Error('binding_generation_cancelled'), { code: 'binding_generation_cancelled' });
    const generation = active.generation;
    projecting = true;
    try {
      const result = await projectInboxBatch({
        state: stateFor(active.namespace),
        batch,
        adapters: createProjectionAdapters(stateFor(active.namespace)),
        isGenerationCurrent: () => context?.namespace === active.namespace && context?.generation === generation,
        requestWorkspaceSnapshot: async () => root.notchAPI?.saveWorkspaceData?.(storageSnapshot()),
      });
      root.dispatchEvent(new CustomEvent('sync:data-changed', { detail: { batchId: batch.batchId } }));
      return result;
    } finally { projecting = false; }
  }

  async function start() {
    projectionUnsubscribe ||= api()?.onApplyBatch?.(applyBatch) || null;
    workspaceUnsubscribe ||= root.notchAPI?.onWorkspaceChanged?.(() => { context = null; void scanNow(); }) || null;
    if (!timer) timer = root.setInterval(() => { void scanNow().catch(() => {}); }, 2000);
    await currentContext().catch(() => null);
    root.setTimeout(() => { void scanNow().catch(() => {}); }, 500);
  }

  function dispose() {
    projectionUnsubscribe?.(); workspaceUnsubscribe?.(); projectionUnsubscribe = null; workspaceUnsubscribe = null;
    if (timer) root.clearInterval(timer); timer = null;
  }

  const exported = Object.freeze({ start, dispose, inventory, scanNow, applyBatch });
  root.NotchSyncRuntime = exported;
  void start();
})(window);
