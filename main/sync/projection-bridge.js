'use strict';

const crypto = require('crypto');

function createProjectionBridge({ ipcMain, getMainWindow, isMainWindowSender, timeoutMs = 5 * 60 * 1000, randomUUID = crypto.randomUUID, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  if (!ipcMain?.on || typeof getMainWindow !== 'function' || typeof isMainWindowSender !== 'function') throw new TypeError('projection_bridge_dependencies_required');
  const pending = new Map();

  function onResult(event, message = {}) {
    if (!isMainWindowSender(event?.sender)) return;
    const row = pending.get(String(message.requestId || ''));
    if (!row) return;
    pending.delete(message.requestId);
    clearTimeoutImpl(row.timer);
    if (message.ok === true) row.resolve(message.result || { ok: true });
    else row.reject(Object.assign(new Error('renderer_projection_failed'), { code: String(message.error?.code || 'renderer_projection_failed').slice(0, 80), retryable: true }));
  }

  ipcMain.on('sync:projection-result', onResult);

  function applyRemoteBatch(batch) {
    const window = getMainWindow();
    if (!window || window.isDestroyed?.() || window.webContents?.isDestroyed?.()) return Promise.reject(Object.assign(new Error('renderer_projection_unavailable'), { code: 'renderer_projection_unavailable', retryable: true }));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeoutImpl(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error('renderer_projection_timeout'), { code: 'renderer_projection_timeout', retryable: true }));
      }, timeoutMs);
      timer?.unref?.();
      pending.set(requestId, { resolve, reject, timer });
      window.webContents.send('sync:apply-batch', { requestId, batch });
    });
  }

  function dispose() {
    ipcMain.removeListener?.('sync:projection-result', onResult);
    for (const row of pending.values()) {
      clearTimeoutImpl(row.timer);
      row.reject(Object.assign(new Error('projection_bridge_closed'), { code: 'projection_bridge_closed' }));
    }
    pending.clear();
  }

  return Object.freeze({ applyRemoteBatch, dispose, pendingCount: () => pending.size });
}

module.exports = { createProjectionBridge };
