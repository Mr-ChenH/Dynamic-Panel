(() => {
  function createController({ getState, getElements, rankingPageSize, renderProviderSummary, emptyState, marketLabel, sourceLabel, errorLabel, formatTime, formatQuotePrice, formatCompact, formatPercent, changeClass, escapeHtml, renderChartCanvas, drawAllCharts }) {
    if (typeof getState !== 'function' || typeof getElements !== 'function') throw new TypeError('finance ranking host is required');

    function renderPagination(result) {
      const state = getState();
      const elements = getElements();
      if (!elements.rankingPagination) return;
      if (!result) {
        elements.rankingPagination.hidden = true;
        return;
      }
      const hasKnownPageCount = Number.isFinite(Number(result.totalPages));
      const totalPages = hasKnownPageCount ? Math.max(1, Number(result.totalPages)) : Math.max(1, state.rankingPage);
      const page = Math.max(1, Math.min(totalPages, Number(result.page || state.rankingPage) || 1));
      state.rankingPage = page;
      const totalRows = Math.max(0, Number(result.totalRows ?? result.counts?.total ?? 0) || 0);
      const pageSize = Math.max(1, Number(result.pageSize) || rankingPageSize);
      const start = totalRows ? (page - 1) * pageSize + 1 : 0;
      const end = totalRows ? Math.min(totalRows, page * pageSize) : 0;
      elements.rankingPagination.hidden = !result.ok || Boolean(result.unavailable) || totalPages <= 1;
      elements.rankingPrevious.disabled = page <= 1;
      elements.rankingNext.disabled = page >= totalPages;
      elements.rankingPageLabel.textContent = totalPages > 1 ? `第 ${page} / ${totalPages} 页 · ${start}-${end} / ${totalRows}` : '第 1 页';
    }

    function render() {
      const state = getState();
      const elements = getElements();
      const sourceVisible = ['all', 'crypto'].includes(state.rankingMarket);
      if (elements.rankingSourceLabel) elements.rankingSourceLabel.hidden = !sourceVisible;
      if (elements.rankingSource) elements.rankingSource.value = state.rankingSource;
      document.querySelectorAll('[data-finance-market]').forEach((button) => {
        const active = button.dataset.financeMarket === state.rankingMarket;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      if (elements.rankingSort) elements.rankingSort.value = state.rankingSort;
      const sortLabels = { gainers: '24h 涨幅', losers: '24h 跌幅', market_cap: '市值', volume: '24h 成交额' };
      const sortLabel = (value) => sortLabels[value] || '当前排序';
      const activeSource = state.rankingSource;
      const rankingScopeLabel = (market, source = activeSource) => ['all', 'crypto'].includes(market) ? `${marketLabel(market)} · ${sourceLabel(source)}` : marketLabel(market);
      const setSummary = (title, subtitle, metrics = {}) => {
        if (elements.rankingTitle) elements.rankingTitle.textContent = title;
        if (elements.rankingSubtitle) elements.rankingSubtitle.textContent = subtitle;
        if (elements.rankingTotal) elements.rankingTotal.textContent = metrics.total ?? '--';
        if (elements.rankingPositive) elements.rankingPositive.textContent = metrics.positive ?? '--';
        if (elements.rankingNegative) elements.rankingNegative.textContent = metrics.negative ?? '--';
        if (elements.rankingFlat) elements.rankingFlat.textContent = metrics.flat ?? '--';
      };
      const emptySpotlight = (title, detail) => {
        if (elements.rankingSpotlight) {
          delete elements.rankingSpotlight.dataset.count;
          elements.rankingSpotlight.innerHTML = emptyState(title, detail);
        }
      };
      const result = state.ranking;
      renderPagination(result);
      if (!result) {
        setSummary(`${rankingScopeLabel(state.rankingMarket)} · ${sortLabel(state.rankingSort)}`, '正在连接数据源，榜单仅展示 provider 返回的资产', {});
        elements.rankingState.textContent = '正在读取数据源';
        emptySpotlight('正在获取榜单');
        elements.rankingList.innerHTML = emptyState('正在获取榜单');
        return;
      }
      renderProviderSummary(result.providers);
      const source = result.source || (result.market === 'binance' ? 'binance' : activeSource);
      const providers = result.providers || [];
      const provider = (['crypto', 'all'].includes(result.market)
        ? providers.find((item) => item.id === source)
        : result.market === 'us'
          ? providers.find((item) => item.market === 'us' && item.state === 'ready')
          : result.market === 'cn'
            ? providers.find((item) => (item.id === `cn-${source}` || source === 'quantdash' && item.id === 'cn-stock') && item.state === 'ready') || providers.find((item) => item.market === 'cn' && item.state === 'ready')
            : providers.find((item) => item.market === result.market && item.state === 'ready'));
      const providerText = provider ? `${provider.label}${provider.feed ? ` · ${provider.feed}` : ''}` : ['crypto', 'all'].includes(result.market) ? sourceLabel(source) : '当前数据源';
      const coverageLabels = {
        coingecko_top_100_market_cap: 'CoinGecko 前 100 个市值资产样本',
        quantdash_cn_stock_universe: 'QuantDash CN_Stock 全市场池',
        eastmoney_cn_stock_ranked_page: '东方财富公开 A 股排序页',
      };
      const coverageText = (Array.isArray(result.coverage) ? result.coverage : []).map((value) => coverageLabels[value]).filter(Boolean).join(' · ');
      setSummary(`${rankingScopeLabel(result.market, source)} · ${sortLabel(result.sort)}`, `${providerText} · ${result.stale ? '缓存快照' : '当前快照'} · ${coverageText || '只统计 provider 返回结果'}`);
      if (result.retrievedAt) elements.updated.textContent = `取回 ${formatTime(result.retrievedAt)}`;
      if (result.unavailable) {
        const message = errorLabel(result.unavailable);
        setSummary(`${rankingScopeLabel(result.market, source)} · ${sortLabel(result.sort)}`, `${message} · 请在设置中检查可用数据源`, { total: '—', positive: '—', negative: '—', flat: '—' });
        elements.rankingState.textContent = message;
        emptySpotlight(`${rankingScopeLabel(result.market, source)}榜单不可用`, message);
        elements.rankingList.innerHTML = emptyState(`${marketLabel(result.market)}榜单不可用`, message);
        return;
      }
      if (!result.ok) {
        const message = errorLabel(result.error);
        setSummary('榜单获取失败', `${message} · 可手动刷新重试`, { total: '—', positive: '—', negative: '—', flat: '—' });
        elements.rankingState.textContent = message;
        emptySpotlight('榜单获取失败', message);
        elements.rankingList.innerHTML = emptyState('榜单获取失败', message);
        return;
      }
      const rows = Array.isArray(result.rows) ? result.rows : [];
      const changeRows = rows.filter((quote) => quote.changePercent !== null && quote.changePercent !== undefined && Number.isFinite(Number(quote.changePercent)));
      const counts = result.counts || {};
      const countsComplete = result.countsComplete !== false;
      const positive = !countsComplete ? '—' : Number.isFinite(Number(counts.positive)) ? counts.positive : changeRows.filter((quote) => quote.changePercent > 0.05).length;
      const negative = !countsComplete ? '—' : Number.isFinite(Number(counts.negative)) ? counts.negative : changeRows.filter((quote) => quote.changePercent < -0.05).length;
      const flat = !countsComplete ? '—' : Number.isFinite(Number(counts.flat)) ? counts.flat : Math.max(0, changeRows.length - positive - negative);
      const totalRows = Number.isFinite(Number(result.totalRows)) ? result.totalRows : Number(counts.total) || rows.length;
      const page = Number(result.page) || state.rankingPage;
      const totalPages = Number(result.totalPages) || 1;
      setSummary(`${rankingScopeLabel(result.market, source)} · ${sortLabel(result.sort)}`, `${providerText} · ${result.stale ? '缓存快照' : '当前快照'} · ${coverageText || 'provider 返回集合'} · 第 ${page}/${totalPages} 页 · 取回 ${formatTime(result.retrievedAt)}`, { total: totalRows, positive, negative, flat });
      elements.rankingState.textContent = `${rows.length} 个标的 · 第 ${page}/${totalPages} 页 · ${countsComplete ? 'provider 返回集合' : '上游标的总数'} ${totalRows} 个${result.stale ? ' · 缓存数据' : ''}${result.warning ? ` · ${errorLabel(result.warning)}` : ''}`;
      if (!rows.length) {
        emptySpotlight('暂无榜单数据', '当前只显示已连接且支持榜单的 provider');
        elements.rankingList.innerHTML = emptyState('暂无榜单数据', '当前只显示已连接且支持榜单的 provider');
        return;
      }
      const maxAbsChange = Math.max(...changeRows.map((quote) => Math.abs(Number(quote.changePercent))), 0);
      const changeWidth = (value) => maxAbsChange > 0 && Number.isFinite(Number(value)) ? Math.min(100, Math.abs(Number(value)) / maxAbsChange * 100) : 0;
      rows.forEach((quote) => {
        if (quote?.asset?.id && Array.isArray(quote.sparkline) && quote.sparkline.length > 1) state.chartSeries.set(quote.asset.id, quote.sparkline);
      });
      if (elements.rankingSpotlight) {
        elements.rankingSpotlight.dataset.count = String(Math.min(3, rows.length));
        elements.rankingSpotlight.innerHTML = rows.slice(0, 3).map((quote, index) => { const rank = (page - 1) * (Number(result.pageSize) || rankingPageSize) + index + 1; return `<button type="button" class="finance-ranking-spotlight-card" data-finance-ranking-asset="${escapeHtml(quote.asset.id)}" aria-label="查看 ${escapeHtml(quote.asset.name)} 详情"><div class="finance-ranking-spotlight-rank"><strong>${String(rank).padStart(2, '0')}</strong><span>${escapeHtml(sortLabel(result.sort))}</span></div><div class="finance-ranking-spotlight-asset"><strong>${escapeHtml(quote.asset.name)}</strong><small>${escapeHtml(quote.asset.symbol)} · ${escapeHtml(marketLabel(quote.asset.market))}${quote.marketCapRank ? ` · 市值 #${escapeHtml(quote.marketCapRank)}` : ''}</small></div><div class="finance-ranking-spotlight-value"><b>${escapeHtml(formatQuotePrice(quote))}</b><em class="${changeClass(quote.changePercent)}">${escapeHtml(formatPercent(quote.changePercent))}</em></div><div class="finance-ranking-change-track" aria-hidden="true"><i class="${changeClass(quote.changePercent)}" style="width:${changeWidth(quote.changePercent)}%"></i></div></button>`; }).join('');
      }
      const heading = '<div class="finance-ranking-head" role="row"><span role="columnheader">#</span><span role="columnheader">标的</span><span role="columnheader">最新价</span><span role="columnheader">24h</span><span role="columnheader">7 日走势</span><span role="columnheader">市值</span><span role="columnheader">成交额</span><span role="columnheader">来源</span></div>';
      elements.rankingList.innerHTML = heading + rows.map((quote, index) => { const rank = (page - 1) * (Number(result.pageSize) || rankingPageSize) + index + 1; return `<button type="button" class="finance-ranking-row" role="row" data-finance-ranking-asset="${escapeHtml(quote.asset.id)}" aria-label="查看 ${escapeHtml(quote.asset.name)} ${escapeHtml(quote.asset.symbol)} 详情"><span class="finance-ranking-index" role="cell">${rank}</span><span class="finance-ranking-asset" role="cell"><strong>${escapeHtml(quote.asset.name)}</strong><small>${escapeHtml(quote.asset.symbol)} · ${escapeHtml(marketLabel(quote.asset.market))}${quote.marketCapRank ? ` · 市值 #${escapeHtml(quote.marketCapRank)}` : ''}</small></span><b role="cell">${escapeHtml(formatQuotePrice(quote))}</b><em class="${changeClass(quote.changePercent)}" role="cell">${escapeHtml(formatPercent(quote.changePercent))}</em><span role="cell">${renderChartCanvas(quote.asset.id, quote.sparkline, 'finance-ranking-sparkline', `${quote.asset.symbol} 7 日走势`) || '<small class="finance-ranking-no-series">无序列</small>'}</span><span role="cell">${escapeHtml(formatCompact(quote.marketCap))}</span><span role="cell">${escapeHtml(formatCompact(quote.volume24h))}</span><span class="finance-ranking-feed" role="cell">${escapeHtml(quote.feed || '--')}</span></button>`; }).join('');
      requestAnimationFrame(drawAllCharts);
    }

    return Object.freeze({ renderPagination, render });
  }

  window.NotchFinanceRanking = Object.freeze({ createController });
})();
