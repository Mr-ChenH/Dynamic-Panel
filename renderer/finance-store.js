(function exposeFinanceStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchFinanceStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFinanceStoreDomain() {
  const WATCHLIST_KEY = 'notch-finance-watchlists-v1';
  const PREFERENCES_KEY = 'notch-finance-view-preferences-v1';
  const DEFAULT_PREFERENCES = Object.freeze({
    defaultView: 'overview',
    defaultMarket: 'all',
    defaultSource: 'coingecko',
    defaultRanking: 'gainers',
    refreshSeconds: 60,
  });

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch (error) { return fallback; }
  }

  function normalizeAssetIdentity(value) {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || '').trim().slice(0, 240);
    const name = String(value.name || '').trim().slice(0, 120);
    const symbol = String(value.symbol || '').trim().toUpperCase().slice(0, 32);
    if (!id || !name || !symbol) return null;
    const parts = id.split(':');
    let market = String(value.market || value.type || '').trim();
    let provider = String(value.provider || '').trim();
    if (id.startsWith('crypto:coingecko:')) { market = 'crypto'; provider = 'coingecko'; }
    else if (id.startsWith('crypto:binance:')) { market = 'crypto'; provider = 'binance'; }
    else if (id.startsWith('us:')) { market = 'us'; provider = provider || 'alpaca'; }
    else if (id.startsWith('cn:') || id.startsWith('a:')) { market = 'cn'; provider = provider || 'cn-stock'; }
    if (!['crypto', 'us', 'cn'].includes(market)) return null;
    return {
      id,
      provider: provider.slice(0, 40),
      providerAssetId: String(value.providerAssetId || parts[parts.length - 1] || '').trim().slice(0, 160),
      market,
      type: market === 'crypto' ? 'crypto' : 'stock',
      symbol,
      name,
      exchange: String(value.exchange || '').trim().slice(0, 40),
      currency: String(value.currency || (market === 'cn' ? 'CNY' : 'USD')).trim().toUpperCase().slice(0, 8),
      addedAt: String(value.addedAt || '').trim().slice(0, 48),
    };
  }

  function createController({
    storage = globalThis.localStorage,
    dispatch = (event) => globalThis.window?.dispatchEvent?.(event),
    rankingSourceFor = (_market, source) => source,
  } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('storage is required');
    }

    function notifyMutation() {
      try { dispatch(new globalThis.CustomEvent('notch-workspace-mutated')); } catch (error) {}
    }

    function loadWatchlists() {
      const raw = safeParse(storage.getItem(WATCHLIST_KEY), {});
      const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const sourceAssets = parsed.assets && typeof parsed.assets === 'object' && !Array.isArray(parsed.assets) ? parsed.assets : {};
      const assets = {};
      for (const [assetId, value] of Object.entries(sourceAssets)) {
        const hadFixtureQuote = Object.hasOwn(value || {}, 'base') || Object.hasOwn(value || {}, 'change') || Object.hasOwn(value || {}, 'price');
        if (hadFixtureQuote && !String(value?.addedAt || '').trim()) continue;
        const asset = normalizeAssetIdentity({ ...value, id: value?.id || assetId });
        if (asset) assets[asset.id] = asset;
      }
      const lists = [];
      for (const list of Array.isArray(parsed.lists) ? parsed.lists : []) {
        const id = String(list?.id || '').trim().slice(0, 80);
        const name = String(list?.name || '').trim().slice(0, 40);
        if (!id || !name || lists.some((item) => item.id === id)) continue;
        const assetIds = [...new Set((Array.isArray(list.assetIds) ? list.assetIds : []).map(String).filter((assetId) => assets[assetId]))];
        lists.push({ id, name, assetIds });
      }
      let all = lists.find((list) => list.id === 'all');
      if (!all) {
        all = { id: 'all', name: '全部观察', assetIds: Object.keys(assets) };
        lists.unshift(all);
      } else {
        all.name = '全部观察';
        all.assetIds = [...new Set([...all.assetIds, ...Object.keys(assets)])];
      }
      const normalized = { schemaVersion: 1, lists: [all, ...lists.filter((list) => list.id !== 'all')], assets };
      storage.setItem(WATCHLIST_KEY, JSON.stringify(normalized));
      return normalized;
    }

    function loadPreferences() {
      const raw = safeParse(storage.getItem(PREFERENCES_KEY), {});
      const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const marketAliases = { 'A 股': 'cn', '美股': 'us', '加密': 'crypto' };
      const rankingAliases = { change: 'gainers', 'change-asc': 'losers', price: 'market_cap' };
      const defaultView = ['overview', 'ranking', 'watchlist'].includes(parsed.defaultView) ? parsed.defaultView : DEFAULT_PREFERENCES.defaultView;
      const requestedMarket = marketAliases[parsed.defaultMarket] || parsed.defaultMarket;
      const requestedRanking = rankingAliases[parsed.defaultRanking] || parsed.defaultRanking;
      const requestedSource = parsed.defaultSource === 'binance' || parsed.defaultSource === 'coingecko'
        ? parsed.defaultSource
        : requestedMarket === 'binance' ? 'binance' : DEFAULT_PREFERENCES.defaultSource;
      const defaultMarket = requestedMarket === 'binance' ? 'crypto' : ['all', 'crypto', 'us', 'cn'].includes(requestedMarket) ? requestedMarket : DEFAULT_PREFERENCES.defaultMarket;
      const defaultRanking = ['gainers', 'losers', 'market_cap', 'volume'].includes(requestedRanking) ? requestedRanking : DEFAULT_PREFERENCES.defaultRanking;
      const normalized = {
        defaultView,
        defaultMarket,
        defaultSource: rankingSourceFor(defaultMarket, requestedSource, defaultRanking),
        defaultRanking,
        refreshSeconds: [0, 30, 60, 120, 300].includes(Number(parsed.refreshSeconds)) ? Number(parsed.refreshSeconds) : DEFAULT_PREFERENCES.refreshSeconds,
      };
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) storage.setItem(PREFERENCES_KEY, JSON.stringify(normalized));
      return normalized;
    }

    function saveWatchlists(value) {
      storage.setItem(WATCHLIST_KEY, JSON.stringify(value));
      notifyMutation();
    }

    function savePreferences(value) {
      storage.setItem(PREFERENCES_KEY, JSON.stringify(value));
      notifyMutation();
    }

    function readPreferences() {
      return safeParse(storage.getItem(PREFERENCES_KEY), {});
    }

    return Object.freeze({
      loadWatchlists,
      loadPreferences,
      saveWatchlists,
      savePreferences,
      readPreferences,
      normalizeAssetIdentity,
    });
  }

  return { createController, normalizeAssetIdentity };
});
