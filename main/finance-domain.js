'use strict';

function boundedText(value, limit) {
  const text = String(value ?? '').trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

function providerStates(config = {}) {
  const coinGecko = config.coingecko || {};
  const binance = config.binance || {};
  const alphaVantage = config.alphaVantage || {};
  const alpaca = config.alpaca || {};
  const twelveData = config.twelveData || {};
  const secEdgar = config.secEdgar || {};
  const cnStock = config.cnStock || {};
  return [
    { id: 'coingecko', label: 'CoinGecko', market: 'crypto', enabled: coinGecko.enabled !== false, configured: true, credentialSource: boundedText(coinGecko.credentialSource, 24) || 'none', feed: '聚合 REST', state: coinGecko.enabled === false ? 'disabled' : 'ready' },
    { id: 'binance', label: 'Binance', market: 'crypto', enabled: binance.enabled !== false, configured: true, credentialSource: 'none', feed: '公共 REST', state: binance.enabled === false ? 'disabled' : 'ready' },
    { id: 'alpha-vantage', label: 'Alpha Vantage', market: 'us', enabled: alphaVantage.enabled === true, configured: Boolean(alphaVantage.apiKey), credentialSource: boundedText(alphaVantage.credentialSource, 24) || 'none', feed: 'Top Movers', state: alphaVantage.enabled !== true ? 'disabled' : alphaVantage.apiKey ? 'ready' : 'missing_credentials' },
    { id: 'alpaca', label: 'Alpaca', market: 'us', enabled: alpaca.enabled === true, configured: Boolean(alpaca.keyId && alpaca.secretKey), credentialSource: boundedText(alpaca.credentialSource, 24) || 'none', feed: alpaca.feed === 'sip' ? 'SIP' : 'IEX · 单一交易所', state: alpaca.enabled !== true ? 'disabled' : alpaca.keyId && alpaca.secretKey ? 'ready' : 'missing_credentials' },
    { id: 'twelve-data', label: 'Twelve Data', market: 'us', enabled: twelveData.enabled === true, configured: Boolean(twelveData.apiKey), credentialSource: boundedText(twelveData.credentialSource, 24) || 'none', feed: 'Basic US feed · 非 SIP', state: twelveData.enabled !== true ? 'disabled' : twelveData.apiKey ? 'ready' : 'missing_credentials' },
    { id: 'sec-edgar', label: 'SEC EDGAR', market: 'us', enabled: secEdgar.enabled === true, configured: Boolean(secEdgar.contact), credentialSource: boundedText(secEdgar.credentialSource, 24) || 'none', feed: '官方申报 XBRL · 非行情', state: secEdgar.enabled !== true ? 'disabled' : secEdgar.contact ? 'ready' : 'missing_credentials' },
    { id: 'cn-stock', label: boundedText(cnStock.label, 80) || 'QuantDash', market: 'cn', enabled: cnStock.enabled === true, configured: Boolean(cnStock.apiKey), credentialSource: boundedText(cnStock.credentialSource, 24) || 'none', feed: '实时快照 / 日 K', state: cnStock.enabled !== true ? 'disabled' : cnStock.apiKey ? 'ready' : 'missing_credentials' },
    { id: 'cn-tencent', label: '腾讯公开行情', market: 'cn', enabled: config.cnTencent?.enabled === true, configured: true, credentialSource: 'none', feed: '公开行情 · GBK', state: config.cnTencent?.enabled === true ? 'ready' : 'disabled' },
    { id: 'cn-eastmoney', label: '东方财富公开行情', market: 'cn', enabled: config.cnEastmoney?.enabled === true, configured: true, credentialSource: 'none', feed: '公开行情 · JSON', state: config.cnEastmoney?.enabled === true ? 'ready' : 'disabled' },
    { id: 'cn-sina', label: '新浪公开行情', market: 'cn', enabled: config.cnSina?.enabled === true, configured: true, credentialSource: 'none', feed: '公开行情 · GBK', state: config.cnSina?.enabled === true ? 'ready' : 'disabled' },
  ];
}

function financeError(error) {
  const code = boundedText(error?.code || error?.message, 80);
  if (/provider_disabled/i.test(code)) return 'provider_disabled';
  if (/not_configured|missing_credentials/i.test(code)) return 'not_configured';
  if (/permission_denied/i.test(code)) return 'permission_denied';
  if (/history_interval_not_supported/i.test(code)) return 'history_interval_not_supported';
  if (/cancel/i.test(code)) return 'cancelled';
  if (/http_429|rate/i.test(code)) return 'rate_limited';
  if (/http_401|authentication/i.test(code)) return 'authentication_failed';
  if (/http_403|permission/i.test(code)) return 'permission_denied';
  if (/abort|timeout/i.test(code)) return 'timeout';
  if (/response_too_large|invalid_response/i.test(code)) return code;
  return 'network_error';
}

function cancelledError() {
  return Object.assign(new Error('cancelled'), { code: 'cancelled' });
}

module.exports = { boundedText, providerStates, financeError, cancelledError };
