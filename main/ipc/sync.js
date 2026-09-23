'use strict';

function registerSyncIpc({ ipcMain, syncService, isMainWindowSender = () => false } = {}) {
  if (!ipcMain || !syncService) throw new TypeError('sync_ipc_dependencies_required');
  const guarded = (handler) => async (event, payload) => {
    if (!isMainWindowSender(event?.sender)) return { ok: false, error: { code: 'forbidden_sender' } };
    try { return await handler(payload); } catch (error) { return { ok: false, error: { code: String(error?.code || error?.message || 'unexpected_error').slice(0, 80), retryable: error?.retryable === true } }; }
  };
  const handle = (channel, handler) => ipcMain.handle(channel, guarded(handler));
  handle('sync:get-status', () => syncService.status());
  handle('sync:get-runtime-context', () => syncService.runtimeContext());
  handle('sync:test-connection', (payload) => syncService.testConnection(payload));
  handle('sync:save-binding', (payload) => syncService.saveBinding(payload));
  handle('sync:set-categories', (payload) => syncService.setCategories(payload?.categories || payload));
  handle('sync:pause', (payload) => syncService.pause(payload));
  handle('sync:run-now', () => syncService.runNow());
  handle('sync:enqueue', (payload) => syncService.enqueue(payload?.operation || payload));
  handle('sync:list-conflicts', (payload) => syncService.listConflicts(payload));
  handle('sync:resolve-conflict', (payload) => syncService.resolveConflict(payload));
  handle('sync:remove-binding', (payload) => syncService.removeBinding(payload));
  handle('sync:cancel-transfer', (payload) => syncService.cancelTransfer?.(payload?.transferId) || { ok: false, error: { code: 'transfer_unavailable' } });
  handle('sync:upload-object', (payload) => syncService.uploadObject(payload));
  handle('sync:download-object', (payload) => syncService.downloadObject(payload));
  handle('sync:first-sync-preview', (payload) => syncService.previewFirstSync(payload));
  handle('sync:first-sync-execute', (payload) => syncService.executeFirstSync(payload));
  handle('sync:first-sync-cancel', (payload) => syncService.cancelFirstSync(payload));
  handle('sync:category-clear-preview', (payload) => syncService.prepareCategoryClear(payload));
  handle('sync:category-clear-execute', (payload) => syncService.executeCategoryClear(payload));
  handle('sync:restore-deleted', (payload) => syncService.restoreDeleted(payload));
  return Object.freeze({ channels: Object.freeze(['sync:get-status', 'sync:get-runtime-context', 'sync:test-connection', 'sync:save-binding', 'sync:set-categories', 'sync:pause', 'sync:run-now', 'sync:enqueue', 'sync:list-conflicts', 'sync:resolve-conflict', 'sync:remove-binding', 'sync:cancel-transfer', 'sync:upload-object', 'sync:download-object', 'sync:first-sync-preview', 'sync:first-sync-execute', 'sync:first-sync-cancel', 'sync:category-clear-preview', 'sync:category-clear-execute', 'sync:restore-deleted']) });
}

module.exports = { registerSyncIpc };
