function registerFinanceIpc({
  ipcMain,
  getFinanceService,
  publicFinanceSettings,
  updateFinanceProvider,
  updateFinanceRefreshInterval,
  setFinanceBackgroundActivity,
  readFinanceSettings,
  writeFinanceSettings,
  isMainWindowSender,
}) {
  function financeRequestId(senderId, value) {
    const requestId = String(value || '').trim().slice(0, 120);
    return requestId ? `${senderId}:${requestId}` : '';
  }

  function financeRequestPayload(event, payload = {}) {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return { ...input, requestId: financeRequestId(event.sender.id, input.requestId) };
  }

  async function handleFinanceRequest(work) {
    try {
      return await work();
    } catch (error) {
      if (error?.code === 'cancelled' || error?.name === 'AbortError') {
        return { ok: false, error: 'cancelled' };
      }
      throw error;
    }
  }

  ipcMain.handle('finance:get-settings', () => publicFinanceSettings());
  ipcMain.handle('finance:set-provider', (_event, payload) => updateFinanceProvider(payload));
  ipcMain.handle('finance:set-refresh-interval', (_event, value) => updateFinanceRefreshInterval(value));
  ipcMain.handle('finance:set-activity', (event, payload) => {
    if (!isMainWindowSender(event.sender)) return { ok: false, error: 'forbidden' };
    return setFinanceBackgroundActivity(payload);
  });
  ipcMain.handle('finance:test-provider', async (_event, providerId) => {
    const id = String(providerId || '');
    const supported = ['coingecko', 'binance', 'alpha-vantage', 'alpaca', 'twelve-data', 'sec-edgar', 'cn-stock', 'cn-tencent', 'cn-eastmoney', 'cn-sina'];
    if (!supported.includes(id)) return { ok: false, error: 'invalid_provider' };
    const result = await getFinanceService().testProvider(id);
    const current = readFinanceSettings();
    const providers = { ...current.providers };
    providers[id] = {
      ...providers[id],
      verification: {
        state: result.ok ? 'verified' : 'failed',
        verifiedAt: new Date().toISOString(),
        error: result.ok ? '' : String(result.error || 'unknown').slice(0, 80),
        capabilities: result.ok && result.capabilities && typeof result.capabilities === 'object' ? result.capabilities : null,
      },
    };
    writeFinanceSettings({ schemaVersion: 2, refreshSeconds: current.refreshSeconds, providers });
    return { ...result, settings: publicFinanceSettings() };
  });
  ipcMain.handle('finance:refresh', () => {
    getFinanceService().clearCache();
    return { ok: true };
  });
  ipcMain.handle('finance:overview', (event, payload) => handleFinanceRequest(() => getFinanceService().overview(financeRequestPayload(event, payload))));
  ipcMain.handle('finance:ranking', (event, payload) => handleFinanceRequest(() => getFinanceService().ranking(financeRequestPayload(event, payload))));
  ipcMain.handle('finance:quotes', (event, payload) => handleFinanceRequest(() => getFinanceService().quotes(financeRequestPayload(event, payload))));
  ipcMain.handle('finance:history', (event, payload) => handleFinanceRequest(() => getFinanceService().history(financeRequestPayload(event, payload))));
  ipcMain.handle('finance:fundamentals', (event, payload) => handleFinanceRequest(() => getFinanceService().fundamentals(financeRequestPayload(event, payload))));
  ipcMain.handle('finance:search', (event, payload) => handleFinanceRequest(() => getFinanceService().search(financeRequestPayload(event, payload))));
  ipcMain.handle('finance:cancel', (event, requestId) => getFinanceService().cancel(financeRequestId(event.sender.id, requestId)));

  return { handleFinanceRequest, financeRequestId, financeRequestPayload };
}

module.exports = { registerFinanceIpc };
