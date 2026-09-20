(() => {
  function createController({ getState, getElements, overviewMarkets, emptyState, escapeHtml, providerStateLabel, errorLabel, formatCompact, formatQuotePrice, formatPercent, changeClass, marketLabel }) {
    if (typeof getState !== 'function' || typeof getElements !== 'function') throw new TypeError('finance overview host is required');

    function rankingRows(result, market = '') {
      const featured = market && Array.isArray(result?.featured?.[market]) ? result.featured[market] : null;
      const featuredMarkets = !market && result?.featured && typeof result.featured === 'object'
        ? Object.values(result.featured).flatMap((rows) => Array.isArray(rows) ? rows : [])
        : null;
      const rows = featured || featuredMarkets || (Array.isArray(result?.rows) ? result.rows : []);
      return market ? rows.filter((quote) => quote?.asset?.market === market) : rows;
    }

    function quotes() {
      const state = getState();
      return [
        ...rankingRows(state.overviewLeaders),
        ...rankingRows(state.overviewLosers),
        ...rankingRows(state.overviewVolume),
      ].filter((quote, index, source) => quote?.asset?.id && source.findIndex((item) => item?.asset?.id === quote.asset.id) === index);
    }

    function marketFocusRows(market) {
      const state = getState();
      const groups = [
        ['领涨', rankingRows(state.overviewLeaders, market)],
        ['领跌', rankingRows(state.overviewLosers, market)],
        ['活跃', rankingRows(state.overviewVolume, market)],
      ];
      const rows = [];
      groups.forEach(([role, group]) => {
        group.slice(0, 2).forEach((quote) => {
          if (!quote?.asset?.id || rows.some((item) => item.asset.id === quote.asset.id)) return;
          rows.push({ ...quote, overviewRole: role });
        });
      });
      return rows.slice(0, 6);
    }

    function marketEmptyDetail(market) {
      const status = overviewMarkets(getState().overview).find((item) => item.market === market);
      if (!status || status.state === 'not_available') return '尚未配置该市场的数据源';
      if (status.state === 'disabled') return '该市场数据源已停用';
      if (status.state === 'missing_credentials') return '该市场数据源缺少凭据';
      if (status.state === 'error') return errorLabel(status.error);
      return '当前 provider 未返回可用榜单';
    }

    function renderMovers(container, rows, emptyDetail = '当前数据源未返回对应榜单') {
      if (!container) return;
      const state = getState();
      const visibleRows = Array.isArray(rows) ? rows.slice(0, 6) : [];
      if (!visibleRows.length) {
        container.innerHTML = emptyState('暂无可用数据', emptyDetail);
        return;
      }
      container.innerHTML = visibleRows.map((quote) => {
        const id = quote.id || quote.asset.id;
        const hasSeries = Array.isArray(quote.sparkline) && quote.sparkline.length > 1;
        const primary = quote.overviewRole === '活跃' ? formatCompact(quote.volume24h) : formatQuotePrice(quote);
        const primaryLabel = quote.overviewRole === '活跃' ? '成交额' : '最新价';
        const chartAttributes = hasSeries ? ` data-finance-benchmark="${escapeHtml(id)}" aria-pressed="${String(id === state.overviewChartAssetId)}"` : '';
        const actionLabel = hasSeries ? '切换主图' : '打开详情';
        const context = [quote.overviewRole, quote.asset.symbol].filter(Boolean).join(' · ');
        return `<button type="button" class="finance-overview-leader" data-finance-overview-asset="${escapeHtml(id)}"${chartAttributes} aria-label="${actionLabel}：${escapeHtml(quote.asset.name)}"><span><strong>${escapeHtml(quote.asset.name)}</strong><small>${escapeHtml(context)}</small></span><span class="finance-mover-value"><small>${primaryLabel}</small><b>${escapeHtml(primary)}</b></span><em class="${changeClass(quote.changePercent)}">${escapeHtml(formatPercent(quote.changePercent))}</em></button>`;
      }).join('');
    }

    function renderMarketSummaries(result, rows) {
      const elements = getElements();
      if (!elements.overviewMarketSummaries) return;
      elements.overviewMarketSummaries.innerHTML = overviewMarkets(result).map((market) => {
        const marketRows = rows.filter((quote) => quote.asset.market === market.market && Number.isFinite(Number(quote.changePercent)));
        const positive = marketRows.filter((quote) => Number(quote.changePercent) > 0.05).length;
        const negative = marketRows.filter((quote) => Number(quote.changePercent) < -0.05).length;
        const isCryptoAggregate = market.market === 'crypto' && result.crypto;
        const primary = isCryptoAggregate ? formatCompact(result.crypto.marketCap) : marketRows.length ? `${marketRows.length} 个标的` : providerStateLabel(market);
        const change = isCryptoAggregate ? `<em class="${changeClass(result.crypto.changePercent24h)}">${escapeHtml(formatPercent(result.crypto.changePercent24h))}</em>` : '';
        const detail = marketRows.length ? `上涨 ${positive} · 下跌 ${negative}` : marketEmptyDetail(market.market);
        return `<article class="finance-market-summary" data-market="${escapeHtml(market.market)}"><header><strong>${escapeHtml(market.label)}</strong><span>${escapeHtml(providerStateLabel(market))}</span></header><div><b>${escapeHtml(primary)}</b>${change}</div><footer><span>${escapeHtml(detail)}</span><small>${escapeHtml(market.provider || '')}</small></footer></article>`;
      }).join('');
    }

    return Object.freeze({ quotes, rankingRows, marketFocusRows, marketEmptyDetail, renderMovers, renderMarketSummaries });
  }

  window.NotchFinanceOverview = Object.freeze({ createController });
})();
