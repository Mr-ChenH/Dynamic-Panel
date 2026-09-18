const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeCredentialInput } = require('../main-services');
const { createCredentialsVault } = require('../main/credentials-vault');
const { registerCredentialsIpc } = require('../main/ipc/credentials');

function createVault(root, available = true) {
  const reverse = (value) => [...value].reverse().join('');
  return createCredentialsVault({
    fs,
    safeStorage: {
      isEncryptionAvailable: () => available,
      encryptString: (value) => Buffer.from(reverse(value)),
      decryptString: (value) => reverse(value.toString()),
    },
    normalizeCredentialInput,
    vaultPath: path.join(root, 'credentials.vault.json'),
    randomId: () => 'credential-1',
    now: () => 1234,
    processId: 99,
  });
}

test('credentials vault encrypts, updates and deletes normalized records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-credentials-'));
  try {
    const vault = createVault(root);
    const saved = vault.save({ service: ' Example ', account: ' user ', password: ' secret ' });
    assert.deepEqual(saved, {
      ok: true,
      item: { id: 'credential-1', service: 'Example', account: 'user', passwordMask: '**********', createdAt: 1234 },
    });
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'credentials.vault.json'), 'utf8'), /secret/);
    assert.equal(vault.get('credential-1').item.password, ' secret ');

    const updated = vault.save({ id: 'credential-1', service: 'Example Cloud', account: 'next', password: '' });
    assert.equal(updated.ok, true);
    assert.equal(vault.get('credential-1').item.password, ' secret ');
    assert.deepEqual(vault.deleteMany(['credential-1']), { ok: true, deleted: 1 });
    assert.deepEqual(vault.get('credential-1'), { ok: false, error: 'not_found' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credentials vault reports unavailable secure storage without writing plaintext', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-credentials-'));
  try {
    const vault = createVault(root, false);
    assert.deepEqual(vault.list(), { ok: false, secureStorage: false, items: [] });
    assert.deepEqual(vault.save({ service: 'A', account: 'B', password: 'C' }), { ok: false, error: 'secure_storage_unavailable' });
    assert.equal(fs.existsSync(path.join(root, 'credentials.vault.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credentials IPC preserves copy behavior and clears only an unchanged password', async () => {
  const handlers = new Map();
  const scheduled = [];
  const writes = [];
  let clipboardValue = '';
  let clears = 0;
  const credentialsVault = {
    list: () => ({ ok: true, items: [] }),
    get: (id) => ({ ok: true, id }),
    save: (payload) => ({ ok: true, payload }),
    deleteMany: (ids) => ({ ok: true, deleted: ids.length }),
    value: (id, field) => id === 'one' ? `${field}-value` : null,
  };
  registerCredentialsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    credentialsVault,
    clipboard: {
      writeText: async (value) => { clipboardValue = value; writes.push(value); },
      readText: async () => clipboardValue,
      clear: () => { clears += 1; },
    },
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
  });
  assert.deepEqual([...handlers.keys()], [
    'credentials:list', 'credentials:get', 'credentials:save', 'credentials:delete-many', 'credentials:copy',
  ]);
  assert.equal(await handlers.get('credentials:copy')({}, { id: 'one', field: 'account' }), true);
  assert.equal(scheduled.length, 0);
  assert.equal(await handlers.get('credentials:copy')({}, { id: 'one', field: 'password' }), true);
  assert.deepEqual(writes, ['account-value', 'password-value']);
  assert.equal(scheduled[0].delay, 60_000);
  await scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clears, 1);

  assert.equal(await handlers.get('credentials:copy')({}, { id: 'one', field: 'password' }), true);
  clipboardValue = 'user-replaced-value';
  await scheduled[1].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clears, 1);
});
