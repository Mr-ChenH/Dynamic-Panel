(function exposeSyncProjection(root, factory) {
const adapters = typeof module !== 'undefined' ? require('./adapters') : root.NotchSyncAdapters;
const scanner = typeof module !== 'undefined' ? require('./scanner') : root.NotchSyncScanner;
const exported = factory(adapters, scanner);
root.NotchSyncProjection = exported;
if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window, function createSyncProjection({ SERIALIZERS }, { assertPortableValue }) {

const REMOTE_PAYLOAD_KEYS = Object.freeze({
  todo: ['quadrant', 'text', 'done', 'createdAt', 'deadline', 'remindedAt', 'sortKey'], todoCategory: ['displayName'],
  note: ['title', 'titleSource', 'body', 'categoryId', 'tagId', 'createdAt', 'updatedAt', 'imageObjectIds'], noteTaxon: ['kind', 'name', 'parentId'],
  link: ['groupId', 'url', 'title', 'description', 'tags', 'favorite', 'read', 'note', 'createdAt', 'updatedAt', 'lastOpenedAt', 'sortKey'], linkGroup: ['name', 'sortKey'],
  preference: ['key', 'value'], clipboardEntry: ['type', 'text', 'imageObjectId', 'timestamp'], clipboardFavorite: ['entryId'],
  screenshot: ['title', 'createdAt', 'mimeType', 'bytes', 'width', 'height', 'objectId'], aiSession: ['title', 'createdAt', 'updatedAt', 'records', 'history'],
  financeWatchlist: ['lists', 'assets', 'preferences'], command: ['text', 'createdAt'], launcherFavorite: ['resultId'], launcherAlias: ['resultId', 'alias'],
  weatherLocation: ['name', 'country', 'admin1', 'latitude', 'longitude', 'timezone'],
});

function changeMarker(change) {
  const record = change?.record || change;
  return `${record.entityType}:${record.entityId}:${record.revision ?? change.sequence ?? '0'}:${record.deleted === true ? 'd' : 'u'}`;
}

function validateRemoteChange(change) {
  const record = change?.record || change;
  if (!record || typeof record !== 'object' || !SERIALIZERS[record.entityType]) throw new TypeError('unsupported_remote_entity');
  if (record.schemaVersion !== 1) throw new TypeError('unsupported_remote_schema');
  if (!record.entityId || !record.category || !Number.isInteger(record.revision) || record.revision < 1) throw new TypeError('invalid_remote_record');
  if (record.payload != null) {
    if (typeof record.payload !== 'object' || Array.isArray(record.payload)) throw new TypeError('invalid_remote_payload');
    const allowed = new Set(REMOTE_PAYLOAD_KEYS[record.entityType]);
    for (const key of Object.keys(record.payload)) if (!allowed.has(key)) throw new TypeError(`unknown_remote_payload_property:${key}`);
    assertPortableValue(record.payload);
  } else if (record.deleted !== true) throw new TypeError('invalid_remote_payload');
  return record;
}

async function projectInboxBatch({ state, batch, adapters, isGenerationCurrent = () => true, requestWorkspaceSnapshot = async () => {}, fault = () => {} }) {
  if (!state || !batch) throw new TypeError('state_and_batch_required');
  await state.stageInbox(batch);
  fault('after-stage');
  for (let index = 0; index < batch.changes.length; index += 1) {
    if (!isGenerationCurrent()) throw new TypeError('binding_generation_cancelled');
    const change = batch.changes[index];
    const marker = changeMarker(change);
    const alreadyProjected = await state.tx(['inboxBatches'], async (tx) => (await tx.get('inboxBatches', batch.batchId))?.projected?.includes(marker));
    if (alreadyProjected) continue;
    if (change?.kind === 'conflict' && change.conflict?.conflictId) {
      assertPortableValue(change.conflict.currentPayload);
      assertPortableValue(change.conflict.incomingPayload);
      await state.tx(['inboxBatches', 'conflicts'], async (tx) => {
        const row = await tx.get('inboxBatches', batch.batchId);
        if (!row || row.state !== 'applying') throw new TypeError('inbox_batch_not_applying');
        row.projected.push(marker);
        await tx.put('inboxBatches', batch.batchId, row);
        await tx.put('conflicts', change.conflict.conflictId, change.conflict);
      });
      continue;
    }
    let record;
    try { record = validateRemoteChange(change); } catch (error) {
      await state.quarantine(`${batch.batchId}:${index}`, change, error.message);
      throw error;
    }
    if (!alreadyProjected) {
      const adapter = adapters?.[record.entityType];
      if (!adapter || typeof adapter.apply !== 'function') { await state.quarantine(`${batch.batchId}:${index}`, change, 'missing_projection_adapter'); throw new TypeError('missing_projection_adapter'); }
      await adapter.apply(record, { remote: true, batchId: batch.batchId });
      fault(`after-apply:${index}`);
      await state.tx(['inboxBatches', 'entityMirror', 'conflicts', 'objectMap'], async (tx) => {
        const row = await tx.get('inboxBatches', batch.batchId);
        if (!row || row.state !== 'applying') throw new TypeError('inbox_batch_not_applying');
        if (!row.projected.includes(marker)) row.projected.push(marker);
        await tx.put('inboxBatches', batch.batchId, row);
        await tx.put('entityMirror', `${record.entityType}:${record.entityId}`, { revision: record.revision, deleted: record.deleted === true, payload: record.payload || null });
        if (change.conflict) await tx.put('conflicts', change.conflict.conflictId, change.conflict);
        for (const descriptor of change.objects || []) await tx.put('objectMap', descriptor.objectId, descriptor);
      });
      fault(`after-marker:${index}`);
    }
  }
  if (!isGenerationCurrent()) throw new TypeError('binding_generation_cancelled');
  await state.tx(['inboxBatches', 'cursors'], async (tx) => {
    const row = await tx.get('inboxBatches', batch.batchId);
    if (!row || row.projected.length !== batch.changes.length) throw new TypeError('inbox_batch_incomplete');
    await tx.put('cursors', 'committed', { cursor: batch.nextCursor, upperCursor: batch.upperCursor || null, restoreEpoch: batch.restoreEpoch });
    row.state = 'complete'; row.snapshotPending = true; await tx.put('inboxBatches', batch.batchId, row);
  });
  fault('after-commit');
  await requestWorkspaceSnapshot();
  await state.tx(['inboxBatches'], (tx) => tx.delete('inboxBatches', batch.batchId));
  return Object.freeze({ batchId: batch.batchId, cursor: batch.nextCursor, projected: batch.changes.length });
}

return Object.freeze({ REMOTE_PAYLOAD_KEYS, changeMarker, validateRemoteChange, projectInboxBatch });
});
