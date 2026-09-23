import { randomUUID } from 'node:crypto';
import { CursorCodec, CursorError, requestHash } from './cursor.js';
import { CATEGORIES, ENTITY_REGISTRY, ENTITY_TYPES, RecordValidationError, operationSchema, validateEntity } from './schema-registry.js';

const DAY = 86_400_000;
const clone = (value) => value === undefined ? undefined : structuredClone(value);

export class ReplicationError extends Error {
  constructor(statusCode, code, details) { super(code); this.name = 'ReplicationError'; this.statusCode = statusCode; this.code = code; this.details = details; this.retryable = false; }
}

export class RecordReplicationService {
  constructor({ repository, cursorSecret, instanceId, clock = () => new Date(), invalidations, tombstoneDays = 30, conflictDays = 30, changeDays = 90 }) {
    if (tombstoneDays < 30 || conflictDays < 30 || changeDays < 90) throw new TypeError('retention_policy_below_minimum');
    this.repository = repository; this.clock = clock; this.invalidations = invalidations;
    this.retention = Object.freeze({ tombstoneDays, conflictDays, changeDays });
    this.cursors = new CursorCodec({ secret: cursorSecret, instanceId, clock });
  }

  async push(context, operations) {
    this.assertContext(context);
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) throw new ReplicationError(400, 'technical_limit_exceeded', { limit: 100 });
    const results = [];
    for (const candidate of operations) results.push(await this.applyOperation(context, candidate));
    return { results };
  }

  async applyOperation(context, candidate) {
    const parsed = operationSchema.safeParse(candidate);
    if (!parsed.success) return this.rejected(candidate?.operationId, parsed.error.issues.some((issue) => issue.message === 'delete_payload_forbidden') ? 'invalid_operation' : 'invalid_operation');
    const operation = parsed.data;
    let payload;
    try { if (operation.kind !== 'delete') payload = validateEntity(operation); }
    catch (error) { if (error instanceof RecordValidationError) return this.rejected(operation.operationId, error.code, { path: error.path, issues: error.issues }); throw error; }
    const canonical = { ...operation, ...(operation.kind === 'delete' ? {} : { payload }) };
    const hash = requestHash(canonical);
    const now = this.clock().toISOString();
    let notify;
    const result = await this.repository.transaction(context, async (tx) => {
      const prior = await tx.getOperation(context.clientId, operation.operationId);
      if (prior) {
        if (prior.requestHash !== hash) throw new ReplicationError(409, 'operation_reused');
        return { ...prior.result, status: 'duplicate' };
      }
      const current = await tx.getRecord(operation.entityType, operation.entityId);
      const policy = ENTITY_REGISTRY[operation.entityType];
      let outcome;
      if (operation.kind === 'resolveConflict') outcome = await this.resolveConflict(tx, context, operation, payload, current, now);
      else if (this.isStale(operation, current)) outcome = await this.applyStale(tx, context, operation, payload, current, policy, now);
      else outcome = await this.accept(tx, context, operation, operation.kind === 'delete' ? current?.payload ?? null : payload, operation.kind === 'delete', current, now);
      await tx.putOperation(context.clientId, operation.operationId, { requestHash: hash, result: outcome, createdAt: now });
      notify = outcome.sequence ? { accountId: context.accountId, spaceId: context.spaceId, sequence: outcome.sequence, restoreEpoch: (await tx.space()).restoreEpoch } : undefined;
      return outcome;
    });
    if (notify) this.invalidations?.publish(notify);
    return result;
  }

  isStale(operation, current) {
    const base = operation.baseRevision ?? 0;
    return current ? base !== current.revision : base !== 0;
  }

  async applyStale(tx, context, operation, payload, current, policy, now) {
    const base = await tx.getVersion(operation.entityType, operation.entityId, operation.baseRevision ?? 0);
    if (policy.merge === 'lww' && operation.kind === 'upsert') return this.accept(tx, context, operation, payload, false, current, now);
    if (!current || !base || current.deleted || operation.kind === 'delete') return this.conflict(tx, context, operation, payload, current, base, now, current?.deleted ? 'stale_edit_after_delete' : 'stale_revision');
    const merged = mergeFields(base.payload, current.payload, payload);
    if (!merged.conflicting.length) return this.accept(tx, context, operation, merged.payload, false, current, now, { merged: true });
    return this.conflict(tx, context, operation, payload, current, base, now, policy.merge === 'copy' ? 'conflict_copy' : 'field_conflict', merged.conflicting);
  }

  async accept(tx, context, operation, payload, deleted, current, now, extra = {}) {
    const revision = (current?.revision ?? 0) + 1;
    const sequence = await tx.nextSequence();
    const retainUntil = deleted ? new Date(Date.parse(now) + this.retention.tombstoneDays * DAY).toISOString() : null;
    const record = { spaceId: context.spaceId, entityType: operation.entityType, entityId: operation.entityId, category: operation.category, schemaVersion: operation.schemaVersion, revision, updatedAt: now, originClientId: context.clientId, deleted, payload: clone(payload), sequence, retainUntil };
    const version = { ...record, baseRevision: operation.baseRevision ?? 0, operationId: operation.operationId };
    await tx.putVersion(version); await tx.putRecord(record);
    const categoryRows = await tx.listRecords([operation.category]);
    await tx.setCategory(operation.category, { present: !deleted || categoryRows.some((row) => !row.deleted), updatedAt: now, lastSequence: sequence });
    const change = { sequence, kind: deleted ? 'tombstone' : current?.deleted ? 'restore' : 'record', category: operation.category, entityType: operation.entityType, entityId: operation.entityId, revision, record, originClientId: context.clientId, serverTime: now };
    await tx.addChange(change);
    return { operationId: operation.operationId, status: 'accepted', record, sequence, ...extra };
  }

  async conflict(tx, context, operation, incomingPayload, current, base, now, reason, changedFields = []) {
    const sequence = await tx.nextSequence();
    const conflict = await tx.addConflict({ accountId: context.accountId, spaceId: context.spaceId, entityType: operation.entityType, entityId: operation.entityId, category: operation.category, baseRevision: operation.baseRevision ?? 0, currentRevision: current?.revision ?? 0, currentPayload: clone(current?.payload), incomingPayload: clone(incomingPayload), currentOriginClientId: current?.originClientId ?? null, incomingOriginClientId: context.clientId, changedFields, reason, status: 'unresolved', createdAt: now, retainUntil: new Date(Date.parse(now) + this.retention.conflictDays * DAY).toISOString(), sequence });
    await tx.addChange({ sequence, kind: 'conflict', category: operation.category, entityType: operation.entityType, entityId: operation.entityId, revision: current?.revision ?? 0, conflict: publicConflict(conflict), originClientId: context.clientId, serverTime: now });
    return { operationId: operation.operationId, status: 'conflict', conflictId: conflict.conflictId, currentRevision: current?.revision ?? 0, sequence };
  }

  async resolveConflict(tx, context, operation, payload, current, now) {
    const conflict = await tx.getConflict(operation.conflictId);
    if (!conflict || conflict.accountId !== context.accountId || conflict.spaceId !== context.spaceId || conflict.entityType !== operation.entityType || conflict.entityId !== operation.entityId) throw new ReplicationError(404, 'resource_not_found');
    if (conflict.status !== 'unresolved' || !current || operation.baseRevision !== current.revision) return this.conflict(tx, context, operation, payload, current, undefined, now, 'stale_resolution');
    const result = await this.accept(tx, context, operation, payload, false, current, now, { resolvedConflictId: conflict.conflictId });
    await tx.updateConflict(conflict.conflictId, { status: 'resolved', resolutionRevision: result.record.revision, resolvedAt: now });
    return result;
  }

  async restore(context, { entityType, entityId, operationId, baseRevision }) {
    this.assertContext(context);
    let restoredPayload;
    await this.repository.read(context, async (tx) => { const current = await tx.getRecord(entityType, entityId); if (!current?.deleted) throw new ReplicationError(404, 'resource_not_found'); restoredPayload = current.payload; });
    const category = ENTITY_REGISTRY[entityType]?.category;
    if (!category) throw new ReplicationError(404, 'resource_not_found');
    return this.applyOperation(context, { operationId, entityType, entityId, category, schemaVersion: 1, baseRevision, kind: 'upsert', payload: restoredPayload });
  }

  async pull(context, { cursor, limit = 500, categories = [] } = {}) {
    this.assertContext(context); const bounded = Number(limit); const selectedCategories = normalizeCategories(categories);
    if (!Number.isInteger(bounded) || bounded < 1 || bounded > 500) throw new ReplicationError(400, 'invalid_request');
    const filterHash = requestHash(selectedCategories);
    return this.repository.read(context, async (tx) => {
      const space = await tx.space();
      let position = { sequence: 0, upper: space.nextSequence };
      if (cursor) {
        try { position = this.cursors.decode(cursor, { spaceId: context.spaceId, epoch: space.restoreEpoch, filterHash }); }
        catch (error) { if (error instanceof CursorError) throw new ReplicationError(error.code === 'restore_epoch_changed' ? 409 : 400, error.code); throw error; }
        if (position.sequence < space.floorSequence - 1) throw new ReplicationError(410, 'cursor_expired');
        if (position.sequence === position.upper) position.upper = space.nextSequence;
      }
      const rows = await tx.listChanges(position.sequence, position.upper, bounded + 1, selectedCategories);
      const hasMore = rows.length > bounded; const changes = rows.slice(0, bounded);
      const sequence = hasMore ? changes.at(-1).sequence : position.upper;
      const cursorState = { spaceId: context.spaceId, epoch: space.restoreEpoch, filterHash };
      return { changes, nextCursor: this.cursors.encode({ ...cursorState, sequence, upper: position.upper }), upperCursor: this.cursors.encode({ ...cursorState, sequence: position.upper, upper: position.upper }), hasMore, restoreEpoch: space.restoreEpoch };
    });
  }

  async reconcile(context, { categories = [], known = [], pageToken, limit = 500 } = {}) {
    this.assertContext(context);
    const selectedCategories = normalizeCategories(categories);
    if (!validKnownRows(known) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new ReplicationError(400, 'invalid_request');
    const queryHash = requestHash({ categories: selectedCategories, known });
    return this.repository.read(context, async (tx) => {
      const space = await tx.space();
      let tokenState = { upperSequence: space.nextSequence, afterKey: '' };
      if (pageToken) {
        try { tokenState = this.cursors.open(pageToken); } catch { throw new ReplicationError(400, 'invalid_page_token'); }
        const epochChanged = tokenState?.epoch !== space.restoreEpoch;
        if (tokenState?.kind !== 'reconcile' || tokenState.spaceId !== context.spaceId || tokenState.queryHash !== queryHash || epochChanged || !Number.isSafeInteger(tokenState.upperSequence) || typeof tokenState.afterKey !== 'string') throw new ReplicationError(epochChanged ? 409 : 400, epochChanged ? 'restore_epoch_changed' : 'invalid_page_token');
      }
      const records = (await tx.listRecords(selectedCategories)).filter((row) => row.sequence <= tokenState.upperSequence);
      const knownMap = new Map(known.map((row) => [`${row.entityType}:${row.entityId}`, row]));
      const differences = records.filter((row) => { const key = `${row.entityType}:${row.entityId}`; const local = knownMap.get(key); return key > tokenState.afterKey && (!local || local.revision !== row.revision || local.deleted !== row.deleted); });
      const page = differences.slice(0, limit); const hasMore = differences.length > limit; const afterKey = page.length ? `${page.at(-1).entityType}:${page.at(-1).entityId}` : tokenState.afterKey;
      return { records: page, pageToken: hasMore ? this.cursors.seal({ kind: 'reconcile', spaceId: context.spaceId, epoch: space.restoreEpoch, queryHash, upperSequence: tokenState.upperSequence, afterKey }) : null, hasMore, restoreEpoch: space.restoreEpoch };
    });
  }

  async firstSyncImpact(context, categories = []) {
    this.assertContext(context);
    const selectedCategories = normalizeCategories(categories);
    return this.repository.read(context, async (tx) => impactForRows(await tx.listRecords(selectedCategories)));
  }

  createFirstSyncPlan(context, { planId, mode, categories = [], recoveryPointId, impact } = {}) {
    this.assertContext(context);
    const selectedCategories = normalizeCategories(categories);
    if (!/^[0-9a-f-]{36}$/i.test(String(planId || '')) || !['local-wins', 'server-wins', 'category-clear'].includes(mode) || !/^[0-9a-f-]{16,64}$/i.test(String(recoveryPointId || '')) || !impact?.hash) throw new ReplicationError(400, 'invalid_request');
    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const token = this.cursors.seal({ v: 1, kind: 'first-sync', accountId: context.accountId, spaceId: context.spaceId, clientId: context.clientId, planId, mode, categories: selectedCategories, recoveryPointId, impactHash: impact.hash, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() });
    return { planToken: token, recoveryPointId, impact: impact.counts, expiresAt: expiresAt.toISOString() };
  }

  async executeFirstSyncPlan(context, { planToken, planId, recoveryPointId, mode, confirmation } = {}) {
    this.assertContext(context);
    let plan;
    try { plan = this.cursors.open(planToken); } catch { throw new ReplicationError(400, 'invalid_first_sync_plan'); }
    const expectedConfirmation = mode === 'local-wins' ? 'REPLACE SERVER' : mode === 'server-wins' ? 'REPLACE THIS DEVICE' : 'DELETE SERVER CATEGORY DATA';
    if (plan?.v !== 1 || plan.kind !== 'first-sync' || plan.accountId !== context.accountId || plan.spaceId !== context.spaceId || plan.clientId !== context.clientId || plan.planId !== planId || plan.recoveryPointId !== recoveryPointId || plan.mode !== mode || confirmation !== expectedConfirmation || Date.parse(plan.expiresAt) <= this.clock().getTime()) throw new ReplicationError(409, 'first_sync_plan_changed');
    if (mode === 'server-wins') {
      const impact = await this.firstSyncImpact(context, plan.categories);
      if (impact.hash !== plan.impactHash) throw new ReplicationError(409, 'first_sync_impact_changed');
      return { mode, recoveryPointId, records: [], restoreEpoch: context.restoreEpoch };
    }
    let notify;
    const result = await this.repository.transaction(context, async (tx) => {
      const rows = await tx.listRecords(plan.categories);
      if (impactForRows(rows).hash !== plan.impactHash) throw new ReplicationError(409, 'first_sync_impact_changed');
      const records = [];
      let lastSequence = null;
      for (const current of rows.filter((row) => !row.deleted)) {
        const accepted = await this.accept(tx, context, { operationId: `first-sync:${randomUUID()}`, entityType: current.entityType, entityId: current.entityId, category: current.category, schemaVersion: current.schemaVersion, baseRevision: current.revision, kind: 'delete' }, current.payload, true, current, this.clock().toISOString());
        records.push(accepted.record);
        lastSequence = accepted.sequence;
      }
      const space = await tx.space();
      if (lastSequence) notify = { accountId: context.accountId, spaceId: context.spaceId, sequence: lastSequence, restoreEpoch: space.restoreEpoch };
      return { mode, recoveryPointId, records, restoreEpoch: space.restoreEpoch };
    });
    if (notify) this.invalidations?.publish(notify);
    return result;
  }

  async stats(context, categories = []) {
    this.assertContext(context); const selectedCategories = normalizeCategories(categories);
    return this.repository.read(context, async (tx) => {
      const rows = await tx.listRecords(selectedCategories); const byCategory = {};
      const space = await tx.space();
      for (const row of rows) { const stats = byCategory[row.category] ||= { records: 0, deleted: 0, bytes: 0 }; stats.records += row.deleted ? 0 : 1; stats.deleted += row.deleted ? 1 : 0; stats.bytes += Buffer.byteLength(JSON.stringify(row.payload), 'utf8'); }
      const categoryState = (await tx.categories()).filter((row) => !selectedCategories.length || selectedCategories.includes(row.category));
      return { categories: byCategory, categoryState, records: rows.filter((row) => !row.deleted).length, tombstones: rows.filter((row) => row.deleted).length, unresolvedConflicts: await tx.countConflicts(), restoreEpoch: space.restoreEpoch, sequence: space.nextSequence };
    });
  }

  async listConflictsForAccount(context, { status = 'unresolved', after = '', limit = 100 } = {}) {
    this.assertSpaceContext(context);
    if (!['unresolved', 'resolved'].includes(status) || typeof after !== 'string' || after.length > 160 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ReplicationError(400, 'invalid_request');
    return this.repository.read(context, async (tx) => {
      const rows = await tx.listConflicts(status, after, limit + 1);
      return { items: rows.slice(0, limit).map(publicConflict), hasMore: rows.length > limit, nextAfter: rows.length > limit ? rows[limit - 1].conflictId : null };
    });
  }

  async resolveConflictForAccount(context, input = {}) {
    this.assertSpaceContext(context);
    if (!input.conflictId || !['current', 'incoming', 'manual'].includes(input.resolution) || !Number.isInteger(input.baseRevision) || input.baseRevision < 0) throw new ReplicationError(400, 'invalid_request');
    const now = this.clock().toISOString();
    let notify;
    const result = await this.repository.transaction(context, async (tx) => {
      const conflict = await tx.getConflict(input.conflictId);
      if (!conflict || conflict.accountId !== context.accountId || conflict.spaceId !== context.spaceId) throw new ReplicationError(404, 'resource_not_found');
      if (conflict.status !== 'unresolved') {
        const version = await tx.getVersion(conflict.entityType, conflict.entityId, conflict.resolutionRevision);
        return { status: 'duplicate', conflictId: conflict.conflictId, record: version ?? null };
      }
      const current = await tx.getRecord(conflict.entityType, conflict.entityId);
      if (!current || current.revision !== input.baseRevision) throw new ReplicationError(409, 'stale_resolution');
      let payload = input.resolution === 'current' ? conflict.currentPayload : conflict.incomingPayload;
      if (input.resolution === 'manual') payload = input.payload;
      payload = validateEntity({ entityType: conflict.entityType, category: conflict.category, schemaVersion: current.schemaVersion, payload });
      const operation = { operationId: `account:${randomUUID()}`, entityType: conflict.entityType, entityId: conflict.entityId, category: conflict.category, schemaVersion: current.schemaVersion, baseRevision: current.revision, kind: 'resolveConflict', conflictId: conflict.conflictId };
      const trustedContext = { ...context, clientId: conflict.currentOriginClientId || conflict.incomingOriginClientId };
      const accepted = await this.accept(tx, trustedContext, operation, payload, false, current, now, { resolvedConflictId: conflict.conflictId });
      await tx.updateConflict(conflict.conflictId, { status: 'resolved', resolutionRevision: accepted.record.revision, resolvedAt: now });
      const space = await tx.space();
      notify = { accountId: context.accountId, spaceId: context.spaceId, sequence: accepted.sequence, restoreEpoch: space.restoreEpoch };
      return { status: 'accepted', conflictId: conflict.conflictId, record: accepted.record, sequence: accepted.sequence };
    });
    if (notify) this.invalidations?.publish(notify);
    return result;
  }

  rejected(operationId, code, details) { return { operationId: typeof operationId === 'string' ? operationId : null, status: 'rejected', error: { code, retryable: false, ...(details ? { details } : {}) } }; }
  assertContext(context) { if (!context?.accountId || !context?.spaceId || !context?.clientId) throw new ReplicationError(401, 'authentication_failed'); }
  assertSpaceContext(context) { if (!context?.accountId || !context?.spaceId) throw new ReplicationError(401, 'authentication_failed'); }
}

function normalizeCategories(categories) {
  if (!Array.isArray(categories) || categories.some((category) => !CATEGORIES.includes(category))) throw new ReplicationError(400, 'invalid_request');
  return [...new Set(categories)].sort();
}
function validKnownRows(known) {
  if (!Array.isArray(known) || known.length > 20_000) return false;
  const keys = new Set();
  for (const row of known) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !['entityType', 'entityId', 'revision', 'deleted'].includes(key)) || !ENTITY_TYPES.includes(row.entityType) || typeof row.entityId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(row.entityId) || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.deleted !== 'boolean') return false;
    const key = `${row.entityType}:${row.entityId}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}
function impactForRows(rows) {
  const versions = rows.map((row) => ({ entityType: row.entityType, entityId: row.entityId, category: row.category, revision: row.revision, deleted: row.deleted })).sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId));
  const counts = {};
  for (const row of rows) { const item = counts[row.category] ||= { records: 0, deleted: 0 }; item[row.deleted ? 'deleted' : 'records'] += 1; }
  return { hash: requestHash(versions), counts };
}
function mergeFields(base, current, incoming) {
  const payload = clone(current); const conflicting = [];
  for (const key of new Set([...Object.keys(base || {}), ...Object.keys(current || {}), ...Object.keys(incoming || {})])) {
    const before = JSON.stringify(base?.[key]); const local = JSON.stringify(current?.[key]); const remote = JSON.stringify(incoming?.[key]);
    const currentChanged = local !== before; const incomingChanged = remote !== before;
    if (incomingChanged && !currentChanged) payload[key] = clone(incoming[key]);
    else if (incomingChanged && currentChanged && local !== remote) conflicting.push(key);
  }
  return { payload, conflicting };
}
function publicConflict(row) { const { accountId, ...scoped } = row; return scoped; }
