(() => {
  function createController({ getState, getElements, escapeHtml, marketLabel }) {
    if (typeof getState !== 'function' || typeof getElements !== 'function') throw new TypeError('finance settings host is required');

    function renderPreferences() {
      const state = getState();
      const elements = getElements();
      if (elements.defaultView) elements.defaultView.value = state.preferences.defaultView;
      if (elements.defaultMarket) elements.defaultMarket.value = state.preferences.defaultMarket;
      if (elements.defaultSource) elements.defaultSource.value = state.preferences.defaultSource;
      if (elements.defaultRanking) elements.defaultRanking.value = state.preferences.defaultRanking;
      if (elements.refreshInterval) elements.refreshInterval.value = String(state.preferences.refreshSeconds);
    }

    function renderWatchlists() {
      const state = getState();
      const elements = getElements();
      const selected = state.watchlists.lists.some((list) => list.id === elements.settingsTargetList?.value) ? elements.settingsTargetList.value : state.currentListId;
      if (elements.settingsTargetList) {
        elements.settingsTargetList.innerHTML = state.watchlists.lists.map((list) => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}</option>`).join('');
        elements.settingsTargetList.value = state.watchlists.lists.some((list) => list.id === selected) ? selected : 'all';
      }
      if (!elements.settingsWatchlistList) return;
      elements.settingsWatchlistList.innerHTML = state.watchlists.lists.map((list) => `<section class="finance-settings-watchlist" data-finance-settings-list="${escapeHtml(list.id)}"><header><div><strong>${escapeHtml(list.name)}</strong><small>${list.assetIds.length} 个标的</small></div><span>${list.id === 'all' ? '' : `<button type="button" data-finance-rename-list="${escapeHtml(list.id)}">重命名</button><button type="button" data-finance-delete-list="${escapeHtml(list.id)}">删除</button>`}</span></header><div class="finance-settings-assets">${list.assetIds.length ? list.assetIds.map((assetId) => { const asset = state.watchlists.assets[assetId]; return asset ? `<div class="finance-settings-asset"><span><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.symbol)} · ${escapeHtml(marketLabel(asset.market))}</small></span><button type="button" data-finance-remove-asset="${escapeHtml(asset.id)}" data-finance-remove-list="${escapeHtml(list.id)}">移除</button></div>` : ''; }).join('') : '<span class="finance-settings-empty">暂无标的</span>'}</div></section>`).join('');
    }

    function renderSearchResults(message = '') {
      const state = getState();
      const elements = getElements();
      if (!elements.settingsSearchResults) return;
      const notice = state.searchNotice ? `<div class="finance-search-notice">${escapeHtml(state.searchNotice)}</div>` : '';
      if (message) {
        elements.settingsSearchResults.hidden = false;
        elements.settingsSearchResults.innerHTML = `${notice}<div class="finance-settings-empty">${escapeHtml(message)}</div>`;
        return;
      }
      if (!state.searchResults.length) {
        elements.settingsSearchResults.hidden = !state.searchNotice;
        elements.settingsSearchResults.innerHTML = notice;
        return;
      }
      elements.settingsSearchResults.hidden = false;
      elements.settingsSearchResults.innerHTML = notice + state.searchResults.map((asset) => `<button type="button" class="finance-search-result" data-finance-search-result="${escapeHtml(asset.id)}"><span class="finance-asset-mark ${escapeHtml(asset.market)}">${escapeHtml(asset.symbol.slice(0, 2))}</span><span><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.symbol)} · ${escapeHtml(marketLabel(asset.market))} · ${escapeHtml(asset.exchange || asset.provider)}</small></span><b>选择</b></button>`).join('');
    }

    return Object.freeze({ renderPreferences, renderWatchlists, renderSearchResults });
  }

  window.NotchFinanceSettings = Object.freeze({ createController });
})();
