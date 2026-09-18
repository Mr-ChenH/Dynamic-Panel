function registerAiIpc({
  ipcMain,
  crypto,
  getAIService,
  getProviderVerificationRevision,
  resolveTranscriptionConfig,
  resolveLlmConfig,
  testTranscriptionProvider,
  persistProviderVerification,
  readDiagnostics,
  clearDiagnostics,
  acknowledgeMigration,
  publicTranscriptionConfig,
}) {
  ipcMain.handle('ai:run', (event, payload) => getAIService().run(event.sender.id, payload));
  ipcMain.handle('ai:cancel', (event, requestId) => getAIService().cancel(event.sender.id, requestId));

  ipcMain.handle('ai:test-provider', async (event, payload) => {
    const slot = payload?.slot === 'transcription' ? 'transcription' : 'content';
    if (slot === 'transcription') {
      const expectedRevision = getProviderVerificationRevision(slot, resolveTranscriptionConfig());
      const result = await testTranscriptionProvider();
      try {
        if (!persistProviderVerification(slot, result, result.capabilities, expectedRevision)) return { ok: false, error: 'stale_context' };
      } catch (error) {}
      return result;
    }
    const expectedRevision = getProviderVerificationRevision(slot, resolveLlmConfig());
    const referenceTime = new Date().toISOString();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const service = getAIService();
    const textResult = await service.run(event.sender.id, {
      requestId: `connection-text-${crypto.randomUUID()}`,
      action: 'summarize',
      context: { sourceType: 'manual', sourceId: '', sourceRevision: '', text: '连接测试：请只回复“已连接”。' },
      referenceTime,
      timeZone,
      categories: {},
    });
    if (!textResult.ok) {
      try {
        if (!persistProviderVerification(slot, textResult, null, expectedRevision)) return { ok: false, error: 'stale_context' };
      } catch (error) {}
      return textResult;
    }
    const structuredResult = await service.run(event.sender.id, {
      requestId: `connection-json-${crypto.randomUUID()}`,
      action: 'nameLink',
      context: { sourceType: 'link', sourceId: 'connection-test', sourceRevision: '', text: 'URL: https://example.com\n网页标题: Example' },
      referenceTime,
      timeZone,
      categories: {},
    });
    const result = structuredResult.ok
      ? { ok: true, capabilities: { text: true, stream: true, structuredJson: true }, promptVersion: structuredResult.promptVersion }
      : { ...structuredResult, error: 'structured_output_unsupported', providerError: structuredResult.error };
    try {
      if (!persistProviderVerification(slot, result, result.capabilities, expectedRevision)) return { ok: false, error: 'stale_context' };
    } catch (error) {}
    return result;
  });

  ipcMain.handle('ai:get-diagnostics', () => ({ ok: true, items: readDiagnostics() }));
  ipcMain.handle('ai:clear-diagnostics', () => clearDiagnostics());
  ipcMain.handle('ai:ack-migration', () => {
    try {
      acknowledgeMigration();
      return { ok: true, ...publicTranscriptionConfig() };
    } catch (error) {
      return { ok: false, error: 'save_failed' };
    }
  });
}

module.exports = { registerAiIpc };
