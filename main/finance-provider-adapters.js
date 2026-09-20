'use strict';

const COINGECKO_ORIGIN = 'https://api.coingecko.com';
const BINANCE_ORIGIN = 'https://api.binance.com';
const ALPHA_VANTAGE_ORIGIN = 'https://www.alphavantage.co';
const ALPACA_DATA_ORIGIN = 'https://data.alpaca.markets';
const TWELVE_DATA_ORIGIN = 'https://api.twelvedata.com';
const SEC_FILES_ORIGIN = 'https://www.sec.gov';
const SEC_DATA_ORIGIN = 'https://data.sec.gov';
const EASTMONEY_ORIGIN = 'https://push2.eastmoney.com';
const EASTMONEY_DELAY_ORIGIN = 'https://push2delay.eastmoney.com';
const TENCENT_ORIGIN = 'https://qt.gtimg.cn';
const EASTMONEY_HISTORY_ORIGIN = 'https://push2his.eastmoney.com';
const SINA_ORIGIN = 'https://hq.sinajs.cn';
const MAX_IDS_PER_REQUEST = 100;
const MAX_SEARCH_RESULTS = 20;
const MAX_HISTORY_POINTS = 180;
const MAX_RANKING_PAGE = 200;
const PUBLIC_CN_MAX_SYMBOLS = 100;
const EASTMONEY_MAX_ROWS = 6_000;
const QUANTDASH_MAX_DIRECT_SYMBOLS = 5;
const QUANTDASH_MAX_DIRECT_REQUESTS = 4;
const TWELVE_DATA_MAX_QUOTE_SYMBOLS = 8;
const ALPHA_VANTAGE_MOVERS_TTL_MS = 12 * 60 * 60_000;
const SEC_FUNDAMENTALS_TTL_MS = 6 * 60 * 60_000;

function createFinanceProviderAdapters({
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
}) {
  const quantdashUniverseRows = [];
  const publicCnUniverseRows = new Map();

  function clearState() {
    quantdashUniverseRows.length = 0;
    publicCnUniverseRows.clear();
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

  function requireSecEdgarConfig(config) {
    if (config.secEdgar?.enabled !== true) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    if (!config.secEdgar.contact) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    return config.secEdgar;
  }

  function secEdgarHeaders(config) {
    const settings = requireSecEdgarConfig(config);
    return { Accept: 'application/json', 'User-Agent': `Dynamic-Panel/1.1 ${settings.contact}` };
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
    return requestJson(`https://api.quantdash.net${pathname}${query ? `?${query}` : ''}`, { headers: quantdashHeaders(config), signal });
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
    quantdashUniverseRows.length = 0;
    quantdashUniverseRows.push(...response.value);
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
      for (const row of response.value) rowsByCode.set(boundedText(row.symbol, 24).toUpperCase(), { row, response });
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

  async function eastmoneyRequest(pathname, options = {}) {
    try {
      return await requestJson(`https://push2.eastmoney.com${pathname}`, options);
    } catch (error) {
      if (financeError(error) === 'cancelled') throw error;
      return requestJson(`https://push2delay.eastmoney.com${pathname}`, options);
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
    return { rows, stale: response.stale, warning: response.error || '', coverage: 'eastmoney_cn_stock_ranked_page', remotePagination: { page: resolvedPage, pageSize: safePageSize, totalRows, totalPages, hasMore: resolvedPage < totalPages }, retrievedAt: storedAt };
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
    const query = new URLSearchParams({ vs_currency: 'usd', order: 'market_cap_desc', per_page: '100', page: '1', sparkline: 'true', price_change_percentage: '1h,24h,7d', locale: 'zh' });
    const response = await cached(`coingecko:markets:${query}`, 45_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/coins/markets?${query}`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    const rows = (Array.isArray(response.value) ? response.value : []).map((row) => normalizeCoinGeckoMarket(row, retrievedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
    return { rows, stale: response.stale, warning: response.error || '', coverage: 'coingecko_top_100_market_cap', retrievedAt };
  }

  async function alpacaAssets(assets, signal = null, force = false) {
    const config = getConfig();
    if (config.alpaca?.enabled !== true || !config.alpaca.keyId || !config.alpaca.secretKey || !assets.length) return [];
    const feed = config.alpaca.feed === 'sip' ? 'sip' : 'iex';
    const symbols = assets.map((asset) => asset.symbol);
    const response = await cached(
      `alpaca:quotes:${feed}:${symbols.slice().sort().join(',')}`,
      20_000,
      (requestSignal) => requestJson(`${ALPACA_DATA_ORIGIN}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=${feed}`, { headers: alpacaHeaders(config), signal: requestSignal }),
      signal,
      force
    );
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
    return limitedAssets.map((asset) => normalizeTwelveDataQuote(rowsBySymbol.get(asset.symbol), retrievedAt, asset)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
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
    const response = await cached(
      `coingecko:quotes:${ids.slice().sort().join(',')}`,
      20_000,
      (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/coins/markets?${query}`, { headers: coinGeckoHeaders(config), signal: requestSignal }),
      signal,
      force
    );
    const retrievedAt = new Date(response.storedAt).toISOString();
    return (Array.isArray(response.value) ? response.value : [])
      .map((row) => normalizeCoinGeckoMarket(row, retrievedAt))
      .filter(Boolean)
      .map((row) => ({ ...row, stale: response.stale === true }));
  }

  async function binanceMarkets({ signal = null, force = false } = {}) {
    const config = getConfig();
    if (config.binance?.enabled === false) throw Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    const response = await cached('binance:markets:24h', 45_000, (requestSignal) => requestJson(`${BINANCE_ORIGIN}/api/v3/ticker/24hr?type=MINI`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal }), signal, force);
    const retrievedAt = new Date(response.storedAt).toISOString();
    const rows = (Array.isArray(response.value) ? response.value : []).filter((row) => String(row?.symbol || '').toUpperCase().endsWith('USDT')).map((row) => normalizeBinanceMarket(row, retrievedAt)).filter(Boolean).map((row) => ({ ...row, stale: response.stale === true }));
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

  async function history(assetId, days, signal = null, force = false) {
    const config = getConfig();
    if (assetId.startsWith('crypto:binance:')) {
      const providerAssetId = assetId.slice('crypto:binance:'.length).toUpperCase();
      if (config.binance?.enabled === false) return { ok: false, assetId, days, error: 'provider_disabled' };
      const interval = days === 1 ? '1h' : '1d';
      const limit = Math.max(2, Math.min(MAX_HISTORY_POINTS, days === 1 ? 24 : days));
      try {
        const response = await cached(`binance:history:${providerAssetId}:${days}`, 45_000, (requestSignal) => requestJson(`${BINANCE_ORIGIN}/api/v3/klines?symbol=${encodeURIComponent(providerAssetId)}&interval=${interval}&limit=${limit}`, { headers: { Accept: 'application/json', 'User-Agent': 'Dynamic-Panel/1.1' }, signal: requestSignal }), signal, force);
        const result = normalizeBinanceHistory(response.value, assetId, new Date(response.storedAt).toISOString(), days);
        if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
      } catch (error) { return { ok: false, assetId, days, error: financeError(error) }; }
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
        const response = await cached(`eastmoney:history:${publicCode}:${days}`, 45_000, (requestSignal) => {
          const query = new URLSearchParams({ secid: publicCnSecId(publicCode), klt: '101', fqt: '0', beg: beginDate, end: '20500101', lmt: String(count), fields1: 'f1,f2,f3,f4', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' });
          return requestJson(`${EASTMONEY_HISTORY_ORIGIN}/api/qt/stock/kline/get?${query}`, { headers: publicCnHeaders('cn-eastmoney'), signal: requestSignal }).then(parseEastmoneyKlines);
        }, signal, force);
        const result = normalizePublicCnHistory(response.value, assetId, new Date(response.storedAt).toISOString(), days);
        if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
      } catch (error) { return { ok: false, assetId, days, error: financeError(error) }; }
    }
    if (publicCode) {
      if (config.cnStock?.enabled !== true) return { ok: false, assetId, days, error: 'provider_disabled' };
      if (!config.cnStock.apiKey) return { ok: false, assetId, days, error: 'not_configured' };
      const count = Math.max(2, Math.min(MAX_HISTORY_POINTS, days === 1 ? 7 : days + 10));
      try {
        const response = await cached(`quantdash:history:${publicCode}:${days}`, 45_000, (requestSignal) => quantdashCall(config, '/v1/klines', { symbol: publicCode, period: '1d', count, adjust: 'none' }, requestSignal).then(quantdashKlineData), signal, force);
        const result = normalizeQuantdashHistory({ data: response.value }, assetId, new Date(response.storedAt).toISOString(), days);
        if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
      } catch (error) { return { ok: false, assetId, days, error: financeError(error) }; }
    }
    const usSymbol = usSymbolFromAssetId(assetId);
    if (usSymbol) {
      if (config.twelveData?.enabled !== true) return { ok: false, assetId, days, error: 'history_not_supported' };
      if (!config.twelveData.apiKey) return { ok: false, assetId, days, error: 'not_configured' };
      const outputsize = Math.max(2, Math.min(MAX_HISTORY_POINTS, days === 1 ? 2 : days + 10));
      try {
        const query = new URLSearchParams({ symbol: usSymbol, interval: days === 1 ? '1h' : '1day', outputsize: String(days === 1 ? 24 : outputsize), order: 'DESC' });
        const response = await cached(`twelve-data:history:${usSymbol}:${days}`, 6 * 60 * 60_000, async (requestSignal) => {
          const value = await requestJson(`${TWELVE_DATA_ORIGIN}/time_series?${query}`, { headers: twelveDataHeaders(config), signal: requestSignal });
          const error = twelveDataError(value);
          if (error) throw error;
          return value;
        }, signal, force);
        const result = normalizeTwelveDataHistory(response.value, assetId, new Date(response.storedAt).toISOString(), days);
        if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
        return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
      } catch (error) { return { ok: false, assetId, days, error: financeError(error) }; }
    }
    if (!assetId.startsWith('crypto:coingecko:')) return { ok: false, assetId, days, error: 'history_not_supported' };
    const providerAssetId = assetId.slice('crypto:coingecko:'.length);
    if (config.coingecko?.enabled === false) return { ok: false, assetId, days, error: 'provider_disabled' };
    try {
      const response = await cached(`coingecko:history:${providerAssetId}:${days}`, 45_000, (requestSignal) => requestJson(`${COINGECKO_ORIGIN}/api/v3/coins/${encodeURIComponent(providerAssetId)}/market_chart?vs_currency=usd&days=${days}`, { headers: coinGeckoHeaders(config), signal: requestSignal }), signal, force);
      const result = normalizeCoinGeckoHistory(response.value, providerAssetId, new Date(response.storedAt).toISOString());
      if (!result) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
      return { ok: true, assetId, days, ...result, stale: response.stale === true, warning: response.error || '' };
    } catch (error) { return { ok: false, assetId, days, error: financeError(error) }; }
  }

  async function fundamentals(assetId, signal = null, force = false) {
    const symbol = usSymbolFromAssetId(assetId);
    if (!symbol) return { ok: false, assetId, error: 'fundamentals_not_supported' };
    const config = getConfig();
    try {
      requireSecEdgarConfig(config);
      const tickerResponse = await cached('sec-edgar:company-tickers', 24 * 60 * 60_000, (requestSignal) => requestJson(`${SEC_FILES_ORIGIN}/files/company_tickers.json`, { headers: secEdgarHeaders(config), signal: requestSignal }), signal);
      const tickerRows = tickerResponse.value && typeof tickerResponse.value === 'object' && !Array.isArray(tickerResponse.value) ? Object.values(tickerResponse.value).slice(0, 20_000) : [];
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
        const response = await cached(`sec-edgar:concept:${cik}:${descriptor.concept}`, SEC_FUNDAMENTALS_TTL_MS, (requestSignal) => requestJson(`${SEC_DATA_ORIGIN}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${encodeURIComponent(descriptor.concept)}.json`, { headers: secEdgarHeaders(config), signal: requestSignal }), signal, force);
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
      const ordered = ['assets', 'liabilities', 'equity', 'revenue', 'netIncome'].map((key) => metricsByKey.get(key)).filter(Boolean);
      const retrievedTimes = [tickerResponse.storedAt, ...ordered.map((item) => item.response.storedAt)].filter(Number.isFinite);
      const warnings = [...new Set(rejected.filter((item) => !isMissingConcept(item)).map((item) => financeError(item.reason)))];
      return { ok: true, assetId, provider: 'sec-edgar', feed: 'sec-edgar-xbrl-companyconcept', symbol, cik, entityName: boundedText(ordered[0]?.response?.value?.entityName || company?.title, 160) || symbol, metrics: ordered.map((item) => item.metric), stale: tickerResponse.stale === true || ordered.some((item) => item.response.stale === true), warning: warnings.join(','), retrievedAt: new Date(Math.max(...retrievedTimes)).toISOString() };
    } catch (error) { return { ok: false, assetId, provider: 'sec-edgar', error: financeError(error) }; }
  }

  async function alphaVantageMovers({ signal = null, force = false } = {}) {
    const config = getConfig();
    if (config.alphaVantage?.enabled !== true || !config.alphaVantage.apiKey) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
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
        return { ok: true, capabilities: { realtime: 'available', daily: historyCapability, exactCodeSearch: 'available', history: historyCapability, metadata: 'available', fullMarket, marketCap: 'unsupported' } };
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
        return { ok: true, capabilities: { realtime, daily: historyCapability, exactCodeSearch: realtime, history: historyCapability, metadata, fullMarket, marketCap: 'unsupported' } };
      }
      return { ok: false, error: 'provider_not_available' };
    } catch (error) {
      return { ok: false, error: financeError(error) };
    }
  }

  return {
    clearState,
    coinGeckoHeaders,
    alphaVantageKey,
    alphaVantageError,
    alpacaHeaders,
    requireTwelveDataConfig,
    twelveDataHeaders,
    twelveDataRows,
    requireQuantdashConfig,
    quantdashCall,
    quantdashQuoteRows,
    quantdashAssetByCode,
    quantdashMarkets,
    quantdashQuotes,
    publicCnConfig,
    publicCnHeaders,
    requirePublicCnConfig,
    publicCnFetchRows,
    publicCnQuotes,
    cnQuoteFallback,
    eastmoneyMarkets,
    cnMarkets,
    coinGeckoMarkets,
    coinGeckoQuotes,
    binanceMarkets,
    binanceQuotes,
    alphaVantageMovers,
    testProvider,
    history,
    fundamentals,
    usQuoteFallback,
    quantdashUniverseRows: () => [...quantdashUniverseRows],
    publicCnUniverseRows: (providerId) => [...(publicCnUniverseRows.get(providerId) || [])],
    publicCnSecId,
    eastmoneyHistoryOrigin: EASTMONEY_HISTORY_ORIGIN,
  };
}

module.exports = { createFinanceProviderAdapters };
