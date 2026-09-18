function createFinanceBackgroundRefresh({
  getFinanceService,
  getMainWindow,
  readAppSettings,
  readFinanceSettings,
  isQuitting,
  sendUpdate,
  logWarning = console.warn,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  now = () => Date.now(),
}) {
  let timer = null;
  let active = false;
  let pending = false;
  let interval = 60;
  let generation = 0;
  let sequence = 0;
  let requestId = '';
  let payload = { assetIds: [], rankingMarket: 'all', rankingSource: 'coingecko', rankingSort: 'gainers', rankingPage: 1 };

  function issueCode(value) {
    const code = String(value?.error || value?.warning || value?.code || value?.message || value || '').trim().slice(0, 80);
    return /^[a-z0-9_,:-]+$/i.test(code) ? code : 'network_error';
  }

  function issues(snapshot) {
    const result = [];
    for (const warning of Array.isArray(snapshot?.overview?.warnings) ? snapshot.overview.warnings : []) {
      result.push(`${String(warning?.provider || 'overview').slice(0, 32)}:${issueCode(warning)}`);
    }
    for (const [key, value] of Object.entries(snapshot?.rankings || {})) {
      if (!value) result.push(`${key}:request_failed`);
      else if (value.ok === false || value.error) result.push(`${key}:${issueCode(value)}`);
      else if ((!Array.isArray(value.rows) || !value.rows.length) && value.unavailable) result.push(`${key}:${issueCode(value.unavailable)}`);
      else if ((!Array.isArray(value.rows) || !value.rows.length) && value.warning) result.push(`${key}:${issueCode(value.warning)}`);
    }
    return [...new Set(result)].slice(0, 16);
  }

  function clearTimer() {
    if (timer) clearTimeoutImpl(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!active || interval <= 0 || isQuitting()) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      void refresh();
    }, interval * 1000);
    timer.unref?.();
  }

  async function refresh({ allowInactive = false } = {}) {
    if ((!active && !allowInactive) || pending || isQuitting()) return;
    const currentGeneration = generation;
    const currentRequestId = `finance-background-${currentGeneration}-${++sequence}`;
    requestId = currentRequestId;
    pending = true;
    const startedAt = now();
    try {
      const snapshot = await getFinanceService().prefetch({ ...payload, requestId: currentRequestId });
      const foundIssues = issues(snapshot);
      if (foundIssues.length) logWarning(`[finance] Background refresh ${currentRequestId} completed with issues after ${now() - startedAt}ms: ${foundIssues.join(', ')}`);
      const window = getMainWindow();
      if (currentGeneration === generation && (active || allowInactive) && window && !window.isDestroyed()) sendUpdate(window, snapshot);
    } catch (error) {
      const code = issueCode(error);
      if (code !== 'cancelled') logWarning(`[finance] Background refresh ${currentRequestId} failed after ${now() - startedAt}ms: ${code}`);
    } finally {
      if (requestId === currentRequestId) requestId = '';
      pending = false;
      if (currentGeneration === generation && active) schedule();
      else if (active && !isQuitting()) void refresh();
    }
  }

  function cancelCurrent() {
    generation += 1;
    if (requestId) getFinanceService().cancel(requestId);
  }

  function setActivity(next = {}) {
    const nextActive = next.active === true;
    const startupPrefetch = next.prefetch === true && readAppSettings().features?.finance !== false;
    const nextInterval = [0, 30, 60, 120, 300].includes(Number(next.refreshSeconds))
      ? Number(next.refreshSeconds) : readFinanceSettings().refreshSeconds;
    const nextPayload = {
      assetIds: Array.isArray(next.assetIds) ? [...new Set(next.assetIds.map((value) => String(value).trim().slice(0, 240)).filter(Boolean))].slice(0, 100) : [],
      rankingMarket: ['all', 'crypto', 'binance', 'us', 'cn'].includes(next.rankingMarket) ? next.rankingMarket : 'all',
      rankingSource: ['coingecko', 'binance'].includes(next.rankingSource) ? next.rankingSource : 'coingecko',
      rankingSort: ['gainers', 'losers', 'market_cap', 'volume'].includes(next.rankingSort) ? next.rankingSort : 'gainers',
      rankingPage: Math.max(1, Math.min(200, Math.floor(Number(next.rankingPage) || 1))),
    };
    const payloadChanged = JSON.stringify(nextPayload) !== JSON.stringify(payload);
    const changed = nextActive !== active || nextInterval !== interval || payloadChanged;
    active = nextActive;
    interval = nextInterval;
    payload = nextPayload;
    if (!active) {
      cancelCurrent();
      clearTimer();
      if (startupPrefetch) void refresh({ allowInactive: true });
      return { ok: true, active: false, refreshSeconds: interval, prefetching: startupPrefetch };
    }
    if (payloadChanged && pending) cancelCurrent();
    schedule();
    if (interval > 0 && (changed || !pending)) void refresh();
    return { ok: true, active: true, refreshSeconds: interval };
  }

  function updateInterval(value) {
    const nextInterval = [0, 30, 60, 120, 300].includes(Number(value)) ? Number(value) : null;
    if (nextInterval === null) return { ok: false, error: 'invalid_refresh_interval' };
    interval = nextInterval;
    schedule();
    if (active && nextInterval > 0) void refresh();
    return { ok: true, refreshSeconds: interval };
  }

  function invalidate() {
    if (!active) return;
    cancelCurrent();
    void refresh();
  }

  function dispose() {
    cancelCurrent();
    active = false;
    clearTimer();
  }

  return { refresh, setActivity, updateInterval, invalidate, dispose, issueCode, issues, getState: () => ({ active, pending, interval, requestId, payload: { ...payload } }) };
}

module.exports = { createFinanceBackgroundRefresh };
