const test = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../ai/providers');
const { registerTranscriptionIpc } = require('../main/ipc/transcription');

function createHarness({ encryptionAvailable = true } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const writes = [];
  const changes = [];
  const serviceCalls = [];
  const transcriptionService = {
    start: (senderId) => ({ ok: true, senderId }),
    sendAudio: (senderId, bytes) => serviceCalls.push({ senderId, bytes }),
    finish: (senderId) => ({ ok: true, senderId, transcript: '' }),
  };
  registerTranscriptionIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: (channel, handler) => listeners.set(channel, handler),
    },
    providers: providers.PROVIDERS,
    providerFor: providers.providerFor,
    normalizeContentProfile: providers.normalizeContentProfile,
    normalizeContentProfiles: providers.normalizeContentProfiles,
    normalizeModelList: providers.normalizeModelList,
    normalizeModelName: providers.normalizeModelName,
    contentConfigRevision: providers.contentConfigRevision,
    transcriptionModel: 'qwen3-asr-flash-realtime',
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
    },
    env: {},
    readSettings: () => ({}),
    writeSettings: (settings) => writes.push(settings),
    resolveLlmConfig: () => ({ ...providers.normalizeContentProfile('deepseek'), model: 'deepseek-flash', apiKey: '' }),
    resolveTranscriptionConfig: () => ({ providerId: 'aliyun-bailian-realtime', model: 'qwen3-asr-flash-realtime', region: 'beijing', workspaceId: '' }),
    transcriptionConfigRevision: (config) => [config.providerId, config.model, config.region, config.workspaceId].join('|'),
    storedContentCredential: () => '',
    decryptStoredSecret: (value) => value ? 'configured' : '',
    publicConfig: () => ({ schemaVersion: 3, configured: true }),
    transcriptionService,
    onConfigChanged: (change) => changes.push(change),
  });
  return { handlers, listeners, writes, changes, serviceCalls };
}

test('transcription IPC validates and persists schema v3 provider configuration', async () => {
  const harness = createHarness();
  const result = await harness.handlers.get('transcription:set-config')({}, {
    region: 'singapore',
    workspaceId: 'workspace_1',
    apiKey: 'asr-key',
    llmProviderId: 'deepseek',
    llmModels: ['deepseek-flash'],
    llmModel: 'deepseek-flash',
    llmApiKey: 'llm-key',
    autoNameNotes: true,
  });
  assert.deepEqual(result, { ok: true, schemaVersion: 3, configured: true });
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].schemaVersion, 3);
  assert.equal(harness.writes[0].services.transcription.region, 'singapore');
  assert.equal(harness.writes[0].services.transcription.workspaceId, 'workspace_1');
  assert.equal(harness.writes[0].automations.nameNotes, true);
  assert.equal(harness.changes[0].transcriptionChanged, true);
});

test('transcription IPC rejects secrets when secure storage is unavailable', async () => {
  const harness = createHarness({ encryptionAvailable: false });
  const result = await harness.handlers.get('transcription:set-config')({}, {
    apiKey: 'secret', llmProviderId: 'deepseek', llmModels: ['deepseek-flash'], llmModel: 'deepseek-flash',
  });
  assert.deepEqual(result, { ok: false, error: 'secure_storage_unavailable' });
  assert.equal(harness.writes.length, 0);
});

test('transcription streaming IPC remains scoped to the sender', async () => {
  const harness = createHarness();
  const event = { sender: { id: 19 } };
  assert.deepEqual(await harness.handlers.get('transcription:start')(event), { ok: true, senderId: 19 });
  harness.listeners.get('transcription:audio')(event, Buffer.from('pcm'));
  assert.equal(harness.serviceCalls[0].senderId, 19);
  assert.deepEqual(await harness.handlers.get('transcription:finish')(event), { ok: true, senderId: 19, transcript: '' });
});
