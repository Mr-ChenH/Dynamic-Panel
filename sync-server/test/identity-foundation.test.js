import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { MemoryIdentityStore } from '../src/auth/memory-store.js';

const SECRET = 'test-secret-value-with-at-least-32-bytes';

async function fixture() {
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-key` });
  const store = new MemoryIdentityStore();
  const closed = { accounts: [], spaces: [], clients: [] };
  const app = await buildServer({
    config,
    store,
    logger: false,
    connections: {
      closeAccount(id) { closed.accounts.push(id); },
      closeSpace(id) { closed.spaces.push(id); },
      closeClient(id) { closed.clients.push(id); }
    }
  });
  return { app, store, config, closed };
}

async function login(app, identity, username, password = 'correct horse battery staple') {
  await identity.createAccount({ username, password });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/account/login',
    headers: { origin: app.config.consoleOrigin },
    payload: { username, password }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.headers['set-cookie'].split(';', 1)[0];
  const session = await app.inject({ method: 'GET', url: '/api/v1/account/session', headers: { cookie } });
  assert.equal(session.statusCode, 200, session.body);
  return { cookie, csrf: session.json().data.csrfToken, account: session.json().data.account };
}

function auth(session) {
  return { cookie: session.cookie, origin: 'http://127.0.0.1:43822', 'x-csrf-token': session.csrf };
}

async function createSpace(app, session, name) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: auth(session), payload: { name } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data;
}

async function reauthenticate(app, session) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/account/reauthenticate', headers: auth(session), payload: { password: 'correct horse battery staple' } });
  assert.equal(response.statusCode, 200, response.body);
}

async function createClient(app, session, spaceId, name = 'Laptop') {
  await reauthenticate(app, session);
  const response = await app.inject({ method: 'POST', url: `/api/v1/spaces/${spaceId}/clients`, headers: auth(session), payload: { name } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data;
}

function syncHeaders(key, installationId = '0f12ebd4-8f91-4a37-8a52-a8a58efc9c72') {
  return {
    authorization: `ClientKey ${key}`,
    'dp-installation-id': installationId,
    'dp-protocol-version': '1',
    'dp-app-version': '1.1.0',
    'dp-platform': 'darwin-arm64'
  };
}

test('discovery, health, strict schemas, and generic login failures expose stable contracts', async (t) => {
  assert.throws(() => loadConfig({ NODE_ENV: 'development', CONSOLE_ORIGIN: 'http://192.168.1.10:43822', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-key` }), /HTTPS/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', CONSOLE_ORIGIN: 'https://sync.example.test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-key` }), /DATABASE_URL/);
  const { app } = await fixture();
  t.after(() => app.close());
  const discovery = await app.inject({ method: 'GET', url: '/.well-known/dynamic-panel-sync' });
  assert.equal(discovery.statusCode, 200);
  assert.equal(discovery.json().service, 'dynamic-panel-sync');
  assert.match(discovery.json().instanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(discovery.json().limits.jsonBytes, 1_048_576);
  assert.ok(discovery.headers['x-request-id']);

  const live = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
  assert.deepEqual(live.json().data, { status: 'ok' });

  const bad = await app.inject({ method: 'POST', url: '/api/v1/account/login', headers: { origin: app.config.consoleOrigin }, payload: { username: 'missing', password: 'wrong', extra: true } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'invalid_request');
  const missing = await app.inject({ method: 'POST', url: '/api/v1/account/login', headers: { origin: app.config.consoleOrigin }, payload: { username: 'missing', password: 'wrong' } });
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.json().error, { code: 'authentication_failed', message: 'Authentication failed.', retryable: false });
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/account/register', payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/account/mfa/enroll', payload: {} })).statusCode, 404);
});

test('account mutations require matching Origin and CSRF and recent authentication gates high-risk work', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const session = await login(app, app.identity, 'alice');

  const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: { cookie: session.cookie, origin: app.config.consoleOrigin }, payload: { name: 'Work' } });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal(noCsrf.json().error.code, 'csrf_failed');
  const wrongOrigin = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: { ...auth(session), origin: 'https://evil.example' }, payload: { name: 'Work' } });
  assert.equal(wrongOrigin.statusCode, 403);

  const space = await createSpace(app, session, 'Work');
  const highRisk = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/delete`, headers: auth(session), payload: { confirmationName: 'Work' } });
  assert.equal(highRisk.statusCode, 403);
  assert.equal(highRisk.json().error.code, 'recent_auth_required');

  const reauth = await app.inject({ method: 'POST', url: '/api/v1/account/reauthenticate', headers: auth(session), payload: { password: 'correct horse battery staple' } });
  assert.equal(reauth.statusCode, 200, reauth.body);
  const deleted = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/delete`, headers: auth(session), payload: { confirmationName: 'Work' } });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().data.status, 'deleting');
});

test('space names normalize and cross-account ID substitution is indistinguishable from missing resources', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const alice = await login(app, app.identity, 'alice');
  const bob = await login(app, app.identity, 'bob');
  const space = await createSpace(app, alice, '  Team\u3000Roadmap  ');
  assert.equal(space.name, 'Team Roadmap');

  const conflict = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: auth(alice), payload: { name: 'team roadmap' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'name_conflict');

  const substituted = await app.inject({ method: 'GET', url: `/api/v1/spaces/${space.spaceId}`, headers: { cookie: bob.cookie } });
  const randomMissing = await app.inject({ method: 'GET', url: '/api/v1/spaces/6d7f66ed-fc4a-4cec-aa44-8493180c5f5d', headers: { cookie: bob.cookie } });
  assert.equal(substituted.statusCode, 404);
  assert.equal(randomMissing.statusCode, 404);
  assert.deepEqual(substituted.json().error, randomMissing.json().error);

  const clients = await app.inject({ method: 'GET', url: `/api/v1/spaces/${space.spaceId}/clients`, headers: { cookie: bob.cookie } });
  assert.equal(clients.statusCode, 404);
});

test('client Keys are unique and one-time, bind atomically, reject installation mismatch, rotate, revoke, and reset', async (t) => {
  const { app, store, closed } = await fixture();
  t.after(() => app.close());
  const session = await login(app, app.identity, 'alice');
  const space = await createSpace(app, session, 'Work');
  const first = await createClient(app, session, space.spaceId, '  MacBook\u00a0Pro ');
  const second = await createClient(app, session, space.spaceId, 'Desktop');
  assert.match(first.clientKey, /^dpk_v1_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.clientKey, second.clientKey);
  assert.equal(first.name, 'MacBook Pro');
  assert.equal([...store.keyGenerations.values()].some((row) => JSON.stringify(row).includes(first.clientKey)), false);

  const listed = await app.inject({ method: 'GET', url: `/api/v1/spaces/${space.spaceId}/clients`, headers: { cookie: session.cookie } });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(JSON.stringify(listed.json()).includes('clientKey'), false);

  const bound = await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(first.clientKey), payload: {} });
  assert.equal(bound.statusCode, 200, bound.body);
  const queryOnlyHeaders = syncHeaders(first.clientKey);
  delete queryOnlyHeaders.authorization;
  const queryCredential = await app.inject({ method: 'POST', url: `/api/v1/sync/session?clientKey=${encodeURIComponent(first.clientKey)}`, headers: queryOnlyHeaders, payload: {} });
  assert.equal(queryCredential.statusCode, 401);
  assert.equal(queryCredential.json().error.code, 'authentication_failed');
  const mismatch = await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(first.clientKey, 'bfdb27ca-846c-4ea1-b204-615401889c15'), payload: {} });
  assert.equal(mismatch.statusCode, 401);
  assert.equal(mismatch.json().error.code, 'authentication_failed');
  assert.ok(store.auditEvents.some((row) => row.action === 'client.binding_mismatch' && row.errorCode === 'authentication_failed'));

  const rotated = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${first.clientId}/rotate-key`, headers: auth(session), payload: { overlapSeconds: 0 } });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal(rotated.headers['cache-control'], 'no-store');
  const rotatedKey = rotated.json().data.clientKey;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(first.clientKey), payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(rotatedKey), payload: {} })).statusCode, 200);

  const revoked = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${first.clientId}/revoke`, headers: auth(session), payload: {} });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(rotatedKey), payload: {} })).statusCode, 401);
  assert.ok(closed.clients.includes(first.clientId));

  const reauth = await app.inject({ method: 'POST', url: '/api/v1/account/reauthenticate', headers: auth(session), payload: { password: 'correct horse battery staple' } });
  assert.equal(reauth.statusCode, 200);
  const reset = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${first.clientId}/reset-installation`, headers: auth(session), payload: {} });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(reset.json().data.clientId, first.clientId);
  assert.ok(reset.json().data.clientKey);
  assert.equal(reset.json().data.binding.status, 'unbound');

  let overlapKey = reset.json().data.clientKey;
  for (let index = 0; index < 2; index += 1) {
    const overlap = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${first.clientId}/rotate-key`, headers: auth(session), payload: { overlapSeconds: 3600 } });
    assert.equal(overlap.statusCode, 200, overlap.body);
    overlapKey = overlap.json().data.clientKey;
  }
  assert.ok(overlapKey);
  const activeGenerations = (await store.listKeyGenerations(session.account.accountId, space.spaceId, first.clientId)).filter((row) => !row.revokedAt && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()));
  assert.equal(activeGenerations.length, 2);
});

test('concurrent creates enforce exact independent 10 space and client bounds', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const alice = await login(app, app.identity, 'alice');
  const bob = await login(app, app.identity, 'bob');

  const attempts = await Promise.all(Array.from({ length: 14 }, (_, index) => app.inject({ method: 'POST', url: '/api/v1/spaces', headers: auth(alice), payload: { name: `Space ${index}` } })));
  assert.equal(attempts.filter((response) => response.statusCode === 201).length, 10);
  for (const response of attempts.filter((item) => item.statusCode !== 201)) {
    assert.equal(response.json().error.code, 'space_limit_reached');
    assert.deepEqual(response.json().error.details, { current: 10, limit: 10 });
  }
  assert.equal((await createSpace(app, bob, 'Independent')).name, 'Independent');

  const spaceId = attempts.find((response) => response.statusCode === 201).json().data.spaceId;
  await reauthenticate(app, alice);
  const clients = await Promise.all(Array.from({ length: 14 }, (_, index) => app.inject({ method: 'POST', url: `/api/v1/spaces/${spaceId}/clients`, headers: auth(alice), payload: { name: `Client ${index}` } })));
  assert.equal(clients.filter((response) => response.statusCode === 201).length, 10);
  for (const response of clients.filter((item) => item.statusCode !== 201)) {
    assert.equal(response.json().error.code, 'client_limit_reached');
    assert.deepEqual(response.json().error.details, { current: 10, limit: 10 });
  }
});

test('structured logging redacts credentials and secret body fields', async (t) => {
  let output = '';
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-key` });
  const app = await buildServer({
    config,
    logger: {
      level: 'info',
      redact: {
        paths: ['request.headers.authorization', 'request.headers.cookie', 'request.headers.x-csrf-token', 'body.password', 'body.clientKey'],
        censor: '[REDACTED]'
      },
      stream: { write(chunk) { output += chunk; } }
    }
  });
  t.after(() => app.close());
  const key = 'dpk_v1_logging-secret-material';
  const password = 'logging-password-material';
  app.log.info({ request: { headers: { authorization: `ClientKey ${key}`, cookie: 'dp_session=cookie-secret', 'x-csrf-token': 'csrf-secret' } }, body: { password, clientKey: key } }, 'redaction fixture');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(output.includes(key), false);
  assert.equal(output.includes(password), false);
  assert.equal(output.includes('cookie-secret'), false);
  assert.equal(output.includes('csrf-secret'), false);
  assert.match(output, /REDACTED/);
});

test('admin-domain account lifecycle is callable without loopback HTTP', async (t) => {
  const { app, closed } = await fixture();
  t.after(() => app.close());
  const created = await app.identity.createAccount({ username: 'Operator Managed', password: 'correct horse battery staple', mustChangePassword: true });
  assert.equal(created.mustChangePassword, true);
  assert.ok((await app.identity.listAccounts()).some((row) => row.accountId === created.accountId));
  assert.equal((await app.identity.setAccountStatus(created.accountId, 'disabled')).status, 'disabled');
  assert.ok(closed.accounts.includes(created.accountId));
  assert.equal((await app.identity.setAccountStatus(created.accountId, 'active')).status, 'active');
  assert.equal((await app.identity.resetPassword(created.accountId, 'another correct horse password')).mustChangePassword, true);
});
