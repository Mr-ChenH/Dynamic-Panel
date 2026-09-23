import { ApiError } from '../errors.js';
import { data, strictObject } from './helpers.js';
import { ENTITY_TYPES, CATEGORIES } from '../records/schema-registry.js';
import { ReplicationError } from '../records/service.js';

const entityId = { type: 'string', minLength: 1, maxLength: 240, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const category = { type: 'string', enum: CATEGORIES };
const firstSyncMode = { type: 'string', enum: ['local-wins', 'server-wins', 'category-clear'] };
const recoveryPointId = { type: 'string', minLength: 16, maxLength: 64, pattern: '^[0-9a-fA-F-]+$' };
const operation = strictObject({
  operationId: entityId, entityType: { type: 'string', enum: ENTITY_TYPES }, entityId, category,
  schemaVersion: { type: 'integer', const: 1 }, baseRevision: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  kind: { type: 'string', enum: ['upsert', 'delete', 'resolveConflict'] }, payload: {}, conflictId: entityId
}, ['operationId', 'entityType', 'entityId', 'category', 'schemaVersion', 'baseRevision', 'kind']);

function clientKey(request) {
  const header = request.headers.authorization;
  return typeof header === 'string' && header.startsWith('ClientKey ') ? header.slice(10) : null;
}
async function context(request) { const result = await request.server.identity.authenticateClient(clientKey(request)); request.auth = result; return result; }
function categories(value) { if (!value) return []; const rows = Array.isArray(value) ? value : String(value).split(','); if (rows.some((row) => !CATEGORIES.includes(row))) throw new ApiError(400, 'invalid_request', 'Request is invalid.'); return [...new Set(rows)]; }
function mapError(error) {
  if (error instanceof ReplicationError) throw new ApiError(error.statusCode, error.code, publicMessage(error.code), { details: error.details, retryable: error.retryable });
  if (error?.code === 'restore_epoch_changed') throw new ApiError(409, 'restore_epoch_changed', publicMessage('restore_epoch_changed'), { retryable: false });
  if (error?.code === 'scope_not_found') throw new ApiError(404, 'resource_not_found', publicMessage('resource_not_found'), { retryable: false });
  throw error;
}
function publicMessage(code) { return ({ operation_reused: 'Operation ID was already used for different content.', cursor_expired: 'Cursor has expired; full reconciliation is required.', restore_epoch_changed: 'Space restore epoch changed; full reconciliation is required.', resource_not_found: 'Resource not found.', authentication_failed: 'Authentication failed.', invalid_first_sync_plan: 'First synchronization plan is invalid.', first_sync_plan_changed: 'First synchronization plan changed or expired.', first_sync_impact_changed: 'The synchronization impact changed; create a new recovery point.' })[code] ?? 'Sync request could not be completed.'; }

export async function syncRoutes(app, options = {}) {
  const records = options.records ?? app.records;
  if (!records) throw new TypeError('syncRoutes requires a records service');

  app.post('/api/v1/sync/first-sync/recovery-point', {
    schema: { body: strictObject({ planId: { type: 'string', format: 'uuid' }, mode: firstSyncMode, categories: { type: 'array', uniqueItems: true, items: category } }, ['planId', 'mode', 'categories']) }
  }, async (request, reply) => {
    try {
      const authenticated = await context(request);
      const operations = app.operations ?? {};
      if (!operations.createSyncRecovery || !operations.verifySyncRecovery) throw new ApiError(503, 'recovery_unavailable', 'A verified recovery target is not configured.');
      const before = await records.firstSyncImpact(authenticated, request.body.categories);
      const point = await operations.createSyncRecovery({ accountId: authenticated.accountId, spaceId: authenticated.spaceId, clientId: authenticated.clientId, planId: request.body.planId });
      const verified = await operations.verifySyncRecovery({ accountId: authenticated.accountId, spaceId: authenticated.spaceId, recoveryPointId: point.id ?? point.manifestId });
      if (!verified?.verified) throw new ApiError(503, 'recovery_verification_failed', 'The recovery point could not be verified.');
      const after = await records.firstSyncImpact(authenticated, request.body.categories);
      if (before.hash !== after.hash) throw new ReplicationError(409, 'first_sync_impact_changed');
      const plan = records.createFirstSyncPlan(authenticated, { ...request.body, recoveryPointId: point.id ?? point.manifestId, impact: after });
      return data(reply, request, { ...plan, recoveryVerified: true }, { noStore: true });
    } catch (error) { mapError(error); }
  });

  app.post('/api/v1/sync/first-sync/execute', {
    schema: { body: strictObject({ planId: { type: 'string', format: 'uuid' }, planToken: { type: 'string', minLength: 32, maxLength: 2048 }, recoveryPointId, mode: firstSyncMode, confirmation: { type: 'string', enum: ['REPLACE SERVER', 'REPLACE THIS DEVICE', 'DELETE SERVER CATEGORY DATA'] } }, ['planId', 'planToken', 'recoveryPointId', 'mode', 'confirmation']) }
  }, async (request, reply) => {
    try {
      const authenticated = await context(request);
      const operations = app.operations ?? {};
      if (!operations.verifySyncRecovery) throw new ApiError(503, 'recovery_unavailable', 'A verified recovery target is not configured.');
      const verified = await operations.verifySyncRecovery({ accountId: authenticated.accountId, spaceId: authenticated.spaceId, recoveryPointId: request.body.recoveryPointId });
      if (!verified?.verified) throw new ApiError(409, 'recovery_verification_failed', 'The recovery point could not be verified.');
      return data(reply, request, { ...(await records.executeFirstSyncPlan(authenticated, request.body)), recoveryVerified: true }, { noStore: true });
    } catch (error) { mapError(error); }
  });

  app.post('/api/v1/sync/push', { schema: { body: strictObject({ operations: { type: 'array', minItems: 1, maxItems: 100, items: operation } }, ['operations']) } }, async (request, reply) => {
    try { return data(reply, request, await records.push(await context(request), request.body.operations), { noStore: true }); } catch (error) { mapError(error); }
  });

  app.get('/api/v1/sync/pull', { schema: { querystring: strictObject({ cursor: { type: 'string', maxLength: 2048 }, limit: { type: 'integer', minimum: 1, maximum: 500 }, categories: { type: 'string', maxLength: 512 } }) } }, async (request, reply) => {
    try { return data(reply, request, await records.pull(await context(request), { cursor: request.query.cursor, limit: request.query.limit ?? 500, categories: categories(request.query.categories) }), { noStore: true }); } catch (error) { mapError(error); }
  });

  app.post('/api/v1/sync/reconcile', { schema: { body: strictObject({ categories: { type: 'array', uniqueItems: true, items: category }, known: { type: 'array', maxItems: 20000, items: strictObject({ entityType: { type: 'string', enum: ENTITY_TYPES }, entityId, revision: { type: 'integer', minimum: 0 }, deleted: { type: 'boolean' } }, ['entityType', 'entityId', 'revision', 'deleted']) }, pageToken: { type: 'string', maxLength: 2048 }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, ['categories', 'known']) } }, async (request, reply) => {
    try { return data(reply, request, await records.reconcile(await context(request), request.body), { noStore: true }); } catch (error) { mapError(error); }
  });

  app.get('/api/v1/sync/stats', { schema: { querystring: strictObject({ categories: { type: 'string', maxLength: 512 } }) } }, async (request, reply) => {
    try { return data(reply, request, await records.stats(await context(request), categories(request.query.categories)), { noStore: true }); } catch (error) { mapError(error); }
  });

  app.post('/api/v1/sync/records/:entityType/:entityId/restore', { schema: { params: strictObject({ entityType: { type: 'string', enum: ENTITY_TYPES }, entityId }, ['entityType', 'entityId']), body: strictObject({ operationId: entityId, baseRevision: { type: 'integer', minimum: 1 } }, ['operationId', 'baseRevision']) } }, async (request, reply) => {
    try { return data(reply, request, await records.restore(await context(request), { ...request.params, ...request.body }), { noStore: true }); } catch (error) { mapError(error); }
  });
}
