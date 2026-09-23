import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BackupService } from '../src/backup/service.js';
import { RestoreService } from '../src/backup/restore.js';
import { composeCli } from '../src/cli/index.js';
import { runCli, EXIT } from '../src/cli/run.js';

function deps(overrides = {}) {
  return {
    operations: {
      async account(action, input) { return { action, accountId: input.accountId ?? 'created', mustChangePassword: true }; },
      async limits() { return { activeSpaces: 10, activeClientsPerSpace: 10 }; }, async usage() { return []; }, async audit() { return []; },
      async migration() { return { applied: [] }; }, async doctor() { return { status: 'ok' }; }
    },
    backup: { async create() { return { status: 'verified' }; }, async list() { return []; }, async verify() { return { status: 'verified' }; }, async prune() { return {}; }, async health() { return { status: 'ok' }; } },
    restore: { async stage() { return { ready: true }; }, async apply() { return { affectedSpaces: [] }; }, async drill() { return { status: 'passed' }; } },
    exporter: { async create() { return { status: 'verified' }; } }, importer: { async stage() { return { ready: true }; }, async apply(_stage, input) { return { affectedSpaces: [], input }; } }, ...overrides
  };
}

test('valid environment composes real backup and restore CLI services without external infrastructure', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dp-cli-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let ended = 0;
  const pool = { async end() { ended += 1; } };
  const env = {
    NODE_ENV: 'test', DATABASE_URL: 'postgres://not-contacted.invalid/test',
    DP_BACKUP_TARGET: 'filesystem', DP_BACKUP_PATH: root,
    DP_BACKUP_MASTER_KEY: randomBytes(32).toString('base64'), DP_BACKUP_KEY_ID: 'test-key'
  };
  const composed = await composeCli(env, { createPool: () => pool });
  assert.ok(composed.cli.backup instanceof BackupService);
  assert.ok(composed.cli.exporter instanceof BackupService);
  assert.ok(composed.cli.restore instanceof RestoreService);
  assert.ok(composed.cli.importer instanceof RestoreService);
  assert.equal((await composed.cli.backup.health()).alerts[0].code, 'backup_missing');
  await composed.pool.end();
  assert.equal(ended, 1);
});

test('CLI returns stable JSON success and error exit codes', async () => {
  let output = ''; let errors = '';
  const ok = await runCli(['doctor'], { ...deps(), stdout: (value) => { output += value; }, stderr: (value) => { errors += value; } });
  assert.equal(ok, EXIT.OK); assert.equal(JSON.parse(output).ok, true); assert.equal(errors, '');
  const invalid = await runCli(['unknown'], { ...deps(), stdout() {}, stderr: (value) => { errors = value; } });
  assert.equal(invalid, EXIT.INVALID); assert.equal(JSON.parse(errors).code, 'UNKNOWN_COMMAND');
  const corrupt = await runCli(['backup', 'verify', 'bad'], { ...deps({ backup: { async verify() { throw Object.assign(new Error('corrupt'), { code: 'BACKUP_VERIFICATION_FAILED' }); } } }), stdout() {}, stderr: (value) => { errors = value; } });
  assert.equal(corrupt, EXIT.VERIFICATION); assert.equal(JSON.parse(errors).code, 'BACKUP_VERIFICATION_FAILED');
  output = ''; errors = '';
  const imported = await runCli(['import', 'apply', 'stage-1', '--account', 'account-1', '--space', 'space-1', '--confirm', 'IMPORT'], { ...deps(), stdout: (value) => { output = value; }, stderr: (value) => { errors = value; } });
  assert.equal(imported, EXIT.OK); assert.equal(JSON.parse(output).data.input.confirmation, 'RESTORE'); assert.equal(errors, '');
  const unconfirmed = await runCli(['import', 'apply', 'stage-1', '--account', 'account-1'], { ...deps(), stdout() {}, stderr: (value) => { errors = value; } });
  assert.equal(unconfirmed, EXIT.CONFLICT); assert.equal(JSON.parse(errors).code, 'IMPORT_CONFIRMATION_REQUIRED');
});

test('CLI rejects argv secrets and redacts result fields', async () => {
  const password = 'plaintext-password-never-print'; let errors = ''; let output = '';
  const rejected = await runCli(['account', 'create', '--username', 'a', '--password', password], { ...deps(), stdout() {}, stderr: (value) => { errors += value; } });
  assert.equal(rejected, EXIT.INVALID); assert.equal(errors.includes(password), false); assert.equal(JSON.parse(errors).code, 'SECRET_ARGUMENT_FORBIDDEN');
  const safe = await runCli(['account', 'create', '--username', 'a'], { ...deps(), env: { DP_ADMIN_PASSWORD: password }, stdout: (value) => { output = value; }, stderr() {} });
  assert.equal(safe, EXIT.OK); assert.equal(output.includes(password), false); assert.equal(output.includes('clientKey'), false);
});
