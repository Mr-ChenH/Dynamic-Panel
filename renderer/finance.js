(() => {
  const getApi = () => window.notchAPI || {};
  const api = new Proxy({}, {
    get(_target, property) {
      const currentApi = getApi();
      const value = currentApi[property];
      return typeof value === 'function' ? value.bind(currentApi) : value;
    },
  });
  const panel = document.getElementById('tab-finance');
  if (!panel) return;

  const financeRequests = window.NotchFinanceRequests.createController({ getApi });
  const isCancelledFinanceResult = financeRequests.isCancelledResult;

  const elements = {
    providerSummary: document.getElementById('finance-provider-summary'),
    updated: document.getElementById('finance-updated'),
    refresh: document.getElementById('finance-refresh'),
    marketStatus: document.getElementById('finance-market-status'),
    overviewStatus: document.getElementById('finance-overview-status'),
    overviewMarketSummaries: document.getElementById('finance-overview-market-summaries'),
    overviewChartTitle: document.getElementById('finance-overview-chart-title'),
    overviewChartValue: document.getElementById('finance-overview-chart-value'),
    overviewChartChange: document.getElementById('finance-overview-chart-change'),
    overviewChart: document.getElementById('finance-overview-chart'),
    overviewChartRange: document.getElementById('finance-overview-chart-range'),
    overviewChartSource: document.getElementById('finance-overview-chart-source'),
    overviewBenchmarks: document.getElementById('finance-overview-benchmarks'),
    overviewCn: document.getElementById('finance-overview-cn'),
    overviewUs: document.getElementById('finance-overview-us'),
    overviewCrypto: document.getElementById('finance-overview-crypto'),
    aiAnalyze: document.getElementById('finance-ai-analyze'),
    aiResult: document.getElementById('finance-ai-result'),
    aiStatus: document.getElementById('finance-ai-status'),
    aiScope: document.getElementById('finance-ai-scope'),
    rankingState: document.getElementById('finance-ranking-state'),
    rankingTitle: document.getElementById('finance-ranking-title'),
    rankingSubtitle: document.getElementById('finance-ranking-subtitle'),
    rankingTotal: document.getElementById('finance-ranking-total'),
    rankingPositive: document.getElementById('finance-ranking-positive'),
    rankingNegative: document.getElementById('finance-ranking-negative'),
    rankingFlat: document.getElementById('finance-ranking-flat'),
    rankingSpotlight: document.getElementById('finance-ranking-spotlight'),
    rankingList: document.getElementById('finance-ranking-list'),
    rankingPagination: document.getElementById('finance-ranking-pagination'),
    rankingPrevious: document.getElementById('finance-ranking-previous'),
    rankingNext: document.getElementById('finance-ranking-next'),
    rankingPageLabel: document.getElementById('finance-ranking-page-label'),
    rankingSort: document.getElementById('finance-ranking-sort'),
    rankingSource: document.getElementById('finance-ranking-source'),
    rankingSourceLabel: document.getElementById('finance-ranking-source-label'),
    listSelect: document.getElementById('finance-list-select'),
    resultCount: document.getElementById('finance-result-count'),
    sort: document.getElementById('finance-sort'),
    quotes: document.getElementById('finance-quotes'),
    detail: document.getElementById('finance-detail'),
    settingsSources: document.getElementById('finance-settings-sources'),
    settingsEnabledCount: document.getElementById('finance-settings-enabled-count'),
    settingsCredentialCount: document.getElementById('finance-settings-credential-count'),
    settingsVerifiedCount: document.getElementById('finance-settings-verified-count'),
    settingsTargetList: document.getElementById('finance-settings-target-list'),
    settingsSearch: document.getElementById('finance-settings-asset-search'),
    settingsSearchResults: document.getElementById('finance-settings-asset-results'),
    settingsAdd: document.getElementById('finance-settings-add'),
    settingsWatchlistList: document.getElementById('finance-settings-watchlists'),
    settingsCreateGroup: document.getElementById('finance-settings-create-group'),
    defaultView: document.getElementById('finance-settings-default-view'),
    defaultMarket: document.getElementById('finance-settings-default-market'),
    defaultSource: document.getElementById('finance-settings-default-source'),
    defaultRanking: document.getElementById('finance-settings-default-ranking'),
    refreshInterval: document.getElementById('finance-settings-refresh-seconds'),
    coinGeckoEnabled: document.getElementById('finance-coingecko-enabled'),
    coinGeckoKey: document.getElementById('finance-coingecko-key'),
    binanceEnabled: document.getElementById('finance-binance-enabled'),
    alphaVantageEnabled: document.getElementById('finance-alpha-vantage-enabled'),
    alphaVantageKey: document.getElementById('finance-alpha-vantage-key'),
    alpacaEnabled: document.getElementById('finance-alpaca-enabled'),
    alpacaKeyId: document.getElementById('finance-alpaca-key-id'),
    alpacaSecret: document.getElementById('finance-alpaca-secret'),
    alpacaFeed: document.getElementById('finance-alpaca-feed'),
    twelveDataEnabled: document.getElementById('finance-twelve-data-enabled'),
    twelveDataKey: document.getElementById('finance-twelve-data-key'),
    secEdgarEnabled: document.getElementById('finance-sec-edgar-enabled'),
    secEdgarContact: document.getElementById('finance-sec-edgar-contact'),
    quantDashEnabled: document.getElementById('finance-quantdash-enabled'),
    quantDashKey: document.getElementById('finance-quantdash-key'),
    tencentEnabled: document.getElementById('finance-tencent-enabled'),
    eastmoneyEnabled: document.getElementById('finance-eastmoney-enabled'),
    sinaEnabled: document.getElementById('finance-sina-enabled'),
  };

  const MAX_RANKING_PAGE_CACHE = 8;
  const RANKING_PAGE_SIZE = 50;
  const OVERVIEW_MARKETS = Object.freeze([
    { market: 'cn', label: 'A 股', providerIds: ['cn-stock', 'cn-eastmoney', 'cn-tencent', 'cn-sina'], session: '交易时段' },
    { market: 'us', label: '美股', providerIds: ['alpaca', 'twelve-data', 'alpha-vantage'], session: '交易时段' },
    { market: 'crypto', label: '加密货币', providerIds: ['coingecko', 'binance'], session: '24/7' },
  ]);

  const financeStore = window.NotchFinanceStore.createController({
    rankingSourceFor: (market, source, sort) => rankingSourceFor(market, source, sort),
  });

  const state = {
    watchlists: financeStore.loadWatchlists(),
    preferences: financeStore.loadPreferences(),
    currentListId: 'all',
    currentView: 'overview',
    rankingMarket: 'all',
    rankingSource: 'coingecko',
    rankingSort: 'gainers',
    rankingPage: 1,
    selectedAssetId: '',
    detailAsset: null,
    detailQuote: null,
    quotes: new Map(),
    unavailableQuotes: new Map(),
    overview: null,
    overviewLeaders: null,
    overviewLosers: null,
    overviewVolume: null,
    overviewChartAssetId: '',
    historyByAsset: new Map(),
    fundamentalsByAsset: new Map(),
    chartSeries: new Map(),
    historyPending: new Set(),
    fundamentalsPending: new Set(),
    ranking: null,
    rankingByQuery: new Map(),
    providerSettings: null,
    searchResults: [],
    searchNotice: '',
    aiRequestId: '',
    aiSequence: 0,
    aiInterpretation: null,
    aiResultRevision: '',
    searchSequence: 0,
    searchRequestId: '',
    refreshActivitySignature: '',
    refreshPending: false,
    refreshSequence: 0,
    expanded: false,
    financeActive: false,
    financeStartupReady: false,
    startupPrefetchRequested: false,
  };
  Object.defineProperty(state, 'financeLoadGeneration', {
    get: () => financeRequests.generation(),
  });

  const financeSettingsView = window.NotchFinanceSettings.createController({
    getState: () => state,
    getElements: () => elements,
    escapeHtml: (value) => escapeHtml(value),
    marketLabel: (market) => marketLabel(market),
  });
  const financeOverviewView = window.NotchFinanceOverview.createController({
    getState: () => state,
    getElements: () => elements,
    overviewMarkets: (result) => overviewMarkets(result),
    emptyState: (title, detail) => emptyState(title, detail),
    escapeHtml: (value) => escapeHtml(value),
    providerStateLabel: (provider) => providerStateLabel(provider),
    errorLabel: (error) => errorLabel(error),
    formatCompact: (value) => formatCompact(value),
    formatQuotePrice: (quote) => formatQuotePrice(quote),
    formatPercent: (value) => formatPercent(value),
    changeClass: (value) => changeClass(value),
    marketLabel: (market) => marketLabel(market),
  });
  const financeWatchlistView = window.NotchFinanceWatchlist.createController({
    getState: () => state,
    getElements: () => elements,
    currentList: () => currentList(),
    escapeHtml: (value) => escapeHtml(value),
    marketLabel: (market) => marketLabel(market),
    errorLabel: (error) => errorLabel(error),
    formatTime: (value) => formatTime(value),
    formatQuotePrice: (quote) => formatQuotePrice(quote),
    formatPercent: (value) => formatPercent(value),
    changeClass: (value) => changeClass(value),
    renderChartCanvas: (assetId, values, className, label) => renderChartCanvas(assetId, values, className, label),
    emptyState: (title, detail) => emptyState(title, detail),
    renderDetail: () => renderDetail(),
    drawAllCharts: () => drawAllCharts(),
  });
  const financeRankingView = window.NotchFinanceRanking.createController({
    getState: () => state,
    getElements: () => elements,
    rankingPageSize: RANKING_PAGE_SIZE,
    renderProviderSummary: (providers) => renderProviderSummary(providers),
    emptyState: (title, detail) => emptyState(title, detail),
    marketLabel: (market) => marketLabel(market),
    sourceLabel: (source) => sourceLabel(source),
    errorLabel: (error) => errorLabel(error),
    formatTime: (value) => formatTime(value),
    formatQuotePrice: (quote) => formatQuotePrice(quote),
    formatCompact: (value) => formatCompact(value),
    formatPercent: (value) => formatPercent(value),
    changeClass: (value) => changeClass(value),
    escapeHtml: (value) => escapeHtml(value),
    renderChartCanvas: (assetId, values, className, label) => renderChartCanvas(assetId, values, className, label),
    drawAllCharts: () => drawAllCharts(),
  });
  const financeAiView = window.NotchFinanceAI.createController({
    getState: () => state,
    getElements: () => elements,
    overviewQuotes: () => financeOverviewView.quotes(),
    overviewMarkets: (result) => overviewMarkets(result),
    providerStateLabel: (provider) => providerStateLabel(provider),
    formatCompact: (value) => formatCompact(value),
    formatQuotePrice: (quote) => formatQuotePrice(quote),
    formatPercent: (value) => formatPercent(value),
    formatTime: (value) => formatTime(value),
    renderMarkdown: (container, text) => {
      if (window.NotchMarkdown?.render) window.NotchMarkdown.render(container, text);
      else container.textContent = text;
    },
  });

  const financeViewDomain = window.NotchFinanceViewDomain;
  const escapeHtml = financeViewDomain.escapeHtml;

  function normalizeAssetIdentity(value) {
    return financeStore.normalizeAssetIdentity(value);
  }

  function loadPreferences() {
    return financeStore.loadPreferences();
  }

  function saveWatchlists() {
    financeStore.saveWatchlists(state.watchlists);
  }

  function savePreferences() {
    financeStore.savePreferences(state.preferences);
  }

  function currentList() {
    return state.watchlists.lists.find((list) => list.id === state.currentListId) || state.watchlists.lists[0];
  }

  function marketLabel(market) {
    return ({ all: '全部可用', crypto: '加密货币', binance: '加密货币', us: '美股', cn: 'A 股' })[market] || '市场';
  }

  function sourceLabel(source) {
    return ({ coingecko: 'CoinGecko 聚合', binance: 'Binance USDT 现货' })[source] || '当前源';
  }

  function rankingCacheKey(market, source, sort, page = 1) {
    let base;
    if (market === 'crypto' && source === 'coingecko') base = `crypto:${sort}`;
    else if (market === 'binance' || (market === 'crypto' && source === 'binance')) base = `binance:${sort}`;
    else if (market === 'us' || market === 'cn') base = `${market}:${sort}`;
    else base = `${market}:${source || 'coingecko'}:${sort}`;
    return Number(page) > 1 ? `${base}:page:${Math.max(1, Math.floor(Number(page) || 1))}` : base;
  }

  function rankingSourceFor(market, source, sort) {
    return sort === 'market_cap' && source === 'binance' && ['all', 'crypto', 'binance'].includes(market) ? 'coingecko' : source;
  }

  function rememberRanking(cacheKey, result) {
    state.rankingByQuery.delete(cacheKey);
    state.rankingByQuery.set(cacheKey, result);
    while (state.rankingByQuery.size > MAX_RANKING_PAGE_CACHE) {
      state.rankingByQuery.delete(state.rankingByQuery.keys().next().value);
    }
  }

  const formatPrice = financeViewDomain.formatPrice;
  const formatQuotePrice = financeViewDomain.formatQuotePrice;
  const formatCompact = financeViewDomain.formatCompact;
  const formatPercent = financeViewDomain.formatPercent;
  const formatTime = financeViewDomain.formatTime;
  const changeClass = financeViewDomain.changeClass;
  const emptyState = financeViewDomain.emptyState;
  const providerStateLabel = financeViewDomain.providerStateLabel;

  function overviewMarkets(result) {
    const markets = Array.isArray(result?.markets) ? result.markets : [];
    const providers = Array.isArray(result?.providers) ? result.providers : state.providerSettings?.providers || [];
    return OVERVIEW_MARKETS.map((definition) => {
      const reported = markets.find((market) => market?.market === definition.market);
      if (reported) return { ...definition, ...reported };
      const candidates = definition.providerIds.map((id) => providers.find((provider) => provider?.id === id)).filter(Boolean);
      const provider = candidates.find((item) => item.state === 'ready')
        || candidates.find((item) => item.enabled)
        || candidates[0];
      return {
        market: definition.market,
        label: definition.label,
        state: provider?.state === 'ready' ? 'available_without_summary' : provider?.state || 'not_available',
        provider: provider?.label || '未配置数据源',
        feed: provider?.feed || '',
        session: definition.session,
      };
    });
  }

  function errorLabel(error) {
    const labels = {
      provider_not_configured: '未配置可用数据源', ranking_not_supported: '当前数据源不提供该榜单',
      provider_disabled: '数据源已停用', rate_limited: '数据源已限流', authentication_failed: '凭据验证失败',
      timeout: '数据源响应超时', network_error: '无法连接数据源', invalid_response: '数据源返回无法识别',
      response_too_large: '数据源响应超过限制', quote_unavailable: '暂时没有可用报价', not_configured: '凭据未配置',
      permission_denied: '当前凭据没有所需接口权限',
      asset_metadata_unavailable: 'A 股名称信息暂不可用；仍可输入 6 位代码添加',
      asset_search_symbol_only: '当前进程未加载可匹配的 A 股名称目录；请先打开 A 股榜单，或直接输入 6 位代码',
      market_cap_not_supported: 'QuantDash 实时快照没有全市场市值字段，A 股市值榜暂不提供',
      market_cap_permission_required: '当前 QuantDash 套餐没有 A 股全市场查询权限',
      provider_not_available: '该数据源尚不可用', history_not_supported: '该市场暂不提供历史曲线', fundamentals_not_supported: '该资产不提供 SEC 基本面', fundamentals_unavailable: 'SEC 暂无可显示的申报指标', invalid_contact: '请输入有效的 SEC 联系邮箱', save_failed: '配置保存失败', secure_storage_unavailable: '系统安全存储不可用',
    };
    return labels[error] || '暂时无法获取数据';
  }

  const renderChartCanvas = financeViewDomain.renderChartCanvas;
  const chartColor = financeViewDomain.chartColor;
  const seriesChange = financeViewDomain.seriesChange;

  function drawChart(canvas, values, options = {}) {
    if (!canvas) return;
    const numbers = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.getBoundingClientRect().width || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.getBoundingClientRect().height || 1));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context || numbers.length < 2) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const padding = options.compact ? 3 : 8;
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const spread = max - min || Math.max(Math.abs(max) * 0.01, 1);
    const xStep = (width - padding * 2) / (numbers.length - 1);
    const y = (value) => height - padding - ((value - min) / spread) * Math.max(1, height - padding * 2);
    context.strokeStyle = 'rgba(255,255,255,.08)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding, Math.round(height * .5) + .5);
    context.lineTo(width - padding, Math.round(height * .5) + .5);
    context.stroke();
    context.strokeStyle = options.color || chartColor(numbers);
    context.lineWidth = options.compact ? 1.5 : 2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    numbers.forEach((value, index) => {
      const x = padding + xStep * index;
      const pointY = y(value);
      if (index === 0) context.moveTo(x, pointY); else context.lineTo(x, pointY);
    });
    context.stroke();
    if (!options.compact) {
      const lastX = padding + xStep * (numbers.length - 1);
      context.fillStyle = context.strokeStyle;
      context.beginPath(); context.arc(lastX, y(numbers[numbers.length - 1]), 3, 0, Math.PI * 2); context.fill();
    }
  }

  function drawAllCharts() {
    document.querySelectorAll('[data-finance-chart-asset]').forEach((canvas) => {
      const values = state.historyByAsset.get(canvas.dataset.financeChartAsset)?.series?.map((point) => point.value)
        || state.quotes.get(canvas.dataset.financeChartAsset)?.sparkline
        || state.chartSeries.get(canvas.dataset.financeChartAsset) || [];
      drawChart(canvas, values, { compact: canvas.classList.contains('finance-sparkline') });
    });
  }

  function renderProviderSummary(providers) {
    const rows = Array.isArray(providers) ? providers : state.providerSettings?.providers || [];
    const ready = rows.filter((provider) => provider.state === 'ready' || provider.state === 'available' || provider.state === 'available_without_summary').length;
    elements.providerSummary.textContent = ready ? `${ready} 个数据源可用` : '没有可用数据源';
  }

  function renderOverview() {
    const result = state.overview;
    if (!result) {
      elements.marketStatus.innerHTML = emptyState('正在读取市场状态');
      elements.overviewMarketSummaries.innerHTML = emptyState('正在获取三市场快照');
      elements.overviewCn.innerHTML = emptyState('正在获取 A 股榜单');
      elements.overviewUs.innerHTML = emptyState('正在获取美股榜单');
      elements.overviewCrypto.innerHTML = emptyState('正在获取加密货币榜单');
      elements.overviewChartTitle.textContent = '等待曲线';
      elements.overviewChartSource.textContent = '等待数据';
      elements.overviewChartValue.textContent = '--';
      elements.overviewChartChange.textContent = '--';
      elements.overviewChart.dataset.financeChartAsset = '';
      return;
    }
    renderProviderSummary(result.providers);
    elements.updated.textContent = result.retrievedAt ? `取回 ${formatTime(result.retrievedAt)}` : '尚未更新';
    const overviewRows = financeOverviewView.quotes();
    const marketCoverage = overviewRows.reduce((counts, quote) => {
      const market = quote.asset.market;
      counts.set(market, (counts.get(market) || 0) + 1);
      return counts;
    }, new Map());
    elements.marketStatus.innerHTML = overviewMarkets(result).map((market) => {
      const hasValue = Number.isFinite(Number(market.value));
      const coverage = marketCoverage.get(market.market) || 0;
      const details = market.state === 'error' ? errorLabel(market.error) : hasValue ? '市场总值' : coverage ? `榜单已加载 ${coverage} 个` : providerStateLabel(market);
      const context = [market.feed, market.session, coverage ? `榜单 ${coverage} 个` : ''].filter(Boolean).join(' · ');
      return `<article class="finance-market-status-card" data-state="${escapeHtml(market.state)}"><header><strong>${escapeHtml(market.label)}</strong><span>${escapeHtml(providerStateLabel(market))}</span></header><div class="finance-market-value">${hasValue ? `<strong>${escapeHtml(formatCompact(market.value))}</strong><em class="${changeClass(market.changePercent)}">${escapeHtml(formatPercent(market.changePercent))}</em>` : `<strong>${escapeHtml(details)}</strong>`}</div><footer><span>${escapeHtml(market.provider || '')}</span><span>${escapeHtml(context)}</span></footer></article>`;
    }).join('') || emptyState('没有市场状态');
    const loadedMarkets = new Set(overviewRows.map((quote) => quote.asset.market));
    elements.overviewStatus.textContent = loadedMarkets.size ? `${loadedMarkets.size} 个市场有榜单${result.crypto?.stale ? ' · 含缓存数据' : ''}` : result.warnings?.length ? errorLabel(result.warnings[0].error) : '暂无可用榜单';
    financeOverviewView.renderMarketSummaries(result, overviewRows);

    const chartRows = overviewRows.filter((quote) => Array.isArray(quote.sparkline) && quote.sparkline.length > 1);
    chartRows.forEach((quote) => state.chartSeries.set(quote.asset.id, quote.sparkline));
    const globalValues = result.crypto?.globalSeries?.map((point) => Number(point.value)).filter(Number.isFinite) || [];
    const globalChart = globalValues.length > 1 ? {
      id: 'global:coingecko:market-cap',
      global: true,
      asset: { name: '全球加密市场总市值', symbol: 'GLOBAL', currency: 'USD' },
      price: result.crypto.marketCap,
      changePercent: seriesChange(globalValues),
      sparkline: globalValues,
      feed: 'coingecko-aggregate-rest',
      stale: result.crypto.stale,
    } : null;
    if (globalChart) state.chartSeries.set(globalChart.id, globalValues);
    const benchmarkRows = [globalChart, ...chartRows.filter((quote) => ['bitcoin', 'ethereum'].includes(quote.asset.providerAssetId)), ...chartRows].filter(Boolean).filter((quote, index, source) => source.findIndex((item) => item.id === quote.id) === index).slice(0, 5);
    if (elements.overviewBenchmarks) {
      elements.overviewBenchmarks.innerHTML = benchmarkRows.map((quote) => `<button type="button" data-finance-benchmark="${escapeHtml(quote.id || quote.asset.id)}" aria-pressed="false">${escapeHtml(quote.global ? '加密总值' : quote.asset.symbol)}</button>`).join('');
    }
    let chartQuote = benchmarkRows.find((quote) => (quote.id || quote.asset.id) === state.overviewChartAssetId) || globalChart || chartRows.find((quote) => quote.asset.providerAssetId === 'bitcoin') || chartRows[0];
    state.overviewChartAssetId = chartQuote?.id || chartQuote?.asset.id || '';
    document.querySelectorAll('[data-finance-benchmark]').forEach((button) => {
      const active = button.dataset.financeBenchmark === state.overviewChartAssetId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (chartQuote) {
      const change = chartQuote.changePercent;
      const isMarketProxy = !chartQuote.global && !globalChart && chartQuote.asset.providerAssetId === 'bitcoin';
      elements.overviewChartTitle.textContent = chartQuote.global ? '全球加密市场总市值' : `${chartQuote.asset.name} · ${chartQuote.asset.symbol}${isMarketProxy ? ' · 市场代理' : ''}`;
      elements.overviewChartValue.textContent = chartQuote.global ? formatCompact(chartQuote.price) : formatPrice(chartQuote.price, chartQuote.asset.currency);
      elements.overviewChartChange.textContent = formatPercent(change);
      elements.overviewChartChange.className = changeClass(change);
      elements.overviewChartRange.textContent = chartQuote.global ? '7 日 · 全球总市值实际序列' : isMarketProxy ? '7 日 · BTC 实际价格序列（市场代理）' : '7 日 · 资产实际价格序列';
      elements.overviewChartSource.textContent = chartQuote.global && result.crypto.globalHistoryError ? '当前计划未返回全球历史 · BTC 代理' : `${chartQuote.feed} · ${chartQuote.stale ? '缓存' : chartQuote.global ? '全市场序列' : isMarketProxy ? '市场代理' : '资产序列'}`;
      elements.overviewChart.dataset.financeChartAsset = chartQuote.id || chartQuote.asset.id;
      requestAnimationFrame(() => drawChart(elements.overviewChart, chartQuote.sparkline));
    } else {
      elements.overviewChartTitle.textContent = '暂无可用曲线';
      elements.overviewChartValue.textContent = '--';
      elements.overviewChartChange.textContent = '历史序列不可用';
      elements.overviewChartChange.className = '';
      elements.overviewChartRange.textContent = '历史序列不可用';
      elements.overviewChartSource.textContent = result.crypto ? 'provider 未返回序列' : '等待数据源';
      elements.overviewChart.dataset.financeChartAsset = '';
      const context = elements.overviewChart.getContext('2d');
      context?.clearRect(0, 0, elements.overviewChart.width, elements.overviewChart.height);
    }

    financeOverviewView.renderMovers(elements.overviewCn, financeOverviewView.marketFocusRows('cn'), financeOverviewView.marketEmptyDetail('cn'));
    financeOverviewView.renderMovers(elements.overviewUs, financeOverviewView.marketFocusRows('us'), financeOverviewView.marketEmptyDetail('us'));
    financeOverviewView.renderMovers(elements.overviewCrypto, financeOverviewView.marketFocusRows('crypto'), financeOverviewView.marketEmptyDetail('crypto'));
  }

  function renderRankingPagination(result) {
    financeRankingView.renderPagination(result);
  }

  function renderRanking() {
    financeRankingView.render();
  }


  function renderWatchlist() {
    financeWatchlistView.render();
  }

  function selectedDetailAsset() {
    return financeWatchlistView.selectedDetailAsset();
  }

  function selectedDetailQuote() {
    return financeWatchlistView.selectedDetailQuote();
  }

  function renderFundamentals(asset) {
    if (asset.market !== 'us') return '';
    const result = state.fundamentalsByAsset.get(asset.id);
    if (!result || result.loading) return '<section class="finance-fundamentals"><header><strong>SEC 申报基本面</strong><span>官方 XBRL · 非实时</span></header><p class="finance-fundamentals-state">正在读取最近披露数据</p></section>';
    if (!result.ok) return `<section class="finance-fundamentals"><header><strong>SEC 申报基本面</strong><span>官方 XBRL · 非实时</span></header><p class="finance-fundamentals-state">${escapeHtml(errorLabel(result.error))}</p></section>`;
    const rows = (Array.isArray(result.metrics) ? result.metrics : []).map((metric) => `<div><dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(formatPrice(metric.value, metric.unit || 'USD'))}</dd><small>${escapeHtml([metric.form, metric.periodEnd, metric.filedAt ? `披露 ${metric.filedAt}` : ''].filter(Boolean).join(' · '))}</small></div>`).join('');
    return `<section class="finance-fundamentals"><header><strong>SEC 申报基本面</strong><span>${escapeHtml(result.entityName || asset.name)}</span></header><dl>${rows}</dl><p class="finance-fundamentals-state">来自 EDGAR companyconcept；口径和期间按每项最近可用申报分别标注，不代表实时估值。</p></section>`;
  }

  function renderDetail() {
    const asset = selectedDetailAsset();
    const quote = selectedDetailQuote();
    if (!asset || !quote) {
      const reason = state.unavailableQuotes.get(state.selectedAssetId);
      elements.detail.innerHTML = emptyState(asset?.name || '没有可用报价', reason ? errorLabel(reason) : '等待 provider 返回数据');
      return;
    }
    const sourceText = `${quote.feed || '--'} · ${quote.session || '未知时段'} · ${quote.stale ? '缓存数据' : quote.freshness || '未知新鲜度'}`;
    const history = state.historyByAsset.get(asset.id);
    const series = history?.series?.map((point) => point.value) || quote.sparkline || [];
    const metrics = [
      ['24h 最高', formatPrice(quote.high24h, asset.currency)],
      ['24h 最低', formatPrice(quote.low24h, asset.currency)],
      ['24h 成交额', formatCompact(quote.volume24h)],
      ['市值', formatCompact(quote.marketCap)],
      ['1h 变化', formatPercent(quote.change1h)],
      ['7d 变化', formatPercent(quote.change7d)],
    ];
    const historyButtons = [1, 7, 30].map((days) => `<button type="button" data-finance-history-days="${days}" class="${days === (history?.days || 7) ? 'active' : ''}" aria-pressed="${String(days === (history?.days || 7))}">${days}D</button>`).join('');
    elements.detail.innerHTML = `<div class="finance-detail-head"><span class="finance-asset-mark ${escapeHtml(asset.market)}">${escapeHtml(asset.symbol.slice(0, 2))}</span><div><span>${escapeHtml(marketLabel(asset.market))} · ${escapeHtml(asset.exchange || asset.provider)}</span><h2>${escapeHtml(asset.name)}</h2><small>${escapeHtml(asset.symbol)}</small></div></div><div class="finance-detail-price"><strong>${escapeHtml(formatQuotePrice(quote))}</strong><span class="${changeClass(quote.changePercent)}">${escapeHtml(formatPercent(quote.changePercent))}</span></div><div class="finance-detail-chart-head"><strong>历史走势</strong><div class="finance-history-tabs" role="group" aria-label="历史走势范围">${historyButtons}</div></div>${series.length > 1 ? `${renderChartCanvas(asset.id, series, 'finance-detail-chart', `${asset.symbol} 历史价格走势`)}<div class="finance-detail-range"><span>${history?.series?.[0]?.at ? escapeHtml(formatTime(history.series[0].at)) : `${history?.days || 7} 天前`}</span><span>${history?.stale ? '缓存' : '最近'}</span></div>` : emptyState('暂无历史序列', history?.error ? errorLabel(history.error) : '等待 provider 返回曲线')}<dl class="finance-metrics">${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${renderFundamentals(asset)}<div class="finance-source-status">${escapeHtml(sourceText)}<br>事件 ${escapeHtml(formatTime(quote.eventAt))} · 取回 ${escapeHtml(formatTime(quote.retrievedAt))}</div>`;
  }

  function renderSettingsProvider(providerId, provider) {
    const status = document.querySelector(`[data-finance-provider-status="${providerId}"]`);
    if (!status || !provider) return;
    const source = document.querySelector(`[data-finance-provider="${providerId}"]`);
    if (source) {
      source.dataset.enabled = String(provider.enabled === true);
      source.dataset.state = provider.state || 'unknown';
    }
    const publicProvider = providerId === 'coingecko' || providerId === 'binance' || ['cn-tencent', 'cn-eastmoney', 'cn-sina'].includes(providerId);
    const savedLabel = providerId === 'sec-edgar' ? '联系信息已保存' : '密钥已保存';
    const missingLabel = providerId === 'sec-edgar' ? '未保存联系邮箱' : '未保存密钥';
    const credential = provider.credentialSource === 'environment' ? '环境变量' : provider.hasCredential ? savedLabel : publicProvider ? '无需密钥' : missingLabel;
    const verification = provider.verification?.state === 'verified' ? ` · 已验证 ${formatTime(provider.verification.verifiedAt)}`
      : provider.verification?.state === 'failed' ? ` · ${errorLabel(provider.verification.error)}` : '';
    status.textContent = `${providerStateLabel(provider)} · ${credential}${verification}`;
    status.dataset.state = provider.verification?.state === 'failed' ? 'error'
      : provider.verification?.state === 'verified' ? 'verified'
        : provider.enabled === true ? 'enabled' : 'disabled';
    const capabilityNode = document.querySelector(`[data-finance-provider-capabilities="${providerId}"]`);
    if (!capabilityNode) return;
    const capabilities = provider.verification?.state === 'verified' ? provider.verification.capabilities : null;
    if (!capabilities) {
      capabilityNode.textContent = provider.verification?.state === 'failed' ? '基础连接失败，未检测附加能力' : '运行连接测试后显示账户实际能力';
      return;
    }
    const capabilityLabels = { available: '可用', permission_required: '需额外权限', unsupported: '不提供', not_tested: '未测试', rate_limited: '暂时限流', authentication_failed: '验证失败', network_error: '连接失败', timeout: '超时', invalid_response: '响应异常' };
    const entries = [
      ['实时快照', capabilities.realtime],
      ['日 K 线与历史', capabilities.history || capabilities.daily],
      ['代码搜索', capabilities.exactCodeSearch],
      ['名称与交易所', capabilities.metadata],
    ];
    if (providerId === 'cn-stock' || providerId.startsWith('cn-')) {
      entries.push(['A 股全市场榜单', capabilities.fullMarket], ['市值榜', capabilities.marketCap]);
    } else {
      entries.push(['申报基本面', capabilities.fundamentals]);
    }
    capabilityNode.innerHTML = entries.map(([label, value]) => {
      const stateValue = Object.hasOwn(capabilityLabels, value) ? value : 'not_tested';
      return `<span data-state="${stateValue}"><i aria-hidden="true"></i>${escapeHtml(label)}<b>${escapeHtml(capabilityLabels[stateValue])}</b></span>`;
    }).join('');
  }

  function renderSettingsOverview(providers) {
    const rows = Array.isArray(providers) ? providers : [];
    const enabled = rows.filter((provider) => provider.enabled === true).length;
    const credentialed = rows.filter((provider) => provider.hasCredential || provider.credentialSource === 'environment').length;
    const verified = rows.filter((provider) => provider.verification?.state === 'verified').length;
    if (elements.settingsEnabledCount) elements.settingsEnabledCount.textContent = String(enabled);
    if (elements.settingsCredentialCount) elements.settingsCredentialCount.textContent = String(credentialed);
    if (elements.settingsVerifiedCount) elements.settingsVerifiedCount.textContent = String(verified);
    document.querySelectorAll('[data-finance-settings-market]').forEach((market) => {
      const sources = [...market.querySelectorAll('[data-finance-provider]')];
      const enabledSources = sources.filter((source) => source.dataset.enabled === 'true').length;
      const count = market.querySelector('.finance-settings-market-count');
      if (count) count.textContent = `${enabledSources}/${sources.length} 已启用`;
      const navSummary = document.querySelector(`[data-finance-settings-tab="${market.dataset.financeSettingsMarket}"] small`);
      if (navSummary) navSummary.textContent = `${enabledSources}/${sources.length} 已启用`;
    });
  }

  function selectSettingsSection(section = 'crypto') {
    const allowed = ['crypto', 'us', 'cn', 'preferences', 'watchlists'];
    const next = allowed.includes(section) ? section : 'crypto';
    document.querySelectorAll('[data-finance-settings-tab]').forEach((button) => {
      const active = button.dataset.financeSettingsTab === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.id = `finance-settings-tab-${button.dataset.financeSettingsTab}`;
    });
    document.querySelectorAll('[data-finance-settings-panel]').forEach((panelNode) => {
      const active = panelNode.dataset.financeSettingsPanel === next;
      panelNode.hidden = !active;
      panelNode.classList.toggle('active', active);
    });
  }

  function applyProviderSettings(settings) {
    if (!settings?.ok) return;
    state.providerSettings = settings;
    const storedPreferences = financeStore.readPreferences();
    const localRefresh = [0, 30, 60, 120, 300].includes(Number(storedPreferences?.refreshSeconds)) ? Number(storedPreferences.refreshSeconds) : null;
    if (localRefresh === null && [0, 30, 60, 120, 300].includes(Number(settings.refreshSeconds))) {
      state.preferences.refreshSeconds = Number(settings.refreshSeconds);
      savePreferences();
    } else if (localRefresh !== null && localRefresh !== Number(settings.refreshSeconds)) {
      api.setFinanceRefreshInterval?.(localRefresh).catch?.(() => {});
    }
    const coinGecko = settings.providers.find((provider) => provider.id === 'coingecko');
    const binance = settings.providers.find((provider) => provider.id === 'binance');
    const alphaVantage = settings.providers.find((provider) => provider.id === 'alpha-vantage');
    const alpaca = settings.providers.find((provider) => provider.id === 'alpaca');
    const twelveData = settings.providers.find((provider) => provider.id === 'twelve-data');
    const secEdgar = settings.providers.find((provider) => provider.id === 'sec-edgar');
    const quantDash = settings.providers.find((provider) => provider.id === 'cn-stock');
    const tencent = settings.providers.find((provider) => provider.id === 'cn-tencent');
    const eastmoney = settings.providers.find((provider) => provider.id === 'cn-eastmoney');
    const sina = settings.providers.find((provider) => provider.id === 'cn-sina');
    elements.coinGeckoEnabled.checked = coinGecko?.enabled !== false;
    elements.binanceEnabled.checked = binance?.enabled !== false;
    elements.alphaVantageEnabled.checked = alphaVantage?.enabled === true;
    elements.alpacaEnabled.checked = alpaca?.enabled === true;
    elements.alpacaFeed.value = alpaca?.feed === 'SIP' ? 'sip' : 'iex';
    elements.twelveDataEnabled.checked = twelveData?.enabled === true;
    elements.secEdgarEnabled.checked = secEdgar?.enabled === true;
    elements.quantDashEnabled.checked = quantDash?.enabled === true;
    elements.tencentEnabled.checked = tencent?.enabled === true;
    elements.eastmoneyEnabled.checked = eastmoney?.enabled === true;
    elements.sinaEnabled.checked = sina?.enabled === true;
    elements.coinGeckoKey.placeholder = coinGecko?.hasCredential ? '已保存，留空则不修改' : '可选 Demo API Key';
    elements.alphaVantageKey.placeholder = alphaVantage?.hasCredential ? '已保存，留空则不修改' : '免费 API Key';
    elements.alphaVantageKey.disabled = alphaVantage?.credentialSource === 'environment' || (!settings.secureStorage && !alphaVantage?.hasCredential);
    elements.alpacaKeyId.placeholder = alpaca?.hasCredential ? '已保存，留空则不修改' : 'API Key ID';
    elements.alpacaSecret.placeholder = alpaca?.hasCredential ? '已保存，留空则不修改' : 'Secret Key';
    elements.twelveDataKey.placeholder = twelveData?.hasCredential ? '已保存，留空则不修改' : '免费 API Key';
    elements.secEdgarContact.placeholder = secEdgar?.hasCredential ? '已保存，留空则不修改' : 'name@example.com';
    elements.quantDashKey.placeholder = quantDash?.hasCredential ? '已保存，留空则不修改' : 'QuantDash API Key';
    const coinEnvironment = coinGecko?.credentialSource === 'environment';
    const alpacaEnvironment = alpaca?.credentialSource === 'environment';
    const twelveDataEnvironment = twelveData?.credentialSource === 'environment';
    const secEdgarEnvironment = secEdgar?.credentialSource === 'environment';
    const quantDashEnvironment = quantDash?.credentialSource === 'environment';
    elements.coinGeckoKey.disabled = coinEnvironment || (!settings.secureStorage && !coinGecko?.hasCredential);
    elements.alpacaKeyId.disabled = alpacaEnvironment || (!settings.secureStorage && !alpaca?.hasCredential);
    elements.alpacaSecret.disabled = alpacaEnvironment || (!settings.secureStorage && !alpaca?.hasCredential);
    elements.twelveDataKey.disabled = twelveDataEnvironment || (!settings.secureStorage && !twelveData?.hasCredential);
    elements.secEdgarContact.disabled = secEdgarEnvironment || (!settings.secureStorage && !secEdgar?.hasCredential);
    elements.quantDashKey.disabled = quantDashEnvironment || (!settings.secureStorage && !quantDash?.hasCredential);
    const providersById = { coingecko: coinGecko, 'alpha-vantage': alphaVantage, alpaca, 'twelve-data': twelveData, 'sec-edgar': secEdgar, 'cn-stock': quantDash };
    document.querySelectorAll('[data-finance-provider-remove]').forEach((button) => {
      const provider = providersById[button.dataset.financeProviderRemove];
      button.disabled = !provider?.hasCredential || provider.credentialSource === 'environment';
      button.title = provider?.credentialSource === 'environment' ? '环境变量只能在应用外修改' : '';
    });
    renderSettingsProvider('coingecko', coinGecko);
    renderSettingsProvider('binance', binance);
    renderSettingsProvider('alpha-vantage', alphaVantage);
    renderSettingsProvider('alpaca', alpaca);
    renderSettingsProvider('twelve-data', twelveData);
    renderSettingsProvider('sec-edgar', secEdgar);
    renderSettingsProvider('cn-stock', quantDash);
    renderSettingsProvider('cn-tencent', tencent);
    renderSettingsProvider('cn-eastmoney', eastmoney);
    renderSettingsProvider('cn-sina', sina);
    renderSettingsOverview(settings.providers);
    renderProviderSummary(settings.providers);
  }

  async function loadProviderSettings() {
    try {
      if (typeof api.getFinanceSettings === 'function') applyProviderSettings(await api.getFinanceSettings());
    } catch (error) {
      document.querySelectorAll('[data-finance-provider-status]').forEach((node) => { node.textContent = '配置读取失败'; });
    } finally {
      state.financeStartupReady = true;
      scheduleRefresh();
    }
  }

  function validateProviderForm(providerId, removeCredential) {
    if (removeCredential) return true;
    const provider = state.providerSettings?.providers?.find((item) => item.id === providerId);
    const hasStoredCredential = Boolean(provider?.hasCredential || provider?.credentialSource === 'environment');
    const status = document.querySelector(`[data-finance-provider-status="${providerId}"]`);
    const fail = (message, input) => {
      if (status) {
        status.textContent = message;
        status.dataset.state = 'error';
      }
      input?.focus();
      return false;
    };
    if (providerId === 'alpaca' && elements.alpacaEnabled.checked) {
      const keyId = elements.alpacaKeyId.value.trim();
      const secretKey = elements.alpacaSecret.value.trim();
      if ((keyId && !secretKey) || (!keyId && secretKey)) return fail('API Key ID 与 Secret Key 需要同时填写', keyId ? elements.alpacaSecret : elements.alpacaKeyId);
      if (!hasStoredCredential && (!keyId || !secretKey)) return fail('启用 Alpaca 前请填写完整账户凭据', elements.alpacaKeyId);
    }
    const requiredCredentials = {
      'alpha-vantage': [elements.alphaVantageEnabled, elements.alphaVantageKey, '启用 Alpha Vantage 前请填写 API Key'],
      'twelve-data': [elements.twelveDataEnabled, elements.twelveDataKey, '启用 Twelve Data 前请填写 API Key'],
      'sec-edgar': [elements.secEdgarEnabled, elements.secEdgarContact, '启用 SEC EDGAR 前请填写联系邮箱'],
      'cn-stock': [elements.quantDashEnabled, elements.quantDashKey, '启用 QuantDash 前请填写 API Key'],
    };
    const requirement = requiredCredentials[providerId];
    if (requirement) {
      const [enabledInput, credentialInput, message] = requirement;
      if (!credentialInput.checkValidity()) {
        credentialInput.reportValidity();
        return fail('请检查凭据格式', credentialInput);
      }
      if (enabledInput.checked && !hasStoredCredential && !credentialInput.value.trim()) return fail(message, credentialInput);
    }
    return true;
  }

  async function saveProvider(providerId, removeCredential = false) {
    if (typeof api.setFinanceProvider !== 'function') return;
    const status = document.querySelector(`[data-finance-provider-status="${providerId}"]`);
    if (!validateProviderForm(providerId, removeCredential)) return;
    const payload = { providerId, removeCredential };
    if (providerId === 'coingecko') {
      payload.enabled = elements.coinGeckoEnabled.checked;
      payload.apiKey = removeCredential ? '' : elements.coinGeckoKey.value;
    } else if (providerId === 'binance') {
      payload.enabled = elements.binanceEnabled.checked;
    } else if (providerId === 'alpha-vantage') {
      payload.enabled = elements.alphaVantageEnabled.checked;
      payload.apiKey = removeCredential ? '' : elements.alphaVantageKey.value;
    } else if (providerId === 'twelve-data') {
      payload.enabled = elements.twelveDataEnabled.checked;
      payload.apiKey = removeCredential ? '' : elements.twelveDataKey.value;
    } else if (providerId === 'sec-edgar') {
      payload.enabled = elements.secEdgarEnabled.checked;
      payload.contact = removeCredential ? '' : elements.secEdgarContact.value;
    } else if (providerId === 'cn-stock') {
      payload.enabled = elements.quantDashEnabled.checked;
      payload.apiKey = removeCredential ? '' : elements.quantDashKey.value;
    } else if (providerId === 'cn-tencent') {
      payload.enabled = elements.tencentEnabled.checked;
    } else if (providerId === 'cn-eastmoney') {
      payload.enabled = elements.eastmoneyEnabled.checked;
    } else if (providerId === 'cn-sina') {
      payload.enabled = elements.sinaEnabled.checked;
    } else {
      payload.enabled = elements.alpacaEnabled.checked;
      payload.feed = elements.alpacaFeed.value;
      payload.keyId = removeCredential ? '' : elements.alpacaKeyId.value;
      payload.secretKey = removeCredential ? '' : elements.alpacaSecret.value;
    }
    status.textContent = '正在保存';
    try {
      const result = await api.setFinanceProvider(payload);
      if (!result?.ok) throw new Error(result?.error || 'save_failed');
      elements.coinGeckoKey.value = '';
      elements.alphaVantageKey.value = '';
      elements.alpacaKeyId.value = '';
      elements.alpacaSecret.value = '';
      elements.twelveDataKey.value = '';
      elements.secEdgarContact.value = '';
      elements.quantDashKey.value = '';
      applyProviderSettings(result);
      state.overview = null;
      state.overviewLeaders = null;
      state.overviewLosers = null;
      state.overviewVolume = null;
      state.ranking = null;
      state.rankingByQuery.clear();
      state.quotes.clear();
      state.searchResults = [];
      state.searchNotice = '';
      renderSearchResults();
      scheduleRefresh();
    } catch (error) {
      status.textContent = errorLabel(error?.message);
    }
  }

  async function testProvider(providerId) {
    if (typeof api.testFinanceProvider !== 'function') return;
    const status = document.querySelector(`[data-finance-provider-status="${providerId}"]`);
    const button = document.querySelector(`[data-finance-provider-test="${providerId}"]`);
    button.disabled = true;
    status.textContent = '正在测试连接';
    try {
      const result = await api.testFinanceProvider(providerId);
      if (result?.settings) applyProviderSettings(result.settings);
      if (!result?.ok && !result?.settings) status.textContent = errorLabel(result?.error);
    } catch (error) {
      status.textContent = errorLabel(error?.message);
    } finally {
      button.disabled = false;
    }
  }

  function renderSettingsPreferences() {
    financeSettingsView.renderPreferences();
  }

  function renderSettingsWatchlists() {
    financeSettingsView.renderWatchlists();
  }

  function renderSearchResults(message = '') {
    financeSettingsView.renderSearchResults(message);
  }

  async function searchAssets() {
    const query = String(elements.settingsSearch?.value || '').trim();
    const sequence = ++state.searchSequence;
    if (state.searchRequestId) {
      try { api.cancelFinanceRequest?.(state.searchRequestId)?.catch(() => {}); } catch (error) {}
      finishFinanceRequest(state.searchRequestId);
      state.searchRequestId = '';
    }
    if (!query) {
      state.searchResults = [];
      state.searchNotice = '';
      renderSearchResults();
      return;
    }
    const requestId = beginFinanceRequest();
    state.searchRequestId = requestId;
    state.searchNotice = '';
    renderSearchResults('正在搜索真实数据源');
    try {
      const result = await api.searchFinanceAssets(query, requestId);
      if (sequence !== state.searchSequence || isCancelledFinanceResult(result)) return;
      state.searchResults = Array.isArray(result?.items) ? result.items.map(normalizeAssetIdentity).filter(Boolean) : [];
      const notice = Array.isArray(result?.warnings) ? result.warnings[0] : null;
      state.searchNotice = notice ? errorLabel(notice.warning || notice.error) : '';
      const emptyMessage = result?.errors?.length ? errorLabel(result.errors[0].error) : state.searchNotice ? '' : '未找到匹配标的';
      renderSearchResults(state.searchResults.length ? '' : emptyMessage);
    } catch (error) {
      if (sequence === state.searchSequence) {
        state.searchNotice = '';
        renderSearchResults(errorLabel(error?.message));
      }
    } finally {
      finishFinanceRequest(requestId);
      if (state.searchRequestId === requestId) state.searchRequestId = '';
    }
  }

  function addSelectedAsset() {
    const selectedId = elements.settingsSearch?.dataset.selectedAssetId || '';
    const asset = state.searchResults.find((item) => item.id === selectedId);
    if (!asset) {
      renderSearchResults('先从搜索结果中选择一个标的');
      return;
    }
    const targetId = elements.settingsTargetList?.value || 'all';
    const target = state.watchlists.lists.find((list) => list.id === targetId) || state.watchlists.lists[0];
    const all = state.watchlists.lists.find((list) => list.id === 'all');
    state.watchlists.assets[asset.id] = { ...asset, addedAt: new Date().toISOString() };
    if (!all.assetIds.includes(asset.id)) all.assetIds.push(asset.id);
    if (!target.assetIds.includes(asset.id)) target.assetIds.push(asset.id);
    saveWatchlists();
    state.currentListId = target.id;
    state.searchResults = [];
    state.searchNotice = '';
    elements.settingsSearch.value = '';
    delete elements.settingsSearch.dataset.selectedAssetId;
    renderSearchResults();
    renderSettingsWatchlists();
    renderWatchlist();
  }

  function removeAsset(listId, assetId) {
    const list = state.watchlists.lists.find((item) => item.id === listId);
    if (!list) return;
    if (list.id === 'all') {
      state.watchlists.lists.forEach((item) => { item.assetIds = item.assetIds.filter((id) => id !== assetId); });
      delete state.watchlists.assets[assetId];
      state.quotes.delete(assetId);
      state.unavailableQuotes.delete(assetId);
    } else {
      list.assetIds = list.assetIds.filter((id) => id !== assetId);
    }
    if (state.selectedAssetId === assetId) state.selectedAssetId = '';
    saveWatchlists();
    renderSettingsWatchlists();
    renderWatchlist();
  }

  function createGroup() {
    const name = String(window.prompt('自选分组名称') || '').trim().slice(0, 40);
    if (!name) return;
    const id = `list-${Date.now().toString(36)}`;
    state.watchlists.lists.push({ id, name, assetIds: [] });
    saveWatchlists();
    state.currentListId = id;
    renderSettingsWatchlists();
    renderWatchlist();
  }

  function renameGroup(listId) {
    const list = state.watchlists.lists.find((item) => item.id === listId && item.id !== 'all');
    if (!list) return;
    const name = String(window.prompt('新的分组名称', list.name) || '').trim().slice(0, 40);
    if (!name) return;
    list.name = name;
    saveWatchlists();
    renderSettingsWatchlists();
    renderWatchlist();
  }

  function deleteGroup(listId) {
    const list = state.watchlists.lists.find((item) => item.id === listId && item.id !== 'all');
    if (!list || !window.confirm(`删除分组“${list.name}”？标的仍保留在全部观察中。`)) return;
    state.watchlists.lists = state.watchlists.lists.filter((item) => item.id !== listId);
    if (state.currentListId === listId) state.currentListId = 'all';
    saveWatchlists();
    renderSettingsWatchlists();
    renderWatchlist();
  }

  function beginFinanceRequest() {
    return financeRequests.begin();
  }

  function finishFinanceRequest(requestId) {
    financeRequests.finish(requestId);
  }

  function cancelFinanceRequests(status = '已停止行情请求') {
    financeRequests.cancelAll();
    state.refreshSequence += 1;
    state.refreshPending = false;
    elements.refresh.disabled = false;
    elements.refresh.classList.remove('loading');
    if (status && elements.updated) elements.updated.textContent = status;
  }

  async function loadOverview() {
    if (typeof api.getFinanceOverview !== 'function') return;
    const requestId = beginFinanceRequest();
    const generation = state.financeLoadGeneration;
    const hadSnapshot = Boolean(state.overview || state.overviewLeaders || state.overviewLosers || state.overviewVolume);
    if (!state.aiInterpretation && !state.aiRequestId && elements.aiStatus) elements.aiStatus.textContent = '不会自动调用';
    renderOverview();
    if (hadSnapshot && elements.overviewStatus) elements.overviewStatus.textContent = '后台更新中 · 当前快照仍可用';
    try {
      const [overview, leaders, losers, volume] = await Promise.all([
        api.getFinanceOverview({ requestId }).catch((error) => ({ ok: false, markets: [], providers: [], warnings: [{ error: error?.message || 'network_error' }] })),
        api.getFinanceRanking({ market: 'all', source: state.preferences.defaultSource, sort: 'gainers', page: 1, pageSize: RANKING_PAGE_SIZE, requestId }).catch((error) => ({ ok: false, rows: [], error: error?.message || 'network_error' })),
        api.getFinanceRanking({ market: 'all', source: state.preferences.defaultSource, sort: 'losers', page: 1, pageSize: RANKING_PAGE_SIZE, requestId }).catch((error) => ({ ok: false, rows: [], error: error?.message || 'network_error' })),
        api.getFinanceRanking({ market: 'all', source: state.preferences.defaultSource, sort: 'volume', page: 1, pageSize: RANKING_PAGE_SIZE, requestId }).catch((error) => ({ ok: false, rows: [], error: error?.message || 'network_error' })),
      ]);
      if (generation !== state.financeLoadGeneration) return;
      if (!isCancelledFinanceResult(overview) && (overview?.ok !== false || !state.overview)) state.overview = overview;
      if (!isCancelledFinanceResult(leaders) && (leaders?.ok !== false || !state.overviewLeaders)) state.overviewLeaders = leaders;
      if (!isCancelledFinanceResult(losers) && (losers?.ok !== false || !state.overviewLosers)) state.overviewLosers = losers;
      if (!isCancelledFinanceResult(volume) && (volume?.ok !== false || !state.overviewVolume)) state.overviewVolume = volume;
      renderOverview();
      if (state.aiInterpretation && state.aiResultRevision !== financeSnapshotRevision()) {
        retainFinanceInterpretation('行情已更新，显示上次解读');
        if (elements.aiStatus) elements.aiStatus.textContent = '行情已更新，可重新生成解读';
      }
    } finally {
      finishFinanceRequest(requestId);
    }
  }

  async function loadFundamentals(assetId) {
    if (typeof api.getFinanceFundamentals !== 'function' || !assetId || !assetId.startsWith('us:') || state.fundamentalsPending.has(assetId)) return;
    const existing = state.fundamentalsByAsset.get(assetId);
    if (existing?.ok || existing?.loading) return;
    const requestId = beginFinanceRequest();
    const generation = state.financeLoadGeneration;
    state.fundamentalsPending.add(assetId);
    state.fundamentalsByAsset.set(assetId, { loading: true });
    if (state.selectedAssetId === assetId) renderWatchlist();
    try {
      const result = await api.getFinanceFundamentals({ assetId, requestId });
      if (generation === state.financeLoadGeneration) {
        if (isCancelledFinanceResult(result)) {
          if (existing) state.fundamentalsByAsset.set(assetId, existing);
          else state.fundamentalsByAsset.delete(assetId);
        } else {
          state.fundamentalsByAsset.set(assetId, { ...result, loading: false });
        }
      }
    } catch (error) {
      if (generation === state.financeLoadGeneration) state.fundamentalsByAsset.set(assetId, { ok: false, loading: false, error: error?.message || 'network_error' });
    } finally {
      state.fundamentalsPending.delete(assetId);
      finishFinanceRequest(requestId);
      if (generation === state.financeLoadGeneration && state.selectedAssetId === assetId) renderWatchlist();
    }
  }

  async function loadHistory(assetId, days = 7) {
    if (typeof api.getFinanceHistory !== 'function' || !assetId) return;
    const safeDays = [1, 7, 30].includes(Number(days)) ? Number(days) : 7;
    const key = `${assetId}:${safeDays}`;
    const existing = state.historyByAsset.get(assetId);
    if (existing?.days === safeDays && (existing.ok || existing.loading) || state.historyPending.has(key)) return;
    const requestId = beginFinanceRequest();
    const generation = state.financeLoadGeneration;
    state.historyPending.add(key);
    state.historyByAsset.set(assetId, { ...(existing || {}), days: safeDays, loading: true });
    if (state.selectedAssetId === assetId) renderWatchlist();
    try {
      const result = await api.getFinanceHistory({ assetId, days: safeDays, requestId });
      if (generation === state.financeLoadGeneration) {
        if (isCancelledFinanceResult(result)) {
          if (existing) state.historyByAsset.set(assetId, existing);
          else state.historyByAsset.delete(assetId);
        } else {
          state.historyByAsset.set(assetId, { ...result, days: safeDays, loading: false });
        }
      }
    } catch (error) {
      if (generation === state.financeLoadGeneration) state.historyByAsset.set(assetId, { ok: false, days: safeDays, loading: false, error: error?.message || 'network_error' });
    } finally {
      state.historyPending.delete(key);
      finishFinanceRequest(requestId);
      if (generation === state.financeLoadGeneration && state.selectedAssetId === assetId) renderWatchlist();
    }
  }

  function financeSnapshotRevision() {
    return financeAiView.snapshotRevision();
  }

  function financeSnapshotTime(revision) {
    return financeAiView.snapshotTime(revision);
  }

  function marketFacts() {
    return financeAiView.marketFacts();
  }

  function aiErrorLabel(error) {
    return financeAiView.aiErrorLabel(error);
  }

  function retainFinanceInterpretation(reason, options = {}) {
    return financeAiView.retain(reason, options);
  }

  function renderFinanceInterpretation(result, revision) {
    financeAiView.renderInterpretation(result, revision);
  }

  function renderAiResult(text = '', options = {}) {
    financeAiView.renderResult(text, options);
  }

  function cancelFinanceAI(status = '已停止本次 AI 解读') {
    const requestId = state.aiRequestId;
    if (!requestId) return;
    state.aiSequence += 1;
    state.aiRequestId = '';
    elements.aiAnalyze.disabled = false;
    elements.aiStatus.textContent = status;
    renderAiResult('', { preservePrevious: true, previousReason: '已停止更新，显示上次解读' });
    api.cancelAI?.(requestId).catch(() => {});
  }

  async function analyzeMarket() {
    if (!elements.aiAnalyze || state.aiRequestId) return;
    if (!state.overview || !state.overviewLeaders?.rows?.length) {
      elements.aiStatus.textContent = '先获取一份可用行情快照';
      return;
    }
    if (typeof api.runAI !== 'function') {
      elements.aiStatus.textContent = '当前版本没有可用的 AI 服务';
      return;
    }
    const sequence = ++state.aiSequence;
    const snapshotRevision = financeSnapshotRevision();
    const snapshotTime = financeSnapshotTime(snapshotRevision);
    const requestId = `finance-ai-${Date.now().toString(36)}-${sequence}`;
    state.aiRequestId = requestId;
    elements.aiAnalyze.disabled = true;
    elements.aiStatus.textContent = '正在基于当前快照整理';
    renderAiResult('正在整理当前行情快照……', { preservePrevious: true, previousReason: '正在生成新解读，显示上次解读', busy: true });
    const referenceTimestamp = Date.parse(snapshotTime);
    const result = await api.runAI({
      requestId,
      action: 'financeInterpretation',
      interactive: true,
      context: { sourceType: 'manual', sourceId: 'finance-overview', sourceTitle: '行情市场快照', sourceRevision: snapshotRevision, text: marketFacts() },
      referenceTime: Number.isFinite(referenceTimestamp) ? new Date(referenceTimestamp).toISOString() : new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }).catch((error) => ({ ok: false, error: error?.message || 'network_error' }));
    if (sequence !== state.aiSequence || state.aiRequestId !== requestId) return;
    state.aiRequestId = '';
    elements.aiAnalyze.disabled = false;
    if (financeSnapshotRevision() !== snapshotRevision) {
      renderAiResult('', { preservePrevious: true, previousReason: '行情已更新，显示上次解读' });
      elements.aiStatus.textContent = '行情已更新，可重新生成解读';
      return;
    }
    if (!result?.ok || result.kind !== 'financeInterpretation') {
      renderAiResult('', { preservePrevious: true, previousReason: '本次生成失败，显示上次解读' });
      elements.aiStatus.textContent = aiErrorLabel(result?.error);
      return;
    }
    renderFinanceInterpretation(result, snapshotRevision);
    elements.aiStatus.textContent = `已完成 · ${state.overview.crypto?.stale ? '基于缓存快照' : '基于当前快照'}`;
  }

  function openAssetDetail(quote) {
    const identity = normalizeAssetIdentity(quote?.asset);
    if (!quote || !identity) return;
    cancelFinanceRequests('正在打开资产详情');
    state.detailAsset = identity;
    state.detailQuote = quote;
    state.quotes.set(identity.id, quote);
    state.unavailableQuotes.delete(identity.id);
    state.selectedAssetId = identity.id;
    selectView('watchlist');
    renderWatchlist();
    void loadHistory(identity.id, 7);
    void loadFundamentals(identity.id);
  }

  function openRankingAsset(assetId) {
    const quote = (Array.isArray(state.ranking?.rows) ? state.ranking.rows : []).find((item) => item?.asset?.id === assetId);
    openAssetDetail(quote);
  }

  async function loadRanking() {
    if (typeof api.getFinanceRanking !== 'function') return;
    const market = state.rankingMarket;
    const sort = state.rankingSort;
    const source = rankingSourceFor(market, state.rankingSource, sort);
    if (source !== state.rankingSource) {
      state.rankingSource = source;
      if (elements.rankingSource) elements.rankingSource.value = source;
    }
    const page = state.rankingPage;
    const cacheKey = rankingCacheKey(market, source, sort, page);
    const cachedSnapshot = state.rankingByQuery.get(cacheKey) || null;
    state.ranking = cachedSnapshot;
    const requestId = beginFinanceRequest();
    const generation = state.financeLoadGeneration;
    renderRanking();
    if (cachedSnapshot) elements.rankingState.textContent = '后台更新中 · 当前榜单仍可用';
    try {
      const result = await api.getFinanceRanking({ market, source, sort, page, pageSize: RANKING_PAGE_SIZE, requestId });
      if (!isCancelledFinanceResult(result)
        && generation === state.financeLoadGeneration && market === state.rankingMarket && source === state.rankingSource && sort === state.rankingSort && page === state.rankingPage) {
        if (result?.ok !== false || !cachedSnapshot) {
          state.ranking = result;
          rememberRanking(cacheKey, result);
          state.rankingPage = Number(result?.page) || page;
          if (state.rankingPage !== page) rememberRanking(rankingCacheKey(market, source, sort, state.rankingPage), result);
        }
      }
    } catch (error) {
      if (generation === state.financeLoadGeneration && market === state.rankingMarket && source === state.rankingSource && sort === state.rankingSort && page === state.rankingPage && !cachedSnapshot) state.ranking = { ok: false, market, source, sort, page, pageSize: RANKING_PAGE_SIZE, rows: [], error: error?.message || 'network_error' };
    } finally {
      finishFinanceRequest(requestId);
    }
    if (generation === state.financeLoadGeneration && market === state.rankingMarket && source === state.rankingSource && sort === state.rankingSort && (page === state.rankingPage || Number(state.ranking?.page) === state.rankingPage)) renderRanking();
  }

  function applyQuoteResult(result) {
    for (const quote of Array.isArray(result?.rows) ? result.rows : []) {
      if (quote?.asset?.id) {
        const savedAsset = state.watchlists.assets[quote.asset.id];
        const identity = normalizeAssetIdentity(savedAsset ? { ...quote.asset, ...savedAsset } : quote.asset);
        if (identity) {
          if (savedAsset) state.watchlists.assets[identity.id] = { ...identity };
          if (state.detailAsset?.id === identity.id) state.detailAsset = { ...identity, ...state.detailAsset };
          const normalizedQuote = { ...quote, asset: identity };
          state.quotes.set(identity.id, normalizedQuote);
          if (state.detailAsset?.id === identity.id) state.detailQuote = normalizedQuote;
        }
      }
    }
    state.unavailableQuotes = new Map((Array.isArray(result?.unavailable) ? result.unavailable : []).map((item) => [item.assetId, item.error]));
    if (result?.retrievedAt) elements.updated.textContent = `取回 ${formatTime(result.retrievedAt)}`;
    renderProviderSummary(result?.providers);
  }

  async function loadQuotes() {
    if (typeof api.getFinanceQuotes !== 'function') return;
    const requestId = beginFinanceRequest();
    const generation = state.financeLoadGeneration;
    const listAssetIds = currentList().assetIds;
    const temporaryDetailId = state.detailAsset?.id === state.selectedAssetId ? state.selectedAssetId : '';
    const assetIds = [...new Set([temporaryDetailId, ...listAssetIds].filter(Boolean))].slice(0, 100);
    if (!assetIds.length) {
      state.quotes.clear();
      state.unavailableQuotes.clear();
      finishFinanceRequest(requestId);
      renderWatchlist();
      return;
    }
    try {
      const result = await api.getFinanceQuotes({ assetIds, requestId });
      if (generation !== state.financeLoadGeneration || isCancelledFinanceResult(result)) return;
      applyQuoteResult(result);
    } catch (error) {
      if (generation === state.financeLoadGeneration) state.unavailableQuotes = new Map(assetIds.map((assetId) => [assetId, error?.message || 'network_error']));
    } finally {
      finishFinanceRequest(requestId);
    }
    if (generation !== state.financeLoadGeneration) return;
    renderWatchlist();
    if (state.currentView === 'watchlist' && state.selectedAssetId) {
      void loadHistory(state.selectedAssetId, 7);
      void loadFundamentals(state.selectedAssetId);
    }
  }

  async function refreshFinance(force = false) {
    if (state.refreshPending || !isFinanceVisible()) return;
    const refreshSequence = ++state.refreshSequence;
    state.refreshPending = true;
    elements.refresh.disabled = true;
    elements.refresh.classList.add('loading');
    try {
      if (force && typeof api.refreshFinanceCache === 'function') await api.refreshFinanceCache();
      if (state.currentView === 'overview') await loadOverview();
      else if (state.currentView === 'ranking') await loadRanking();
      else await loadQuotes();
    } finally {
      if (refreshSequence !== state.refreshSequence) return;
      state.refreshPending = false;
      elements.refresh.disabled = false;
      elements.refresh.classList.remove('loading');
      scheduleRefresh();
    }
  }

  function selectView(view, { load = true } = {}) {
    if (!['overview', 'ranking', 'watchlist'].includes(view)) return;
    if (state.currentView !== view) cancelFinanceRequests('已停止：已切换行情视图');
    state.currentView = view;
    document.querySelectorAll('[data-finance-view]').forEach((button) => {
      const active = button.dataset.financeView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-finance-view-panel]').forEach((section) => {
      const active = section.dataset.financeViewPanel === view;
      section.classList.toggle('active', active);
      section.hidden = !active;
    });
    if (load && isFinanceVisible()) refreshFinance(false);
    scheduleRefresh();
  }

  function isFinanceVisible() {
    const app = document.getElementById('app');
    const expanded = state.expanded || app?.classList.contains('expanded') === true;
    return expanded && !document.hidden && panel.classList.contains('active') && panel.getAttribute('aria-hidden') !== 'true';
  }

  function scheduleRefresh() {
    if (!state.financeStartupReady) return;
    const active = isFinanceVisible();
    const assetSignature = currentList()?.assetIds?.slice(0, 100).join('|') || '';
    const signature = `${active ? 'on' : 'off'}:${state.preferences.refreshSeconds}:${state.rankingMarket}:${state.rankingSource}:${state.rankingSort}:${state.rankingPage}:${assetSignature}`;
    if (signature !== state.refreshActivitySignature) {
      state.refreshActivitySignature = signature;
      const startupPrefetch = !state.startupPrefetchRequested;
      if (startupPrefetch) state.startupPrefetchRequested = true;
      api.setFinanceActivity?.({ active, refreshSeconds: state.preferences.refreshSeconds, rankingMarket: state.rankingMarket, rankingSource: state.rankingSource, rankingSort: state.rankingSort, rankingPage: state.rankingPage, assetIds: currentList()?.assetIds || [], prefetch: startupPrefetch }).catch?.(() => {
        if (!startupPrefetch) return;
        state.startupPrefetchRequested = false;
        state.refreshActivitySignature = '';
      });
    }
  }

  function updatePreference(key, value) {
    state.preferences[key] = value;
    if (key === 'defaultMarket') { state.rankingMarket = value; state.rankingPage = 1; }
    if (key === 'defaultSource') { state.rankingSource = value; state.rankingPage = 1; }
    if (key === 'defaultRanking') { state.rankingSort = value; state.rankingPage = 1; }
    const compatibleSource = rankingSourceFor(state.preferences.defaultMarket, state.preferences.defaultSource, state.preferences.defaultRanking);
    state.preferences.defaultSource = compatibleSource;
    state.rankingSource = rankingSourceFor(state.rankingMarket, state.rankingSource, state.rankingSort);
    savePreferences();
    if (key === 'refreshSeconds') api.setFinanceRefreshInterval?.(state.preferences.refreshSeconds).catch?.(() => {});
    renderSettingsPreferences();
    scheduleRefresh();
  }

  function applyFinanceUpdate(snapshot) {
    if (!snapshot) return;
    const previousRevision = financeSnapshotRevision();
    if (snapshot.overview && (snapshot.overview.ok !== false || !state.overview)) {
      state.overview = snapshot.overview;
      const overviewPrefix = `all:${state.preferences.defaultSource}:`;
      const leaders = snapshot.rankings?.[`${overviewPrefix}gainers`] || snapshot.rankings?.['crypto:gainers'];
      const losers = snapshot.rankings?.[`${overviewPrefix}losers`];
      const volume = snapshot.rankings?.[`${overviewPrefix}volume`];
      if (leaders?.ok !== false) state.overviewLeaders = leaders;
      if (losers?.ok !== false) state.overviewLosers = losers;
      if (volume?.ok !== false) state.overviewVolume = volume;
    }
    if (snapshot.quotes) applyQuoteResult(snapshot.quotes);
    for (const [rankingKey, result] of Object.entries(snapshot.rankings || {})) {
      if (result && (result.ok !== false || !state.rankingByQuery.has(rankingKey))) rememberRanking(rankingKey, result);
    }
    const key = rankingCacheKey(state.rankingMarket, state.rankingSource, state.rankingSort, state.rankingPage);
    if (state.rankingByQuery.has(key)) state.ranking = state.rankingByQuery.get(key);
    if (snapshot.overview?.retrievedAt) elements.updated.textContent = `取回 ${formatTime(snapshot.overview.retrievedAt)}`;
    if (state.aiInterpretation && previousRevision !== financeSnapshotRevision()) {
      retainFinanceInterpretation('行情已更新，显示上次解读');
      if (elements.aiStatus) elements.aiStatus.textContent = '行情已更新，可重新生成解读';
    }
    // Startup prefetch often completes while the workspace is collapsed. Keep the
    // hidden view in sync so the first visit does not depend on another request.
    if (state.currentView === 'overview') renderOverview();
    if (state.currentView === 'ranking' && snapshot.rankings?.[key]) renderRanking();
  }

  api.onFinanceUpdate?.(applyFinanceUpdate);

  function render() {
    renderProviderSummary(state.providerSettings?.providers);
    renderOverview();
    renderRanking();
    renderWatchlist();
    renderSettingsPreferences();
    renderSettingsWatchlists();
  }

  document.querySelectorAll('[data-finance-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.financeView)));
  document.querySelectorAll('[data-finance-settings-tab]').forEach((button) => button.addEventListener('click', () => selectSettingsSection(button.dataset.financeSettingsTab)));
  document.querySelector('[data-finance-open-ranking]')?.addEventListener('click', () => selectView('ranking'));
  function selectRankingPage(page) {
    const totalPages = Math.max(1, Number(state.ranking?.totalPages) || 1);
    const nextPage = Math.max(1, Math.min(totalPages, Math.floor(Number(page) || 1)));
    if (nextPage === state.rankingPage) return;
    cancelFinanceRequests();
    state.rankingPage = nextPage;
    loadRanking();
    scheduleRefresh();
  }

  document.querySelectorAll('[data-finance-market]').forEach((button) => button.addEventListener('click', () => {
    cancelFinanceRequests();
    state.rankingMarket = button.dataset.financeMarket;
    state.rankingPage = 1;
    document.querySelectorAll('[data-finance-market]').forEach((item) => item.classList.toggle('active', item === button));
    loadRanking();
    scheduleRefresh();
  }));
  elements.rankingSource?.addEventListener('change', () => { cancelFinanceRequests(); state.rankingSource = elements.rankingSource.value; state.rankingPage = 1; loadRanking(); scheduleRefresh(); });
  elements.rankingSort?.addEventListener('change', () => { cancelFinanceRequests(); state.rankingSort = elements.rankingSort.value; state.rankingPage = 1; loadRanking(); scheduleRefresh(); });
  elements.rankingPrevious?.addEventListener('click', () => selectRankingPage(state.rankingPage - 1));
  elements.rankingNext?.addEventListener('click', () => selectRankingPage(state.rankingPage + 1));
  const handleRankingSelection = (event) => {
    const button = event.target.closest('[data-finance-ranking-asset]');
    if (button) openRankingAsset(button.dataset.financeRankingAsset);
  };
  elements.rankingList?.addEventListener('click', handleRankingSelection);
  elements.rankingSpotlight?.addEventListener('click', handleRankingSelection);
  elements.listSelect?.addEventListener('change', () => { cancelFinanceRequests(); state.currentListId = elements.listSelect.value; state.selectedAssetId = ''; state.detailAsset = null; state.detailQuote = null; renderWatchlist(); loadQuotes(); scheduleRefresh(); });
  elements.sort?.addEventListener('change', renderWatchlist);
  elements.refresh?.addEventListener('click', () => refreshFinance(true));
  elements.aiAnalyze?.addEventListener('click', () => analyzeMarket());
  elements.overviewBenchmarks?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-finance-benchmark]');
    if (!button) return;
    state.overviewChartAssetId = button.dataset.financeBenchmark;
    renderOverview();
  });
  const handleOverviewSelection = (event) => {
    const button = event.target.closest('[data-finance-overview-asset]');
    if (!button) return;
    const assetId = button.dataset.financeOverviewAsset;
    const quote = financeOverviewView.quotes().find((item) => (item.id || item.asset.id) === assetId);
    if (!quote) return;
    if (Array.isArray(quote.sparkline) && quote.sparkline.length > 1) {
      state.overviewChartAssetId = assetId;
      renderOverview();
      return;
    }
    openAssetDetail(quote);
  };
  [elements.overviewCn, elements.overviewUs, elements.overviewCrypto].forEach((container) => container?.addEventListener('click', handleOverviewSelection));
  elements.quotes?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-finance-asset]');
    if (!row) return;
    cancelFinanceRequests('正在打开资产详情');
    state.selectedAssetId = row.dataset.financeAsset;
    state.detailAsset = null;
    state.detailQuote = null;
    renderWatchlist();
    void loadHistory(state.selectedAssetId, 7);
    void loadFundamentals(state.selectedAssetId);
  });
  elements.detail?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-finance-history-days]');
    if (!button) return;
    void loadHistory(state.selectedAssetId, Number(button.dataset.financeHistoryDays));
  });

  document.querySelectorAll('[data-finance-provider-save]').forEach((button) => button.addEventListener('click', () => saveProvider(button.dataset.financeProviderSave)));
  document.querySelectorAll('[data-finance-provider-test]').forEach((button) => button.addEventListener('click', () => testProvider(button.dataset.financeProviderTest)));
  document.querySelectorAll('[data-finance-provider-remove]').forEach((button) => button.addEventListener('click', () => {
    const providerId = button.dataset.financeProviderRemove;
    if (window.confirm('清除本机保存的该数据源密钥？')) saveProvider(providerId, true);
  }));

  let searchTimer = null;
  elements.settingsSearch?.addEventListener('input', () => {
    delete elements.settingsSearch.dataset.selectedAssetId;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(searchAssets, 280);
  });
  elements.settingsSearchResults?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-finance-search-result]');
    if (!button) return;
    elements.settingsSearch.dataset.selectedAssetId = button.dataset.financeSearchResult;
    const asset = state.searchResults.find((item) => item.id === button.dataset.financeSearchResult);
    if (asset) elements.settingsSearch.value = `${asset.name} · ${asset.symbol}`;
    elements.settingsSearchResults.hidden = true;
  });
  elements.settingsAdd?.addEventListener('click', addSelectedAsset);
  elements.settingsCreateGroup?.addEventListener('click', createGroup);
  elements.settingsWatchlistList?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-finance-remove-asset]');
    if (remove) return removeAsset(remove.dataset.financeRemoveList, remove.dataset.financeRemoveAsset);
    const rename = event.target.closest('[data-finance-rename-list]');
    if (rename) return renameGroup(rename.dataset.financeRenameList);
    const removeList = event.target.closest('[data-finance-delete-list]');
    if (removeList) deleteGroup(removeList.dataset.financeDeleteList);
  });

  elements.defaultView?.addEventListener('change', () => updatePreference('defaultView', elements.defaultView.value));
  elements.defaultMarket?.addEventListener('change', () => updatePreference('defaultMarket', elements.defaultMarket.value));
  elements.defaultSource?.addEventListener('change', () => updatePreference('defaultSource', elements.defaultSource.value));
  elements.defaultRanking?.addEventListener('change', () => updatePreference('defaultRanking', elements.defaultRanking.value));
  elements.refreshInterval?.addEventListener('change', () => updatePreference('refreshSeconds', Number(elements.refreshInterval.value)));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelFinanceRequests('已停止：窗口不可见');
      cancelFinanceAI('已停止：窗口不可见');
    }
    scheduleRefresh();
  });
  document.addEventListener('notch:modechange', (event) => {
    state.expanded = event.detail?.expanded === true;
    if (!state.expanded) {
      cancelFinanceRequests('已停止：行情面板已收起');
      cancelFinanceAI('已停止：行情面板已收起');
    }
    if (state.expanded && state.financeActive) refreshFinance(false);
    else scheduleRefresh();
  });
  document.addEventListener('notch:tabchange', (event) => {
    const active = event.detail?.tab === 'finance';
    if (!active) {
      cancelFinanceRequests('已停止：已离开行情页');
      cancelFinanceAI('已停止：已离开行情页');
    }
    if (active && !state.financeActive) {
      state.preferences = loadPreferences();
      state.currentView = state.preferences.defaultView;
      state.rankingMarket = state.preferences.defaultMarket;
      state.rankingSource = state.preferences.defaultSource;
      state.rankingSort = state.preferences.defaultRanking;
      state.rankingPage = 1;
      selectView(state.currentView, { load: false });
    }
    state.financeActive = active;
    if (active && state.expanded) refreshFinance(false);
    else scheduleRefresh();
  });

  state.currentView = state.preferences.defaultView;
  state.rankingMarket = state.preferences.defaultMarket;
  state.rankingSource = state.preferences.defaultSource;
  state.rankingSort = state.preferences.defaultRanking;
  state.rankingPage = 1;
  render();
  selectSettingsSection('crypto');
  selectView(state.currentView, { load: false });
  loadProviderSettings();

  window.financePanel = {
    render,
    refresh: () => refreshFinance(true),
    selectView,
    onViewChange(active) {
      if (active) refreshFinance(false);
      else {
        cancelFinanceRequests('已停止：已离开行情页');
        cancelFinanceAI('已停止：已离开行情页');
        scheduleRefresh();
      }
    },
    onPanelStateChange(expanded) {
      state.expanded = Boolean(expanded);
      if (state.expanded && panel.classList.contains('active')) refreshFinance(false);
      else {
        cancelFinanceRequests('已停止：行情面板已收起');
        cancelFinanceAI('已停止：行情面板已收起');
        scheduleRefresh();
      }
    },
  };
})();
