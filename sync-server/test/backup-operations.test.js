import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BackupService } from '../src/backup/service.js';
import { MemoryRestoreRepository } from '../src/backup/memory-repository.js';
import { RestoreService } from '../src/backup/restore.js';
import { selectRetention } from '../src/backup/retention.js';
import { FilesystemBackupTarget } from '../src/backup/targets.js';
import { BackupJob } from '../src/jobs/backup.js';

async function fixture(t, { withObject = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dp-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = new FilesystemBackupTarget(root);
  const data = { accounts: [{ accountId: 'a' }], spaces: [{ accountId: 'a', spaceId: 'one', restoreEpoch: 3 }, { accountId: 'a', spaceId: 'two', restoreEpoch: 8 }], records: [{ body: 'encrypted content' }] };
  const objectBody = Buffer.from('referenced-object-plaintext');
  const objectEntries = withObject ? [{ objectId: 'obj_test', accountId: 'a', spaceId: 'one', bytes: objectBody.length, digest: `sha256:${createHash('sha256').update(objectBody).digest('hex')}`, body: objectBody }] : [];
  const source = { async snapshot() { return { databaseSchema: 1, instanceId: 'instance', spaces: data.spaces, data, objectEntries }; } };
  let next = 1;
  const backup = new BackupService({ source, target, masterKey: randomBytes(32), keyId: 'test-master', id: () => `point-${next++}`, chunkBytes: 9 });
  return { root, target, backup, data, objectBody };
}

test('valid point decrypts and corruption or missing commit marker fails', async (t) => {
  const { root, backup, data } = await fixture(t);
  const point = await backup.create();
  assert.deepEqual((await backup.verify(point.manifestId)).data, data);
  const files = await backup.target.list(`points/${point.manifestId}/chunks/`);
  const file = path.join(root, ...files[0].split('/'));
  const body = await readFile(file); body[0] ^= 0xff; await writeFile(file, body);
  await assert.rejects(backup.verify(point.manifestId), (error) => error.code === 'BACKUP_VERIFICATION_FAILED');
});

test('encrypted target contains no logical plaintext or master key', async (t) => {
  const { backup, target } = await fixture(t);
  const point = await backup.create();
  for (const key of await target.list(`points/${point.manifestId}/`)) {
    const value = await target.get(key);
    assert.equal(value.includes('encrypted content'), false);
  }
});

test('referenced object bytes are encrypted, authenticated, and required by staging', async (t) => {
  const { root, backup, target, objectBody } = await fixture(t, { withObject: true });
  const point = await backup.create();
  const verified = await backup.verify(point.manifestId);
  assert.deepEqual(verified.objects.map((item) => item.bytes), [objectBody]);
  for (const key of await target.list(`points/${point.manifestId}/objects/`)) assert.equal((await target.get(key)).includes(objectBody), false);

  const objectKeys = await target.list(`points/${point.manifestId}/objects/`);
  await rm(path.join(root, ...objectKeys[0].split('/')));
  await assert.rejects(backup.verify(point.manifestId), (error) => error.code === 'BACKUP_VERIFICATION_FAILED' && error.reason === 'missing_entry');
  const restore = new RestoreService({ backup, repository: new MemoryRestoreRepository() });
  await assert.rejects(restore.stage(point.manifestId), (error) => error.code === 'BACKUP_VERIFICATION_FAILED');
});

test('corrupt referenced object artifact fails verification before staging mutation', async (t) => {
  const { root, backup, target } = await fixture(t, { withObject: true });
  const point = await backup.create();
  const objectKeys = await target.list(`points/${point.manifestId}/objects/`);
  const file = path.join(root, ...objectKeys.at(-1).split('/'));
  const body = await readFile(file); body[0] ^= 0xff; await writeFile(file, body);
  const repository = new MemoryRestoreRepository();
  const restore = new RestoreService({ backup, repository });
  await assert.rejects(restore.stage(point.manifestId), (error) => error.code === 'BACKUP_VERIFICATION_FAILED');
  assert.equal(repository.stages.size, 0);
  assert.equal(repository.mutations, 0);
});

test('retention selects at least 7 daily, 4 weekly and 12 monthly slots', () => {
  const points = Array.from({ length: 400 }, (_, index) => ({ id: `p${index}`, manifestId: `p${index}`, status: 'verified', createdAt: new Date(Date.UTC(2026, 11, 31 - index)).toISOString() }));
  const result = selectRetention(points, { daily: 7, weekly: 4, monthly: 12 });
  assert.ok(result.keep.length >= 12);
  assert.deepEqual(result.keep.slice(0, 7).map((point) => point.id), points.slice(0, 7).map((point) => point.id));
});

test('failed backup never invokes retention pruning', async () => {
  let pruneCalls = 0;
  const job = new BackupJob({ backup: { async create() { throw Object.assign(new Error('write failed'), { code: 'BACKUP_UNAVAILABLE' }); }, async prune() { pruneCalls += 1; } } });
  await assert.rejects(job.run());
  assert.equal(pruneCalls, 0);
});

test('stage dry run has no mutation and scoped activation changes only affected epoch', async (t) => {
  const { backup } = await fixture(t);
  const point = await backup.create();
  const repository = new MemoryRestoreRepository({ accounts: [{ accountId: 'a' }], spaces: [{ accountId: 'a', spaceId: 'one', restoreEpoch: 10, marker: 'online' }, { accountId: 'a', spaceId: 'two', restoreEpoch: 20, marker: 'untouched' }] });
  const restore = new RestoreService({ backup, repository });
  const dry = await restore.stage(point.manifestId, { dryRun: true });
  assert.equal(dry.ready, true); assert.equal(repository.stages.size, 0); assert.equal(repository.mutations, 0);
  const stage = await restore.stage(point.manifestId);
  const applied = await restore.apply(stage.stageId, { scope: { type: 'space', accountId: 'a', spaceId: 'one' }, confirmation: 'RESTORE', createPreRestore: false });
  assert.equal(applied.affectedSpaces[0].restoreEpoch, 11);
  assert.equal(repository.online.spaces.find((space) => space.spaceId === 'two').restoreEpoch, 20);
  assert.equal(repository.online.spaces.find((space) => space.spaceId === 'two').marker, 'untouched');
});
