'use strict';

function createStoredSecretDecryptor({ safeStorage, BufferImpl = Buffer } = {}) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || typeof safeStorage.decryptString !== 'function') {
    throw new TypeError('safeStorage is required');
  }
  return function decryptStoredSecret(value) {
    if (!value || !safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(BufferImpl.from(String(value), 'base64'));
    } catch (error) {
      return '';
    }
  };
}

module.exports = { createStoredSecretDecryptor };
