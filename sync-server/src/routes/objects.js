import { data, strictObject } from './helpers.js';
import { ObjectService } from '../objects/service.js';
import { MemoryObjectStorage } from '../objects/storage.js';

const opaqueParam = (name, prefix) => strictObject({ [name]: { type: 'string', pattern: `^${prefix}_[A-Za-z0-9_-]{24}$` } }, [name]);
const digestSchema = { type: 'string', maxLength: 128 };
const objectIdSchema = { type: 'string', pattern: '^obj_[A-Za-z0-9_-]{24}$' };
const referenceIdSchema = { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,160}$' };

function clientKeyHeader(request) {
  const authorization = request.headers.authorization;
  return typeof authorization === 'string' && authorization.startsWith('ClientKey ') ? authorization.slice('ClientKey '.length) : null;
}

async function clientContext(request) {
  const context = await request.server.identity.authenticateClient(clientKeyHeader(request));
  request.auth = context;
  return context;
}

export async function objectRoutes(app, options = {}) {
  const service = options.service ?? app.objectService ?? new ObjectService({ storage: options.storage ?? new MemoryObjectStorage(), clock: options.clock });
  if (!app.hasDecorator('objectService')) app.decorate('objectService', service);

  app.addContentTypeParser('application/octet-stream', (request, payload, done) => done(null, payload));

  app.post('/api/v1/objects/uploads', {
    schema: { body: strictObject({ digest: digestSchema, bytes: { type: 'integer', minimum: 8 }, mimeType: { const: 'image/png' }, purpose: { type: 'string', enum: ['note-image', 'clipboard-image', 'screenshot'] } }, ['digest', 'bytes', 'mimeType', 'purpose']) }
  }, async (request, reply) => {
    const result = await service.createUpload(await clientContext(request), request.body);
    reply.code(201);
    return data(reply, request, result, { noStore: true });
  });

  app.get('/api/v1/objects/uploads/:uploadId', { schema: { params: opaqueParam('uploadId', 'upl') } }, async (request, reply) => data(reply, request, await service.uploadStatus(await clientContext(request), request.params.uploadId), { noStore: true }));

  app.put('/api/v1/objects/uploads/:uploadId/parts/:partNumber', {
    bodyLimit: 8 * 1024 * 1024 + 1,
    schema: {
      params: strictObject({ uploadId: { type: 'string', pattern: '^upl_[A-Za-z0-9_-]{24}$' }, partNumber: { type: 'integer', minimum: 1, maximum: 10000 } }, ['uploadId', 'partNumber']),
      headers: { type: 'object', additionalProperties: true, properties: { 'content-digest': digestSchema }, required: ['content-digest'] }
    }
  }, async (request, reply) => data(reply, request, await service.putPart(await clientContext(request), request.params.uploadId, request.params.partNumber, request.headers['content-digest'], request.body), { noStore: true }));

  app.post('/api/v1/objects/uploads/:uploadId/complete', {
    schema: { params: opaqueParam('uploadId', 'upl'), body: strictObject({}) }
  }, async (request, reply) => data(reply, request, await service.completeUpload(await clientContext(request), request.params.uploadId), { noStore: true }));

  app.delete('/api/v1/objects/uploads/:uploadId', { schema: { params: opaqueParam('uploadId', 'upl') } }, async (request, reply) => data(reply, request, await service.cancelUpload(await clientContext(request), request.params.uploadId), { noStore: true }));

  app.get('/api/v1/objects/:objectId/metadata', { schema: { params: opaqueParam('objectId', 'obj') } }, async (request, reply) => data(reply, request, await service.metadata(await clientContext(request), request.params.objectId), { noStore: true }));

  app.get('/api/v1/objects/:objectId', { schema: { params: opaqueParam('objectId', 'obj') } }, async (request, reply) => {
    const result = await service.download(await clientContext(request), request.params.objectId, request.headers.range);
    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', result.object.mimeType);
    reply.header('content-digest', result.digestHeader);
    reply.header('content-length', result.end - result.start + 1);
    reply.header('cache-control', 'private, no-store');
    if (result.partial) {
      reply.code(206);
      reply.header('content-range', `bytes ${result.start}-${result.end}/${result.object.bytes}`);
    }
    return reply.send(result.stream);
  });

  app.post('/api/v1/objects/completeness', {
    schema: { body: strictObject({ objectIds: { type: 'array', maxItems: 100, uniqueItems: true, items: objectIdSchema } }, ['objectIds']) }
  }, async (request, reply) => data(reply, request, await service.completeness(await clientContext(request), request.body.objectIds), { noStore: true }));

  app.put('/api/v1/objects/references/:referenceId', {
    schema: {
      params: strictObject({ referenceId: referenceIdSchema }, ['referenceId']),
      body: strictObject({ objectIds: { type: 'array', maxItems: 100, uniqueItems: true, items: objectIdSchema }, retainUntil: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } }, ['objectIds'])
    }
  }, async (request, reply) => data(reply, request, await service.setReferences(await clientContext(request), request.params.referenceId, request.body.objectIds, { retainUntil: request.body.retainUntil }), { noStore: true }));

  app.delete('/api/v1/objects/references/:referenceId', {
    schema: { params: strictObject({ referenceId: referenceIdSchema }, ['referenceId']) }
  }, async (request, reply) => data(reply, request, await service.deleteReferences(await clientContext(request), request.params.referenceId), { noStore: true }));

  app.get('/api/v1/objects/usage/observed', async (request, reply) => data(reply, request, await service.usage(await clientContext(request)), { noStore: true }));
}

export const objectsPlugin = objectRoutes;
export default objectRoutes;
