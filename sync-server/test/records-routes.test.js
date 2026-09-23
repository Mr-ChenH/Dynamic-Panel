import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { installErrorHandler } from '../src/errors.js';
import { MemoryRecordRepository } from '../src/records/memory-repository.js';
import { RecordReplicationService } from '../src/records/service.js';
import { syncRoutes } from '../src/routes/sync.js';

const context = { accountId: 'account-route', spaceId: 'space-route', clientId: 'client-route', restoreEpoch: 1 };
const notePayload = { title: 'Route', titleSource: 'user', body: 'body', categoryId: '', tagId: '', createdAt: 1, updatedAt: 1, imageObjectIds: [] };

async function build() {
  const repository = new MemoryRecordRepository(); repository.seedSpace(context);
  const records = new RecordReplicationService({ repository, cursorSecret: 'route-secret-at-least-thirty-two-characters', instanceId: 'route-instance' });
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.decorate('identity', { authenticateClient: async (key) => { if (key !== 'route-key') throw new Error('bad auth'); return context; } });
  installErrorHandler(app); await app.register(syncRoutes, { records }); await app.ready();
  return app;
}

test('sync route plugin composes independently and derives source and scope from authentication', async (t) => {
  const app = await build(); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { authorization: 'ClientKey route-key' }, payload: { operations: [{ operationId: 'route-op', entityType: 'note', entityId: 'route-note', category: 'notes', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: notePayload }] } });
  assert.equal(response.statusCode, 200); const body = response.json();
  assert.equal(body.data.results[0].record.spaceId, context.spaceId); assert.equal(body.data.results[0].record.originClientId, context.clientId);
  const stats = await app.inject({ method: 'GET', url: '/api/v1/sync/stats?categories=notes', headers: { authorization: 'ClientKey route-key' } });
  assert.equal(stats.json().data.records, 1);
});

test('sync route rejects client-claimed source, space, revision and time fields', async (t) => {
  const app = await build(); t.after(() => app.close());
  for (const forged of [{ originClientId: 'client-other' }, { spaceId: 'space-other' }, { revision: 99 }, { updatedAt: '2000-01-01T00:00:00Z' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { authorization: 'ClientKey route-key' }, payload: { operations: [{ operationId: `forged-${Object.keys(forged)[0]}`, entityType: 'note', entityId: 'route-note', category: 'notes', schemaVersion: 1, baseRevision: 0, kind: 'upsert', payload: notePayload, ...forged }] } });
    assert.equal(response.statusCode, 400); assert.equal(response.json().error.code, 'invalid_request');
  }
});
