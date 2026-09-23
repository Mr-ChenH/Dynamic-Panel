function createCredentialEnvelope({ secureStorage } = {}) {
  const available = Boolean(secureStorage && secureStorage.isEncryptionAvailable?.());
  const sessionSecrets = new Map();
  return Object.freeze({
    mode: available ? 'persistent-encrypted' : 'session-only',
    seal(id, secret) {
      if (typeof secret !== 'string' || !secret.startsWith('dpk_v1_')) throw new TypeError('invalid_client_key');
      if (available) return Object.freeze({ version: 1, kind: 'safeStorage', ciphertext: secureStorage.encryptString(secret).toString('base64') });
      sessionSecrets.set(String(id), secret);
      return Object.freeze({ version: 1, kind: 'session' });
    },
    open(id, envelope) {
      if (envelope?.kind === 'safeStorage' && available) return secureStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
      if (envelope?.kind === 'session' || !available) return sessionSecrets.get(String(id)) || null;
      return null;
    },
    remove(id) { sessionSecrets.delete(String(id)); },
    export(envelope) { return envelope?.kind === 'safeStorage' ? JSON.parse(JSON.stringify(envelope)) : null; },
  });
}

module.exports = { createCredentialEnvelope };
