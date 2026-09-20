(function exposeFinanceViewDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchFinanceViewDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFinanceViewDomain() {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function formatPrice(value, currency = 'USD') {
    if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    const maximumFractionDigits = Math.abs(number) < 1 ? 6 : 2;
    try {
      return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits }).format(number);
    } catch (error) {
      return number.toLocaleString('zh-CN', { maximumFractionDigits });
    }
  }

  function formatQuotePrice(quote) {
    if (quote?.asset?.currency === 'USDT') {
      const number = Number(quote.price);
      return Number.isFinite(number) ? `${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(number) < 1 ? 6 : 2 })} USDT` : '--';
    }
    return formatPrice(quote?.price, quote?.asset?.currency || 'USD');
  }

  function formatCompact(value) {
    if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(number);
  }

  function formatPercent(value) {
    if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
  }

  function formatTime(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return '--';
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp);
  }

  function changeClass(value) {
    if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return '';
    const number = Number(value);
    return Number.isFinite(number) && number < 0 ? 'down' : 'up';
  }

  function emptyState(title, detail = '') {
    return `<div class="finance-empty-state"><strong>${escapeHtml(title)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
  }

  function providerStateLabel(provider) {
    const labels = {
      ready: '可用', disabled: '已停用', missing_credentials: '缺少凭据', not_available: '未配置',
      available: '可用', available_without_summary: '已连接', stale: '缓存', error: '错误',
    };
    return labels[provider?.state] || '未知';
  }

  function overviewMarkets(result, definitions, providers = []) {
    const markets = Array.isArray(result?.markets) ? result.markets : [];
    const availableProviders = Array.isArray(result?.providers) ? result.providers : providers;
    return definitions.map((definition) => {
      const reported = markets.find((market) => market?.market === definition.market);
      if (reported) return { ...definition, ...reported };
      const candidates = definition.providerIds.map((id) => availableProviders.find((provider) => provider?.id === id)).filter(Boolean);
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

  function renderChartCanvas(assetId, values, className = 'finance-sparkline', label = '实际价格序列') {
    const numbers = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
    if (numbers.length < 2) return '';
    return `<canvas class="${className}" data-finance-chart-asset="${escapeHtml(assetId)}" role="img" aria-label="${escapeHtml(label)}"></canvas>`;
  }

  function chartColor(values) {
    const first = Number(values?.[0]);
    const last = Number(values?.[values.length - 1]);
    return Number.isFinite(first) && Number.isFinite(last) && last < first ? '#ff8d82' : '#59d792';
  }

  function seriesChange(values) {
    const first = Number(values?.[0]);
    const last = Number(values?.[values.length - 1]);
    return Number.isFinite(first) && Number.isFinite(last) && first !== 0 ? (last - first) / first * 100 : null;
  }

  return Object.freeze({
    escapeHtml,
    formatPrice,
    formatQuotePrice,
    formatCompact,
    formatPercent,
    formatTime,
    changeClass,
    emptyState,
    providerStateLabel,
    overviewMarkets,
    errorLabel,
    renderChartCanvas,
    chartColor,
    seriesChange,
  });
});
