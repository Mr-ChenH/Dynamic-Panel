import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireKey(key, label) {
  const value = Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64');
  if (value.length !== 32) throw new TypeError(`${label} must be exactly 32 bytes`);
  return value;
}

export function encryptAesGcm(plaintext, key, { aad = '', nonce = randomBytes(NONCE_BYTES) } = {}) {
  const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
  const cipher = createCipheriv(ALGORITHM, requireKey(key, 'encryption key'), nonce);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  return {
    ciphertext,
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    plainBytes: input.length,
    cipherBytes: ciphertext.length,
    plainSha256: sha256(input),
    cipherSha256: sha256(ciphertext)
  };
}

export function decryptAesGcm(envelope, key, { aad = '' } = {}) {
  const ciphertext = Buffer.isBuffer(envelope.ciphertext) ? envelope.ciphertext : Buffer.from(envelope.ciphertext, 'base64');
  const actualDigest = Buffer.from(sha256(ciphertext), 'hex');
  const expectedDigest = Buffer.from(envelope.cipherSha256, 'hex');
  if (actualDigest.length !== expectedDigest.length || !timingSafeEqual(actualDigest, expectedDigest)) {
    throw verificationError('ciphertext_digest_mismatch');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, requireKey(key, 'decryption key'), Buffer.from(envelope.nonce, 'base64url'));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length !== envelope.plainBytes || sha256(plaintext) !== envelope.plainSha256) {
      throw verificationError('plaintext_digest_mismatch');
    }
    return plaintext;
  } catch (error) {
    if (error.code === 'BACKUP_VERIFICATION_FAILED') throw error;
    throw verificationError('authentication_tag_mismatch', error);
  }
}

export function wrapDataKey(dataKey, masterKey, keyId) {
  const envelope = encryptAesGcm(requireKey(dataKey, 'data key'), masterKey, { aad: `dynamic-panel-backup-key:${keyId}` });
  return {
    algorithm: 'AES-256-GCM',
    keyId,
    nonce: envelope.nonce,
    tag: envelope.tag,
    cipherSha256: envelope.cipherSha256,
    plainSha256: envelope.plainSha256,
    plainBytes: envelope.plainBytes,
    wrappedKey: envelope.ciphertext.toString('base64')
  };
}

export function unwrapDataKey(wrapped, masterKey) {
  return decryptAesGcm({ ...wrapped, ciphertext: wrapped.wrappedKey }, masterKey, {
    aad: `dynamic-panel-backup-key:${wrapped.keyId}`
  });
}

export function newDataKey() { return randomBytes(32); }

export function verificationError(reason, cause) {
  const error = new Error(`Backup verification failed: ${reason}`, { cause });
  error.code = 'BACKUP_VERIFICATION_FAILED';
  error.reason = reason;
  return error;
}
