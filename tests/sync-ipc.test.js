'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSyncIpc } = require('../main/ipc/sync');

test('sync IPC is additive, sender checked and exposes no credential reads', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const calls = [];
  const service = {
    status: () => ({ state: 'disconnected' }), testConnection: (value) => (calls.push(['test', value]), { ok: true }), saveBinding: (value) => (calls.push(['save', value]), { ok: true }),
    setCategories: (value) => ({ ok: true, value }), pause: (value) => ({ ok: true, value }), runNow: () => ({ ok: true }), listConflicts: () => ({ ok: true, items: [] }), resolveConflict: () => ({ ok: true }), removeBinding: () => ({ ok: true }), cancelTransfer: () => ({ ok: true }), previewFirstSync: () => ({ ok: true }), executeFirstSync: () => ({ ok: true }), cancelFirstSync: () => ({ ok: true }), prepareCategoryClear: () => ({ ok: true }), executeCategoryClear: () => ({ ok: true }), restoreDeleted: () => ({ ok: true }),
  };
  const owner = {};
  const result = registerSyncIpc({ ipcMain, syncService: service, isMainWindowSender: (sender) => sender === owner });
  assert.ok(result.channels.includes('sync:get-status'));
  assert.ok(result.channels.includes('sync:category-clear-preview'));
  assert.ok(result.channels.includes('sync:category-clear-execute'));
  assert.equal(handlers.has('workspace:get'), false);
  assert.equal([...handlers].some(([channel]) => /key|credential/i.test(channel)), false);
  assert.deepEqual(await handlers.get('sync:get-status')({ sender: {} }), { ok: false, error: { code: 'forbidden_sender' } });
  assert.deepEqual(await handlers.get('sync:get-status')({ sender: owner }), { state: 'disconnected' });
  await handlers.get('sync:test-connection')({ sender: owner }, { baseUrl: 'http://localhost:3000', clientKey: 'dpk_v1_secret', allowLoopbackHttp: true });
  assert.equal(calls[0][0], 'test');
});
