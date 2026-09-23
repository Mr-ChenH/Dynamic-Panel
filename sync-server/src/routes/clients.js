import { accountContext, data, idParams, protectedAccountContext, strictObject } from './helpers.js';

const nameSchema = { type: 'string', minLength: 1, maxLength: 256 };
const clientParams = idParams('spaceId', 'clientId');

export async function clientRoutes(app) {
  app.get('/api/v1/spaces/:spaceId/clients', { schema: { params: idParams('spaceId') } }, async (request, reply) => {
    const result = await app.identity.listClients(await accountContext(request), request.params.spaceId);
    return data(reply, request, result);
  });

  app.post('/api/v1/spaces/:spaceId/clients', {
    schema: { params: idParams('spaceId'), body: strictObject({ name: nameSchema }, ['name']) }
  }, async (request, reply) => {
    const row = await app.identity.createClient(await protectedAccountContext(request), request.params.spaceId, request.body.name, request.id);
    reply.code(201);
    return data(reply, request, row, { noStore: true });
  });

  app.patch('/api/v1/spaces/:spaceId/clients/:clientId', {
    schema: { params: clientParams, body: strictObject({ name: nameSchema }, ['name']) }
  }, async (request, reply) => data(reply, request, await app.identity.updateClient(await protectedAccountContext(request), request.params.spaceId, request.params.clientId, request.body.name)));

  app.post('/api/v1/spaces/:spaceId/clients/:clientId/rotate-key', {
    schema: { params: clientParams, body: strictObject({ overlapSeconds: { type: 'integer', minimum: 0, maximum: 86400 } }, ['overlapSeconds']) }
  }, async (request, reply) => data(reply, request, await app.identity.rotateKey(await protectedAccountContext(request), request.params.spaceId, request.params.clientId, request.body.overlapSeconds, request.id), { noStore: true }));

  app.post('/api/v1/spaces/:spaceId/clients/:clientId/revoke', {
    schema: { params: clientParams, body: strictObject({}) }
  }, async (request, reply) => data(reply, request, await app.identity.revokeClient(await protectedAccountContext(request), request.params.spaceId, request.params.clientId, request.id)));

  app.post('/api/v1/spaces/:spaceId/clients/:clientId/reset-installation', {
    schema: { params: clientParams, body: strictObject({}) }
  }, async (request, reply) => data(reply, request, await app.identity.resetInstallation(await protectedAccountContext(request), request.params.spaceId, request.params.clientId, request.id), { noStore: true }));
}
