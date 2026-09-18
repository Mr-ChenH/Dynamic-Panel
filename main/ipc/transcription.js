function registerTranscriptionIpc({
  ipcMain,
  providers,
  providerFor,
  normalizeContentProfile,
  normalizeContentProfiles,
  normalizeModelList,
  normalizeModelName,
  contentConfigRevision,
  transcriptionModel,
  safeStorage,
  env,
  readSettings,
  writeSettings,
  resolveLlmConfig,
  resolveTranscriptionConfig,
  transcriptionConfigRevision,
  storedContentCredential,
  decryptStoredSecret,
  publicConfig,
  transcriptionService,
  onConfigChanged,
}) {
  ipcMain.handle('transcription:get-config', () => publicConfig());

  ipcMain.handle('transcription:set-config', (_event, payload) => {
    const previous = readSettings();
    const previousContentState = normalizeContentProfiles(previous);
    const previousActiveContent = resolveLlmConfig();
    const region = payload?.region === 'singapore' ? 'singapore' : 'beijing';
    const workspaceId = String(payload?.workspaceId || '').trim();
    const apiKey = String(payload?.apiKey || '').trim();
    const llmApiKey = String(payload?.llmApiKey || '').trim();
    const removeAsr = payload?.removeAsr === true;
    const removeContent = payload?.removeContent === true;
    const llmProviderId = String(payload?.llmProviderId || previousContentState.activeProviderId);
    if (!providers[llmProviderId]) return { ok: false, error: 'invalid_provider' };
    const llmProvider = providerFor(llmProviderId);
    const previousProviderProfile = previousContentState.profiles[llmProviderId] || normalizeContentProfile(llmProviderId);
    const rawModels = Array.isArray(payload?.llmModels) ? payload.llmModels : [payload?.llmModel];
    if (!removeContent && (rawModels.length < 1 || rawModels.length > 12)) return { ok: false, error: 'invalid_model_count' };
    if (!removeContent && rawModels.some((model) => typeof model !== 'string')) return { ok: false, error: 'invalid_model' };
    const normalizedRequestedModels = rawModels.map(normalizeModelName);
    if (!removeContent && normalizedRequestedModels.some((model) => !model)) return { ok: false, error: 'invalid_model' };
    const llmModels = normalizeModelList(normalizedRequestedModels);
    if (!removeContent && llmModels.length !== normalizedRequestedModels.length) return { ok: false, error: 'duplicate_model' };
    const requestedActiveModel = normalizeModelName(payload?.llmModel);
    const llmModel = llmModels.includes(requestedActiveModel) ? requestedActiveModel : llmModels[0] || '';
    const llmBaseUrl = String(llmProvider.endpointEditable
      ? payload?.llmBaseUrl || previousProviderProfile.baseUrl || llmProvider.defaultBaseUrl
      : previousProviderProfile.baseUrl || llmProvider.defaultBaseUrl).trim().replace(/\/+$/, '');
    const llmTimeoutMs = Math.max(10000, Math.min(60000, Number(payload?.llmTimeoutMs) || previousProviderProfile.timeoutMs || 30000));
    if (workspaceId && !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) return { ok: false, error: 'invalid_workspace' };
    if ((apiKey || llmApiKey) && !safeStorage.isEncryptionAvailable()) return { ok: false, error: 'secure_storage_unavailable' };

    const encryptedApiKey = removeAsr ? '' : apiKey
      ? safeStorage.encryptString(apiKey).toString('base64') : String(previous.encryptedApiKey || '');
    const previousEncryptedLlmKey = storedContentCredential(previous, llmProviderId);
    const selectedEncryptedLlmKey = removeContent ? '' : llmApiKey
      ? safeStorage.encryptString(llmApiKey).toString('base64') : previousEncryptedLlmKey;
    const contentConfigured = Boolean(env.NOTCH_LLM_API_KEY || decryptStoredSecret(selectedEncryptedLlmKey));
    let parsedLlmUrl = null;
    if (llmBaseUrl) {
      try { parsedLlmUrl = new URL(llmBaseUrl); } catch (error) {}
    }
    if (!removeContent && contentConfigured && (!parsedLlmUrl || parsedLlmUrl.protocol !== 'https:' || parsedLlmUrl.username || parsedLlmUrl.password)) {
      return { ok: false, error: 'invalid_llm_url' };
    }
    if (!removeContent && !llmModel) return { ok: false, error: 'invalid_model' };

    const rawContent = previous?.services?.content && typeof previous.services.content === 'object'
      ? previous.services.content : {};
    const rawProfiles = rawContent.profiles && typeof rawContent.profiles === 'object' && !Array.isArray(rawContent.profiles)
      ? rawContent.profiles : {};
    const contentProfiles = { ...rawProfiles };
    for (const profile of Object.values(previousContentState.profiles)) {
      const raw = rawProfiles[profile.providerId] && typeof rawProfiles[profile.providerId] === 'object'
        ? rawProfiles[profile.providerId] : {};
      contentProfiles[profile.providerId] = {
        ...raw,
        ...profile,
        encryptedApiKey: storedContentCredential(previous, profile.providerId),
      };
    }
    if (removeContent) delete contentProfiles[llmProviderId];
    else {
      contentProfiles[llmProviderId] = {
        ...(contentProfiles[llmProviderId] || {}),
        providerId: llmProviderId,
        adapterId: llmProvider.adapterId,
        baseUrl: parsedLlmUrl ? parsedLlmUrl.toString().replace(/\/+$/, '') : llmBaseUrl,
        models: llmModels,
        activeModel: llmModel,
        timeoutMs: llmTimeoutMs,
        encryptedApiKey: selectedEncryptedLlmKey,
      };
    }
    let activeProviderId = removeContent && previousContentState.activeProviderId === llmProviderId
      ? Object.keys(contentProfiles).find((providerId) => providers[providerId]) || llmProviderId
      : removeContent ? previousContentState.activeProviderId : llmProviderId;
    if (!providers[activeProviderId]) activeProviderId = 'deepseek';
    const activeProfile = contentProfiles[activeProviderId]
      ? normalizeContentProfile(activeProviderId, contentProfiles[activeProviderId])
      : normalizeContentProfile(activeProviderId);
    const activeEncryptedLlmKey = contentProfiles[activeProviderId]?.encryptedApiKey || '';
    const contentService = {
      ...rawContent,
      activeProviderId,
      profiles: contentProfiles,
      providerId: activeProviderId,
      adapterId: providerFor(activeProviderId).adapterId,
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.activeModel,
      timeoutMs: activeProfile.timeoutMs,
    };
    const transcriptionConfig = {
      providerId: 'aliyun-bailian-realtime',
      model: transcriptionModel,
      region,
      workspaceId,
    };
    const verification = { ...(previous.verification || {}) };
    const previousTranscription = resolveTranscriptionConfig();
    const transcriptionChanged = Boolean(apiKey || removeAsr
      || transcriptionConfigRevision(previousTranscription) !== transcriptionConfigRevision(transcriptionConfig));
    if (transcriptionChanged) delete verification.transcription;
    const activeContentChanged = Boolean(llmApiKey || removeContent
      || contentConfigRevision(previousActiveContent) !== contentConfigRevision({ ...activeProfile, model: activeProfile.activeModel }));
    if (activeContentChanged) delete verification.content;
    const automations = {
      nameNotes: payload?.autoNameNotes === true,
      nameRecordings: payload?.autoNameRecordings === true,
      organizeLinks: payload?.autoOrganizeLinks === true,
    };
    const next = {
      ...previous,
      schemaVersion: 3,
      services: { ...(previous.services || {}), transcription: transcriptionConfig, content: contentService },
      automations,
      verification,
      region,
      workspaceId,
      encryptedApiKey,
      llmProviderId: activeProviderId,
      llmBaseUrl: activeProfile.baseUrl,
      llmModel: activeProfile.activeModel,
      llmTimeoutMs: activeProfile.timeoutMs,
      autoNameNotes: automations.nameNotes,
      autoNameRecordings: automations.nameRecordings,
      autoOrganizeLinks: automations.organizeLinks,
      aiSettingsVersion: 2,
      encryptedLlmApiKey: activeEncryptedLlmKey,
    };
    try {
      writeSettings(next);
      onConfigChanged({ transcriptionChanged, activeContentChanged });
      return { ok: true, ...publicConfig() };
    } catch (error) {
      return { ok: false, error: 'save_failed' };
    }
  });

  ipcMain.handle('transcription:start', (event) => transcriptionService.start(event.sender.id, event.sender));
  ipcMain.on('transcription:audio', (event, bytes) => transcriptionService.sendAudio(event.sender.id, bytes));
  ipcMain.handle('transcription:finish', (event) => transcriptionService.finish(event.sender.id));
}

module.exports = { registerTranscriptionIpc };
