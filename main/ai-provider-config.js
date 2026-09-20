'use strict';

function createAIProviderConfig({
  fs,
  path,
  crypto,
  safeStorage,
  WebSocket,
  env = process.env,
  readSettings,
  writeSettings,
  getUserDataPath,
  fileName = 'ai-diagnostics.json',
  transcriptionModel,
  providers,
  providerFor,
  normalizeContentProfile,
  normalizeContentProfiles,
  normalizeContentService,
  normalizeTranscriptionService,
  normalizeModelList,
  contentConfigRevision,
  publicContentProviders,
  decryptStoredSecret,
}) {
  if (!fs || !path || !crypto || !safeStorage || typeof readSettings !== 'function' || typeof writeSettings !== 'function') {
    throw new TypeError('AI provider config dependencies are required');
  }
  if (typeof decryptStoredSecret !== 'function') throw new TypeError('decryptStoredSecret is required');

  function diagnosticsPath() {
    return path.join(getUserDataPath(), fileName);
  }

  function readDiagnostics() {
    try {
      const value = JSON.parse(fs.readFileSync(diagnosticsPath(), 'utf8'));
      return Array.isArray(value) ? value.slice(-50) : [];
    } catch (error) {
      return [];
    }
  }

  function appendDiagnostic(entry) {
    const result = entry && entry.result || {};
    const config = entry && entry.config || {};
    let provider = String(config.providerId || 'unknown');
    if (provider === 'unknown') {
      try { provider = new URL(config.baseUrl).hostname; } catch (error) {}
    }
    const diagnostic = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action: String(entry?.request?.action || 'unknown').slice(0, 40),
      provider: String(provider).slice(0, 120),
      model: String(config.model || '').slice(0, 120),
      durationMs: Math.max(0, Math.round(Number(entry?.durationMs) || 0)),
      queueWaitMs: Math.max(0, Math.round(Number(entry?.queueWaitMs) || 0)),
      status: result.ok ? 'completed' : result.error === 'cancelled' ? 'cancelled' : 'failed',
      error: result.ok ? '' : String(result.error || 'unknown').slice(0, 80),
      usage: result.usage && typeof result.usage === 'object' ? result.usage : null,
      promptVersion: String(result.promptVersion || entry?.promptVersion || '').slice(0, 40),
    };
    try {
      fs.writeFileSync(diagnosticsPath(), JSON.stringify([...readDiagnostics(), diagnostic].slice(-50)), { mode: 0o600 });
    } catch (error) {}
  }

  function decryptStoredApiKey(settings) {
    const environmentKey = String(env.DASHSCOPE_API_KEY || '').trim();
    if (environmentKey) return environmentKey;
    return decryptStoredSecret(settings.encryptedApiKey).trim();
  }

  function storedContentCredential(settings, providerId) {
    const profiles = settings?.services?.content?.profiles;
    const profile = profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles[providerId] : null;
    if (profile && Object.prototype.hasOwnProperty.call(profile, 'encryptedApiKey')) return String(profile.encryptedApiKey || '');
    const legacy = normalizeContentService(settings);
    return legacy.providerId === providerId ? String(settings.encryptedLlmApiKey || '') : '';
  }

  function resolveContentProfile(settings, providerId, useEnvironment = false) {
    const normalized = normalizeContentProfiles(settings);
    const profile = normalized.profiles[providerId] || normalizeContentProfile(providerId);
    const encryptedApiKey = storedContentCredential(settings, providerId);
    const environmentKey = useEnvironment ? String(env.NOTCH_LLM_API_KEY || '').trim() : '';
    return {
      ...profile,
      model: profile.activeModel,
      encryptedApiKey,
      apiKey: environmentKey || decryptStoredSecret(encryptedApiKey).trim(),
      credentialSource: environmentKey ? 'environment' : encryptedApiKey ? 'stored' : 'none',
    };
  }

  function resolveLlmConfig() {
    const settings = readSettings();
    const content = normalizeContentProfiles(settings);
    return resolveContentProfile(settings, content.activeProviderId, true);
  }

  function resolveTranscriptionConfig() {
    const settings = readSettings();
    const stored = normalizeTranscriptionService(settings, transcriptionModel);
    const environmentWorkspace = String(env.DASHSCOPE_WORKSPACE_ID || env.DASHSCOPE_WORKSPACE || '').trim();
    const environmentRegion = String(env.DASHSCOPE_REGION || '').trim().toLowerCase();
    const region = ['beijing', 'singapore'].includes(environmentRegion) ? environmentRegion : stored.region;
    const workspaceId = (environmentWorkspace || stored.workspaceId).slice(0, 128);
    return {
      ...stored,
      apiKey: decryptStoredApiKey(settings),
      workspaceId: /^[A-Za-z0-9_-]{0,128}$/.test(workspaceId) ? workspaceId : '',
      region,
    };
  }

  function transcriptionConfigRevision(config) {
    return [config.providerId, config.model, config.region, config.workspaceId].join('|');
  }

  function providerVerificationRevision(slot, config) {
    const configuration = slot === 'transcription' ? transcriptionConfigRevision(config) : contentConfigRevision(config);
    const credentialDigest = crypto.createHash('sha256').update(String(config.apiKey || '')).digest('hex');
    return crypto.createHash('sha256').update(`${configuration}\0${credentialDigest}`).digest('hex');
  }

  function contentVerificationKey(config) {
    return crypto.createHash('sha256').update(contentConfigRevision(config)).digest('hex');
  }

  function verificationStatus(settings, slot, revision, configured, storedValue = null) {
    if (!configured) return { state: 'missing', verifiedAt: '', error: '', capabilities: null };
    const value = storedValue || settings?.verification?.[slot];
    if (!value || value.revision !== revision) return { state: 'unverified', verifiedAt: '', error: '', capabilities: null };
    return {
      state: value.state === 'verified' ? 'verified' : 'failed',
      verifiedAt: String(value.verifiedAt || ''),
      error: String(value.error || ''),
      capabilities: value.capabilities && typeof value.capabilities === 'object' ? value.capabilities : null,
    };
  }

  function publicConfig() {
    const config = resolveTranscriptionConfig();
    const llmConfig = resolveLlmConfig();
    const settings = readSettings();
    const content = normalizeContentProfiles(settings);
    const transcriptionVerification = verificationStatus(settings, 'transcription', providerVerificationRevision('transcription', config), Boolean(config.apiKey));
    const activeVerificationValue = settings?.verification?.contentProfiles?.[contentVerificationKey(llmConfig)] || settings?.verification?.content;
    const contentVerification = verificationStatus(settings, 'content', providerVerificationRevision('content', llmConfig), Boolean(llmConfig.apiKey), activeVerificationValue);
    const rawContentProfiles = settings?.services?.content?.profiles;
    const hasLegacyContent = Boolean(settings?.services?.content?.providerId || settings.llmProviderId || settings.llmModel || settings.encryptedLlmApiKey);
    const contentProviderConfigs = Object.values(content.profiles).map((profile) => {
      const resolved = resolveContentProfile(settings, profile.providerId, true);
      const storedProfile = rawContentProfiles && typeof rawContentProfiles === 'object'
        && Object.prototype.hasOwnProperty.call(rawContentProfiles, profile.providerId);
      return {
        providerId: profile.providerId,
        saved: storedProfile || (hasLegacyContent && profile.providerId === content.activeProviderId),
        baseUrl: profile.baseUrl,
        models: profile.models.map((model) => {
          const modelConfig = { ...resolved, model };
          const value = settings?.verification?.contentProfiles?.[contentVerificationKey(modelConfig)];
          return {
            name: model,
            verification: verificationStatus(settings, 'content', providerVerificationRevision('content', modelConfig), Boolean(resolved.apiKey), value),
          };
        }),
        activeModel: profile.activeModel,
        timeoutMs: profile.timeoutMs,
        configured: Boolean(resolved.apiKey),
        needsReentry: Boolean(resolved.encryptedApiKey && !resolved.apiKey),
        credentialSource: resolved.credentialSource,
      };
    });
    return {
      schemaVersion: 3,
      configured: Boolean(config.apiKey),
      asrNeedsReentry: Boolean(settings.encryptedApiKey && !config.apiKey),
      asrCredentialSource: env.DASHSCOPE_API_KEY ? 'environment' : config.apiKey ? 'stored' : 'none',
      transcriptionProviderId: config.providerId,
      transcriptionProviderLabel: '阿里云百炼',
      transcriptionModel: config.model,
      transcriptionVerification,
      workspaceId: config.workspaceId,
      region: config.region,
      provider: config.model,
      secureStorage: safeStorage.isEncryptionAvailable(),
      llmConfigured: Boolean(llmConfig.apiKey),
      llmNeedsReentry: Boolean(llmConfig.encryptedApiKey && !llmConfig.apiKey),
      llmCredentialSource: llmConfig.credentialSource,
      llmProviderId: llmConfig.providerId,
      llmProviderLabel: providerFor(llmConfig.providerId).label,
      llmBaseUrl: llmConfig.baseUrl,
      llmModel: llmConfig.model,
      llmModels: llmConfig.models,
      llmTimeoutMs: llmConfig.timeoutMs,
      contentVerification,
      contentProviders: publicContentProviders(),
      contentProviderConfigs,
      autoNameNotes: settings?.automations?.nameNotes === true || settings.autoNameNotes === true,
      autoNameRecordings: settings?.automations?.nameRecordings === true || settings.autoNameRecordings === true,
      autoOrganizeLinks: settings?.automations?.organizeLinks === true || settings.autoOrganizeLinks === true,
      aiMigrationNoticePending: Object.keys(settings).length > 0 && settings.aiSettingsVersion !== 2,
    };
  }

  function transcriptionUrl(config) {
    const host = config.workspaceId
      ? config.region === 'singapore'
        ? `${config.workspaceId}.ap-southeast-1.maas.aliyuncs.com`
        : `${config.workspaceId}.cn-beijing.maas.aliyuncs.com`
      : config.region === 'singapore'
        ? 'dashscope-intl.aliyuncs.com'
        : 'dashscope.aliyuncs.com';
    return `wss://${host}/api-ws/v1/realtime?model=${encodeURIComponent(config.model || transcriptionModel)}&heartbeat=true`;
  }

  function eventId() {
    return `event_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  function persistProviderVerification(slot, result, capabilities = null, expectedRevision = '') {
    const settings = readSettings();
    const config = slot === 'transcription' ? resolveTranscriptionConfig() : resolveLlmConfig();
    const revision = providerVerificationRevision(slot, config);
    if (expectedRevision && revision !== expectedRevision) return false;
    const entry = {
      state: result.ok ? 'verified' : 'failed',
      verifiedAt: new Date().toISOString(),
      revision,
      error: result.ok ? '' : String(result.error || 'unknown').slice(0, 80),
      capabilities: result.ok && capabilities ? capabilities : null,
    };
    const verification = { ...(settings.verification || {}), [slot]: entry };
    if (slot === 'content') {
      verification.contentProfiles = {
        ...(settings.verification?.contentProfiles || {}),
        [contentVerificationKey(config)]: entry,
      };
    }
    writeSettings({ ...settings, schemaVersion: 3, verification });
    return true;
  }

  function testTranscriptionProvider() {
    const config = resolveTranscriptionConfig();
    if (!config.apiKey) return Promise.resolve({ ok: false, error: 'not_configured' });
    return new Promise((resolve) => {
      const headers = {
        Authorization: `Bearer ${config.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
        'User-Agent': 'DynamicPanel/0.3',
      };
      if (config.workspaceId) headers['X-DashScope-WorkSpace'] = config.workspaceId;
      const socket = new WebSocket(transcriptionUrl(config), { headers });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch (error) {}
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'connect_timeout' }), 8000);
      socket.on('message', (raw) => {
        let message;
        try { message = JSON.parse(String(raw)); } catch (error) { return; }
        if (message.type === 'session.created' || message.type === 'session.updated') {
          finish({ ok: true, capabilities: { realtimeTranscription: true } });
        } else if (message.type === 'error') {
          finish({ ok: false, error: 'provider_error' });
        }
      });
      socket.once('unexpected-response', (_request, response) => {
        finish({ ok: false, error: response.statusCode === 401 || response.statusCode === 403 ? 'authentication_failed' : `http_${response.statusCode || 0}` });
      });
      socket.once('error', () => finish({ ok: false, error: 'network_error' }));
      socket.once('close', () => finish({ ok: false, error: 'connection_closed' }));
    });
  }

  function clearDiagnostics() {
    try {
      fs.rmSync(diagnosticsPath(), { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'clear_failed' };
    }
  }

  function acknowledgeMigration() {
    writeSettings({ ...readSettings(), schemaVersion: 3, aiSettingsVersion: 2 });
  }

  return {
    appendDiagnostic,
    readDiagnostics,
    clearDiagnostics,
    acknowledgeMigration,
    decryptStoredApiKey,
    storedContentCredential,
    resolveContentProfile,
    resolveLlmConfig,
    resolveTranscriptionConfig,
    transcriptionConfigRevision,
    providerVerificationRevision,
    contentVerificationKey,
    publicConfig,
    transcriptionUrl,
    eventId,
    persistProviderVerification,
    testTranscriptionProvider,
  };
}

module.exports = { createAIProviderConfig };
