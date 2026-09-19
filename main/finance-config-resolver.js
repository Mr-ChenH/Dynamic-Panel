function createFinanceConfigResolver({ readSettings, decryptStoredSecret, environment = process.env }) {
  function normalizeSecEdgarContact(value) {
    const contact = String(value || '').trim().slice(0, 160);
    return contact.includes('@') && !/[\r\n]/.test(contact) ? contact : '';
  }

  function resolve() {
    const stored = readSettings();
    const environmentCoinGeckoKey = String(environment.COINGECKO_API_KEY || '').trim();
    const environmentAlphaVantageKey = String(environment.ALPHA_VANTAGE_API_KEY || '').trim();
    const environmentAlpacaKey = String(environment.ALPACA_API_KEY_ID || '').trim();
    const environmentAlpacaSecret = String(environment.ALPACA_API_SECRET_KEY || '').trim();
    const environmentTwelveDataKey = String(environment.TWELVE_DATA_API_KEY || '').trim();
    const environmentSecEdgarContact = normalizeSecEdgarContact(environment.SEC_EDGAR_CONTACT);
    const environmentQuantDashKey = String(environment.QUANTDASH_API_KEY || '').trim();
    const coinGeckoKey = environmentCoinGeckoKey || decryptStoredSecret(stored.providers.coingecko.encryptedApiKey).trim();
    const alphaVantageKey = environmentAlphaVantageKey || decryptStoredSecret(stored.providers['alpha-vantage'].encryptedApiKey).trim();
    const alpacaKey = environmentAlpacaKey || decryptStoredSecret(stored.providers.alpaca.encryptedKeyId).trim();
    const alpacaSecret = environmentAlpacaSecret || decryptStoredSecret(stored.providers.alpaca.encryptedSecretKey).trim();
    const twelveDataKey = environmentTwelveDataKey || decryptStoredSecret(stored.providers['twelve-data'].encryptedApiKey).trim();
    const secEdgarContact = environmentSecEdgarContact || normalizeSecEdgarContact(decryptStoredSecret(stored.providers['sec-edgar'].encryptedContact));
    const quantDashKey = environmentQuantDashKey || decryptStoredSecret(stored.providers['cn-stock'].encryptedApiKey).trim();
    return {
      coingecko: {
        enabled: stored.providers.coingecko.enabled,
        apiKey: coinGeckoKey,
        credentialSource: environmentCoinGeckoKey ? 'environment' : coinGeckoKey ? 'stored' : 'none',
      },
      binance: { enabled: stored.providers.binance.enabled },
      alphaVantage: {
        enabled: stored.providers['alpha-vantage'].enabled,
        apiKey: alphaVantageKey,
        credentialSource: environmentAlphaVantageKey ? 'environment' : alphaVantageKey ? 'stored' : 'none',
      },
      alpaca: {
        enabled: stored.providers.alpaca.enabled,
        feed: stored.providers.alpaca.feed,
        keyId: alpacaKey,
        secretKey: alpacaSecret,
        credentialSource: environmentAlpacaKey && environmentAlpacaSecret ? 'environment' : alpacaKey && alpacaSecret ? 'stored' : 'none',
      },
      twelveData: {
        enabled: stored.providers['twelve-data'].enabled,
        apiKey: twelveDataKey,
        credentialSource: environmentTwelveDataKey ? 'environment' : twelveDataKey ? 'stored' : 'none',
      },
      secEdgar: {
        enabled: stored.providers['sec-edgar'].enabled,
        contact: secEdgarContact,
        credentialSource: environmentSecEdgarContact ? 'environment' : secEdgarContact ? 'stored' : 'none',
      },
      cnStock: {
        enabled: stored.providers['cn-stock'].enabled,
        apiKey: quantDashKey,
        credentialSource: environmentQuantDashKey ? 'environment' : quantDashKey ? 'stored' : 'none',
        label: 'QuantDash',
      },
      cnTencent: { enabled: stored.providers['cn-tencent'].enabled },
      cnEastmoney: { enabled: stored.providers['cn-eastmoney'].enabled },
      cnSina: { enabled: stored.providers['cn-sina'].enabled },
    };
  }

  return Object.freeze({ normalizeSecEdgarContact, resolve });
}

module.exports = { createFinanceConfigResolver };
