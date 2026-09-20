'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const providers = require('../ai/providers');
const { createAIProviderConfig } = require('../main/ai-provider-config');

function createHarness(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-ai-config-'));
  let settings = overrides.settings || {};
  const writes = [];
  const config = createAIProviderConfig({
    fs,
    path,
    crypto,
    safeStorage: { isEncryptionAvailable: () => true },
    WebSocket: class {},
    env: { ...(overrides.env || {}) },
    readSettings: () => settings,
    writeSettings: (value) => { settings = value; writes.push(value); },
    getUserDataPath: () => directory,
    transcriptionModel: 'qwen3-asr-flash-realtime',
    providers: providers.PROVIDERS,
    providerFor: providers.providerFor,
    normalizeContentProfile: providers.normalizeContentProfile,
    normalizeContentProfiles: providers.normalizeContentProfiles,
    normalizeContentService: providers.normalizeContentService,
    normalizeTranscriptionService: providers.normalizeTranscriptionService,
    normalizeModelList: providers.normalizeModelList,
    contentConfigRevision: providers.contentConfigRevision,
    publicContentProviders: providers.publicContentProviders,
    decryptStoredSecret: (value) => value ? `secret:${value}` : '',
  });
  return { config, directory, writes, getSettings: () => settings };
}

test('AI provider config preserves environment precedence and bounded transcription fields', () => {
  const harness = createHarness({
    env: {
      DASHSCOPE_API_KEY: 'env-asr',
      DASHSCOPE_WORKSPACE_ID: 'workspace_1',
      DASHSCOPE_REGION: 'singapore',
      NOTCH_LLM_API_KEY: 'env-llm',
    },
    settings: {
      encryptedApiKey: 'stored-asr',
      services: { transcription: { region: 'beijing', workspaceId: 'stored-workspace' } },
    },
  });
  const transcription = harness.config.resolveTranscriptionConfig();
  const llm = harness.config.resolveLlmConfig();
  assert.equal(transcription.apiKey, 'env-asr');
  assert.equal(transcription.region, 'singapore');
  assert.equal(transcription.workspaceId, 'workspace_1');
  assert.equal(llm.apiKey, 'env-llm');
  assert.equal(harness.config.transcriptionConfigRevision(transcription), 'aliyun-bailian-realtime|qwen3-asr-flash-realtime|singapore|workspace_1');
});

test('AI diagnostics are bounded and can be cleared through the injected filesystem', () => {
  const harness = createHarness();
  for (let index = 0; index < 55; index += 1) {
    harness.config.appendDiagnostic({
      request: { action: `action-${index}` },
      config: { providerId: 'deepseek', model: 'model' },
      result: { ok: index % 2 === 0, error: 'failed' },
      durationMs: index,
    });
  }
  const diagnostics = harness.config.readDiagnostics();
  assert.equal(diagnostics.length, 50);
  assert.equal(diagnostics[0].action, 'action-5');
  assert.equal(diagnostics.at(-1).status, 'completed');
  assert.deepEqual(harness.config.clearDiagnostics(), { ok: true });
  assert.deepEqual(harness.config.readDiagnostics(), []);
});

test('provider verification rejects stale revisions and persists current content verification', () => {
  const harness = createHarness();
  const llm = harness.config.resolveLlmConfig();
  const revision = harness.config.providerVerificationRevision('content', llm);
  assert.equal(harness.config.persistProviderVerification('content', { ok: true }, { text: true }, `${revision}-stale`), false);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.config.persistProviderVerification('content', { ok: true }, { text: true }, revision), true);
  assert.equal(harness.writes.length, 1);
  const stored = harness.getSettings();
  assert.equal(stored.schemaVersion, 3);
  assert.equal(stored.verification.content.state, 'verified');
  assert.equal(Object.keys(stored.verification.contentProfiles).length, 1);
});

test('transcription URL keeps the public and workspace endpoint variants stable', () => {
  const harness = createHarness();
  assert.equal(
    harness.config.transcriptionUrl({ model: 'model', region: 'beijing', workspaceId: '' }),
    'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=model&heartbeat=true'
  );
  assert.equal(
    harness.config.transcriptionUrl({ model: 'model', region: 'singapore', workspaceId: 'workspace_1' }),
    'wss://workspace_1.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=model&heartbeat=true'
  );
});
