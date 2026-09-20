const test = require('node:test');
const assert = require('node:assert/strict');
const { createStoredSecretDecryptor } = require('../main/secret-decryptor');

test('stored secret decryptor decodes encrypted values only when safe storage is available', () => {
  const calls = [];
  const decrypt = createStoredSecretDecryptor({
    safeStorage: {
      isEncryptionAvailable: () => true,
      decryptString: (value) => {
        calls.push(value.toString('utf8'));
        return 'decoded';
      },
    },
  });
  assert.equal(decrypt(Buffer.from('secret').toString('base64')), 'decoded');
  assert.deepEqual(calls, ['secret']);
});

test('stored secret decryptor returns empty values for unavailable or invalid credentials', () => {
  const unavailable = createStoredSecretDecryptor({ safeStorage: { isEncryptionAvailable: () => false, decryptString: () => 'unexpected' } });
  assert.equal(unavailable('encoded'), '');
  const invalid = createStoredSecretDecryptor({
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('invalid'); } },
  });
  assert.equal(invalid('encoded'), '');
  assert.equal(invalid(''), '');
});
