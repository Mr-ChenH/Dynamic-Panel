'use strict';

const COINGECKO_ORIGIN = 'https://api.coingecko.com';
const BINANCE_ORIGIN = 'https://api.binance.com';
const ALPHA_VANTAGE_ORIGIN = 'https://www.alphavantage.co';
const ALPACA_DATA_ORIGIN = 'https://data.alpaca.markets';
const ALPACA_TRADING_ORIGIN = 'https://paper-api.alpaca.markets';
const TWELVE_DATA_ORIGIN = 'https://api.twelvedata.com';
const SEC_FILES_ORIGIN = 'https://www.sec.gov';
const SEC_DATA_ORIGIN = 'https://data.sec.gov';
const QUANTDASH_ORIGIN = 'https://api.quantdash.net';
const TENCENT_ORIGIN = 'https://qt.gtimg.cn';
const EASTMONEY_ORIGIN = 'https://push2.eastmoney.com';
const EASTMONEY_DELAY_ORIGIN = 'https://push2delay.eastmoney.com';
const EASTMONEY_HISTORY_ORIGIN = 'https://push2his.eastmoney.com';
const SINA_ORIGIN = 'https://hq.sinajs.cn';
const QUANTDASH_MAX_DIRECT_SYMBOLS = 5;
const QUANTDASH_MAX_DIRECT_REQUESTS = 4;
const PUBLIC_CN_MAX_SYMBOLS = 100;
const EASTMONEY_MAX_ROWS = 6_000;
const MAX_IDS_PER_REQUEST = 100;
const MAX_SEARCH_RESULTS = 20;
const MAX_HISTORY_POINTS = 180;
const MAX_CACHE_ENTRIES = 64;
const MAX_RANKING_PAGE = 200;
const TWELVE_DATA_MAX_QUOTE_SYMBOLS = 8;
const ALPHA_VANTAGE_MOVERS_TTL_MS = 12 * 60 * 60_000;
const SEC_FUNDAMENTALS_TTL_MS = 6 * 60 * 60_000;
const INTERNAL_OPERATION_SIGNAL = Symbol('finance-operation-signal');

function boundedText(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sampleSeries(values, limit = 32) {
  const numbers = Array.isArray(values) ? values.map(finiteNumber).filter((value) => value !== null) : [];
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 32));
  if (numbers.length <= safeLimit) return numbers;
  const result = [];
  if (safeLimit === 1) return [numbers[numbers.length - 1]];
  for (let index = 0; index < safeLimit; index += 1) {
    result.push(numbers[Math.round(index * (numbers.length - 1) / (safeLimit - 1))]);
  }
  return result;
}

function freshnessFor(eventAt, retrievedAt) {
  const eventTime = Date.parse(eventAt || '');
  const retrievedTime = Date.parse(retrievedAt || '');
  if (!Number.isFinite(eventTime) || !Number.isFinite(retrievedTime)) return 'unknown';
  const age = Math.max(0, retrievedTime - eventTime);
  if (age <= 2 * 60 * 1000) return 'delayed';
  if (age <= 15 * 60 * 1000) return 'stale';
  return 'expired';
}

function sampleHistory(values, limit = MAX_HISTORY_POINTS) {
  const points = Array.isArray(values)
    ? values.map((point) => [Number(point?.[0]), finiteNumber(point?.[1])]).filter((point) => Number.isFinite(point[0]) && point[1] !== null)
    : [];
  const safeLimit = Math.max(2, Math.floor(Number(limit) || MAX_HISTORY_POINTS));
  if (points.length <= safeLimit) return points;
  const result = [];
  for (let index = 0; index < safeLimit; index += 1) {
    result.push(points[Math.round(index * (points.length - 1) / (safeLimit - 1))]);
  }
  return result;
}

function normalizeCoinGeckoHistory(payload, assetId, retrievedAt) {
  const providerAssetId = boundedText(assetId, 160);
  const points = sampleHistory(payload?.prices);
  if (!providerAssetId || points.length < 2) return null;
  const series = points.map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  return {
    assetId: `crypto:coingecko:${providerAssetId}`,
    provider: 'coingecko',
    feed: 'coingecko-aggregate-rest',
    metric: 'price',
    currency: 'USD',
    series,
    eventAt: series[series.length - 1].at,
    retrievedAt,
    freshness: freshnessFor(series[series.length - 1].at, retrievedAt),
  };
}

function normalizeCoinGeckoGlobalHistory(payload, retrievedAt) {
  const chart = payload?.market_cap_chart || payload || {};
  const points = sampleHistory(chart.market_cap);
  if (points.length < 2) return null;
  const series = points.map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  const volumeSeries = sampleHistory(chart.volume).map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  return {
    provider: 'coingecko',
    feed: 'coingecko-aggregate-rest',
    metric: 'market_cap',
    currency: 'USD',
    series,
    volumeSeries,
    eventAt: series[series.length - 1].at,
    retrievedAt,
    freshness: freshnessFor(series[series.length - 1].at, retrievedAt),
  };
}

function normalizeCoinGeckoMarket(row, retrievedAt) {
  const providerAssetId = boundedText(row?.id, 160);
  const symbol = boundedText(row?.symbol, 32).toUpperCase();
  const name = boundedText(row?.name, 120);
  const price = finiteNumber(row?.current_price);
  if (!providerAssetId || !symbol || !name || price === null) return null;
  const eventAt = boundedText(row?.last_updated, 48);
  return {
    asset: {
      id: `crypto:coingecko:${providerAssetId}`,
      provider: 'coingecko',
      providerAssetId,
      market: 'crypto',
      type: 'crypto',
      symbol,
      exchange: 'CoinGecko',
      currency: 'USD',
      name,
    },
    price,
    changeAmount: finiteNumber(row?.price_change_24h),
    changePercent: finiteNumber(row?.price_change_percentage_24h),
    change1h: finiteNumber(row?.price_change_percentage_1h_in_currency),
    change7d: finiteNumber(row?.price_change_percentage_7d_in_currency),
    marketCap: finiteNumber(row?.market_cap),
    marketCapRank: finiteNumber(row?.market_cap_rank),
    volume24h: finiteNumber(row?.total_volume),
    high24h: finiteNumber(row?.high_24h),
    low24h: finiteNumber(row?.low_24h),
    sparkline: sampleSeries(row?.sparkline_in_7d?.price),
    session: 'continuous',
    feed: 'coingecko-aggregate-rest',
    eventAt,
    retrievedAt,
    freshness: freshnessFor(eventAt, retrievedAt),
  };
}

function normalizeBinanceMarket(row, retrievedAt) {
  const providerAssetId = boundedText(row?.symbol, 32).toUpperCase();
  const baseSymbol = providerAssetId.endsWith('USDT') ? providerAssetId.slice(0, -4) : '';
  const price = finiteNumber(row?.lastPrice ?? row?.last_price);
  if (!providerAssetId || !baseSymbol || price === null) return null;
  const openPrice = finiteNumber(row?.openPrice ?? row?.open_price);
  const explicitChangeAmount = finiteNumber(row?.priceChange ?? row?.price_change);
  const changeAmount = explicitChangeAmount ?? (openPrice === null ? null : price - openPrice);
  const explicitChangePercent = finiteNumber(row?.priceChangePercent ?? row?.price_change_percent);
  const changePercent = explicitChangePercent ?? (openPrice ? (price - openPrice) / openPrice * 100 : null);
  const closeTime = finiteNumber(row?.closeTime ?? row?.close_time);
  const eventAt = closeTime === null ? '' : new Date(closeTime).toISOString();
  return {
    asset: {
      id: `crypto:binance:${providerAssetId}`,
      provider: 'binance',
      providerAssetId,
      market: 'crypto',
      type: 'crypto',
      symbol: `${baseSymbol}/USDT`,
      exchange: 'Binance Spot',
      currency: 'USDT',
      name: `${baseSymbol}/USDT`,
    },
    price,
    changeAmount,
    changePercent,
    change1h: null,
    change7d: null,
    marketCap: null,
    marketCapRank: null,
    volume24h: finiteNumber(row?.quoteVolume ?? row?.quote_volume),
    high24h: finiteNumber(row?.highPrice ?? row?.high_price),
    low24h: finiteNumber(row?.lowPrice ?? row?.low_price),
    sparkline: [],
    session: 'continuous',
    feed: 'binance-public-rest',
    eventAt,
    retrievedAt,
    freshness: freshnessFor(eventAt, retrievedAt),
  };
}

function parsePercentage(value) {
  const text = String(value ?? '').replace('%', '').trim();
  return finiteNumber(text);
}

function normalizeAlphaVantageMover(row, category, retrievedAt) {
  const symbol = boundedText(row?.ticker, 24).toUpperCase();
  const price = finiteNumber(row?.price);
  if (!symbol || price === null) return null;
  return {
    asset: {
      id: `us:alpha-vantage:${symbol}`,
      provider: 'alpha-vantage',
      providerAssetId: symbol,
      market: 'us',
      type: 'stock',
      symbol,
      exchange: 'US',
      currency: 'USD',
      name: symbol,
    },
    price,
    changeAmount: finiteNumber(row?.change_amount),
    changePercent: parsePercentage(row?.change_percentage),
    change1h: null,
    change7d: null,
    marketCap: null,
    marketCapRank: null,
    volume24h: finiteNumber(row?.volume),
    high24h: null,
    low24h: null,
    sparkline: [],
    session: 'unknown',
    feed: `alpha-vantage-${category}`,
    eventAt: boundedText(row?.last_updated, 48),
    retrievedAt,
    freshness: freshnessFor(row?.last_updated, retrievedAt),
  };
}

function normalizeBinanceHistory(payload, assetId, retrievedAt, days) {
  const rows = Array.isArray(payload) ? payload : [];
  const points = rows.map((row) => [Number(row?.[0]), finiteNumber(row?.[4])]).filter((point) => Number.isFinite(point[0]) && point[1] !== null);
  if (points.length < 2) return null;
  const series = sampleHistory(points).map(([timestamp, value]) => ({ at: new Date(timestamp).toISOString(), value }));
  return {
    assetId,
    provider: 'binance',
    feed: 'binance-public-rest',
    metric: 'price',
    currency: 'USDT',
    days,
    series,
    eventAt: series[series.length - 1].at,
    retrievedAt,
    freshness: freshnessFor(series[series.length - 1].at, retrievedAt),
  };
}

function normalizeAlpacaSnapshot(asset, snapshot, feed, retrievedAt) {
  const symbol = boundedText(asset?.symbol, 24).toUpperCase();
  const name = boundedText(asset?.name, 120) || symbol;
  const latestTrade = snapshot?.latestTrade || snapshot?.latest_trade || {};
  const minuteBar = snapshot?.minuteBar || snapshot?.minute_bar || {};
  const dailyBar = snapshot?.dailyBar || snapshot?.daily_bar || {};
  const previousBar = snapshot?.prevDailyBar || snapshot?.prev_daily_bar || {};
  const price = finiteNumber(latestTrade.p ?? minuteBar.c ?? dailyBar.c);
  if (!symbol || price === null) return null;
  const previousClose = finiteNumber(previousBar.c);
  const changeAmount = previousClose === null ? null : price - previousClose;
  const changePercent = previousClose && changeAmount !== null ? changeAmount / previousClose * 100 : null;
  const eventAt = boundedText(latestTrade.t ?? minuteBar.t ?? dailyBar.t, 48);
  return {
    asset: {
      id: boundedText(asset?.assetId, 240) || `us:${boundedText(asset?.exchange, 32).toLowerCase() || 'unknown'}:${symbol}`,
      provider: 'alpaca',
      providerAssetId: symbol,
      market: 'us',
      type: 'stock',
      symbol,
      exchange: boundedText(asset?.exchange, 32) || 'US',
      currency: 'USD',
      name,
    },
    price,
    changeAmount,
    changePercent,
    change1h: null,
    change7d: null,
    marketCap: null,
    marketCapRank: null,
    volume24h: finiteNumber(dailyBar.v),
    high24h: finiteNumber(dailyBar.h),
    low24h: finiteNumber(dailyBar.l),
    sparkline: [],
    session: 'unknown',
    feed: `alpaca-${feed}`,
    eventAt,
    retrievedAt,
    freshness: freshnessFor(eventAt, retrievedAt),
  };
}

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

function parseTencentQuotes(text) {
  const rows = [];
  const source = boundedText(text, 2 * 1024 * 1024);
  const pattern = /v_(sh|sz|bj)(\d{6})\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const values = match[3].split('~');
    if (values.length < 38) continue;
    rows.push({
      symbol: `${match[2]}.${match[1].toUpperCase()}`,
      name: values[1],
      price: values[3],
      previousClose: values[4],
      changeAmount: values[31],
      changePercent: values[32],
      high: values[33],
      low: values[34],
      timestamp: /^\d{14}$/.test(values[30]) ? `${values[30].slice(0, 4)}-${values[30].slice(4, 6)}-${values[30].slice(6, 8)} ${values[30].slice(8, 10)}:${values[30].slice(10, 12)}:${values[30].slice(12, 14)}` : '',
      volume: values[6] === '' ? null : Number(values[6]) * 100,
      amount: values[37] === '' ? null : Number(values[37]) * 10_000,
    });
  }
  return rows;
}

function parseSinaQuotes(text) {
  const rows = [];
  const source = boundedText(text, 2 * 1024 * 1024);
  const pattern = /hq_str_(sh|sz|bj)(\d{6})\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const values = match[3].split(',');
    if (values.length < 12) continue;
    const dateIndex = values.findIndex((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    const date = boundedText(dateIndex >= 0 ? values[dateIndex] : '', 16);
    const time = boundedText(dateIndex >= 0 ? values[dateIndex + 1] : '', 16);
    rows.push({
      symbol: `${match[2]}.${match[1].toUpperCase()}`,
      name: values[0],
      price: values[3],
      previousClose: values[2],
      high: values[4],
      low: values[5],
      volume: values[8],
      amount: values[9],
      timestamp: date && time ? `${date} ${time}` : '',
    });
  }
  return rows;
}

function parseEastmoneyKlines(payload) {
  if (!payload || typeof payload !== 'object' || (payload.rc !== undefined && Number(payload.rc) !== 0)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  if (!Array.isArray(data.klines)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const rows = Array.isArray(data.klines) ? data.klines : [];
  return rows.slice(-MAX_HISTORY_POINTS * 2).map((value) => {
    const fields = boundedText(value, 512).split(',');
    return { at: fields[0], close: fields[2] };
  }).filter((row) => row.at && finiteNumber(row.close) !== null);
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

function eastmoneyScaled(value) {
  const number = finiteNumber(value);
  return number === null ? null : number / 100;
}

function parseEastmoneyQuotes(payload) {
  if (!payload || typeof payload !== 'object' || (payload.rc !== undefined && Number(payload.rc) !== 0)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  if (!Array.isArray(data.diff) && (!data.diff || typeof data.diff !== 'object')) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const rawRows = Array.isArray(data.diff) ? data.diff : Object.values(data.diff);
  return rawRows.slice(0, EASTMONEY_MAX_ROWS).map((row) => {
    const value = row && typeof row === 'object' ? row : {};
    const code = boundedText(value.f12, 6);
    const market = finiteNumber(value.f13) === 1 ? 'SH' : finiteNumber(value.f13) === 2 || /^(?:4|8|92)/.test(code) ? 'BJ' : 'SZ';
    return {
      symbol: `${code}.${market}`,
      name: value.f14,
      price: eastmoneyScaled(value.f2),
      changePercent: eastmoneyScaled(value.f3),
      changeAmount: eastmoneyScaled(value.f4),
      volume: value.f5,
      amount: value.f6,
      high: eastmoneyScaled(value.f15),
      low: eastmoneyScaled(value.f16),
      timestamp: finiteNumber(value.f124),
    };
  }).filter((row) => /^\d{6}\.(?:SH|SZ|BJ)$/.test(row.symbol));
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
    {
      id: 'coingecko',
      label: 'CoinGecko',
      market: 'crypto',
      enabled: coinGecko.enabled !== false,
      configured: true,
      credentialSource: boundedText(coinGecko.credentialSource, 24) || 'none',
      feed: '聚合 REST',
      state: coinGecko.enabled === false ? 'disabled' : 'ready',
    },
    {
      id: 'binance',
      label: 'Binance',
      market: 'crypto',
      enabled: binance.enabled !== false,
      configured: true,
      credentialSource: 'none',
      feed: '公共 REST',
      state: binance.enabled === false ? 'disabled' : 'ready',
    },
    {
      id: 'alpha-vantage',
      label: 'Alpha Vantage',
      market: 'us',
      enabled: alphaVantage.enabled === true,
      configured: Boolean(alphaVantage.apiKey),
      credentialSource: boundedText(alphaVantage.credentialSource, 24) || 'none',
      feed: 'Top Movers',
      state: alphaVantage.enabled !== true ? 'disabled' : alphaVantage.apiKey ? 'ready' : 'missing_credentials',
    },
    {
      id: 'alpaca',
      label: 'Alpaca',
      market: 'us',
      enabled: alpaca.enabled === true,
      configured: Boolean(alpaca.keyId && alpaca.secretKey),
      credentialSource: boundedText(alpaca.credentialSource, 24) || 'none',
      feed: alpaca.feed === 'sip' ? 'SIP' : 'IEX · 单一交易所',
      state: alpaca.enabled !== true ? 'disabled' : alpaca.keyId && alpaca.secretKey ? 'ready' : 'missing_credentials',
    },
    {
      id: 'twelve-data',
      label: 'Twelve Data',
      market: 'us',
      enabled: twelveData.enabled === true,
      configured: Boolean(twelveData.apiKey),
      credentialSource: boundedText(twelveData.credentialSource, 24) || 'none',
      feed: 'Basic US feed · 非 SIP',
      state: twelveData.enabled !== true ? 'disabled' : twelveData.apiKey ? 'ready' : 'missing_credentials',
    },
    {
      id: 'sec-edgar',
      label: 'SEC EDGAR',
      market: 'us',
      enabled: secEdgar.enabled === true,
      configured: Boolean(secEdgar.contact),
      credentialSource: boundedText(secEdgar.credentialSource, 24) || 'none',
      feed: '官方申报 XBRL · 非行情',
      state: secEdgar.enabled !== true ? 'disabled' : secEdgar.contact ? 'ready' : 'missing_credentials',
    },
    {
      id: 'cn-stock',
      label: boundedText(cnStock.label, 80) || 'QuantDash',
      market: 'cn',
      enabled: cnStock.enabled === true,
      configured: Boolean(cnStock.apiKey),
      credentialSource: boundedText(cnStock.credentialSource, 24) || 'none',
      feed: '实时快照 / 日 K',
      state: cnStock.enabled !== true ? 'disabled' : cnStock.apiKey ? 'ready' : 'missing_credentials',
    },
    {
      id: 'cn-tencent',
      label: '腾讯公开行情',
      market: 'cn',
      enabled: config.cnTencent?.enabled === true,
      configured: true,
      credentialSource: 'none',
      feed: '公开行情 · GBK',
      state: config.cnTencent?.enabled === true ? 'ready' : 'disabled',
    },
    {
      id: 'cn-eastmoney',
      label: '东方财富公开行情',
      market: 'cn',
      enabled: config.cnEastmoney?.enabled === true,
      configured: true,
      credentialSource: 'none',
      feed: '公开行情 · JSON',
      state: config.cnEastmoney?.enabled === true ? 'ready' : 'disabled',
    },
    {
      id: 'cn-sina',
      label: '新浪公开行情',
      market: 'cn',
      enabled: config.cnSina?.enabled === true,
      configured: true,
      credentialSource: 'none',
      feed: '公开行情 · GBK',
      state: config.cnSina?.enabled === true ? 'ready' : 'disabled',
    },
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

function createFinanceService({ requestJson, getConfig = () => ({}), now = () => Date.now() } = {}) {
  if (typeof requestJson !== 'function') throw new TypeError('requestJson is required');
  const cache = new Map();
  const pending = new Map();
  const rateLimitedUntil = new Map();
  const operations = new Map();
  let quantdashUniverseRows = [];
  const publicCnUniverseRows = new Map();

  function clearCache(options = {}) {
    const includeQuotaProtected = options?.includeQuotaProtected === true;
    for (const key of cache.keys()) {
      if (includeQuotaProtected || !key.startsWith('quota:')) cache.delete(key);
    }
    for (const key of rateLimitedUntil.keys()) {
      if (includeQuotaProtected || !key.startsWith('quota:')) rateLimitedUntil.delete(key);
    }
    quantdashUniverseRows = [];
    publicCnUniverseRows.clear();
  }

  function withOperation(payload, work) {
    const inheritedSignal = payload?.[INTERNAL_OPERATION_SIGNAL];
    if (inheritedSignal) return Promise.resolve().then(() => work(inheritedSignal));
    const requestId = boundedText(payload?.requestId, 160);
    if (!requestId) return Promise.resolve().then(() => work(null));
    const controller = new AbortController();
    const controllers = operations.get(requestId) || new Set();
    controllers.add(controller);
    operations.set(requestId, controllers);
    return Promise.resolve()
      .then(() => work(controller.signal))
      .finally(() => {
        controllers.delete(controller);
        if (!controllers.size) operations.delete(requestId);
      });
  }

  function cancel(requestId) {
    const id = boundedText(requestId, 160);
    const controllers = operations.get(id);
    if (!controllers) return { ok: true, cancelled: false };
    controllers.forEach((controller) => controller.abort());
    return { ok: true, cancelled: true };
  }

  function waitForPending(entry, signal) {
    entry.consumers += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        entry.consumers = Math.max(0, entry.consumers - 1);
        if (!entry.settled && entry.consumers === 0) entry.controller.abort();
      };
      const onAbort = () => {
        if (settled) return;
        release();
        reject(cancelledError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.promise.then((value) => {
        if (signal?.aborted) reject(cancelledError());
        else resolve(value);
      }, reject).finally(release);
    });
  }

  async function cached(key, ttlMs, loader, signal = null, force = false) {
    const currentTime = now();
    const existing = cache.get(key);
    if (!force && existing && currentTime - existing.storedAt <= ttlMs) return { value: existing.value, stale: false, storedAt: existing.storedAt };
    if (rateLimitedUntil.get(key) > currentTime) {
      if (existing && currentTime - existing.storedAt <= 30 * 60 * 1000) return { value: existing.value, stale: true, error: 'rate_limited', storedAt: existing.storedAt };
      throw Object.assign(new Error('http_429'), { code: 'http_429' });
    }
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = (async () => {
        try {
          const value = await loader(controller.signal);
          const storedAt = now();
          cache.set(key, { value, storedAt });
          while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
          return { value, stale: false, storedAt };
        } catch (error) {
          const errorCode = financeError(error);
          if (errorCode === 'cancelled') throw error;
          if (errorCode === 'rate_limited') {
            const retryAfterMs = Math.max(30_000, Math.min(5 * 60_000, Number(error?.retryAfterMs) || 0));
            rateLimitedUntil.set(key, now() + retryAfterMs);
          }
          if (existing && currentTime - existing.storedAt <= 30 * 60 * 1000) {
            return { value: existing.value, stale: true, error: errorCode, storedAt: existing.storedAt };
          }
          throw error;
        } finally {
          entry.settled = true;
          if (pending.get(key) === entry) pending.delete(key);
        }
      })();
      entry = { controller, promise, consumers: 0, settled: false };
      pending.set(key, entry);
    }
    return waitForPending(entry, signal);
  }

  function coinGeckoHeaders(config) {
    const headers = { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' };
    if (config.coingecko?.apiKey) headers['x-cg-demo-api-key'] = config.coingecko.apiKey;
    return headers;
  }

  function alphaVantageKey(config) {
    return encodeURIComponent(String(config.alphaVantage?.apiKey || '').trim());
  }

  function alphaVantageError(value) {
    const text = String(value || '').toLowerCase();
    if (/rate|frequency|limit/.test(text)) return Object.assign(new Error('http_429'), { code: 'http_429' });
    if (/invalid|apikey|api key|premium/.test(text)) return Object.assign(new Error('http_401'), { code: 'http_401' });
    return Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  }

  function alpacaHeaders(config) {
    return {
      Accept: 'application/json',
      'APCA-API-KEY-ID': config.alpaca?.keyId || '',
      'APCA-API-SECRET-KEY': config.alpaca?.secretKey || '',
      'User-Agent': 'Dynamic-Panel/1.1',
    };
  }

  function requireTwelveDataConfig(config) {
    if (config.twelveData?.enabled !== true) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    if (!config.twelveData.apiKey) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    return config.twelveData;
  }

  function twelveDataHeaders(config) {
    requireTwelveDataConfig(config);
    return { Accept: 'application/json', Authorization: `apikey ${config.twelveData.apiKey}`, 'User-Agent': 'Dynamic-Panel/1.1' };
  }

  function twelveDataRows(payload) {
    const topLevelError = twelveDataError(payload);
    if (topLevelError) throw topLevelError;
    if (payload?.symbol) return [payload];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
    const rows = Object.values(payload).slice(0, TWELVE_DATA_MAX_QUOTE_SYMBOLS);
    for (const row of rows) {
      const error = twelveDataError(row);
      if (error && financeError(error) !== 'invalid_response') throw error;
    }
    return rows.filter((row) => row && typeof row === 'object' && !twelveDataError(row));
  }

  function requireSecEdgarConfig(config) {
    if (config.secEdgar?.enabled !== true) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    if (!config.secEdgar.contact) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    return config.secEdgar;
  }

  function secEdgarHeaders(config) {
    const settings = requireSecEdgarConfig(config);
    return { Accept: 'application/json', 'User-Agent': `Dynamic-Panel/1.1 ${settings.contact}` };
  }

  function requireQuantdashConfig(config) {
    if (config.cnStock?.enabled !== true) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    if (!config.cnStock.apiKey) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    return config.cnStock;
  }

  function quantdashHeaders(config) {
    return { Accept: 'application/json', 'X-API-Key': config.cnStock.apiKey, 'User-Agent': 'Dynamic-Panel/1.1' };
  }

  function quantdashQuery(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    return query.toString();
  }

  async function quantdashCall(config, pathname, params, signal = null) {
    requireQuantdashConfig(config);
    const query = quantdashQuery(params);
    return requestJson(`${QUANTDASH_ORIGIN}${pathname}${query ? `?${query}` : ''}`, { headers: quantdashHeaders(config), signal });
  }

  async function quantdashQuoteRows(config, params, signal = null) {
    return quantdashRows(await quantdashCall(config, '/v1/quotes', params, signal));
  }

  async function quantdashUniverseQuotes(config, signal = null, force = false) {
    const response = await cached(
      'quantdash:quotes:universe:CN_Stock',
      20_000,
      (requestSignal) => quantdashQuoteRows(config, { universes: 'CN_Stock' }, requestSignal),
      signal,
      force
    );
    quantdashUniverseRows = response.value;
    return response;
  }

  async function quantdashAssetByCode(config, code, signal = null) {
    try {
      const response = await cached(
        `quantdash:instrument:${code}`,
        24 * 60 * 60_000,
        (requestSignal) => quantdashCall(config, '/v1/instruments', { symbols: code }, requestSignal).then(quantdashInstrumentRows),
        signal
      );
      const instrument = response.value.find((row) => boundedText(row.symbol, 24).toUpperCase() === code);
      if (instrument) return quantdashAsset(code, instrument.name);
      return null;
    } catch (error) {
      if (financeError(error) !== 'permission_denied') throw error;
      const response = await cached(
        `quantdash:quote:exact:${code}`,
        20_000,
        (requestSignal) => quantdashQuoteRows(config, { symbols: code }, requestSignal),
        signal
      );
      const row = response.value.find((item) => boundedText(item.symbol, 24).toUpperCase() === code);
      const extension = row?.ext && typeof row.ext === 'object' ? row.ext : {};
      return row ? quantdashAsset(code, extension.name) : null;
    }
  }

  async function quantdashMarkets({ sort = 'gainers', signal = null, force = false } = {}) {
    const config = getConfig();
    requireQuantdashConfig(config);
    const retrievedAt = new Date(now()).toISOString();
    if (sort === 'market_cap') return { rows: [], stale: false, unavailable: 'market_cap_not_supported', retrievedAt };
    const response = await quantdashUniverseQuotes(config, signal, force);
    const rows = response.value.map((row) => normalizeQuantdashMarket(row, new Date(response.storedAt).toISOString())).filter(Boolean)
      .map((row) => ({ ...row, stale: response.stale === true }));
    return { rows, stale: response.stale, warning: response.error || '', coverage: 'quantdash_cn_stock_universe', retrievedAt: new Date(response.storedAt).toISOString() };
  }

  async function quantdashQuotes(assets, signal = null, force = false) {
    if (!assets.length) return [];
    const config = getConfig();
    requireQuantdashConfig(config);
    const requestsByCode = new Map();
    for (const asset of assets) {
      const code = publicCnCodeFromAssetId(asset.assetId);
      if (!code) continue;
      const requests = requestsByCode.get(code) || [];
      requests.push(asset.assetId);
      requestsByCode.set(code, requests);
    }
    const codes = [...requestsByCode.keys()].slice(0, QUANTDASH_MAX_DIRECT_SYMBOLS * QUANTDASH_MAX_DIRECT_REQUESTS);
    if (!codes.length) return [];
    const responses = [];
    for (let offset = 0; offset < codes.length; offset += QUANTDASH_MAX_DIRECT_SYMBOLS) {
      const batch = codes.slice(offset, offset + QUANTDASH_MAX_DIRECT_SYMBOLS);
      responses.push(await cached(
        `quantdash:quotes:${batch.slice().sort().join(',')}`,
        20_000,
        (requestSignal) => quantdashQuoteRows(config, { symbols: batch.join(',') }, requestSignal),
        signal,
        force
      ));
    }
    const rowsByCode = new Map();
    for (const response of responses) {
      for (const row of response.value) {
        rowsByCode.set(boundedText(row.symbol, 24).toUpperCase(), { row, response });
      }
    }
    const rows = [];
    for (const code of codes) {
      const entry = rowsByCode.get(code);
      if (!entry) continue;
      const retrievedAt = new Date(entry.response.storedAt).toISOString();
      for (const assetId of requestsByCode.get(code) || []) {
        const normalized = normalizeQuantdashMarket(entry.row, retrievedAt, { assetId });
        if (normalized) rows.push({ ...normalized, stale: entry.response.stale === true });
      }
    }
    return rows;
  }

  function publicCnConfig(config, providerId) {
    const key = { 'cn-tencent': 'cnTencent', 'cn-eastmoney': 'cnEastmoney', 'cn-sina': 'cnSina' }[providerId];
    return key ? config[key] : null;
  }

  function publicCnHeaders(providerId) {
    const common = { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (Dynamic-Panel)' };
    if (providerId === 'cn-eastmoney') return { ...common, Referer: 'https://quote.eastmoney.com/' };
    if (providerId === 'cn-sina') return { ...common, Referer: 'https://stock.finance.sina.com.cn/' };
    return common;
  }

  function requirePublicCnConfig(config, providerId) {
    const provider = publicCnConfig(config, providerId);
    if (provider?.enabled !== true) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    return provider;
  }

  function publicCnSecId(code) {
    const normalized = inferQuantdashCode(code);
    return `${normalized.endsWith('.SH') ? '1' : '0'}.${normalized.slice(0, 6)}`;
  }

  async function eastmoneyRequest(pathname, options = {}) {
    try {
      return await requestJson(`${EASTMONEY_ORIGIN}${pathname}`, options);
    } catch (error) {
      if (financeError(error) === 'cancelled') throw error;
      return requestJson(`${EASTMONEY_DELAY_ORIGIN}${pathname}`, options);
    }
  }

  async function publicCnFetchRows(providerId, codes, signal = null, force = false) {
    const config = getConfig();
    requirePublicCnConfig(config, providerId);
    const normalizedCodes = [...new Set(codes.map(inferQuantdashCode).filter(Boolean))].slice(0, PUBLIC_CN_MAX_SYMBOLS);
    if (!normalizedCodes.length) return { value: [], stale: false, storedAt: now() };
    const cacheKey = `public-cn:${providerId}:quotes:${normalizedCodes.slice().sort().join(',')}`;
    return cached(cacheKey, 20_000, async (requestSignal) => {
      if (providerId === 'cn-tencent') {
        const query = normalizedCodes.map((code) => `${publicCnPrefix(code)}${code.slice(0, 6)}`).join(',');
        const text = await requestJson(`${TENCENT_ORIGIN}/q=${encodeURIComponent(query)}`, { responseType: 'text', encoding: 'gbk', headers: publicCnHeaders(providerId), signal: requestSignal });
        if (!/v_(?:sh|sz|bj)\d{6}\s*=\s*"/i.test(text)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return parseTencentQuotes(text);
      }
      if (providerId === 'cn-sina') {
        const query = normalizedCodes.map((code) => `${publicCnPrefix(code)}${code.slice(0, 6)}`).join(',');
        const text = await requestJson(`${SINA_ORIGIN}/list=${encodeURIComponent(query)}`, { responseType: 'text', encoding: 'gbk', headers: publicCnHeaders(providerId), signal: requestSignal });
        if (!/hq_str_(?:sh|sz|bj)\d{6}\s*=\s*"/i.test(text)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return parseSinaQuotes(text);
      }
      const query = new URLSearchParams({ fltt: '2', invt: '2', fields: 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f124', secids: normalizedCodes.map(publicCnSecId).join(',') });
      const payload = await eastmoneyRequest(`/api/qt/ulist.np/get?${query}`, { headers: publicCnHeaders(providerId), signal: requestSignal });
      return parseEastmoneyQuotes(payload);
    }, signal, force);
  }

  async function publicCnQuotes(providerId, assets, signal = null, force = false) {
    const codes = assets.map((asset) => publicCnCodeFromAssetId(asset.assetId)).filter(Boolean);
    if (!codes.length) return [];
    const response = await publicCnFetchRows(providerId, codes, signal, force);
    const rowsByCode = new Map(response.value.map((row) => [boundedText(row.symbol, 24).toUpperCase(), row]));
    const retrievedAt = new Date(response.storedAt).toISOString();
    return assets.map((asset) => {
      const code = publicCnCodeFromAssetId(asset.assetId);
      const row = rowsByCode.get(code);
      const normalized = row ? normalizePublicCnQuote(row, providerId.slice(3), retrievedAt, { assetId: asset.assetId }) : null;
      return normalized ? { ...normalized, stale: response.stale === true } : null;
    }).filter(Boolean);
  }

  async function cnQuoteFallback(assets, signal = null, force = false) {
    if (!assets.length) return { rows: [], errors: [] };
    const config = getConfig();
    const providers = [];
    if (config.cnStock?.enabled === true && config.cnStock.apiKey) providers.push(['cn-stock', (pending) => quantdashQuotes(pending, signal, force)]);
    if (config.cnTencent?.enabled === true) providers.push(['cn-tencent', (pending) => publicCnQuotes('cn-tencent', pending, signal, force)]);
    if (config.cnEastmoney?.enabled === true) providers.push(['cn-eastmoney', (pending) => publicCnQuotes('cn-eastmoney', pending, signal, force)]);
    if (config.cnSina?.enabled === true) providers.push(['cn-sina', (pending) => publicCnQuotes('cn-sina', pending, signal, force)]);
    const rows = [];
    const errors = [];
    let pending = [...assets];
    for (const [provider, load] of providers) {
      try {
        const providerRows = await load(pending);
        rows.push(...providerRows);
        const returned = new Set(providerRows.map((row) => row.asset.id));
        pending = pending.filter((asset) => !returned.has(asset.assetId));
        if (!pending.length) break;
      } catch (error) {
        const errorCode = financeError(error);
        if (errorCode === 'cancelled') throw error;
        errors.push({ provider, error: errorCode });
      }
    }
    return { rows, errors };
  }

  async function eastmoneyMarkets({ sort = 'gainers', page = 1, pageSize = 50, signal = null, force = false } = {}) {
    const config = getConfig();
    requirePublicCnConfig(config, 'cn-eastmoney');
    const safePage = Math.max(1, Math.min(MAX_RANKING_PAGE, Math.floor(Number(page) || 1)));
    const safePageSize = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 50)));
    const retrievedAt = new Date(now()).toISOString();
    if (sort === 'market_cap') return { rows: [], stale: false, unavailable: 'market_cap_not_supported', coverage: 'eastmoney_cn_stock_ranked_page', retrievedAt };
    const field = sort === 'volume' ? 'f6' : 'f3';
    const descending = sort !== 'losers';
    const response = await cached(
      `public-cn:cn-eastmoney:markets:${sort}:${safePage}:${safePageSize}`,
      20_000,
      async (requestSignal) => {
        const query = new URLSearchParams({ pn: String(safePage), pz: String(safePageSize), po: descending ? '1' : '0', np: '1', fid: field, fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048', fields: 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f124' });
        const payload = await eastmoneyRequest(`/api/qt/clist/get?${query}`, { headers: publicCnHeaders('cn-eastmoney'), signal: requestSignal });
        const total = Math.max(0, Math.min(20_000, Math.floor(finiteNumber(payload?.data?.total) || 0)));
        return { rows: parseEastmoneyQuotes(payload), total };
      },
      signal,
      force
    );
    const rememberedRows = [...(publicCnUniverseRows.get('eastmoney') || []), ...response.value.rows];
    const uniqueRows = rememberedRows.filter((row, index, values) => values.findIndex((item) => item.symbol === row.symbol) === index).slice(-EASTMONEY_MAX_ROWS);
    publicCnUniverseRows.set('eastmoney', uniqueRows);
    const storedAt = new Date(response.storedAt).toISOString();
    const rows = response.value.rows.map((row) => normalizePublicCnQuote(row, 'eastmoney', storedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
    const totalRows = response.value.total || rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
    const resolvedPage = Math.min(safePage, totalPages);
    if (resolvedPage !== safePage) return eastmoneyMarkets({ sort, page: resolvedPage, pageSize: safePageSize, signal, force });
    return {
      rows,
      stale: response.stale,
      warning: response.error || '',
      coverage: 'eastmoney_cn_stock_ranked_page',
      remotePagination: { page: resolvedPage, pageSize: safePageSize, totalRows, totalPages, hasMore: resolvedPage < totalPages },
      retrievedAt: storedAt,
    };
  }

  async function cnMarkets({ sort = 'gainers', page = 1, pageSize = 50, signal = null, force = false } = {}) {
    const config = getConfig();
    const errors = [];
    if (config.cnStock?.enabled === true && config.cnStock.apiKey) {
      try {
        const result = await quantdashMarkets({ sort, signal, force });
        if (result.rows.length || result.unavailable) return { ...result, source: 'quantdash' };
      } catch (error) {
        if (financeError(error) === 'cancelled') throw error;
        errors.push(financeError(error));
      }
    }
    if (config.cnEastmoney?.enabled === true) {
      try {
        const result = await eastmoneyMarkets({ sort, page, pageSize, signal, force });
        return { ...result, source: 'eastmoney', warning: [result.warning, ...errors].filter(Boolean).join(',') };
      } catch (error) {
        if (financeError(error) === 'cancelled') throw error;
        errors.push(financeError(error));
      }
    }
    const code = errors[0] || 'ranking_not_supported';
    throw Object.assign(new Error(code), { code });
  }

  async function coinGeckoMarkets({ signal = null, force = false } = {}) {
    const config = getConfig();
    if (config.coingecko?.enabled === false) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    const query = new URLSearchParams({
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: '100',
      page: '1',
      sparkline: 'true',
      price_change_percentage: '1h,24h,7d',
      locale: 'zh',
    });
    const response = await cached(`coingecko:markets:${query}`, 45_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/coins/markets?${query}`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    const rows = (Array.isArray(response.value) ? response.value : []).map((row) => normalizeCoinGeckoMarket(row, retrievedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
    return { rows, stale: response.stale, warning: response.error || '', coverage: 'coingecko_top_100_market_cap', retrievedAt };
  }

  async function binanceMarkets({ signal = null, force = false } = {}) {
    const config = getConfig();
    if (config.binance?.enabled === false) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    const response = await cached('binance:markets:24h', 45_000, (requestSignal) => requestJson(`${BINANCE_ORIGIN}/api/v3/ticker/24hr?type=MINI`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    const rows = (Array.isArray(response.value) ? response.value : [])
      .filter((row) => String(row?.symbol || '').toUpperCase().endsWith('USDT'))
      .map((row) => normalizeBinanceMarket(row, retrievedAt)).filter(Boolean)
      .map((row) => ({ ...row, stale: response.stale === true }));
    return { rows, stale: response.stale, warning: response.error || '', retrievedAt };
  }

  async function binanceQuotes(symbols, signal = null, force = false) {
    if (!symbols.length) return [];
    const config = getConfig();
    if (config.binance?.enabled === false) return [];
    const safeSymbols = [...new Set(symbols.map((symbol) => boundedText(symbol, 32).toUpperCase()).filter((symbol) => /^[A-Z0-9]{1,32}USDT$/.test(symbol)))].slice(0, MAX_IDS_PER_REQUEST);
    if (!safeSymbols.length) return [];
    const query = `symbols=${encodeURIComponent(JSON.stringify(safeSymbols))}&type=FULL`;
    const response = await cached(`binance:quotes:${safeSymbols.slice().sort().join(',')}`, 20_000, (requestSignal) => requestJson(`${BINANCE_ORIGIN}/api/v3/ticker/24hr?${query}`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    return (Array.isArray(response.value) ? response.value : []).map((row) => normalizeBinanceMarket(row, retrievedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
  }

  async function alphaVantageMovers({ signal = null, force = false } = {}) {
    const config = getConfig();
    if (config.alphaVantage?.enabled !== true || !config.alphaVantage.apiKey) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    // 免费层每日额度很低；手动刷新和后台刷新都复用半日快照，只有配置变更才清除此缓存。
    const response = await cached('quota:alpha-vantage:movers', ALPHA_VANTAGE_MOVERS_TTL_MS, async (requestSignal) => {
      const value = await requestJson(`${ALPHA_VANTAGE_ORIGIN}/query?function=TOP_GAINERS_LOSERS&apikey=${alphaVantageKey(config)}`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal });
      if (value?.Note || value?.Information) throw alphaVantageError(value.Note || value.Information);
      return value;
    }, signal, false);
    if (response.value?.Note || response.value?.Information) throw alphaVantageError(response.value.Note || response.value.Information);
    const retrievedAt = new Date(response.storedAt).toISOString();
    const categories = [['top_gainers', 'gainers'], ['top_losers', 'losers'], ['most_actively_traded', 'volume']];
    const lastUpdated = boundedText(response.value?.last_updated ?? response.value?.metadata, 48);
    const rows = categories.flatMap(([key, category]) => (Array.isArray(response.value?.[key]) ? response.value[key] : []).map((row) => normalizeAlphaVantageMover({ ...row, last_updated: row?.last_updated || lastUpdated }, category, retrievedAt)).filter(Boolean));
    return { rows, stale: response.stale, warning: response.error || '', retrievedAt };
  }

  async function overview(payload = {}) {
    return withOperation(payload, async (signal) => {
    const config = getConfig();
    const force = payload.force === true;
    const providers = providerStates(config);
    const result = { ok: true, providers, markets: [], crypto: null, retrievedAt: new Date(now()).toISOString(), warnings: [] };
    const coinGecko = providers.find((provider) => provider.id === 'coingecko');
    if (!coinGecko.enabled) {
      result.markets.push({ market: 'crypto', label: '加密货币', state: 'disabled', provider: 'CoinGecko' });
    } else {
      try {
        const response = await cached('coingecko:global', 45_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/global`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal, force);
        const data = response.value?.data || {};
        const marketCap = finiteNumber(data.total_market_cap?.usd);
        const volume = finiteNumber(data.total_volume?.usd);
        const change = finiteNumber(data.market_cap_change_percentage_24h_usd);
        const activeAssets = finiteNumber(data.active_cryptocurrencies);
        const btcDominance = finiteNumber(data.market_cap_percentage?.btc);
        if (marketCap === null) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        result.retrievedAt = new Date(response.storedAt).toISOString();
        let globalHistory = null;
        let globalHistoryError = config.coingecko?.apiKey ? '' : 'not_configured';
        if (config.coingecko?.apiKey) {
          try {
            const historyResponse = await cached('coingecko:global-market-cap:7', 45_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/global/market_cap_chart?days=7&vs_currency=usd`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal, force);
            globalHistory = normalizeCoinGeckoGlobalHistory(historyResponse.value, new Date(historyResponse.storedAt).toISOString());
            if (!globalHistory) globalHistoryError = 'invalid_response';
          } catch (historyError) {
            globalHistoryError = financeError(historyError);
          }
        }
        result.crypto = { marketCap, volume24h: volume, changePercent24h: change, activeAssets, btcDominance, globalSeries: globalHistory?.series || [], globalHistoryError, stale: response.stale === true };
        result.markets.push({ market: 'crypto', label: '加密货币', state: response.stale ? 'stale' : 'available', provider: 'CoinGecko', feed: '聚合 REST', session: '24/7', value: marketCap, changePercent: change });
        if (response.error) result.warnings.push({ provider: 'coingecko', error: response.error });
      } catch (error) {
        const message = financeError(error);
        result.markets.push({ market: 'crypto', label: '加密货币', state: 'error', provider: 'CoinGecko', error: message });
        result.warnings.push({ provider: 'coingecko', error: message });
      }
    }
    const alpaca = providers.find((provider) => provider.id === 'alpaca');
    const twelveData = providers.find((provider) => provider.id === 'twelve-data');
    const alphaVantage = providers.find((provider) => provider.id === 'alpha-vantage');
    const usProvider = [alpaca, twelveData, alphaVantage].find((provider) => provider.state === 'ready')
      || [alpaca, twelveData, alphaVantage].find((provider) => provider.enabled) || alpaca;
    const cnProviders = providers.filter((provider) => provider.market === 'cn');
    const cnProvider = cnProviders.find((provider) => provider.state === 'ready') || cnProviders[0];
    result.markets.unshift({ market: 'us', label: '美股', state: usProvider.state === 'ready' ? 'available_without_summary' : usProvider.state, provider: usProvider.label, feed: usProvider.feed });
    result.markets.unshift({ market: 'cn', label: 'A 股', state: cnProvider.state === 'ready' ? 'available_without_summary' : cnProvider.state, provider: cnProvider.label, feed: cnProvider.feed, session: '交易时段' });
    return result;
    });
  }

  async function ranking(payload = {}) {
    return withOperation(payload, async (signal) => {
      const requestedMarket = ['all', 'crypto', 'binance', 'us', 'cn'].includes(payload.market) ? payload.market : 'all';
      const legacyBinance = requestedMarket === 'binance';
      const market = legacyBinance ? 'crypto' : requestedMarket;
      const sort = ['gainers', 'losers', 'market_cap', 'volume'].includes(payload.sort) ? payload.sort : 'gainers';
      const requestedCryptoSource = ['coingecko', 'binance'].includes(payload.source) ? payload.source : legacyBinance ? 'binance' : 'coingecko';
      const cryptoSource = sort === 'market_cap' && requestedCryptoSource === 'binance' ? 'coingecko' : requestedCryptoSource;
      const source = market === 'cn' ? 'quantdash' : cryptoSource;
      const requestedPage = Math.max(1, Math.min(MAX_RANKING_PAGE, Math.floor(Number(payload.page) || 1)));
      const pageSize = Math.max(1, Math.min(50, Math.floor(Number(payload.pageSize) || 50)));
      const config = getConfig();
      const providers = providerStates(config);
      const force = payload.force === true;
      const emptyPageInfo = { page: 1, pageSize, totalRows: 0, totalPages: 1, hasMore: false, counts: { total: 0, positive: 0, negative: 0, flat: 0 } };
      const tasks = [];
      if ((market === 'crypto' || market === 'all') && cryptoSource === 'coingecko' && config.coingecko?.enabled !== false) tasks.push(coinGeckoMarkets({ signal, force }).then((result) => ({ ...result, source: 'coingecko' })));
      if ((market === 'crypto' || market === 'all') && cryptoSource === 'binance' && config.binance?.enabled !== false) tasks.push(binanceMarkets({ signal, force }).then((result) => ({ ...result, source: 'binance' })));
      if ((market === 'us' || market === 'all') && config.alphaVantage?.enabled === true && config.alphaVantage.apiKey) tasks.push(alphaVantageMovers({ signal, force }).then((result) => ({ ...result, source: 'alpha-vantage' })));
      if ((market === 'cn' || market === 'all') && (config.cnStock?.enabled === true && config.cnStock.apiKey || config.cnEastmoney?.enabled === true)) tasks.push(cnMarkets({ sort, page: requestedPage, pageSize, signal, force }));
      if (market === 'us' && !tasks.length) return { ok: true, market, source, sort, rows: [], providers, ...emptyPageInfo, unavailable: config.alphaVantage?.enabled === false ? 'provider_disabled' : 'ranking_not_supported' };
      if (market === 'cn' && !tasks.length) {
        const publicEnabled = ['cnTencent', 'cnEastmoney', 'cnSina'].some((key) => config[key]?.enabled === true);
        return { ok: true, market, source, sort, rows: [], providers, ...emptyPageInfo, unavailable: !publicEnabled && config.cnStock?.enabled !== true ? 'provider_disabled' : 'ranking_not_supported' };
      }
      const cryptoProviderDisabled = (market === 'crypto' || market === 'all') && ((cryptoSource === 'coingecko' && config.coingecko?.enabled === false) || (cryptoSource === 'binance' && config.binance?.enabled === false));
      if (!tasks.length) return { ok: true, market, source, sort, rows: [], providers, ...emptyPageInfo, unavailable: cryptoProviderDisabled ? 'provider_disabled' : 'provider_not_configured' };
      const settled = await Promise.allSettled(tasks);
      const responses = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
      const resolvedSource = market === 'cn' ? responses.find((response) => response.source)?.source || source : source;
      const errors = settled.filter((item) => item.status === 'rejected').map((item) => financeError(item.reason));
      const remoteResponse = market === 'cn' ? responses.find((response) => response.remotePagination) : null;
      if (remoteResponse) {
        const remote = remoteResponse.remotePagination;
        return {
          ok: true,
          market,
          source: resolvedSource,
          sort,
          rows: remoteResponse.rows || [],
          providers,
          ...remote,
          counts: { total: remote.totalRows },
          countsComplete: false,
          coverage: remoteResponse.coverage ? [remoteResponse.coverage] : [],
          stale: remoteResponse.stale === true,
          warning: [remoteResponse.warning, ...errors].filter(Boolean).join(',') || '',
          retrievedAt: remoteResponse.retrievedAt || new Date(now()).toISOString(),
        };
      }
      let rows = responses.flatMap((response) => {
        if (response.source !== 'alpha-vantage') return response.rows || [];
        const category = sort === 'market_cap' ? '' : sort;
        return (response.rows || []).filter((row) => row.feed === `alpha-vantage-${category}`);
      });
      if (sort === 'market_cap') rows = rows.filter((row) => row.marketCap !== null && row.marketCap !== undefined && Number.isFinite(Number(row.marketCap)));
      rows = rows.filter((row, index, sourceRows) => {
        const identity = row.asset.market === 'cn' ? `${row.asset.market}:${row.asset.symbol}` : row.asset.id;
        return sourceRows.findIndex((item) => (item.asset.market === 'cn' ? `${item.asset.market}:${item.asset.symbol}` : item.asset.id) === identity) === index;
      });
      rows.sort((left, right) => {
        if (sort === 'losers') return (left.changePercent ?? Infinity) - (right.changePercent ?? Infinity);
        if (sort === 'market_cap') return (right.marketCap ?? -Infinity) - (left.marketCap ?? -Infinity);
        if (sort === 'volume') return (right.volume24h ?? -Infinity) - (left.volume24h ?? -Infinity);
        return (right.changePercent ?? -Infinity) - (left.changePercent ?? -Infinity);
      });
      const featured = market === 'all' ? Object.fromEntries(['cn', 'us', 'crypto'].map((marketId) => [marketId, rows.filter((row) => row.asset.market === marketId).slice(0, 6)])) : null;
      const totalRows = rows.length;
      const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * pageSize;
      const changeValues = rows.map((row) => row.changePercent).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
      const counts = {
        total: totalRows,
        positive: changeValues.filter((value) => value > 0.05).length,
        negative: changeValues.filter((value) => value < -0.05).length,
      };
      counts.flat = changeValues.length - counts.positive - counts.negative;
      rows = rows.slice(offset, offset + pageSize);
      const pageInfo = { page, pageSize, totalRows, totalPages, hasMore: page < totalPages, counts };
      const retrievedTimes = responses.map((response) => Date.parse(response.retrievedAt || '')).filter(Number.isFinite);
      const retrievedAt = retrievedTimes.length ? new Date(Math.max(...retrievedTimes)).toISOString() : new Date(now()).toISOString();
      const warnings = [...new Set(responses.map((response) => response.warning).filter(Boolean))];
      const coverage = [...new Set(responses.map((response) => response.coverage).filter(Boolean))];
      const coverageInfo = coverage.length ? { coverage } : {};
      const unavailable = [...new Set(responses.map((response) => response.unavailable).filter(Boolean))];
      const uniqueErrors = [...new Set(errors)];
      if (market === 'cn' && !totalRows && uniqueErrors.length === 1 && uniqueErrors[0] === 'permission_denied') {
        return { ok: true, market, source: resolvedSource, sort, rows: [], providers, ...pageInfo, ...coverageInfo, unavailable: 'market_cap_permission_required', warning: 'CN_Stock permission required', retrievedAt };
      }
      if (!totalRows && unavailable.length) return { ok: true, market, source: resolvedSource, sort, rows: [], providers, ...pageInfo, ...coverageInfo, unavailable: unavailable[0], warning: [...warnings, ...uniqueErrors].join(',') || '', retrievedAt };
      if (!totalRows && uniqueErrors.length) return { ok: false, market, source: resolvedSource, sort, rows: [], providers, ...pageInfo, ...coverageInfo, error: uniqueErrors[0] };
      if (sort === 'market_cap' && !totalRows) return { ok: true, market, source: resolvedSource, sort, rows: [], providers, ...pageInfo, ...coverageInfo, unavailable: 'ranking_not_supported', warning: uniqueErrors[0] || '' };
      return { ok: true, market, source: resolvedSource, sort, rows, providers, ...pageInfo, ...coverageInfo, ...(featured ? { featured } : {}), stale: responses.some((response) => response.stale), warning: [...warnings, ...unavailable, ...uniqueErrors].join(',') || '', retrievedAt };
    });
  }

  async function history(payload = {}) {
    return withOperation(payload, async (signal) => {
      const assetId = boundedText(payload.assetId, 240);
      const days = [1, 7, 30, 90, 365].includes(Number(payload.days)) ? Number(payload.days) : 7;
      const config = getConfig();
      if (assetId.startsWith('crypto:binance:')) {
        const providerAssetId = assetId.slice('crypto:binance:'.length).toUpperCase();
        if (config.binance?.enabled === false) return { ok: false, assetId, days, error: 'provider_disabled' };
        const interval = days === 1 ? '1h' : '1d';
        const limit = Math.max(2, Math.min(MAX_HISTORY_POINTS, days === 1 ? 24 : days));
        try {
          const response = await cached(`binance:history:${providerAssetId}:${days}`, 45_000, (requestSignal) => requestJson(`${BINANCE_ORIGIN}/api/v3/klines?symbol=${encodeURIComponent(providerAssetId)}&interval=${interval}&limit=${limit}`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal }), signal);
          const retrievedAt = new Date(response.storedAt).toISOString();
          const result = normalizeBinanceHistory(response.value, assetId, retrievedAt, days);
          if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
          return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
        } catch (error) {
          return { ok: false, assetId, days, error: financeError(error) };
        }
      }
      const publicCode = publicCnCodeFromAssetId(assetId);
      if (publicCode && (config.cnStock?.enabled !== true || !config.cnStock.apiKey)) {
        if (config.cnEastmoney?.enabled !== true) {
          const anyPublic = ['cnTencent', 'cnSina'].some((key) => config[key]?.enabled === true);
          return { ok: false, assetId, days, error: anyPublic ? 'history_not_supported' : 'provider_disabled' };
        }
        const count = Math.max(2, Math.min(MAX_HISTORY_POINTS * 2, days === 1 ? 7 : days + 10));
        const lookbackDays = Math.max(14, Math.min(800, days * 2 + 14));
        const beginDate = new Date(now() - lookbackDays * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
        try {
          const response = await cached(
            `eastmoney:history:${publicCode}:${days}`,
            45_000,
            (requestSignal) => {
              const query = new URLSearchParams({ secid: publicCnSecId(publicCode), klt: '101', fqt: '0', beg: beginDate, end: '20500101', lmt: String(count), fields1: 'f1,f2,f3,f4', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' });
              return requestJson(`${EASTMONEY_HISTORY_ORIGIN}/api/qt/stock/kline/get?${query}`, { headers: publicCnHeaders('cn-eastmoney'), signal: requestSignal }).then(parseEastmoneyKlines);
            },
            signal
          );
          const retrievedAt = new Date(response.storedAt).toISOString();
          const result = normalizePublicCnHistory(response.value, assetId, retrievedAt, days);
          if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
          return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
        } catch (error) {
          return { ok: false, assetId, days, error: financeError(error) };
        }
      }
      const quantdashCode = publicCode;
      if (quantdashCode) {
        if (config.cnStock?.enabled !== true) return { ok: false, assetId, days, error: 'provider_disabled' };
        if (!config.cnStock.apiKey) return { ok: false, assetId, days, error: 'not_configured' };
        const count = Math.max(2, Math.min(MAX_HISTORY_POINTS, days === 1 ? 7 : days + 10));
        try {
          const response = await cached(
            `quantdash:history:${quantdashCode}:${days}`,
            45_000,
            (requestSignal) => quantdashCall(config, '/v1/klines', { symbol: quantdashCode, period: '1d', count, adjust: 'none' }, requestSignal).then(quantdashKlineData),
            signal
          );
          const retrievedAt = new Date(response.storedAt).toISOString();
          const result = normalizeQuantdashHistory({ data: response.value }, assetId, retrievedAt, days);
          if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
          return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
        } catch (error) {
          return { ok: false, assetId, days, error: financeError(error) };
        }
      }
      const usSymbol = usSymbolFromAssetId(assetId);
      if (usSymbol) {
        if (config.twelveData?.enabled !== true) return { ok: false, assetId, days, error: 'history_not_supported' };
        if (!config.twelveData.apiKey) return { ok: false, assetId, days, error: 'not_configured' };
        const outputsize = Math.max(2, Math.min(MAX_HISTORY_POINTS, days === 1 ? 2 : days + 10));
        try {
          const query = new URLSearchParams({ symbol: usSymbol, interval: days === 1 ? '1h' : '1day', outputsize: String(days === 1 ? 24 : outputsize), order: 'DESC' });
          const response = await cached(
            `twelve-data:history:${usSymbol}:${days}`,
            6 * 60 * 60_000,
            async (requestSignal) => {
              const value = await requestJson(`${TWELVE_DATA_ORIGIN}/time_series?${query}`, { headers: twelveDataHeaders(config), signal: requestSignal });
              const error = twelveDataError(value);
              if (error) throw error;
              return value;
            },
            signal
          );
          const retrievedAt = new Date(response.storedAt).toISOString();
          const result = normalizeTwelveDataHistory(response.value, assetId, retrievedAt, days);
          if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
          return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
        } catch (error) {
          return { ok: false, assetId, days, error: financeError(error) };
        }
      }
      if (!assetId.startsWith('crypto:coingecko:')) return { ok: false, assetId, days, error: 'history_not_supported' };
      const providerAssetId = assetId.slice('crypto:coingecko:'.length);
      if (config.coingecko?.enabled === false) return { ok: false, assetId, days, error: 'provider_disabled' };
      try {
        const response = await cached(`coingecko:history:${providerAssetId}:${days}`, 45_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/coins/${encodeURIComponent(providerAssetId)}/market_chart?vs_currency=usd&days=${days}`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal);
        const retrievedAt = new Date(response.storedAt).toISOString();
        const result = normalizeCoinGeckoHistory(response.value, providerAssetId, retrievedAt);
        if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
      } catch (error) {
        return { ok: false, assetId, days, error: financeError(error) };
      }
    });
  }

  async function coinGeckoQuotes(ids, signal = null, force = false) {
    if (!ids.length) return [];
    const config = getConfig();
    if (config.coingecko?.enabled === false) return [];
    const query = new URLSearchParams({
      vs_currency: 'usd',
      ids: ids.join(','),
      order: 'market_cap_desc',
      per_page: String(ids.length),
      page: '1',
      sparkline: 'true',
      price_change_percentage: '1h,24h,7d',
      locale: 'zh',
    });
    const response = await cached(`coingecko:quotes:${ids.slice().sort().join(',')}`, 20_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/coins/markets?${query}`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    return (Array.isArray(response.value) ? response.value : []).map((row) => normalizeCoinGeckoMarket(row, retrievedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
  }

  async function alpacaAssets(assets, signal = null, force = false) {
    const config = getConfig();
    if (config.alpaca?.enabled !== true || !config.alpaca.keyId || !config.alpaca.secretKey || !assets.length) return [];
    const feed = config.alpaca.feed === 'sip' ? 'sip' : 'iex';
    const headers = alpacaHeaders(config);
    const symbols = assets.map((asset) => asset.symbol);
    const cacheKey = `alpaca:quotes:${feed}:${symbols.slice().sort().join(',')}`;
    const response = await cached(cacheKey, 20_000, (requestSignal) => requestJson(`${ALPACA_DATA_ORIGIN}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=${feed}`, { headers, signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    return assets.map((asset) => normalizeAlpacaSnapshot(asset, response.value?.[asset.symbol], feed, retrievedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
  }

  async function twelveDataAssets(assets, signal = null, force = false) {
    const config = getConfig();
    if (config.twelveData?.enabled !== true || !config.twelveData.apiKey || !assets.length) return [];
    const limitedAssets = assets.slice(0, TWELVE_DATA_MAX_QUOTE_SYMBOLS);
    const symbols = limitedAssets.map((asset) => asset.symbol);
    const query = new URLSearchParams({ symbol: symbols.join(',') });
    const response = await cached(
      `twelve-data:quotes:${symbols.slice().sort().join(',')}`,
      60_000,
      (requestSignal) => requestJson(`${TWELVE_DATA_ORIGIN}/quote?${query}`, { headers: twelveDataHeaders(config), signal: requestSignal }).then(twelveDataRows),
      signal,
      force
    );
    const rowsBySymbol = new Map(response.value.map((row) => [boundedText(row?.symbol, 24).toUpperCase(), row]));
    const retrievedAt = new Date(response.storedAt).toISOString();
    return limitedAssets.map((asset) => normalizeTwelveDataQuote(rowsBySymbol.get(asset.symbol), retrievedAt, asset)).filter(Boolean)
      .map((row) => ({ ...row, stale: response.stale === true }));
  }

  async function usQuoteFallback(assets, signal = null, force = false) {
    if (!assets.length) return { rows: [], errors: [] };
    const config = getConfig();
    const rows = [];
    const errors = [];
    let pendingAssets = assets;
    const providers = [];
    if (config.alpaca?.enabled === true && config.alpaca.keyId && config.alpaca.secretKey) providers.push(['alpaca', alpacaAssets]);
    if (config.twelveData?.enabled === true && config.twelveData.apiKey) providers.push(['twelve-data', twelveDataAssets]);
    for (const [provider, loader] of providers) {
      if (!pendingAssets.length) break;
      try {
        const resolved = await loader(pendingAssets, signal, force);
        rows.push(...resolved);
        const resolvedIds = new Set(resolved.map((row) => row.asset.id));
        pendingAssets = pendingAssets.filter((asset) => !resolvedIds.has(asset.assetId));
      } catch (error) {
        const errorCode = financeError(error);
        if (errorCode === 'cancelled') throw error;
        errors.push({ provider, error: errorCode });
      }
    }
    return { rows, errors };
  }

  async function quotes(payload = {}) {
    return withOperation(payload, async (signal) => {
    const assetIds = Array.isArray(payload.assetIds) ? [...new Set(payload.assetIds.map((id) => boundedText(id, 240)).filter(Boolean))].slice(0, MAX_IDS_PER_REQUEST) : [];
    const force = payload.force === true;
    const config = getConfig();
    const cryptoIds = [];
    const binanceIds = [];
    const cnAssets = [];
    const usAssets = [];
    const unavailable = [];
    for (const assetId of assetIds) {
      if (assetId.startsWith('crypto:coingecko:')) {
        if (config.coingecko?.enabled === false) unavailable.push({ assetId, error: 'provider_disabled' });
        else cryptoIds.push(assetId.slice('crypto:coingecko:'.length));
      } else if (assetId.startsWith('crypto:binance:')) {
        if (config.binance?.enabled === false) unavailable.push({ assetId, error: 'provider_disabled' });
        else binanceIds.push(assetId.slice('crypto:binance:'.length));
      } else if (publicCnCodeFromAssetId(assetId)) {
        cnAssets.push({ assetId });
      } else if (assetId.startsWith('us:')) {
        const symbol = usSymbolFromAssetId(assetId);
        const exchange = assetId.split(':')[1] || 'US';
        if (symbol) usAssets.push({ assetId, symbol, exchange });
        else unavailable.push({ assetId, error: 'quote_unavailable' });
      } else unavailable.push({ assetId, error: 'provider_not_configured' });
    }
    const rows = [];
    const errors = [];
    const tasks = [
      coinGeckoQuotes(cryptoIds, signal, force).then((items) => rows.push(...items)).catch((error) => errors.push({ provider: 'coingecko', error: financeError(error) })),
      binanceQuotes(binanceIds, signal, force).then((items) => rows.push(...items)).catch((error) => errors.push({ provider: 'binance', error: financeError(error) })),
      cnQuoteFallback(cnAssets, signal, force).then((result) => { rows.push(...result.rows); errors.push(...result.errors); }),
      usQuoteFallback(usAssets, signal, force).then((result) => { rows.push(...result.rows); errors.push(...result.errors); }),
    ];
    await Promise.all(tasks);
    if (signal?.aborted) throw cancelledError();
    const publicProviderPriority = { quantdash: 0, tencent: 1, eastmoney: 2, sina: 3 };
    const selectedCnProvider = new Map();
    for (const row of rows) {
      if (row.asset.market !== 'cn') continue;
      const code = row.asset.symbol;
      const priority = publicProviderPriority[row.asset.provider] ?? 99;
      if (!selectedCnProvider.has(code) || priority < selectedCnProvider.get(code).priority) selectedCnProvider.set(code, { provider: row.asset.provider, priority });
    }
    const dedupedRows = [];
    const seenQuoteIdentities = new Set();
    for (const row of rows) {
      if (row.asset.market === 'cn') {
        const selected = selectedCnProvider.get(row.asset.symbol);
        if (selected && row.asset.provider !== selected.provider) continue;
      }
      const identity = row.asset.id;
      if (seenQuoteIdentities.has(identity)) continue;
      seenQuoteIdentities.add(identity);
      dedupedRows.push(row);
    }
    rows.length = 0;
    rows.push(...dedupedRows);
    const cnProviderAvailable = config.cnStock?.enabled === true && config.cnStock.apiKey
      || ['cnTencent', 'cnEastmoney', 'cnSina'].some((key) => config[key]?.enabled === true);
    const usProviderAvailable = config.alpaca?.enabled === true && config.alpaca.keyId && config.alpaca.secretKey
      || config.twelveData?.enabled === true && config.twelveData.apiKey;
    const usProviderEnabled = config.alpaca?.enabled === true || config.twelveData?.enabled === true;
    for (const assetId of assetIds) {
      if (publicCnCodeFromAssetId(assetId) && !cnProviderAvailable && !unavailable.some((item) => item.assetId === assetId)) unavailable.push({ assetId, error: 'provider_disabled' });
      if (assetId.startsWith('us:') && !usProviderAvailable && !unavailable.some((item) => item.assetId === assetId)) unavailable.push({ assetId, error: usProviderEnabled ? 'not_configured' : 'provider_disabled' });
      if (!rows.some((row) => row.asset.id === assetId) && !unavailable.some((item) => item.assetId === assetId)) unavailable.push({ assetId, error: 'quote_unavailable' });
    }
    const retrievedTimes = rows.map((row) => Date.parse(row.retrievedAt || '')).filter(Number.isFinite);
    const retrievedAt = retrievedTimes.length ? new Date(Math.max(...retrievedTimes)).toISOString() : new Date(now()).toISOString();
    return { ok: errors.length === 0 || rows.length > 0, rows, unavailable, errors, providers: providerStates(getConfig()), retrievedAt };
    });
  }

  async function fundamentals(payload = {}) {
    return withOperation(payload, async (signal) => {
      const assetId = boundedText(payload.assetId, 240);
      const symbol = usSymbolFromAssetId(assetId);
      if (!symbol) return { ok: false, assetId, error: 'fundamentals_not_supported' };
      const config = getConfig();
      try {
        requireSecEdgarConfig(config);
        const tickerResponse = await cached(
          'sec-edgar:company-tickers',
          24 * 60 * 60_000,
          (requestSignal) => requestJson(`${SEC_FILES_ORIGIN}/files/company_tickers.json`, { headers: secEdgarHeaders(config), signal: requestSignal }),
          signal
        );
        const tickerRows = tickerResponse.value && typeof tickerResponse.value === 'object' && !Array.isArray(tickerResponse.value)
          ? Object.values(tickerResponse.value).slice(0, 20_000) : [];
        const company = tickerRows.find((row) => boundedText(row?.ticker, 24).toUpperCase() === symbol);
        const cikNumber = Math.floor(finiteNumber(company?.cik_str) || 0);
        if (!cikNumber) return { ok: false, assetId, provider: 'sec-edgar', error: 'fundamentals_unavailable' };
        const cik = String(cikNumber).padStart(10, '0');
        const descriptors = [
          { key: 'assets', label: '总资产', concept: 'Assets' },
          { key: 'liabilities', label: '总负债', concept: 'Liabilities' },
          { key: 'equity', label: '股东权益', concept: 'StockholdersEquity' },
          { key: 'revenue', label: '营业收入', concept: 'RevenueFromContractWithCustomerExcludingAssessedTax' },
          { key: 'revenue', label: '营业收入', concept: 'Revenues' },
          { key: 'netIncome', label: '净利润', concept: 'NetIncomeLoss' },
        ];
        const settled = await Promise.allSettled(descriptors.map(async (descriptor) => {
          const response = await cached(
            `sec-edgar:concept:${cik}:${descriptor.concept}`,
            SEC_FUNDAMENTALS_TTL_MS,
            (requestSignal) => requestJson(`${SEC_DATA_ORIGIN}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${encodeURIComponent(descriptor.concept)}.json`, { headers: secEdgarHeaders(config), signal: requestSignal }),
            signal,
            payload.force === true
          );
          return { descriptor, response, metric: normalizeSecCompanyConcept(response.value, descriptor) };
        }));
        if (signal?.aborted) throw cancelledError();
        const resolved = settled.filter((item) => item.status === 'fulfilled' && item.value.metric).map((item) => item.value);
        const rejected = settled.filter((item) => item.status === 'rejected');
        const isMissingConcept = (item) => /http_404/i.test(boundedText(item?.reason?.code || item?.reason?.message, 80));
        if (!resolved.length) {
          const firstError = rejected.find((item) => !isMissingConcept(item));
          return { ok: false, assetId, provider: 'sec-edgar', error: firstError ? financeError(firstError.reason) : 'fundamentals_unavailable' };
        }
        const metricsByKey = new Map();
        for (const item of resolved) {
          const existing = metricsByKey.get(item.metric.key);
          if (!existing || item.metric.filedAt > existing.metric.filedAt) metricsByKey.set(item.metric.key, item);
        }
        const order = ['assets', 'liabilities', 'equity', 'revenue', 'netIncome'];
        const ordered = order.map((key) => metricsByKey.get(key)).filter(Boolean);
        const retrievedTimes = [tickerResponse.storedAt, ...ordered.map((item) => item.response.storedAt)].filter(Number.isFinite);
        const warnings = [...new Set(rejected.filter((item) => !isMissingConcept(item)).map((item) => financeError(item.reason)))];
        return {
          ok: true,
          assetId,
          provider: 'sec-edgar',
          feed: 'sec-edgar-xbrl-companyconcept',
          symbol,
          cik,
          entityName: boundedText(ordered[0]?.response?.value?.entityName || company?.title, 160) || symbol,
          metrics: ordered.map((item) => item.metric),
          stale: tickerResponse.stale === true || ordered.some((item) => item.response.stale === true),
          warning: warnings.join(','),
          retrievedAt: new Date(Math.max(...retrievedTimes)).toISOString(),
        };
      } catch (error) {
        return { ok: false, assetId, provider: 'sec-edgar', error: financeError(error) };
      }
    });
  }

  async function search(payload = {}) {
    return withOperation(payload, async (signal) => {
    const query = boundedText(payload.query, 120);
    if (!query) return { ok: true, items: [], providers: providerStates(getConfig()) };
    const config = getConfig();
    const items = [];
    const errors = [];
    const warnings = [];
    if (config.coingecko?.enabled !== false) {
      try {
        const response = await cached(`coingecko:search:${query.toLowerCase()}`, 5 * 60_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/search?query=${encodeURIComponent(query)}`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal);
        for (const coin of Array.isArray(response.value?.coins) ? response.value.coins.slice(0, MAX_SEARCH_RESULTS) : []) {
          const providerAssetId = boundedText(coin?.id, 160);
          const symbol = boundedText(coin?.symbol, 32).toUpperCase();
          const name = boundedText(coin?.name, 120);
          if (!providerAssetId || !symbol || !name) continue;
          items.push({ id: `crypto:coingecko:${providerAssetId}`, provider: 'coingecko', providerAssetId, market: 'crypto', type: 'crypto', symbol, exchange: 'CoinGecko', currency: 'USD', name, rank: finiteNumber(coin?.market_cap_rank) });
        }
      } catch (error) { errors.push({ provider: 'coingecko', error: financeError(error) }); }
    }
    const exactSymbol = /^[A-Za-z][A-Za-z0-9.-]{0,14}$/.test(query) ? query.toUpperCase() : '';
    if (exactSymbol && config.binance?.enabled !== false) {
      try {
        const providerAssetId = exactSymbol.endsWith('USDT') ? exactSymbol : `${exactSymbol}USDT`;
        const response = await cached(`binance:search:${providerAssetId}`, 5 * 60_000, (requestSignal) => requestJson(`${BINANCE_ORIGIN}/api/v3/ticker/24hr?symbol=${encodeURIComponent(providerAssetId)}&type=FULL`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal }), signal);
        const result = normalizeBinanceMarket(response.value, new Date(response.storedAt).toISOString());
        if (result) items.push(result.asset);
      } catch (error) { errors.push({ provider: 'binance', error: financeError(error) }); }
    }
    if (query.length >= 2 && config.twelveData?.enabled === true && config.twelveData.apiKey) {
      try {
        const searchQuery = new URLSearchParams({ symbol: query, outputsize: String(MAX_SEARCH_RESULTS) });
        const response = await cached(
          `twelve-data:search:${query.toLowerCase()}`,
          24 * 60 * 60_000,
          async (requestSignal) => {
            const value = await requestJson(`${TWELVE_DATA_ORIGIN}/symbol_search?${searchQuery}`, { headers: twelveDataHeaders(config), signal: requestSignal });
            const error = twelveDataError(value);
            if (error) throw error;
            return value;
          },
          signal
        );
        items.push(...normalizeTwelveDataSearch(response.value));
      } catch (error) { errors.push({ provider: 'twelve-data', error: financeError(error) }); }
    }
    if (exactSymbol && config.alpaca?.enabled === true && config.alpaca.keyId && config.alpaca.secretKey) {
      try {
        const asset = await requestJson(`${ALPACA_TRADING_ORIGIN}/v2/assets/${encodeURIComponent(exactSymbol)}`, { headers: alpacaHeaders(config), signal });
        if (asset?.tradable !== false && asset?.status !== 'inactive') {
          items.unshift({ id: `us:${boundedText(asset.exchange, 32).toLowerCase() || 'unknown'}:${exactSymbol}`, provider: 'alpaca', providerAssetId: exactSymbol, market: 'us', type: 'stock', symbol: exactSymbol, exchange: boundedText(asset.exchange, 32) || 'US', currency: 'USD', name: boundedText(asset.name, 120) || exactSymbol });
        }
      } catch (error) { errors.push({ provider: 'alpaca', error: financeError(error) }); }
    }
    if (config.cnStock?.enabled === true && config.cnStock.apiKey) {
      const inferredCode = inferQuantdashCode(query);
      let primaryError = '';
      if (inferredCode) {
        try {
          const asset = await quantdashAssetByCode(config, inferredCode, signal);
          if (asset) items.unshift(asset);
        } catch (error) {
          primaryError = financeError(error);
          errors.push({ provider: 'cn-stock', error: primaryError });
        }
      } else {
        const normalizedQuery = query.toLowerCase();
        for (const row of quantdashUniverseRows) {
          const extension = row?.ext && typeof row.ext === 'object' ? row.ext : {};
          const symbol = boundedText(row?.symbol, 24).toUpperCase();
          const name = boundedText(extension.name, 120);
          if (!symbol || !name || ![symbol.toLowerCase(), name.toLowerCase()].some((value) => value.includes(normalizedQuery))) continue;
          const asset = quantdashAsset(symbol, name);
          if (asset) items.unshift(asset);
          if (items.filter((item) => item.market === 'cn').length >= MAX_SEARCH_RESULTS) break;
        }
        if (!items.some((item) => item.market === 'cn')) warnings.push({ provider: 'cn-stock', warning: 'asset_search_symbol_only' });
      }
      if (primaryError === 'permission_denied') warnings.push({ provider: 'cn-stock', warning: 'asset_metadata_unavailable' });
    }
    const publicCode = inferQuantdashCode(query);
    const publicProviders = [
      ['cn-tencent', 'tencent'],
      ['cn-eastmoney', 'eastmoney'],
      ['cn-sina', 'sina'],
    ];
    if (publicCode && !items.some((item) => item.market === 'cn')) {
      for (const [providerId, providerName] of publicProviders) {
        if (publicCnConfig(config, providerId)?.enabled !== true) continue;
        try {
          const response = await publicCnFetchRows(providerId, [publicCode], signal);
          const row = response.value.find((item) => boundedText(item.symbol, 24).toUpperCase() === publicCode);
          const asset = row ? publicCnAsset(row.symbol, row.name, providerName) : null;
          if (asset) {
            items.push(asset);
            break;
          }
        } catch (error) {
          errors.push({ provider: providerId, error: financeError(error) });
        }
      }
    } else {
      const normalizedQuery = query.toLowerCase();
      const publicRows = [...(publicCnUniverseRows.get('eastmoney') || [])];
      for (const row of publicRows) {
        const symbol = boundedText(row?.symbol, 24).toUpperCase();
        const name = boundedText(row?.name, 120);
        if (!symbol || !name || ![symbol.toLowerCase(), name.toLowerCase()].some((value) => value.includes(normalizedQuery))) continue;
        const provider = publicCnAsset(symbol, name, 'eastmoney');
        if (provider) items.push(provider);
        if (items.filter((item) => item.market === 'cn').length >= MAX_SEARCH_RESULTS) break;
      }
      if (!items.some((item) => item.market === 'cn') && publicRows.length) warnings.push({ provider: 'cn-eastmoney', warning: 'asset_search_symbol_only' });
    }
    if (signal?.aborted) throw cancelledError();
    const uniqueItems = items.filter(Boolean).filter((item, index, rows) => {
      const identity = ['cn', 'us'].includes(item.market) ? `${item.market}:${item.symbol}` : item.id;
      return rows.findIndex((candidate) => (['cn', 'us'].includes(candidate.market) ? `${candidate.market}:${candidate.symbol}` : candidate.id) === identity) === index;
    });
    return { ok: uniqueItems.length > 0 || errors.length === 0, items: uniqueItems.slice(0, MAX_SEARCH_RESULTS), errors, warnings, providers: providerStates(config) };
    });
  }

  async function prefetch(payload = {}) {
    return withOperation(payload, async (signal) => {
      const operation = { force: true, [INTERNAL_OPERATION_SIGNAL]: signal };
      const overviewResult = await overview(operation);
      if (signal?.aborted) throw cancelledError();
      const assetIds = Array.isArray(payload.assetIds) ? [...new Set(payload.assetIds.map((value) => boundedText(value, 240)).filter(Boolean))].slice(0, MAX_IDS_PER_REQUEST) : [];
      const quoteResult = assetIds.length ? await quotes({ ...operation, assetIds }) : null;
      if (signal?.aborted) throw cancelledError();
      const rankingMarket = ['all', 'crypto', 'binance', 'us', 'cn'].includes(payload.rankingMarket) ? payload.rankingMarket : 'all';
      const rankingSource = ['coingecko', 'binance'].includes(payload.rankingSource) ? payload.rankingSource : 'coingecko';
      const rankingSort = ['gainers', 'losers', 'market_cap', 'volume'].includes(payload.rankingSort) ? payload.rankingSort : 'gainers';
      const rankingPage = Math.max(1, Math.min(MAX_RANKING_PAGE, Math.floor(Number(payload.rankingPage) || 1)));
      const overviewQueries = ['gainers', 'losers', 'volume'].map((sort) => ({ market: 'all', source: rankingSource, sort, page: 1, pageSize: 50 }));
      const activeQuery = rankingMarket === 'binance'
        ? { market: 'binance', source: 'binance', sort: rankingSort, page: rankingPage, pageSize: 50 }
        : { market: rankingMarket, source: rankingSource, sort: rankingSort, page: rankingPage, pageSize: 50 };
      const rankingQueries = [...overviewQueries, activeQuery]
        .filter((query, index, rows) => rows.findIndex((item) => item.market === query.market && item.source === query.source && item.sort === query.sort && item.page === query.page) === index);
      const settled = await Promise.allSettled(rankingQueries.map((query) => ranking({ ...operation, ...query })));
      if (signal?.aborted) throw cancelledError();
      const rankings = {};
      rankingQueries.forEach((query, index) => {
        const item = settled[index];
        const baseKey = query.market === 'crypto' && query.source === 'coingecko' ? `crypto:${query.sort}` : query.source === 'binance' ? `${query.market === 'crypto' || query.market === 'binance' ? 'binance' : query.market === 'all' ? 'all:binance' : query.market}:${query.sort}` : query.market === 'us' || query.market === 'cn' ? `${query.market}:${query.sort}` : `${query.market}:${query.source}:${query.sort}`;
        const key = query.page > 1 ? `${baseKey}:page:${query.page}` : baseKey;
        rankings[key] = item.status === 'fulfilled' ? item.value : null;
      });
      return { ok: overviewResult.ok !== false, overview: overviewResult, quotes: quoteResult, rankings, retrievedAt: new Date(now()).toISOString() };
    });
  }

  async function testProvider(providerId) {
    const config = getConfig();
    try {
      if (providerId === 'coingecko') {
        if (config.coingecko?.enabled === false) return { ok: false, error: 'provider_disabled' };
        const value = await requestJson(`${COINGECKO_ORIGIN}/api/v3/ping`, { headers: coinGeckoHeaders(config) });
        return value && typeof value === 'object' ? { ok: true } : { ok: false, error: 'invalid_response' };
      }
      if (providerId === 'binance') {
        if (config.binance?.enabled === false) return { ok: false, error: 'provider_disabled' };
        const value = await requestJson(`${BINANCE_ORIGIN}/api/v3/ping`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' } });
        return value && typeof value === 'object' ? { ok: true } : { ok: false, error: 'invalid_response' };
      }
      if (providerId === 'alpha-vantage') {
        if (config.alphaVantage?.enabled !== true || !config.alphaVantage.apiKey) return { ok: false, error: 'not_configured' };
        const value = await requestJson(`${ALPHA_VANTAGE_ORIGIN}/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${alphaVantageKey(config)}`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' } });
        if (value?.Note || value?.Information) throw alphaVantageError(value.Note || value.Information);
        return value && typeof value === 'object' ? { ok: true } : { ok: false, error: 'invalid_response' };
      }
      if (providerId === 'alpaca') {
        if (config.alpaca?.enabled !== true || !config.alpaca.keyId || !config.alpaca.secretKey) return { ok: false, error: 'not_configured' };
        await requestJson(`${ALPACA_DATA_ORIGIN}/v2/stocks/snapshots?symbols=AAPL&feed=${config.alpaca.feed === 'sip' ? 'sip' : 'iex'}`, { headers: alpacaHeaders(config) });
        return { ok: true, capabilities: { realtime: 'available', history: 'unsupported', exactCodeSearch: 'available', metadata: 'available', fullMarket: 'unsupported', marketCap: 'unsupported', fundamentals: 'unsupported' } };
      }
      if (providerId === 'twelve-data') {
        requireTwelveDataConfig(config);
        const quote = await requestJson(`${TWELVE_DATA_ORIGIN}/quote?symbol=AAPL`, { headers: twelveDataHeaders(config) });
        if (!normalizeTwelveDataQuote(quote, new Date(now()).toISOString())) return { ok: false, error: 'invalid_response' };
        const historyPayload = await requestJson(`${TWELVE_DATA_ORIGIN}/time_series?symbol=AAPL&interval=1day&outputsize=2&order=DESC`, { headers: twelveDataHeaders(config) });
        const historyResult = normalizeTwelveDataHistory(historyPayload, 'us:twelve-data:AAPL', new Date(now()).toISOString(), 7);
        const searchPayload = await requestJson(`${TWELVE_DATA_ORIGIN}/symbol_search?symbol=AAPL&outputsize=1`, { headers: twelveDataHeaders(config) });
        const searchResult = normalizeTwelveDataSearch(searchPayload);
        return { ok: true, capabilities: { realtime: 'available', history: historyResult ? 'available' : 'invalid_response', exactCodeSearch: searchResult.length ? 'available' : 'invalid_response', metadata: searchResult.length ? 'available' : 'invalid_response', fullMarket: 'unsupported', marketCap: 'unsupported', fundamentals: 'unsupported' } };
      }
      if (providerId === 'sec-edgar') {
        requireSecEdgarConfig(config);
        const headers = secEdgarHeaders(config);
        const tickers = await requestJson(`${SEC_FILES_ORIGIN}/files/company_tickers.json`, { headers });
        const apple = tickers && typeof tickers === 'object'
          ? Object.values(tickers).slice(0, 20_000).find((row) => boundedText(row?.ticker, 24).toUpperCase() === 'AAPL' && finiteNumber(row?.cik_str) !== null) : null;
        if (!apple) return { ok: false, error: 'invalid_response' };
        const cik = String(Math.floor(finiteNumber(apple.cik_str))).padStart(10, '0');
        const assets = await requestJson(`${SEC_DATA_ORIGIN}/api/xbrl/companyconcept/CIK${cik}/us-gaap/Assets.json`, { headers });
        const metric = normalizeSecCompanyConcept(assets, { key: 'assets', label: '总资产', concept: 'Assets' });
        return metric
          ? { ok: true, capabilities: { realtime: 'unsupported', history: 'unsupported', exactCodeSearch: 'available', metadata: 'available', fullMarket: 'unsupported', marketCap: 'unsupported', fundamentals: 'available' } }
          : { ok: false, error: 'invalid_response' };
      }
      if (['cn-tencent', 'cn-eastmoney', 'cn-sina'].includes(providerId)) {
        requirePublicCnConfig(config, providerId);
        const response = await publicCnFetchRows(providerId, ['000001.SZ'], null, true);
        if (!response.value.length) return { ok: false, error: 'invalid_response' };
        let historyCapability = 'unsupported';
        let fullMarket = 'unsupported';
        if (providerId === 'cn-eastmoney') {
          try {
            const ranked = await eastmoneyMarkets({ sort: 'gainers', page: 1, pageSize: 1, force: true });
            fullMarket = ranked.rows.length ? 'available' : 'invalid_response';
          } catch (error) {
            fullMarket = financeError(error);
          }
          try {
            const beginDate = new Date(now() - 30 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
            const query = new URLSearchParams({ secid: '0.000001', klt: '101', fqt: '0', beg: beginDate, end: '20500101', lmt: '10', fields1: 'f1,f2,f3,f4', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' });
            const rows = await requestJson(`${EASTMONEY_HISTORY_ORIGIN}/api/qt/stock/kline/get?${query}`, { headers: publicCnHeaders(providerId) }).then(parseEastmoneyKlines);
            historyCapability = rows.length >= 2 ? 'available' : 'invalid_response';
          } catch (error) {
            historyCapability = financeError(error);
          }
        }
        return {
          ok: true,
          capabilities: {
            realtime: 'available',
            daily: historyCapability,
            exactCodeSearch: 'available',
            history: historyCapability,
            metadata: 'available',
            fullMarket,
            marketCap: 'unsupported',
          },
        };
      }
      if (providerId === 'cn-stock') {
        requireQuantdashConfig(config);
        const quoteCapability = async () => {
          try {
            const rows = await quantdashQuoteRows(config, { symbols: '000001.SZ' });
            return rows.length ? 'available' : 'invalid_response';
          } catch (error) {
            const errorCode = financeError(error);
            return errorCode === 'permission_denied' ? 'permission_required' : errorCode;
          }
        };
        const klineCapability = async () => {
          try {
            const data = quantdashKlineData(await quantdashCall(config, '/v1/klines', { symbol: '000001.SZ', period: '1d', count: 1, adjust: 'none' }));
            return data.timestamp.length ? 'available' : 'invalid_response';
          } catch (error) {
            const errorCode = financeError(error);
            return errorCode === 'permission_denied' ? 'permission_required' : errorCode;
          }
        };
        const instrumentCapability = async () => {
          try {
            const rows = quantdashInstrumentRows(await quantdashCall(config, '/v1/instruments', { symbols: '000001.SZ' }));
            return rows.length ? 'available' : 'invalid_response';
          } catch (error) {
            const errorCode = financeError(error);
            return errorCode === 'permission_denied' ? 'permission_required' : errorCode;
          }
        };
        const universeCapability = async () => {
          try {
            const rows = await quantdashQuoteRows(config, { universes: 'CN_Stock' });
            return rows.length ? 'available' : 'invalid_response';
          } catch (error) {
            const errorCode = financeError(error);
            return errorCode === 'permission_denied' ? 'permission_required' : errorCode;
          }
        };
        const [realtime, historyCapability, metadata, fullMarket] = await Promise.all([quoteCapability(), klineCapability(), instrumentCapability(), universeCapability()]);
        if (realtime !== 'available') return { ok: false, error: realtime };
        return {
          ok: true,
          capabilities: {
            realtime,
            daily: historyCapability,
            exactCodeSearch: realtime,
            history: historyCapability,
            metadata,
            fullMarket,
            marketCap: 'unsupported',
          },
        };
      }
      return { ok: false, error: 'provider_not_available' };
    } catch (error) {
      return { ok: false, error: financeError(error) };
    }
  }

  return { overview, ranking, quotes, history, fundamentals, search, prefetch, testProvider, providerStates: () => providerStates(getConfig()), clearCache, cancel };
}

module.exports = {
  createFinanceService,
  normalizeCoinGeckoMarket,
  normalizeCoinGeckoHistory,
  normalizeCoinGeckoGlobalHistory,
  normalizeBinanceMarket,
  normalizeBinanceHistory,
  normalizeAlphaVantageMover,
  normalizeAlpacaSnapshot,
  normalizeTwelveDataQuote,
  normalizeTwelveDataHistory,
  normalizeTwelveDataSearch,
  normalizeSecCompanyConcept,
  normalizeQuantdashMarket,
  normalizeQuantdashHistory,
  quantdashRows,
  quantdashKlineData,
  quantdashCodeFromAssetId,
  publicCnCodeFromAssetId,
  parseTencentQuotes,
  parseSinaQuotes,
  parseEastmoneyQuotes,
  parseEastmoneyKlines,
  normalizePublicCnQuote,
  normalizePublicCnHistory,
  providerStates,
  freshnessFor,
  sampleSeries,
  sampleHistory,
};
