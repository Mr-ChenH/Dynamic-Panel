(() => {
  function createController({ getState, getElements, currentList, escapeHtml, marketLabel, errorLabel, formatTime, formatQuotePrice, formatPercent, changeClass, renderChartCanvas, emptyState, renderDetail, drawAllCharts }) {
    if (typeof getState !== 'function' || typeof getElements !== 'function') throw new TypeError('finance watchlist host is required');

    function renderListSelect() {
      const state = getState();
      const elements = getElements();
      if (!elements.listSelect) return;
      if (!state.watchlists.lists.some((list) => list.id === state.currentListId)) state.currentListId = 'all';
      elements.listSelect.innerHTML = state.watchlists.lists.map((list) => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}</option>`).join('');
      elements.listSelect.value = state.currentListId;
    }

    function sortedAssets() {
      const state = getState();
      const elements = getElements();
      const list = currentList();
      const assets = list.assetIds.map((assetId) => state.watchlists.assets[assetId]).filter(Boolean);
      if (elements.sort?.value === 'name') assets.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      if (elements.sort?.value === 'change') assets.sort((left, right) => (state.quotes.get(right.id)?.changePercent ?? -Infinity) - (state.quotes.get(left.id)?.changePercent ?? -Infinity));
      return assets;
    }

    function selectedDetailAsset() {
      const state = getState();
      if (state.detailAsset?.id === state.selectedAssetId) return state.detailAsset;
      return state.watchlists.assets[state.selectedAssetId] || null;
    }

    function selectedDetailQuote() {
      const state = getState();
      if (state.quotes.has(state.selectedAssetId)) return state.quotes.get(state.selectedAssetId);
      return state.detailQuote?.asset?.id === state.selectedAssetId ? state.detailQuote : null;
    }

    function render() {
      const state = getState();
      const elements = getElements();
      renderListSelect();
      const assets = sortedAssets();
      elements.resultCount.textContent = `${assets.length} 个标的`;
      const quoteHead = '<div class="finance-quotes-head" aria-hidden="true"><span></span><span>标的</span><span>7 日走势</span><span>最新报价</span><span>事件</span></div>';
      if (!assets.length) {
        elements.quotes.innerHTML = quoteHead + emptyState('当前分组为空', '在设置中搜索真实标的并加入自选');
        if (selectedDetailAsset()) renderDetail();
        else elements.detail.innerHTML = '<div class="finance-detail-empty">没有可查看的标的</div>';
        return;
      }
      if (!selectedDetailAsset() && !assets.some((asset) => asset.id === state.selectedAssetId)) state.selectedAssetId = assets[0].id;
      elements.quotes.innerHTML = quoteHead + assets.map((asset) => {
        const quote = state.quotes.get(asset.id);
        const unavailable = state.unavailableQuotes.get(asset.id);
        const selected = asset.id === state.selectedAssetId;
        const label = `${asset.name} ${asset.symbol}`;
        if (!quote) return `<button type="button" class="finance-quote${selected ? ' selected' : ''}" data-finance-asset="${escapeHtml(asset.id)}" role="listitem" aria-pressed="${String(selected)}" aria-label="${escapeHtml(label)}"><span class="finance-asset-mark ${escapeHtml(asset.market)}">${escapeHtml(asset.symbol.slice(0, 2))}</span><span class="finance-quote-name"><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.symbol)} · ${escapeHtml(marketLabel(asset.market))}</span></span><span></span><span class="finance-quote-value"><strong>--</strong><span>${escapeHtml(errorLabel(unavailable || 'quote_unavailable'))}</span></span><em>--</em></button>`;
        return `<button type="button" class="finance-quote${selected ? ' selected' : ''}" data-finance-asset="${escapeHtml(asset.id)}" role="listitem" aria-pressed="${String(selected)}" aria-label="${escapeHtml(label)}"><span class="finance-asset-mark ${escapeHtml(asset.market)}">${escapeHtml(asset.symbol.slice(0, 2))}</span><span class="finance-quote-name"><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.symbol)} · ${escapeHtml(quote.feed)}</span></span>${renderChartCanvas(asset.id, quote.sparkline, 'finance-sparkline', `${asset.symbol} 7 日走势`)}<span class="finance-quote-value"><strong>${escapeHtml(formatQuotePrice(quote))}</strong><span class="${changeClass(quote.changePercent)}">${escapeHtml(formatPercent(quote.changePercent))}</span></span><em>${escapeHtml(formatTime(quote.eventAt))}</em></button>`;
      }).join('');
      renderDetail();
      requestAnimationFrame(drawAllCharts);
    }

    return Object.freeze({ renderListSelect, sortedAssets, selectedDetailAsset, selectedDetailQuote, render });
  }

  window.NotchFinanceWatchlist = Object.freeze({ createController });
})();
