import assert from 'node:assert/strict';
import test from 'node:test';
import { main as cliMain } from '../src/cli/index.js';
import { loadConfig } from '../src/config.js';
import { buildServer, startServer } from '../src/server.js';

const SECRET = 'integration-secret-with-at-least-32-bytes';
const config = () => loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup`, CURSOR_SECRET: `${SECRET}-cursor` });

test('composed server injects health and strict-CSP console assets', async (t) => {
  const app = await buildServer({ config: config(), logger: false });
  t.after(() => app.close());
  const health = await app.inject({ url: '/api/v1/health/ready' });
  assert.equal(health.statusCode, 200, health.body);
  assert.equal(health.json().data.status, 'ok');

  const consolePage = await app.inject({ url: '/console/login' });
  assert.equal(consolePage.statusCode, 200);
  assert.match(consolePage.headers['content-security-policy'], /default-src 'self'/);
  assert.match(consolePage.headers['content-security-policy'], /object-src 'none'/);
  assert.match(consolePage.body, /\/console\/app\.js/);

  const script = await app.inject({ url: '/console/app.js' });
  assert.equal(script.statusCode, 200);
  assert.match(script.headers['content-type'], /text\/javascript/);
});

test('account sessions and ClientKey credentials cannot cross route families', async (t) => {
  const app = await buildServer({ config: config(), logger: false });
  t.after(() => app.close());
  const accountWithClientKey = await app.inject({ url: '/api/v1/account/session', headers: { authorization: 'ClientKey dpk_v1_not-a-real-key' } });
  assert.equal(accountWithClientKey.statusCode, 401);
  const syncWithCookie = await app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { cookie: 'dp_session=not-a-client-key' }, payload: { operations: [] } });
  assert.equal(syncWithCookie.statusCode, 400);
  assert.notEqual(syncWithCookie.json().error?.code, undefined);
});

test('production config rejects missing infrastructure and shared local data roots', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/app', CONSOLE_ORIGIN: 'https://sync.example.com', TRUST_PROXY: '127.0.0.1', COOKIE_SECRET: SECRET, KEY_LOOKUP_SECRET: `${SECRET}-lookup`, CURSOR_SECRET: `${SECRET}-cursor`, DP_BACKUP_TARGET: 'filesystem', DP_BACKUP_MASTER_KEY: Buffer.alloc(32).toString('base64'), DP_OBJECT_TARGET: 'filesystem' };
  assert.throws(() => loadConfig({ ...base, DP_OBJECT_PATH: '/data/same', DP_BACKUP_PATH: '/data/same' }), /must be separate/);
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: undefined, DP_OBJECT_PATH: '/data/objects', DP_BACKUP_PATH: '/data/backups' }), /DATABASE_URL/);
});

test('CLI help requires no database and server start-stop drains cleanly', async () => {
  let output = '';
  assert.equal(await cliMain(['--help'], {}, { stdout: (value) => { output += value; } }), 0);
  assert.match(output, /backup run\|list\|verify/);

  const runtime = await startServer({ config: { ...config(), host: '127.0.0.1', port: 0 }, logger: false, signals: [] });
  assert.equal(runtime.app.server.listening, true);
  await runtime.shutdown();
  assert.equal(runtime.app.server.listening, false);
});
