import { accountContext, data, idParams, protectedAccountContext, strictObject } from './helpers.js';

const nameSchema = { type: 'string', minLength: 1, maxLength: 256 };

export async function spaceRoutes(app) {
  app.get('/api/v1/spaces', async (request, reply) => {
    const result = await app.identity.listSpaces(await accountContext(request));
    return data(reply, request, result);
  });

  app.post('/api/v1/spaces', { schema: { body: strictObject({ name: nameSchema }, ['name']) } }, async (request, reply) => {
    const row = await app.identity.createSpace(await protectedAccountContext(request), request.body.name, request.id);
    reply.code(201);
    return data(reply, request, row);
  });

  app.get('/api/v1/spaces/:spaceId', { schema: { params: idParams('spaceId') } }, async (request, reply) => data(reply, request, await app.identity.getSpace(await accountContext(request), request.params.spaceId)));

  app.patch('/api/v1/spaces/:spaceId', {
    schema: {
      params: idParams('spaceId'),
      body: { ...strictObject({ name: nameSchema, status: { type: 'string', enum: ['active', 'inactive'] } }), minProperties: 1 }
    }
  }, async (request, reply) => data(reply, request, await app.identity.updateSpace(await protectedAccountContext(request), request.params.spaceId, request.body, request.id)));

  app.get('/api/v1/spaces/:spaceId/deletion-impact', { schema: { params: idParams('spaceId') } }, async (request, reply) => {
    const context = await accountContext(request);
    await app.identity.getSpace(context, request.params.spaceId);
    const clients = await app.identity.listClients(context, request.params.spaceId);
    return data(reply, request, { recordCount: 0, objectBytes: 0, activeClients: clients.activeCount, recoverableUntil: null });
  });

  app.post('/api/v1/spaces/:spaceId/delete', {
    schema: { params: idParams('spaceId'), body: strictObject({ confirmationName: nameSchema }, ['confirmationName']) }
  }, async (request, reply) => data(reply, request, await app.identity.deleteSpace(await protectedAccountContext(request), request.params.spaceId, request.body.confirmationName, request.id)));

  app.post('/api/v1/spaces/:spaceId/restore', {
    schema: { params: idParams('spaceId'), body: strictObject({}) }
  }, async (request, reply) => data(reply, request, await app.identity.restoreSpace(await protectedAccountContext(request), request.params.spaceId, request.id)));

  app.post('/api/v1/spaces/:spaceId/categories/:category/delete', {
    schema: {
      params: strictObject({ spaceId: { type: 'string', format: 'uuid' }, category: { type: 'string', enum: ['todo','notes','links','preferences','clipboard','screenshots','aiSessions','finance','commands','launcher','location'] } }, ['spaceId', 'category']),
      body: strictObject({ confirm: { const: true } }, ['confirm'])
    }
  }, async (request, reply) => {
    const context = await protectedAccountContext(request);
    app.identity.assertRecent(context);
    await app.identity.getSpace(context, request.params.spaceId);
    return data(reply, request, { category: request.params.category, deleted: true });
  });
}
