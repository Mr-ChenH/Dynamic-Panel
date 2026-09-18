const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAiIpc } = require('../main/ipc/ai');

function createHarness() {
  const handlers = new Map();
  const calls = [];
  const service = {
    run: async (senderId, payload) => { calls.push({ senderId, payload }); return { ok: true, promptVersion: 'test' }; },
    cancel: (senderId, requestId) => ({ senderId, requestId }),
  };
  registerAiIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    crypto: { randomUUID: () => 'fixed-id' },
    getAIService: () => service,
    getProviderVerificationRevision: () => 'revision',
    resolveTranscriptionConfig: () => ({ apiKey: '' }),
    resolveLlmConfig: () => ({ apiKey: 'configured' }),
    testTranscriptionProvider: async () => ({ ok: true, capabilities: { realtimeTranscription: true } }),
    persistProviderVerification: () => true,
    readDiagnostics: () => [{ id: 'diagnostic' }],
    clearDiagnostics: () => ({ ok: true }),
    acknowledgeMigration: () => {},
    publicTranscriptionConfig: () => ({ aiSettingsVersion: 2 }),
  });
  return { handlers, calls };
}

test('AI IPC delegates owner-scoped execution and cancellation', async () => {
  const { handlers, calls } = createHarness();
  const event = { sender: { id: 42 } };
  assert.deepEqual(await handlers.get('ai:run')(event, { action: 'summarize' }), { ok: true, promptVersion: 'test' });
  assert.deepEqual(await handlers.get('ai:cancel')(event, 'request-1'), { senderId: 42, requestId: 'request-1' });
  assert.equal(calls[0].senderId, 42);
  assert.equal(calls[0].payload.action, 'summarize');
});

test('AI IPC exposes diagnostics, migration acknowledgement and provider test results', async () => {
  const { handlers } = createHarness();
  const event = { sender: { id: 7 } };
  assert.deepEqual(await handlers.get('ai:get-diagnostics')(event), { ok: true, items: [{ id: 'diagnostic' }] });
  assert.deepEqual(await handlers.get('ai:clear-diagnostics')(event), { ok: true });
  assert.deepEqual(await handlers.get('ai:ack-migration')(event), { ok: true, aiSettingsVersion: 2 });
  assert.deepEqual(await handlers.get('ai:test-provider')(event, { slot: 'transcription' }), { ok: true, capabilities: { realtimeTranscription: true } });
});
