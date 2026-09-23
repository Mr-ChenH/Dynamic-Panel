import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { errors, installErrorHandler } from '../src/errors.js';
import { objectRoutes } from '../src/routes/objects.js';
import { MemoryObjectStorage, ObjectService } from '../src/objects/index.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('route-test')]);
const digest = `sha256:${createHash('sha256').update(png).digest('hex')}`;
const contexts = {
  alpha: { accountId: 'account-a', spaceId: 'space-a', clientId: 'client-a' },
  beta: { accountId: 'account-b', spaceId: 'space-b', clientId: 'client-b' }
};

async function fixture() {
  const app = Fastify({ logger: false });
  app.decorate('identity', { async authenticateClient(key) { if (!contexts[key]) throw errors.authentication(); return contexts[key]; } });
  installErrorHandler(app);
  await app.register(objectRoutes, { service: new ObjectService({ storage: new MemoryObjectStorage() }) });
  return app;
}

const headers = (key = 'alpha') => ({ authorization: `ClientKey ${key}` });

test('object route plugin composes independently and preserves stream headers and authorization', async (t) => {
  const app = await fixture();
  t.after(() => app.close());
  const created = await app.inject({
    method: 'POST', url: '/api/v1/objects/uploads', headers: headers(),
    payload: { digest, bytes: png.length, mimeType: 'image/png', purpose: 'screenshot' }
  });
  assert.equal(created.statusCode, 201, created.body);
  const uploadId = created.json().data.uploadId;
  const part = await app.inject({
    method: 'PUT', url: `/api/v1/objects/uploads/${uploadId}/parts/1`,
    headers: { ...headers(), 'content-type': 'application/octet-stream', 'content-digest': digest }, payload: png
  });
  assert.equal(part.statusCode, 200, part.body);
  const complete = await app.inject({ method: 'POST', url: `/api/v1/objects/uploads/${uploadId}/complete`, headers: { ...headers(), 'content-type': 'application/json' }, payload: {} });
  assert.equal(complete.statusCode, 200, complete.body);
  const objectId = complete.json().data.objectId;

  const ranged = await app.inject({ method: 'GET', url: `/api/v1/objects/${objectId}`, headers: { ...headers(), range: 'bytes=2-6' } });
  assert.equal(ranged.statusCode, 206, ranged.body);
  assert.equal(ranged.headers['content-range'], `bytes 2-6/${png.length}`);
  assert.equal(ranged.headers['content-length'], '5');
  assert.deepEqual(ranged.rawPayload, png.subarray(2, 7));

  const forbidden = await app.inject({ method: 'GET', url: `/api/v1/objects/${objectId}`, headers: headers('beta') });
  const missing = await app.inject({ method: 'GET', url: '/api/v1/objects/obj_aaaaaaaaaaaaaaaaaaaaaaaa', headers: headers('beta') });
  assert.equal(forbidden.statusCode, 404);
  assert.deepEqual(forbidden.json().error, missing.json().error);

  const usage = await app.inject({ method: 'GET', url: '/api/v1/objects/usage/observed', headers: headers() });
  assert.equal(usage.statusCode, 200, usage.body);
  assert.equal(usage.json().data.quota, null);
});
