'use strict';

const { boundedText } = require('./finance-domain');
const {
  finiteNumber,
  freshnessFor,
  sampleHistory,
} = require('./finance-market-normalizers');

const MAX_HISTORY_POINTS = 180;
const MAX_SEARCH_RESULTS = 20;

function twelveDataError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (boundedText(payload.status, 16).toLowerCase() !== 'error' && payload.code === undefined) return null;
  const code = Number(payload.code);
  const message = boundedText(payload.message, 240).toLowerCase();
  if (code === 429 || /credit|rate|limit/.test(message)) return Object.assign(new Error('http_429'), { code: 'http_429' });
  if (code === 401 || code === 403 || /api key|apikey|authentication/.test(message)) return Object.assign(new Error('http_401'), { code: 'http_401' });
  return Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
}

function twelveDataEventAt(row) {
  const timestamp = finiteNumber(row?.timestamp);
  if (timestamp !== null) {
    const date = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const datetime = boundedText(row?.datetime, 32);
  const parsed = Date.parse(datetime);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeTwelveDataQuote(row, retrievedAt, options = {}) {
  const error = twelveDataError(row);
  if (error) throw error;
  const symbol = boundedText(row?.symbol || options.symbol, 24).toUpperCase();
  const price = finiteNumber(row?.close ?? row?.price);
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || price === null) return null;
  const previousClose = finiteNumber(row?.previous_close);
  const changeAmount = finiteNumber(row?.change) ?? (previousClose === null ? null : price - previousClose);
  const changePercent = finiteNumber(row?.percent_change) ?? (previousClose && changeAmount !== null ? changeAmount / previousClose * 100 : null);
  const eventAt = twelveDataEventAt(row);
  return {
    asset: {
      id: boundedText(options.assetId, 240) || `us:twelve-data:${symbol}`,
      provider: 'twelve-data',
      providerAssetId: symbol,
      market: 'us',
      type: 'stock',
      symbol,
      exchange: boundedText(row?.exchange || options.exchange, 32) || 'US',
      currency: boundedText(row?.currency, 12) || 'USD',
      name: boundedText(row?.name || options.name, 120) || symbol,
    },
    price,
    changeAmount,
    changePercent,
    change1h: null,
    change7d: null,
    marketCap: null,
    marketCapRank: null,
    volume24h: finiteNumber(row?.volume),
    high24h: finiteNumber(row?.high),
    low24h: finiteNumber(row?.low),
    sparkline: [],
    session: row?.is_market_open === true ? 'regular' : row?.is_market_open === false ? 'closed' : 'unknown',
    feed: 'twelve-data-us-basic-non-sip',
    eventAt,
    retrievedAt,
    freshness: freshnessFor(eventAt, retrievedAt),
  };
}

function normalizeTwelveDataHistory(payload, assetId, retrievedAt, days) {
  const error = twelveDataError(payload);
  if (error) throw error;
  const values = Array.isArray(payload?.values) ? payload.values.slice(0, MAX_HISTORY_POINTS * 2) : [];
  const points = values.map((row) => [Date.parse(boundedText(row?.datetime, 32)), finiteNumber(row?.close)])
    .filter((point) => Number.isFinite(point[0]) && point[1] !== null)
    .sort((left, right) => left[0] - right[0]);
  const series = sampleHistory(points).map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  if (series.length < 2) return null;
  return {
    assetId,
    provider: 'twelve-data',
    feed: 'twelve-data-history',
    metric: 'price',
    currency: boundedText(payload?.meta?.currency, 12) || 'USD',
    days,
    series,
    eventAt: series[series.length - 1].at,
    retrievedAt,
    freshness: freshnessFor(series[series.length - 1].at, retrievedAt),
  };
}

function usSymbolFromAssetId(assetId) {
  const id = boundedText(assetId, 240);
  if (!id.startsWith('us:')) return '';
  const symbol = boundedText(id.split(':').at(-1), 24).toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) ? symbol : '';
}

function normalizeTwelveDataSearch(payload) {
  const error = twelveDataError(payload);
  if (error) throw error;
  const rows = Array.isArray(payload?.data) ? payload.data.slice(0, MAX_SEARCH_RESULTS * 2) : [];
  return rows.map((row) => {
    const symbol = boundedText(row?.symbol, 24).toUpperCase();
    const exchange = boundedText(row?.exchange, 32) || 'US';
    const currency = boundedText(row?.currency, 12).toUpperCase();
    const country = boundedText(row?.country, 48).toLowerCase();
    const instrumentType = boundedText(row?.instrument_type, 48).toLowerCase();
    const isUsSecurity = currency === 'USD' && (!country || /united states|usa/.test(country))
      && (!instrumentType || /stock|etf|fund|reit/.test(instrumentType));
    if (!isUsSecurity || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) return null;
    return {
      id: `us:twelve-data:${symbol}`,
      provider: 'twelve-data',
      providerAssetId: symbol,
      market: 'us',
      type: 'stock',
      symbol,
      exchange,
      currency: 'USD',
      name: boundedText(row?.instrument_name, 120) || symbol,
    };
  }).filter(Boolean).slice(0, MAX_SEARCH_RESULTS);
}

function normalizeSecCompanyConcept(payload, descriptor) {
  if (!payload || typeof payload !== 'object' || boundedText(payload.cik, 20) === '') return null;
  const values = Array.isArray(payload?.units?.USD) ? payload.units.USD : [];
  const acceptedForms = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A']);
  const facts = values.filter((fact) => acceptedForms.has(boundedText(fact?.form, 16)) && finiteNumber(fact?.val) !== null && /^\d{4}-\d{2}-\d{2}$/.test(boundedText(fact?.end, 16)))
    .sort((left, right) => boundedText(right?.filed, 16).localeCompare(boundedText(left?.filed, 16)) || boundedText(right?.end, 16).localeCompare(boundedText(left?.end, 16)));
  const fact = facts[0];
  if (!fact) return null;
  return {
    key: descriptor.key,
    label: descriptor.label,
    concept: descriptor.concept,
    value: finiteNumber(fact.val),
    unit: 'USD',
    periodStart: boundedText(fact.start, 16),
    periodEnd: boundedText(fact.end, 16),
    filedAt: boundedText(fact.filed, 16),
    form: boundedText(fact.form, 16),
    fiscalYear: finiteNumber(fact.fy),
    fiscalPeriod: boundedText(fact.fp, 12),
  };
}

function quantdashEventAt(value) {
  const timestamp = finiteNumber(value);
  if (timestamp !== null) {
    const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  const parsed = Date.parse(boundedText(value, 48));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function quantdashExchange(symbol) {
  const suffix = boundedText(symbol, 24).toUpperCase().split('.').at(-1);
  return ({ SH: 'SSE', SZ: 'SZSE', BJ: 'BSE' })[suffix] || 'A 股';
}

function quantdashAsset(symbol, name = '', assetId = '') {
  const providerAssetId = boundedText(symbol, 24).toUpperCase();
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(providerAssetId)) return null;
  return {
    id: boundedText(assetId, 240) || `cn:quantdash:${providerAssetId}`,
    provider: 'quantdash',
    providerAssetId,
    market: 'cn',
    type: 'stock',
    symbol: providerAssetId.slice(0, 6),
    exchange: quantdashExchange(providerAssetId),
    currency: 'CNY',
    name: boundedText(name, 120) || providerAssetId.slice(0, 6),
  };
}

function normalizeQuantdashMarket(row, retrievedAt, options = {}) {
  const extension = row?.ext && typeof row.ext === 'object' ? row.ext : {};
  const asset = quantdashAsset(row?.symbol, options.name || extension.name, options.assetId);
  const price = finiteNumber(row?.last_price ?? row?.lastPrice);
  if (!asset || price === null) return null;
  const previousClose = finiteNumber(row?.prev_close ?? row?.prevClose);
  const changeAmount = finiteNumber(extension.change_amount ?? extension.changeAmount) ?? (previousClose === null ? null : price - previousClose);
  const rawChangePercent = finiteNumber(extension.change_pct ?? extension.changePct);
  const changePercent = rawChangePercent === null
    ? (previousClose && changeAmount !== null ? changeAmount / previousClose * 100 : null)
    : rawChangePercent * 100;
  const eventAt = quantdashEventAt(row?.timestamp);
  return {
    asset,
    price,
    changeAmount,
    changePercent,
    change1h: null,
    change7d: null,
    marketCap: null,
    marketCapRank: null,
    volume24h: finiteNumber(row?.amount),
    high24h: finiteNumber(row?.high),
    low24h: finiteNumber(row?.low),
    sparkline: [],
    session: 'regular',
    feed: 'quantdash-realtime-snapshot',
    eventAt,
    retrievedAt,
    freshness: freshnessFor(eventAt, retrievedAt),
  };
}

function normalizeQuantdashHistory(payload, assetId, retrievedAt, days) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const timestamps = Array.isArray(data.timestamp) ? data.timestamp : [];
  const closes = Array.isArray(data.close) ? data.close : [];
  const points = timestamps.map((timestamp, index) => [Date.parse(quantdashEventAt(timestamp)), finiteNumber(closes[index])])
    .filter((point) => Number.isFinite(point[0]) && point[1] !== null);
  const sampled = sampleHistory(points).map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  if (sampled.length < 2) return null;
  return {
    assetId,
    provider: 'quantdash',
    feed: 'quantdash-daily-kline',
    metric: 'price',
    currency: 'CNY',
    days,
    series: sampled,
    eventAt: sampled[sampled.length - 1].at,
    retrievedAt,
    freshness: freshnessFor(sampled[sampled.length - 1].at, retrievedAt),
  };
}

function quantdashError(payload) {
  const code = Number(payload?.code);
  if (code === 401) return Object.assign(new Error('http_401'), { code: 'http_401' });
  if (code === 403) return Object.assign(new Error('provider_permission_denied'), { code: 'provider_permission_denied' });
  if (code === 429) return Object.assign(new Error('http_429'), { code: 'http_429', retryAfterMs: finiteNumber(payload?.retry_after_ms) });
  if (payload?.code !== undefined && code !== 0) return Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  return null;
}

function quantdashRows(payload) {
  const error = quantdashError(payload);
  if (error) throw error;
  const rows = Array.isArray(payload?.data) ? payload.data : null;
  if (!rows || rows.length > 10_000 || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  }
  return rows;
}

function quantdashKlineData(payload) {
  const error = quantdashError(payload);
  if (error) throw error;
  const data = payload?.data;
  const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'amount'];
  if (!data || typeof data !== 'object' || fields.some((field) => !Array.isArray(data[field])) || data.timestamp.length > 10_000) {
    throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  }
  const length = data.timestamp.length;
  if (fields.some((field) => data[field].length !== length)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  return data;
}

function quantdashInstrumentRows(payload) {
  const rows = quantdashRows(payload);
  return rows.map((row) => ({ ...row, ext: row.ext && typeof row.ext === 'object' ? row.ext : {} }));
}

function quantdashCodeFromAssetId(assetId) {
  const id = boundedText(assetId, 240);
  const match = id.match(/^cn:(?:quantdash|tushare):([0-9]{6}\.(?:SH|SZ|BJ))$/i);
  if (match) return match[1].toUpperCase();
  const legacy = id.match(/^(?:cn|a):(sh|sz|bj):([0-9]{6})$/i);
  return legacy ? `${legacy[2]}.${legacy[1].toUpperCase()}` : '';
}

function inferQuantdashCode(value) {
  const text = boundedText(value, 32).toUpperCase();
  if (/^\d{6}\.(?:SH|SZ|BJ)$/.test(text)) return text;
  if (!/^\d{6}$/.test(text)) return '';
  if (/^[03]/.test(text)) return `${text}.SZ`;
  if (/^[48]/.test(text) || /^92/.test(text)) return `${text}.BJ`;
  return `${text}.SH`;
}

function publicCnCodeFromAssetId(assetId) {
  const id = boundedText(assetId, 240);
  const match = id.match(/^cn:(?:quantdash|tushare|tencent|eastmoney|sina):([0-9]{6}\.(?:SH|SZ|BJ))$/i);
  if (match) return match[1].toUpperCase();
  const legacy = id.match(/^(?:cn|a):(sh|sz|bj):([0-9]{6})$/i);
  return legacy ? `${legacy[2]}.${legacy[1].toUpperCase()}` : '';
}

function publicCnPrefix(code) {
  const normalized = inferQuantdashCode(code);
  return normalized.endsWith('.BJ') ? 'bj' : normalized.endsWith('.SH') ? 'sh' : 'sz';
}

function publicCnAsset(symbol, name = '', provider = 'public', assetId = '') {
  const providerAssetId = boundedText(symbol, 24).toUpperCase();
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(providerAssetId)) return null;
  const safeProvider = ['tencent', 'eastmoney', 'sina'].includes(provider) ? provider : 'public';
  return {
    id: boundedText(assetId, 240) || `cn:${safeProvider}:${providerAssetId}`,
    provider: safeProvider,
    providerAssetId,
    market: 'cn',
    type: 'stock',
    symbol: providerAssetId.slice(0, 6),
    exchange: quantdashExchange(providerAssetId),
    currency: 'CNY',
    name: boundedText(name, 120) || providerAssetId.slice(0, 6),
  };
}

function publicCnEventAt(value) {
  const text = boundedText(value, 48);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return quantdashEventAt(`${text.replace(' ', 'T')}+08:00`);
  return quantdashEventAt(value);
}

function normalizePublicCnQuote(row, provider, retrievedAt, options = {}) {
  const asset = publicCnAsset(row?.symbol, row?.name, provider, options.assetId);
  const price = finiteNumber(row?.price);
  if (!asset || price === null) return null;
  const previousClose = finiteNumber(row?.previousClose);
  const changeAmount = finiteNumber(row?.changeAmount) ?? (previousClose === null ? null : price - previousClose);
  const changePercent = finiteNumber(row?.changePercent) ?? (previousClose ? changeAmount / previousClose * 100 : null);
  const eventAt = publicCnEventAt(row?.timestamp);
  return {
    asset,
    price,
    changeAmount,
    changePercent,
    change1h: null,
    change7d: null,
    marketCap: null,
    marketCapRank: null,
    volume24h: finiteNumber(row?.amount),
    high24h: finiteNumber(row?.high),
    low24h: finiteNumber(row?.low),
    sparkline: [],
    session: 'regular',
    feed: `${provider}-public-quote`,
    eventAt,
    retrievedAt,
    freshness: freshnessFor(eventAt, retrievedAt),
  };
}

function normalizePublicCnHistory(rows, assetId, retrievedAt, days) {
  const points = rows.map((row) => [Date.parse(boundedText(row.at, 32)), finiteNumber(row.close)])
    .filter((point) => Number.isFinite(point[0]) && point[1] !== null);
  const series = sampleHistory(points).map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  if (series.length < 2) return null;
  return {
    assetId,
    provider: 'eastmoney',
    feed: 'eastmoney-public-daily-kline',
    metric: 'price',
    currency: 'CNY',
    days,
    series,
    eventAt: series[series.length - 1].at,
    retrievedAt,
    freshness: freshnessFor(series[series.length - 1].at, retrievedAt),
  };
}

module.exports = {
  twelveDataError,
  twelveDataEventAt,
  normalizeTwelveDataQuote,
  normalizeTwelveDataHistory,
  usSymbolFromAssetId,
  normalizeTwelveDataSearch,
  normalizeSecCompanyConcept,
  quantdashEventAt,
  quantdashExchange,
  quantdashAsset,
  normalizeQuantdashMarket,
  normalizeQuantdashHistory,
  quantdashError,
  quantdashRows,
  quantdashKlineData,
  quantdashInstrumentRows,
  quantdashCodeFromAssetId,
  inferQuantdashCode,
  publicCnCodeFromAssetId,
  publicCnPrefix,
  publicCnAsset,
  publicCnEventAt,
  normalizePublicCnQuote,
  normalizePublicCnHistory,
};
