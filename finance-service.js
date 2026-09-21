'use strict';

const { createFinanceRequestCache } = require('./main/finance-request-cache');
const { createFinanceProviderAdapters } = require('./main/finance-provider-adapters');
const {
  finiteNumber,
  sampleSeries,
  freshnessFor,
  sampleHistory,
  normalizeCoinGeckoHistory,
  normalizeCoinGeckoGlobalHistory,
  normalizeCoinGeckoMarket,
  normalizeBinanceMarket,
  normalizeAlphaVantageMover,
  normalizeBinanceHistory,
  normalizeAlpacaSnapshot,
} = require('./main/finance-market-normalizers');

const COINGECKO_ORIGIN = 'https://api.coingecko.com';
const BINANCE_ORIGIN = 'https://api.binance.com';
const ALPHA_VANTAGE_ORIGIN = 'https://www.alphavantage.co';
const ALPACA_DATA_ORIGIN = 'https://data.alpaca.markets';
const ALPACA_TRADING_ORIGIN = 'https://paper-api.alpaca.markets';
const TWELVE_DATA_ORIGIN = 'https://api.twelvedata.com';
const QUANTDASH_ORIGIN = 'https://api.quantdash.net';
const TENCENT_ORIGIN = 'https://qt.gtimg.cn';
const EASTMONEY_ORIGIN = 'https://push2.eastmoney.com';
const EASTMONEY_DELAY_ORIGIN = 'https://push2delay.eastmoney.com';
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

const {
  parseTencentQuotes,
  parseSinaQuotes,
  parseEastmoneyKlines,
  parseEastmoneyQuotes,
} = require('./main/finance-public-parsers');

const {
  twelveDataError,
  normalizeTwelveDataQuote,
  normalizeTwelveDataHistory,
  usSymbolFromAssetId,
  normalizeTwelveDataSearch,
  normalizeSecCompanyConcept,
  quantdashAsset,
  normalizeQuantdashMarket,
  normalizeQuantdashHistory,
  quantdashRows,
  quantdashKlineData,
  quantdashInstrumentRows,
  quantdashCodeFromAssetId,
  inferQuantdashCode,
  publicCnCodeFromAssetId,
  publicCnPrefix,
  publicCnAsset,
  normalizePublicCnQuote,
  normalizePublicCnHistory,
} = require('./main/finance-provider-normalizers');

const {
  boundedText,
  providerStates,
  financeError,
  cancelledError,
} = require('./main/finance-domain');



function createFinanceService({ requestJson, getConfig = () => ({}), now = () => Date.now() } = {}) {
  if (typeof requestJson !== 'function') throw new TypeError('requestJson is required');
  const requestCache = createFinanceRequestCache({
    now,
    financeError,
    cancelledError,
    maxCacheEntries: MAX_CACHE_ENTRIES,
  });
  const { cached, cancel, withOperation, operationSignal } = requestCache;
  let quantdashUniverseRows = [];
  const publicCnUniverseRows = new Map();
  const providerAdapters = createFinanceProviderAdapters({
    requestJson,
    getConfig,
    now,
    cached,
    financeError,
    cancelledError,
    boundedText,
    finiteNumber,
    inferQuantdashCode,
    publicCnPrefix,
    publicCnSecId,
    publicCnCodeFromAssetId,
    usSymbolFromAssetId,
    quantdashAsset,
    publicCnAsset,
    normalizeCoinGeckoMarket,
    normalizeCoinGeckoHistory,
    normalizeBinanceMarket,
    normalizeBinanceHistory,
    normalizeAlphaVantageMover,
    normalizeAlpacaSnapshot,
    normalizeTwelveDataQuote,
    normalizeTwelveDataHistory,
    normalizeTwelveDataSearch,
    normalizeQuantdashMarket,
    normalizeQuantdashHistory,
    normalizePublicCnQuote,
    normalizePublicCnHistory,
    normalizeSecCompanyConcept,
    parseTencentQuotes,
    parseSinaQuotes,
    parseEastmoneyQuotes,
    parseEastmoneyKlines,
    quantdashRows,
    quantdashKlineData,
    quantdashInstrumentRows,
    twelveDataError,
  });

  function clearCache(options = {}) {
    requestCache.clear(options);
    quantdashUniverseRows = [];
    publicCnUniverseRows.clear();
    providerAdapters.clearState();
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
    const cnMarket = { market: 'cn', label: 'A 股', state: cnProvider.state === 'ready' ? 'available_without_summary' : cnProvider.state, provider: cnProvider.label, feed: cnProvider.feed, session: '交易时段', benchmark: '上证指数' };
    if (cnProviders.some((provider) => provider.enabled)) {
      try {
        const benchmarkResult = await providerAdapters.cnQuoteFallback([{ assetId: 'cn:eastmoney:000001.SH', symbol: '000001' }], signal, force);
        const benchmark = benchmarkResult.rows?.[0];
        if (benchmark && Number.isFinite(Number(benchmark.price))) {
          cnMarket.value = benchmark.price;
          cnMarket.changePercent = benchmark.changePercent;
          cnMarket.benchmarkAssetId = benchmark.asset.id;
          cnMarket.provider = benchmark.asset.provider === 'eastmoney' ? '东方财富' : cnMarket.provider;
          cnMarket.feed = benchmark.feed;
        }
        if (benchmarkResult.errors?.length) result.warnings.push(...benchmarkResult.errors);
      } catch (error) {
        const message = financeError(error);
        if (message !== 'cancelled') result.warnings.push({ provider: 'cn-benchmark', error: message });
        else throw error;
      }
    }
    result.markets.unshift({ market: 'us', label: '美股', state: usProvider.state === 'ready' ? 'available_without_summary' : usProvider.state, provider: usProvider.label, feed: usProvider.feed });
    result.markets.unshift(cnMarket);
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
      if ((market === 'crypto' || market === 'all') && cryptoSource === 'coingecko' && config.coingecko?.enabled !== false) tasks.push(providerAdapters.coinGeckoMarkets({ signal, force }).then((result) => ({ ...result, source: 'coingecko' })));
      if ((market === 'crypto' || market === 'all') && cryptoSource === 'binance' && config.binance?.enabled !== false) tasks.push(providerAdapters.binanceMarkets({ signal, force }).then((result) => ({ ...result, source: 'binance' })));
      if ((market === 'us' || market === 'all') && config.alphaVantage?.enabled === true && config.alphaVantage.apiKey) tasks.push(providerAdapters.alphaVantageMovers({ signal, force }).then((result) => ({ ...result, source: 'alpha-vantage' })));
      if ((market === 'cn' || market === 'all') && (config.cnStock?.enabled === true && config.cnStock.apiKey || config.cnEastmoney?.enabled === true)) tasks.push(providerAdapters.cnMarkets({ sort, page: requestedPage, pageSize, signal, force }));
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
      return providerAdapters.history(assetId, days, signal, payload.force === true);
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
      providerAdapters.coinGeckoQuotes(cryptoIds, signal, force).then((items) => rows.push(...items)).catch((error) => errors.push({ provider: 'coingecko', error: financeError(error) })),
      providerAdapters.binanceQuotes(binanceIds, signal, force).then((items) => rows.push(...items)).catch((error) => errors.push({ provider: 'binance', error: financeError(error) })),
      providerAdapters.cnQuoteFallback(cnAssets, signal, force).then((result) => { rows.push(...result.rows); errors.push(...result.errors); }),
      providerAdapters.usQuoteFallback(usAssets, signal, force).then((result) => { rows.push(...result.rows); errors.push(...result.errors); }),
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
      return providerAdapters.fundamentals(assetId, signal, payload.force === true);
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
          const asset = await providerAdapters.quantdashAssetByCode(config, inferredCode, signal);
          if (asset) items.unshift(asset);
        } catch (error) {
          primaryError = financeError(error);
          errors.push({ provider: 'cn-stock', error: primaryError });
        }
      } else {
        const normalizedQuery = query.toLowerCase();
        for (const row of providerAdapters.quantdashUniverseRows()) {
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
          const response = await providerAdapters.publicCnFetchRows(providerId, [publicCode], signal);
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
      const publicRows = providerAdapters.publicCnUniverseRows('eastmoney');
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
      const operation = { force: true, [operationSignal]: signal };
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

  return { overview, ranking, quotes, history, fundamentals, search, prefetch, testProvider: providerAdapters.testProvider, providerStates: () => providerStates(getConfig()), clearCache, cancel };
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
