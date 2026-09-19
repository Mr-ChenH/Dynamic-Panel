function createFinanceProviderSettings({
  readSettings,
  writeSettings,
  normalizeSecEdgarContact,
  isEncryptionAvailable,
  encryptString,
  onSaved,
}) {
  const providerIds = new Set([
    'coingecko',
    'binance',
    'alpha-vantage',
    'alpaca',
    'twelve-data',
    'sec-edgar',
    'cn-stock',
    'cn-tencent',
    'cn-eastmoney',
    'cn-sina',
  ]);

  function encryptedValue(value) {
    return encryptString(value).toString('base64');
  }

  function update(payload = {}) {
    const providerId = String(payload.providerId || '');
    if (!providerIds.has(providerId)) return { ok: false, error: 'invalid_provider' };
    const current = readSettings();
    const apiKey = String(payload.apiKey || '').trim();
    const keyId = String(payload.keyId || '').trim();
    const secretKey = String(payload.secretKey || '').trim();
    const rawContact = String(payload.contact || '').trim();
    const contact = normalizeSecEdgarContact(rawContact);
    if (apiKey.length > 512 || keyId.length > 256 || secretKey.length > 512 || rawContact.length > 160) {
      return { ok: false, error: 'invalid_credential' };
    }
    if (providerId === 'sec-edgar' && rawContact && !contact) return { ok: false, error: 'invalid_contact' };
    if ((apiKey || keyId || secretKey || contact) && !isEncryptionAvailable()) {
      return { ok: false, error: 'secure_storage_unavailable' };
    }

    const providers = { ...current.providers };
    if (providerId === 'coingecko') {
      providers.coingecko = {
        enabled: payload.enabled !== false,
        encryptedApiKey: payload.removeCredential === true ? '' : apiKey
          ? encryptedValue(apiKey) : current.providers.coingecko.encryptedApiKey,
        verification: null,
      };
    } else if (providerId === 'binance') {
      providers.binance = { enabled: payload.enabled !== false, verification: null };
    } else if (providerId === 'alpha-vantage') {
      providers['alpha-vantage'] = {
        enabled: payload.enabled === true,
        encryptedApiKey: payload.removeCredential === true ? '' : apiKey
          ? encryptedValue(apiKey) : current.providers['alpha-vantage'].encryptedApiKey,
        verification: null,
      };
    } else if (providerId === 'alpaca') {
      providers.alpaca = {
        enabled: payload.enabled === true,
        feed: payload.feed === 'sip' ? 'sip' : 'iex',
        encryptedKeyId: payload.removeCredential === true ? '' : keyId
          ? encryptedValue(keyId) : current.providers.alpaca.encryptedKeyId,
        encryptedSecretKey: payload.removeCredential === true ? '' : secretKey
          ? encryptedValue(secretKey) : current.providers.alpaca.encryptedSecretKey,
        verification: null,
      };
    } else if (providerId === 'twelve-data') {
      providers['twelve-data'] = {
        enabled: payload.enabled === true,
        encryptedApiKey: payload.removeCredential === true ? '' : apiKey
          ? encryptedValue(apiKey) : current.providers['twelve-data'].encryptedApiKey,
        verification: null,
      };
    } else if (providerId === 'sec-edgar') {
      providers['sec-edgar'] = {
        enabled: payload.enabled === true,
        encryptedContact: payload.removeCredential === true ? '' : contact
          ? encryptedValue(contact) : current.providers['sec-edgar'].encryptedContact,
        verification: null,
      };
    } else if (providerId === 'cn-stock') {
      providers['cn-stock'] = {
        enabled: payload.enabled === true,
        encryptedApiKey: payload.removeCredential === true ? '' : apiKey
          ? encryptedValue(apiKey) : current.providers['cn-stock'].encryptedApiKey,
        verification: null,
      };
    } else {
      providers[providerId] = { enabled: payload.enabled !== false, verification: null };
    }

    if (!writeSettings({ schemaVersion: 2, refreshSeconds: current.refreshSeconds, providers })) {
      return { ok: false, error: 'save_failed' };
    }
    return onSaved();
  }

  return Object.freeze({ update });
}

module.exports = { createFinanceProviderSettings };
