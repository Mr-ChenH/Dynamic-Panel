import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { MemoryIdentityStore } from '../src/auth/memory-store.js';

const SECRET = 'security-acceptance-secret-at-least-32-bytes';
const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://127.0.0.1:43822';

async function fixture() {
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup` });
  const store = new MemoryIdentityStore();
  const app = await buildServer({ config, store, logger: false });
  return { app, store };
}

async function accountSession(app, username) {
  await app.identity.createAccount({ username, password: PASSWORD });
  const login = await app.inject({ method: 'POST', url: '/api/v1/account/login', headers: { origin: ORIGIN }, payload: { username, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.headers['set-cookie'].split(';', 1)[0];
  const current = await app.inject({ method: 'GET', url: '/api/v1/account/session', headers: { cookie } });
  return { cookie, csrf: current.json().data.csrfToken, accountId: current.json().data.account.accountId };
}

function protectedHeaders(session) {
  return { cookie: session.cookie, origin: ORIGIN, 'x-csrf-token': session.csrf };
}

async function reauthenticate(app, session) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/account/reauthenticate', headers: protectedHeaders(session), payload: { password: PASSWORD } });
  assert.equal(response.statusCode, 200, response.body);
}

async function createSpace(app, session, name) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: protectedHeaders(session), payload: { name } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data;
}

async function createClient(app, session, spaceId, name) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/spaces/${spaceId}/clients`, headers: protectedHeaders(session), payload: { name } });
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

async function errorShape(response) {
  const body = response.json();
  return { statusCode: response.statusCode, error: body.error };
}

test('FR-130/NFR-018: every management ID boundary rejects cross-account substitutions like random missing IDs', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const alice = await accountSession(app, 'alice-security');
  const bob = await accountSession(app, 'bob-security');
  const aliceSpace = await createSpace(app, alice, 'Alice space');
  const bobSpace = await createSpace(app, bob, 'Bob space');
  await reauthenticate(app, alice);
  const aliceClient = await createClient(app, alice, aliceSpace.spaceId, 'Alice client');
  const randomSpace = '6d7f66ed-fc4a-4cec-aa44-8493180c5f5d';
  const randomClient = '07baad86-4f9b-45c9-a961-8f1f45d757f4';

  const cases = [
    ['GET', `/api/v1/spaces/${aliceSpace.spaceId}`, `/api/v1/spaces/${randomSpace}`],
    ['GET', `/api/v1/spaces/${aliceSpace.spaceId}/clients`, `/api/v1/spaces/${randomSpace}/clients`],
    ['GET', `/api/v1/spaces/${aliceSpace.spaceId}/deletion-impact`, `/api/v1/spaces/${randomSpace}/deletion-impact`],
    ['PATCH', `/api/v1/spaces/${aliceSpace.spaceId}`, `/api/v1/spaces/${randomSpace}`, { name: 'stolen' }],
    ['PATCH', `/api/v1/spaces/${aliceSpace.spaceId}/clients/${aliceClient.clientId}`, `/api/v1/spaces/${bobSpace.spaceId}/clients/${randomClient}`, { name: 'stolen' }],
    ['POST', `/api/v1/spaces/${aliceSpace.spaceId}/clients/${aliceClient.clientId}/rotate-key`, `/api/v1/spaces/${bobSpace.spaceId}/clients/${randomClient}/rotate-key`, { overlapSeconds: 0 }],
    ['POST', `/api/v1/spaces/${aliceSpace.spaceId}/clients/${aliceClient.clientId}/revoke`, `/api/v1/spaces/${bobSpace.spaceId}/clients/${randomClient}/revoke`, {}],
    ['POST', `/api/v1/spaces/${aliceSpace.spaceId}/clients/${aliceClient.clientId}/reset-installation`, `/api/v1/spaces/${bobSpace.spaceId}/clients/${randomClient}/reset-installation`, {}]
  ];

  await reauthenticate(app, bob);
  for (const [method, foreignUrl, missingUrl, payload] of cases) {
    const request = { method, headers: protectedHeaders(bob), ...(payload === undefined ? {} : { payload }) };
    const foreign = await app.inject({ ...request, url: foreignUrl });
    const missing = await app.inject({ ...request, url: missingUrl });
    assert.deepEqual(await errorShape(foreign), await errorShape(missing), `${method} ${foreignUrl}`);
    assert.equal(foreign.statusCode, 404, foreign.body);
  }
});

test('FR-143/AC-045: one-time Key creation, rotation, and revocation require recent authentication', async (t) => {
  const { app, store } = await fixture();
  t.after(() => app.close());
  const session = await accountSession(app, 'recent-auth-user');
  const space = await createSpace(app, session, 'Recent auth');

  const createWithoutRecentAuth = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients`, headers: protectedHeaders(session), payload: { name: 'Unverified client' } });
  await reauthenticate(app, session);
  const first = await createClient(app, session, space.spaceId, 'Rotation target');
  const second = await createClient(app, session, space.spaceId, 'Revocation target');
  for (const row of store.sessions.values()) row.recentAuthAt = null;
  const rotateWithoutRecentAuth = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${first.clientId}/rotate-key`, headers: protectedHeaders(session), payload: { overlapSeconds: 0 } });
  const revokeWithoutRecentAuth = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${second.clientId}/revoke`, headers: protectedHeaders(session), payload: {} });

  assert.deepEqual({
    create: [createWithoutRecentAuth.statusCode, createWithoutRecentAuth.json().error?.code],
    rotate: [rotateWithoutRecentAuth.statusCode, rotateWithoutRecentAuth.json().error?.code],
    revoke: [revokeWithoutRecentAuth.statusCode, revokeWithoutRecentAuth.json().error?.code]
  }, {
    create: [403, 'recent_auth_required'],
    rotate: [403, 'recent_auth_required'],
    revoke: [403, 'recent_auth_required']
  });
});

test('FR-009/AC-035: ClientKey authentication cannot access account management or usage', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const session = await accountSession(app, 'scheme-user');
  const space = await createSpace(app, session, 'Scheme space');
  await reauthenticate(app, session);
  const client = await createClient(app, session, space.spaceId, 'Scheme client');
  for (const url of ['/api/v1/account/session', '/api/v1/spaces', '/api/v1/usage', '/api/v1/audit']) {
    const keyed = await app.inject({ method: 'GET', url, headers: { authorization: `ClientKey ${client.clientKey}` } });
    const anonymous = await app.inject({ method: 'GET', url });
    assert.deepEqual(await errorShape(keyed), await errorShape(anonymous), url);
    assert.equal(keyed.statusCode, 401);
  }
});

test('FR-125/NFR-007: unknown, revoked, wrong-installation, and query-only Keys have generic failures', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const session = await accountSession(app, 'generic-auth-user');
  const space = await createSpace(app, session, 'Generic auth');
  await reauthenticate(app, session);
  const client = await createClient(app, session, space.spaceId, 'Generic client');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(client.clientKey), payload: {} })).statusCode, 200);
  const mismatch = await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(client.clientKey, 'bfdb27ca-846c-4ea1-b204-615401889c15'), payload: {} });
  await reauthenticate(app, session);
  await app.inject({ method: 'POST', url: `/api/v1/spaces/${space.spaceId}/clients/${client.clientId}/revoke`, headers: protectedHeaders(session), payload: {} });
  const revoked = await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(client.clientKey), payload: {} });
  const unknown = await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(`dpk_v1_${'A'.repeat(43)}`), payload: {} });
  const queryHeaders = syncHeaders(client.clientKey); delete queryHeaders.authorization;
  const queryOnly = await app.inject({ method: 'POST', url: `/api/v1/sync/session?clientKey=${encodeURIComponent(client.clientKey)}`, headers: queryHeaders, payload: {} });
  assert.deepEqual(await errorShape(mismatch), await errorShape(unknown));
  assert.deepEqual(await errorShape(revoked), await errorShape(unknown));
  assert.deepEqual(await errorShape(queryOnly), await errorShape(unknown));
});

test('FR-126/AC-037: re-enabled accounts can resume with existing Client Keys after reconciliation', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const session = await accountSession(app, 'reenable-user');
  const space = await createSpace(app, session, 'Re-enable');
  await reauthenticate(app, session);
  const client = await createClient(app, session, space.spaceId, 'Stable key');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(client.clientKey), payload: {} })).statusCode, 200);

  await app.identity.disableAccount(session.accountId, 'test-disable');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(client.clientKey), payload: {} })).statusCode, 401);
  await app.identity.enableAccount(session.accountId, 'test-enable');
  const resumed = await app.inject({ method: 'POST', url: '/api/v1/sync/session', headers: syncHeaders(client.clientKey), payload: {} });
  assert.equal(resumed.statusCode, 200, 're-enable currently leaves every pre-disable Key permanently invalid');
});

test('FR-003/FR-151/AC-060: public registration and all MFA route families are absent', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  for (const url of ['/api/v1/account/register', '/api/v1/register', '/api/v1/account/mfa', '/api/v1/account/mfa/enroll', '/api/v1/account/recovery-codes']) {
    const response = await app.inject({ method: 'POST', url, payload: {} });
    assert.equal(response.statusCode, 404, url);
  }
});
