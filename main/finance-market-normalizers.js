'use strict';

const { boundedText } = require('./finance-domain');

const MAX_HISTORY_POINTS = 180;

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

module.exports = {
  finiteNumber,
  sampleSeries,
  freshnessFor,
  sampleHistory,
  normalizeCoinGeckoHistory,
  normalizeCoinGeckoGlobalHistory,
  normalizeCoinGeckoMarket,
  normalizeBinanceMarket,
  parsePercentage,
  normalizeAlphaVantageMover,
  normalizeBinanceHistory,
  normalizeAlpacaSnapshot,
};
