function createFinanceSettingsStore({ readJsonFile, writeJsonFile, getSettingsPath, fileName }) {
  function read() {
    const stored = readJsonFile(getSettingsPath(fileName));
    const providers = stored.providers && typeof stored.providers === 'object' && !Array.isArray(stored.providers)
      ? stored.providers : {};
    const coingecko = providers.coingecko && typeof providers.coingecko === 'object' ? providers.coingecko : {};
    const binance = providers.binance && typeof providers.binance === 'object' ? providers.binance : {};
    const alphaVantage = providers['alpha-vantage'] && typeof providers['alpha-vantage'] === 'object' ? providers['alpha-vantage'] : {};
    const alpaca = providers.alpaca && typeof providers.alpaca === 'object' ? providers.alpaca : {};
    const twelveData = providers['twelve-data'] && typeof providers['twelve-data'] === 'object' ? providers['twelve-data'] : {};
    const secEdgar = providers['sec-edgar'] && typeof providers['sec-edgar'] === 'object' ? providers['sec-edgar'] : {};
    const cnStock = providers['cn-stock'] && typeof providers['cn-stock'] === 'object' ? providers['cn-stock'] : {};
    const cnTencent = providers['cn-tencent'] && typeof providers['cn-tencent'] === 'object' ? providers['cn-tencent'] : {};
    const cnEastmoney = providers['cn-eastmoney'] && typeof providers['cn-eastmoney'] === 'object' ? providers['cn-eastmoney'] : {};
    const cnSina = providers['cn-sina'] && typeof providers['cn-sina'] === 'object' ? providers['cn-sina'] : {};
    const refreshSeconds = [0, 30, 60, 120, 300].includes(Number(stored.refreshSeconds)) ? Number(stored.refreshSeconds) : 60;
    return {
      schemaVersion: 2,
      refreshSeconds,
      providers: {
        coingecko: {
          enabled: coingecko.enabled !== false,
          encryptedApiKey: String(coingecko.encryptedApiKey || ''),
          verification: coingecko.verification && typeof coingecko.verification === 'object' ? coingecko.verification : null,
        },
        binance: {
          enabled: binance.enabled !== false,
          verification: binance.verification && typeof binance.verification === 'object' ? binance.verification : null,
        },
        'alpha-vantage': {
          enabled: alphaVantage.enabled === true,
          encryptedApiKey: String(alphaVantage.encryptedApiKey || ''),
          verification: alphaVantage.verification && typeof alphaVantage.verification === 'object' ? alphaVantage.verification : null,
        },
        alpaca: {
          enabled: alpaca.enabled === true,
          feed: alpaca.feed === 'sip' ? 'sip' : 'iex',
          encryptedKeyId: String(alpaca.encryptedKeyId || ''),
          encryptedSecretKey: String(alpaca.encryptedSecretKey || ''),
          verification: alpaca.verification && typeof alpaca.verification === 'object' ? alpaca.verification : null,
        },
        'twelve-data': {
          enabled: twelveData.enabled === true,
          encryptedApiKey: String(twelveData.encryptedApiKey || ''),
          verification: twelveData.verification && typeof twelveData.verification === 'object' ? twelveData.verification : null,
        },
        'sec-edgar': {
          enabled: secEdgar.enabled === true,
          encryptedContact: String(secEdgar.encryptedContact || ''),
          verification: secEdgar.verification && typeof secEdgar.verification === 'object' ? secEdgar.verification : null,
        },
        'cn-stock': {
          enabled: cnStock.enabled === true,
          encryptedApiKey: String(cnStock.encryptedApiKey || ''),
          verification: cnStock.verification && typeof cnStock.verification === 'object' ? cnStock.verification : null,
        },
        'cn-tencent': {
          enabled: cnTencent.enabled !== false,
          verification: cnTencent.verification && typeof cnTencent.verification === 'object' ? cnTencent.verification : null,
        },
        'cn-eastmoney': {
          enabled: cnEastmoney.enabled !== false,
          verification: cnEastmoney.verification && typeof cnEastmoney.verification === 'object' ? cnEastmoney.verification : null,
        },
        'cn-sina': {
          enabled: cnSina.enabled !== false,
          verification: cnSina.verification && typeof cnSina.verification === 'object' ? cnSina.verification : null,
        },
      },
    };
  }

  function write(settings) {
    return writeJsonFile(getSettingsPath(fileName), settings);
  }

  return Object.freeze({ read, write });
}

module.exports = { createFinanceSettingsStore };
