function registerLinksIpc({
  ipcMain,
  inspectLink,
  getAIModelService,
  crypto,
  now = () => new Date().toISOString(),
  timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  inputLimit = 12_000,
}) {
  ipcMain.handle('links:inspect', (event, url) => inspectLink(url, event.sender.id));
  ipcMain.handle('smart:organize-material', async (event, payload) => {
    const text = String(payload && payload.text || '').trim();
    const kind = payload && payload.kind === 'note' ? 'note' : 'recording';
    const sourceId = String(payload && payload.sourceId || '').trim().slice(0, 100);
    const sourceRevision = crypto.createHash('sha256').update(`${kind}\0${sourceId}\0${text}`).digest('hex');
    if (!text) return { ok: false, error: 'empty_text' };
    if (text.length > inputLimit) return { ok: false, error: 'input_too_long', limit: inputLimit };
    const aiModelService = getAIModelService();
    if (!aiModelService) return { ok: false, error: 'not_configured' };
    return aiModelService.run(event.sender.id, {
      requestId: `legacy-${crypto.randomUUID()}`,
      action: kind === 'note' ? 'nameNote' : 'nameRecording',
      context: { sourceType: kind, sourceId: sourceId || sourceRevision, sourceRevision, text },
      referenceTime: now(),
      timeZone: timeZone(),
      categories: {},
    });
  });
}

module.exports = { registerLinksIpc };
