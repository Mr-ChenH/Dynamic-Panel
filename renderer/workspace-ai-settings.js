(function exposeWorkspaceAISettings() {
  const DEFAULT_CONFIG = Object.freeze({
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    transcriptionProviderLabel: '阿里云百炼',
    transcriptionModel: 'qwen3-asr-flash-realtime',
    transcriptionVerification: { state: 'missing' },
    llmConfigured: false,
    llmNeedsReentry: false,
    llmProviderId: 'deepseek',
    llmProviderLabel: 'DeepSeek',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-flash',
    llmModels: ['deepseek-flash'],
    llmTimeoutMs: 30000,
    contentVerification: { state: 'missing' },
    contentProviders: [],
    contentProviderConfigs: [],
    autoNameNotes: false,
    autoNameRecordings: false,
    autoOrganizeLinks: false,
    aiMigrationNoticePending: false,
  });

  function createController(host) {
    const {
      Domain,
      setMode,
      setSettingsNote,
      renderSettingsPanel,
      updateRecordingUi,
      getRecordingLifecycle,
      getTranscriptionPipeline,
    } = host;
    const aiSettingsRoot = document.querySelector('.settings-api-card');
    const aiProviderConfigBody = document.querySelector('.ai-provider-config-scroll');
    const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
    const aiProviderTranscription = document.getElementById('ai-provider-transcription');
    const aiContentProviderList = document.getElementById('ai-content-provider-list');
    const aiContentSettingsSecondary = document.getElementById('ai-content-settings-secondary');
    const aiServicePanelTranscription = document.getElementById('ai-service-panel-transcription');
    const aiServicePanelContent = document.getElementById('ai-service-panel-content');
    const aiContentProviderTitle = document.getElementById('ai-content-provider-title');
    const aiContentProviderDescription = document.getElementById('ai-content-provider-description');
    const aiTranscriptionNavStatus = document.getElementById('ai-transcription-nav-status');
    const transcriptionApiKey = document.getElementById('transcription-api-key');
    const transcriptionApiStatus = document.getElementById('transcription-api-status');
    const transcriptionVerificationStatus = document.getElementById('transcription-verification-status');
    const transcriptionApiHelp = document.getElementById('transcription-api-help');
    const transcriptionRegion = document.getElementById('transcription-region');
    const transcriptionWorkspace = document.getElementById('transcription-workspace');
    const transcriptionProviderTest = document.getElementById('transcription-provider-test');
    const transcriptionProviderRemove = document.getElementById('transcription-provider-remove');
    const llmProvider = document.getElementById('llm-provider');
    const llmApiKey = document.getElementById('llm-api-key');
    const llmApiStatus = document.getElementById('llm-api-status');
    const contentVerificationStatus = document.getElementById('content-verification-status');
    const llmApiHelp = document.getElementById('llm-api-help');
    const llmApiHelpLabel = document.getElementById('llm-api-help-label');
    const llmBaseUrlField = document.getElementById('llm-base-url-field');
    const llmBaseUrl = document.getElementById('llm-base-url');
    const llmModel = document.getElementById('llm-model');
    const llmModelList = document.getElementById('llm-model-list');
    const llmModelAdd = document.getElementById('llm-model-add');
    const llmModelLimit = document.getElementById('llm-model-limit');
    const llmTimeout = document.getElementById('llm-timeout');
    const contentProviderRemove = document.getElementById('content-provider-remove');
    const aiAutoNameNotes = document.getElementById('ai-auto-name-notes');
    const aiAutoNameRecordings = document.getElementById('ai-auto-name-recordings');
    const aiAutoOrganizeLinks = document.getElementById('ai-auto-organize-links');
    const aiProviderTest = document.getElementById('ai-provider-test');
    const aiDiagnostics = document.getElementById('ai-diagnostics');
    const aiDiagnosticsCopy = document.getElementById('ai-diagnostics-copy');
    const aiDiagnosticsClear = document.getElementById('ai-diagnostics-clear');
    const settingsAiMigration = document.getElementById('settings-ai-migration');
    const settingsAiMigrationAck = document.getElementById('settings-ai-migration-ack');
    const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
    const aiSettingsReset = document.getElementById('ai-settings-reset');
    const recordingConfigure = document.getElementById('recording-configure');
    let config = { ...DEFAULT_CONFIG };
    let activeServicePanel = 'content';
    let removeAsrOnSave = false;
    let removeContentOnSave = false;
    let dirty = false;

    function exposeConfig() {
      window.NotchAISettings = { ...config };
    }

    function acceptConfig(value, { expose = false } = {}) {
      if (value && typeof value === 'object') config = value;
      if (expose) exposeConfig();
      updateConfigUi();
      return config;
    }

    function verificationPresentation(verification, configured) {
      if (!configured) return { label: '未配置', state: 'empty' };
      if (verification?.state === 'verified') return { label: '已验证', state: 'saved' };
      if (verification?.state === 'failed') return { label: '验证失败', state: 'error' };
      return { label: '待验证', state: 'warning' };
    }

    function selectedContentProvider() {
      const providers = Array.isArray(config.contentProviders) ? config.contentProviders : [];
      return providers.find((provider) => provider.id === llmProvider?.value)
        || providers.find((provider) => provider.id === config.llmProviderId)
        || null;
    }

    function setStatusPresentation(element, presentation) {
      if (!element) return;
      element.textContent = presentation.label;
      element.dataset.state = presentation.state;
    }

    function contentProfileFor(providerId) {
      const provider = (config.contentProviders || []).find((item) => item.id === providerId);
      const saved = (config.contentProviderConfigs || []).find((item) => item.providerId === providerId);
      const fallbackModel = provider?.defaultModel || '';
      const models = saved?.models?.length
        ? saved.models.map((item) => typeof item === 'string' ? { name: item, verification: { state: 'missing' } } : item)
        : fallbackModel ? [{ name: fallbackModel, verification: { state: 'missing' } }] : [{ name: '', verification: { state: 'missing' } }];
      return {
        providerId,
        baseUrl: saved?.baseUrl ?? provider?.defaultBaseUrl ?? '',
        models,
        activeModel: saved?.activeModel || models[0]?.name || '',
        timeoutMs: saved?.timeoutMs || 30000,
        saved: saved?.saved === true,
        configured: saved?.configured === true,
        needsReentry: saved?.needsReentry === true,
        credentialSource: saved?.credentialSource || 'none',
      };
    }

    function currentContentModels() {
      return [...(llmModelList?.querySelectorAll('[data-ai-model-name]') || [])]
        .map((input) => input.value.replace(/\s+/g, ' ').trim());
    }

    function contentModelDraft(names, activeModel = '') {
      const profile = contentProfileFor(llmProvider?.value);
      return {
        ...profile,
        models: names.map((name) => profile.models.find((item) => item.name === name) || { name, verification: { state: 'missing' } }),
        activeModel: names.includes(activeModel) ? activeModel : names[0] || '',
      };
    }

    function renderContentModels(profile) {
      if (!llmModelList) return;
      const models = profile.models.length ? profile.models : [{ name: '', verification: { state: 'missing' } }];
      const activeModel = models.some((item) => item.name === profile.activeModel) ? profile.activeModel : models[0].name;
      if (llmModel) llmModel.value = activeModel;
      llmModelList.replaceChildren(...models.map((item, index) => {
        const row = document.createElement('div'); row.className = 'ai-model-row';
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'active-content-model'; radio.checked = item.name === activeModel;
        radio.dataset.aiModelActive = String(index); radio.setAttribute('aria-label', `将${item.name || '新模型'}设为默认`);
        const input = document.createElement('input');
        input.type = 'text'; input.value = item.name; input.maxLength = 120; input.placeholder = selectedContentProvider()?.modelPlaceholder || '模型名称';
        input.dataset.aiModelName = String(index); input.autocomplete = 'off'; input.spellcheck = false;
        const presentation = verificationPresentation(item.verification, profile.configured);
        const status = document.createElement('i'); status.className = 'ai-model-row-status'; status.dataset.state = presentation.state; status.title = presentation.label; status.setAttribute('aria-label', presentation.label);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ai-model-remove'; remove.dataset.aiModelRemove = String(index); remove.disabled = models.length === 1; remove.setAttribute('aria-label', `删除${item.name || '该模型'}`); remove.textContent = '×';
        row.append(radio, input, status, remove);
        return row;
      }));
      if (llmModelLimit) {
        llmModelLimit.textContent = models.length >= 12 ? '已达到每个厂商 12 个模型的上限。' : `已添加 ${models.length} / 12 个模型。`;
        llmModelLimit.classList.remove('error');
      }
      if (llmModelAdd) llmModelAdd.disabled = models.length >= 12;
    }

    function transcriptionConnectionChanged() {
      return removeAsrOnSave
        || Boolean(transcriptionApiKey?.value.trim())
        || transcriptionRegion?.value !== (config.region || 'beijing')
        || transcriptionWorkspace?.value.trim() !== (config.workspaceId || '');
    }

    function contentProfileFieldsChanged() {
      const profile = contentProfileFor(llmProvider?.value);
      const models = currentContentModels();
      const savedModels = profile.models.map((item) => item.name);
      return removeContentOnSave
        || Boolean(llmApiKey?.value.trim())
        || llmBaseUrl?.value.trim() !== profile.baseUrl
        || models.length !== savedModels.length
        || models.some((model, index) => model !== savedModels[index])
        || llmModel?.value.trim() !== profile.activeModel
        || Number(llmTimeout?.value || 30000) !== Number(profile.timeoutMs || 30000);
    }

    function contentConnectionChanged() {
      return llmProvider?.value !== config.llmProviderId || contentProfileFieldsChanged();
    }

    function hasChanges() {
      return transcriptionConnectionChanged()
        || contentConnectionChanged()
        || aiAutoNameNotes?.checked !== (config.autoNameNotes === true)
        || aiAutoNameRecordings?.checked !== (config.autoNameRecordings === true)
        || aiAutoOrganizeLinks?.checked !== (config.autoOrganizeLinks === true);
    }

    function contentProviderPresentation(providerId) {
      const profile = contentProfileFor(providerId);
      if (removeContentOnSave && providerId === llmProvider?.value && profile.configured) return { label: '待移除', state: 'warning' };
      if (providerId === llmProvider?.value && contentConnectionChanged()) return { label: '待保存', state: 'warning' };
      const active = profile.models.find((item) => item.name === profile.activeModel) || profile.models[0];
      return verificationPresentation(active?.verification, profile.configured);
    }

    function renderProviderNavigation() {
      const transcriptionPresentation = removeAsrOnSave && config.configured
        ? { label: '待移除', state: 'warning' }
        : transcriptionConnectionChanged()
          ? { label: '待保存', state: 'warning' }
          : verificationPresentation(config.transcriptionVerification, config.configured);
      if (aiProviderTranscription) aiProviderTranscription.setAttribute('aria-selected', String(activeServicePanel === 'transcription'));
      if (aiTranscriptionNavStatus) {
        aiTranscriptionNavStatus.dataset.state = transcriptionPresentation.state;
        aiTranscriptionNavStatus.setAttribute('aria-label', transcriptionPresentation.label);
        aiTranscriptionNavStatus.title = transcriptionPresentation.label;
      }
      if (!aiContentProviderList) return;
      const providers = Array.isArray(config.contentProviders) ? config.contentProviders : [];
      aiContentProviderList.replaceChildren(...providers.map((provider) => {
        const profile = contentProfileFor(provider.id);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-provider-option';
        button.dataset.aiService = 'content';
        button.dataset.aiProvider = provider.id;
        button.dataset.activeProvider = String(provider.id === config.llmProviderId);
        button.setAttribute('aria-selected', String(activeServicePanel === 'content' && llmProvider?.value === provider.id));
        const copy = document.createElement('span');
        const name = document.createElement('strong'); name.textContent = provider.label;
        const detail = document.createElement('small'); detail.textContent = `${profile.models.length} 个模型 · ${profile.activeModel || '未命名'}`;
        const status = document.createElement('i');
        const presentation = contentProviderPresentation(provider.id);
        status.dataset.state = presentation.state;
        status.setAttribute('aria-label', presentation.label);
        status.title = presentation.label;
        copy.append(name, detail); button.append(copy, status);
        return button;
      }));
    }

    function renderContentProviderFields() {
      const provider = selectedContentProvider();
      if (!provider) return;
      const profile = contentProfileFor(provider.id);
      if (llmBaseUrlField) llmBaseUrlField.hidden = provider.endpointEditable !== true;
      if (llmBaseUrl) llmBaseUrl.placeholder = provider.endpointPlaceholder || 'https://服务地址/v1';
      if (llmApiHelp) llmApiHelp.hidden = !provider.keyUrl;
      if (llmApiHelpLabel) llmApiHelpLabel.textContent = `前往 ${provider.label} 管理 API Key`;
      if (llmApiKey) llmApiKey.placeholder = profile.configured ? '已配置，留空表示不更换' : `请输入 ${provider.label} API Key`;
      if (aiContentProviderTitle) aiContentProviderTitle.textContent = provider.label;
      if (aiContentProviderDescription) {
        aiContentProviderDescription.textContent = provider.id === 'custom-openai'
          ? '自定义公网 HTTPS 端点 · OpenAI-compatible'
          : `内容整理 · ${profile.models.length} 个模型 · 推荐 ${provider.defaultModel}`;
      }
      const credentialStatus = llmApiKey?.value.trim()
        ? { label: '待保存新密钥', state: 'warning' }
        : profile.credentialSource === 'environment'
          ? { label: '由环境变量提供', state: 'saved' }
          : profile.needsReentry
            ? { label: '需重新输入', state: 'error' }
            : profile.configured
              ? { label: '已安全保存', state: 'saved' }
              : { label: '未配置', state: 'empty' };
      setStatusPresentation(llmApiStatus, credentialStatus);
      setStatusPresentation(contentVerificationStatus, contentProviderPresentation(provider.id));
      if (contentProviderRemove) contentProviderRemove.disabled = !profile.saved && !profile.configured;
      if (aiSettingsReset) aiSettingsReset.disabled = !hasChanges();
      renderProviderNavigation();
    }

    function populateContentProviders() {
      if (!llmProvider) return;
      const providers = Array.isArray(config.contentProviders) ? config.contentProviders : [];
      llmProvider.replaceChildren(...providers.map((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.label;
        return option;
      }));
      llmProvider.value = providers.some((provider) => provider.id === config.llmProviderId)
        ? config.llmProviderId : providers[0]?.id || 'deepseek';
    }

    function updateConfigUi() {
      const statuses = Domain.apiCredentialStatuses(config);
      const transcriptionCredentialStatus = config.asrCredentialSource === 'environment'
        ? { label: '由环境变量提供', state: 'saved' }
        : statuses.transcription;
      setStatusPresentation(transcriptionApiStatus, transcriptionCredentialStatus);
      if (transcriptionRegion) transcriptionRegion.value = config.region || 'beijing';
      if (transcriptionWorkspace) transcriptionWorkspace.value = config.workspaceId || '';
      const transcriptionVerification = removeAsrOnSave && config.configured
        ? { label: '待移除', state: 'warning' }
        : transcriptionConnectionChanged()
          ? { label: '待保存', state: 'warning' }
          : verificationPresentation(config.transcriptionVerification, config.configured);
      setStatusPresentation(transcriptionVerificationStatus, transcriptionVerification);
      populateContentProviders();
      const activeContentProfile = contentProfileFor(llmProvider?.value);
      if (llmBaseUrl) llmBaseUrl.value = activeContentProfile.baseUrl;
      if (llmTimeout) llmTimeout.value = String(activeContentProfile.timeoutMs || 30000);
      renderContentModels(activeContentProfile);
      renderContentProviderFields();
      if (aiAutoNameNotes) aiAutoNameNotes.checked = config.autoNameNotes === true;
      if (aiAutoNameRecordings) aiAutoNameRecordings.checked = config.autoNameRecordings === true;
      if (aiAutoOrganizeLinks) aiAutoOrganizeLinks.checked = config.autoOrganizeLinks === true;
      if (settingsAiMigration) settingsAiMigration.hidden = config.aiMigrationNoticePending !== true;
      if (transcriptionProviderRemove) transcriptionProviderRemove.disabled = !config.configured || removeAsrOnSave;
      if (aiSettingsReset) aiSettingsReset.disabled = !hasChanges();
      renderProviderNavigation();
    }

    function diagnosticText(items) {
      return items.map((item) => `${item.at} | ${item.action} | ${item.provider} | ${item.model || '-'} | ${item.status}${item.error ? `:${item.error}` : ''} | wait:${item.queueWaitMs || 0}ms run:${item.durationMs}ms | in:${item.usage?.inputTokens || 0} out:${item.usage?.outputTokens || 0} | ${item.promptVersion || '-'}`).join('\n');
    }

    async function renderDiagnostics() {
      if (!aiDiagnostics) return;
      const result = await window.notchAPI?.getAIDiagnostics?.().catch(() => ({ ok: false }));
      const items = result?.ok && Array.isArray(result.items) ? result.items.slice().reverse() : [];
      aiDiagnostics.replaceChildren();
      aiDiagnostics.dataset.copyText = '';
      if (!items.length) {
        const empty = document.createElement('p');
        empty.textContent = result?.ok ? '暂无请求记录' : '无法读取请求诊断';
        aiDiagnostics.append(empty);
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('section'); row.className = 'ai-diagnostic-row';
        const name = document.createElement('strong'); name.textContent = `${item.action} · ${item.status}`;
        const time = document.createElement('time'); time.textContent = new Date(item.at).toLocaleString();
        const detail = document.createElement('span'); detail.textContent = `${item.provider} · ${item.model || '未记录模型'} · 等待 ${item.queueWaitMs || 0}ms · 请求 ${item.durationMs}ms${item.error ? ` · ${item.error}` : ''}`;
        row.append(name, time, detail); aiDiagnostics.append(row);
      });
      aiDiagnostics.dataset.copyText = diagnosticText(items.slice().reverse());
    }

    function showDirtyNote() {
      if (!dirty || !transcriptionSettingsNote) return;
      transcriptionSettingsNote.classList.remove('error', 'success');
      transcriptionSettingsNote.textContent = '有未保存的 AI 配置更改。';
    }

    function selectServicePanel(slot, focus = false) {
      activeServicePanel = slot === 'transcription' ? 'transcription' : 'content';
      const transcriptionActive = activeServicePanel === 'transcription';
      if (aiServicePanelTranscription) aiServicePanelTranscription.hidden = !transcriptionActive;
      if (aiServicePanelContent) aiServicePanelContent.hidden = transcriptionActive;
      if (aiContentSettingsSecondary) aiContentSettingsSecondary.hidden = transcriptionActive;
      renderProviderNavigation();
      if (!focus) return;
      const target = transcriptionActive
        ? aiProviderTranscription
        : aiContentProviderList?.querySelector(`[data-ai-provider="${CSS.escape(llmProvider?.value || '')}"]`);
      target?.focus();
    }

    async function open(slot = 'content') {
      if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
      if (window.NotchPanel?.navigate) await window.NotchPanel.navigate({ tab: 'settings' });
      else document.querySelector('[data-tab="settings"]')?.click();
      window.NotchSettings?.select('api');
      transcriptionSettingsNote?.classList.remove('error', 'success');
      if (transcriptionSettingsNote && !dirty) {
        transcriptionSettingsNote.textContent = config.asrNeedsReentry || config.llmNeedsReentry
          ? '检测到无法解密的旧密钥，请在对应服务中重新输入。'
          : '已配置的 API Key 可留空；新输入的密钥会覆盖旧值。';
      }
      selectServicePanel(slot);
      void renderDiagnostics();
      setTimeout(() => {
        if (slot === 'transcription') aiProviderTranscription?.focus();
        else aiContentProviderList?.querySelector('[aria-selected="true"]')?.focus();
      }, 0);
    }

    async function save() {
      if (!window.notchAPI || !transcriptionSettingsSave) return;
      const provider = selectedContentProvider();
      const normalizedModels = currentContentModels().map((model) => model.replace(/\s+/g, ' ').trim());
      if (!removeContentOnSave && (!provider || !normalizedModels.length || normalizedModels.some((model) => !model))) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = '每个模型都需要填写有效名称。';
        selectServicePanel('content');
        llmModelList?.querySelector('input[value=""]')?.focus();
        return;
      }
      if (!removeContentOnSave && new Set(normalizedModels).size !== normalizedModels.length) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = '同一厂商下不能添加重名模型。';
        selectServicePanel('content');
        return;
      }
      if (!removeContentOnSave && provider.endpointEditable && !llmBaseUrl?.value.trim()) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = '请填写该厂商的 Base URL。';
        selectServicePanel('content');
        return;
      }
      transcriptionSettingsSave.disabled = true;
      transcriptionSettingsNote.classList.remove('error', 'success');
      transcriptionSettingsNote.textContent = '正在安全保存…';
      let result;
      try {
        result = await window.notchAPI.setTranscriptionConfig({
          apiKey: transcriptionApiKey.value,
          removeAsr: removeAsrOnSave,
          region: transcriptionRegion.value,
          workspaceId: transcriptionWorkspace.value,
          llmApiKey: llmApiKey.value,
          removeContent: removeContentOnSave,
          llmProviderId: llmProvider.value,
          llmBaseUrl: llmBaseUrl.value,
          llmModel: llmModel.value,
          llmModels: normalizedModels,
          llmTimeoutMs: Number(llmTimeout?.value) || 30000,
          autoNameNotes: aiAutoNameNotes?.checked === true,
          autoNameRecordings: aiAutoNameRecordings?.checked === true,
          autoOrganizeLinks: aiAutoOrganizeLinks?.checked === true,
        });
      } catch (error) {
        result = { ok: false, error: 'save_failed' };
      }
      transcriptionSettingsSave.disabled = false;
      if (!result?.ok) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = result?.error === 'invalid_workspace'
          ? 'Workspace ID 格式不正确。'
          : result?.error === 'invalid_provider'
            ? '不支持所选 AI 厂商。'
            : result?.error === 'invalid_llm_url'
              ? '内容整理 Base URL 必须是有效的 HTTPS 地址。'
              : ['invalid_model', 'invalid_model_count'].includes(result?.error)
                ? '请添加 1 至 12 个有效模型。'
                : result?.error === 'duplicate_model'
                  ? '同一厂商下不能添加重名模型。'
                  : result?.error === 'secure_storage_unavailable'
                    ? '当前系统安全存储不可用，可改用环境变量提供 API Key。'
                    : '配置保存失败，请重试。';
        return;
      }
      config = result;
      exposeConfig();
      window.dispatchEvent(new CustomEvent('notch:ai-settings-changed'));
      removeAsrOnSave = false;
      removeContentOnSave = false;
      dirty = false;
      if (transcriptionApiKey) transcriptionApiKey.value = '';
      if (llmApiKey) llmApiKey.value = '';
      updateConfigUi();
      transcriptionSettingsNote.classList.remove('error');
      transcriptionSettingsNote.classList.add('success');
      transcriptionSettingsNote.textContent = '配置已安全保存。新配置需要单独验证后才会显示为已验证。';
      transcriptionSettingsSave.textContent = '已保存';
      setTimeout(() => {
        if (transcriptionSettingsSave) transcriptionSettingsSave.textContent = '保存更改';
      }, 1200);
      const lifecycle = getRecordingLifecycle();
      const pipeline = getTranscriptionPipeline();
      if (config.configured && ['recording', 'paused'].includes(lifecycle?.status()) && !pipeline?.hasCloudSession()) {
        pipeline.stopBrowser();
        pipeline.startCloud(lifecycle.stream());
      }
      updateRecordingUi();
      renderSettingsPanel();
    }

    async function load() {
      if (!window.notchAPI || typeof window.notchAPI.getTranscriptionConfig !== 'function') return;
      try {
        const result = await window.notchAPI.getTranscriptionConfig();
        if (result) config = result;
      } catch (error) {}
      exposeConfig();
      updateConfigUi();
      updateRecordingUi();
      renderSettingsPanel();
    }

    async function testConfiguredProvider(slot, button) {
      const configured = slot === 'transcription' ? config.configured : config.llmConfigured;
      if (!configured || (slot === 'transcription' ? removeAsrOnSave : removeContentOnSave)) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = '请先保存该服务的 API Key，再验证配置。';
        return;
      }
      const connectionChanged = slot === 'transcription' ? transcriptionConnectionChanged() : contentConnectionChanged();
      if (connectionChanged) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = '当前服务有未保存的修改，请保存后再验证。';
        return;
      }
      button.disabled = true;
      transcriptionSettingsNote.classList.remove('error', 'success');
      transcriptionSettingsNote.textContent = slot === 'transcription'
        ? '正在验证实时转写连接，不会启动麦克风…'
        : '正在验证内容整理服务，可能产生少量 API 费用…';
      const result = await window.notchAPI?.testAIProvider?.(slot).catch(() => ({ ok: false, error: 'network_error' }));
      button.disabled = false;
      const refreshed = await window.notchAPI?.getTranscriptionConfig?.().catch(() => null);
      if (refreshed) {
        config = refreshed;
        exposeConfig();
        updateConfigUi();
        renderSettingsPanel();
      }
      transcriptionSettingsNote.classList.toggle('success', result?.ok === true);
      transcriptionSettingsNote.classList.toggle('error', result?.ok !== true);
      transcriptionSettingsNote.textContent = result?.ok
        ? slot === 'transcription'
          ? '实时转写连接已验证；测试过程未访问麦克风。'
          : '内容整理连接已验证，文本与结构化输出均可用。'
        : result?.error === 'structured_output_unsupported'
          ? `基础连接正常，但结构化输出不可用（${result.providerError || '格式不兼容'}）。`
          : `配置验证失败：${result?.error || '请检查配置'}`;
      if (slot === 'content') await renderDiagnostics();
    }

    recordingConfigure?.addEventListener('click', () => { void open('transcription'); });
    transcriptionSettingsSave?.addEventListener('click', save);
    aiProviderTranscription?.addEventListener('click', () => selectServicePanel('transcription'));
    aiContentProviderList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-ai-provider]');
      if (!button || !llmProvider) return;
      const providerId = button.dataset.aiProvider;
      if (llmProvider.value === providerId) selectServicePanel('content');
      else {
        if (contentProfileFieldsChanged()) {
          transcriptionSettingsNote.classList.add('error');
          transcriptionSettingsNote.textContent = '当前厂商有未保存的配置，请先保存或撤销更改。';
          return;
        }
        llmProvider.value = providerId;
        llmProvider.dispatchEvent(new Event('change', { bubbles: true }));
      }
      aiContentProviderList.querySelector(`[data-ai-provider="${CSS.escape(providerId)}"]`)?.focus();
    });
    document.querySelector('.ai-provider-sidebar')?.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const options = [...document.querySelectorAll('.ai-provider-sidebar .ai-provider-option')];
      const index = options.indexOf(document.activeElement);
      if (index < 0 || !options.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next].focus();
      options[next].click();
    });
    llmProvider?.addEventListener('change', () => {
      const provider = selectedContentProvider();
      if (!provider) return;
      const profile = contentProfileFor(provider.id);
      if (llmBaseUrl) llmBaseUrl.value = profile.baseUrl;
      if (llmTimeout) llmTimeout.value = String(profile.timeoutMs || 30000);
      if (llmApiKey) llmApiKey.value = '';
      removeContentOnSave = false;
      renderContentModels(profile);
      dirty = hasChanges();
      selectServicePanel('content');
      if (aiProviderConfigBody) aiProviderConfigBody.scrollTop = 0;
      renderContentProviderFields();
      transcriptionSettingsNote.classList.remove('error', 'success');
      transcriptionSettingsNote.textContent = profile.configured
        ? `${provider.label} 已保存 ${profile.models.length} 个模型；保存可将所选模型设为全局默认。`
        : `${provider.label} 尚未配置；添加模型和 API Key 后保存。`;
    });
    llmModelAdd?.addEventListener('click', () => {
      const models = currentContentModels();
      if (models.length >= 12) return;
      renderContentModels(contentModelDraft([...models, ''], llmModel?.value));
      dirty = hasChanges();
      if (aiSettingsReset) aiSettingsReset.disabled = !dirty;
      showDirtyNote();
      renderContentProviderFields();
      [...(llmModelList?.querySelectorAll('[data-ai-model-name]') || [])].at(-1)?.focus();
    });
    llmModelList?.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-ai-model-remove]');
      if (!remove) return;
      const index = Number(remove.dataset.aiModelRemove);
      const models = currentContentModels();
      if (models.length <= 1 || !Number.isInteger(index) || index < 0 || index >= models.length) return;
      const removed = models.splice(index, 1)[0];
      const activeModel = llmModel?.value === removed ? models[0] : llmModel?.value;
      renderContentModels(contentModelDraft(models, activeModel));
      dirty = hasChanges();
      if (aiSettingsReset) aiSettingsReset.disabled = !dirty;
      showDirtyNote();
      renderContentProviderFields();
    });
    llmModelList?.addEventListener('input', (event) => {
      const input = event.target.closest('[data-ai-model-name]');
      if (!input) return;
      const row = input.closest('.ai-model-row');
      if (row?.querySelector('[data-ai-model-active]')?.checked && llmModel) llmModel.value = input.value;
    });
    llmModelList?.addEventListener('change', (event) => {
      const radio = event.target.closest('[data-ai-model-active]');
      if (!radio || !llmModel) return;
      llmModel.value = radio.closest('.ai-model-row')?.querySelector('[data-ai-model-name]')?.value || '';
    });
    aiSettingsReset?.addEventListener('click', () => {
      removeAsrOnSave = false;
      removeContentOnSave = false;
      dirty = false;
      if (transcriptionApiKey) transcriptionApiKey.value = '';
      if (llmApiKey) llmApiKey.value = '';
      updateConfigUi();
      transcriptionSettingsNote.classList.remove('error', 'success');
      transcriptionSettingsNote.textContent = '未保存的更改已撤销。';
    });
    aiSettingsRoot?.addEventListener('input', (event) => {
      if (!event.target.closest('.ai-service-panel, .ai-auto-settings')) return;
      if (event.target === transcriptionApiKey) {
        removeAsrOnSave = false;
        if (transcriptionProviderRemove) transcriptionProviderRemove.disabled = !config.configured;
      }
      if (event.target === llmApiKey) {
        removeContentOnSave = false;
        if (contentProviderRemove) {
          const profile = contentProfileFor(llmProvider?.value);
          contentProviderRemove.disabled = !profile.saved && !profile.configured;
        }
      }
      dirty = hasChanges();
      if (aiSettingsReset) aiSettingsReset.disabled = !dirty;
      showDirtyNote();
      if (event.target.closest('#ai-service-panel-content')) renderContentProviderFields();
      if (event.target.closest('#ai-service-panel-transcription')) {
        setStatusPresentation(transcriptionVerificationStatus, { label: '待保存', state: 'warning' });
        renderProviderNavigation();
      }
    });
    aiSettingsRoot?.addEventListener('change', (event) => {
      if (!event.target.closest('.ai-service-panel, .ai-auto-settings')) return;
      dirty = hasChanges();
      if (aiSettingsReset) aiSettingsReset.disabled = !dirty;
      showDirtyNote();
      if (event.target.closest('#ai-service-panel-content')) renderContentProviderFields();
      if (event.target.closest('#ai-service-panel-transcription')) {
        setStatusPresentation(transcriptionVerificationStatus, transcriptionConnectionChanged()
          ? { label: '待保存', state: 'warning' }
          : verificationPresentation(config.transcriptionVerification, config.configured));
        renderProviderNavigation();
      }
    });
    transcriptionProviderRemove?.addEventListener('click', () => {
      removeAsrOnSave = true;
      dirty = hasChanges();
      if (transcriptionApiKey) transcriptionApiKey.value = '';
      transcriptionProviderRemove.disabled = true;
      transcriptionSettingsNote.classList.remove('error', 'success');
      transcriptionSettingsNote.textContent = config.asrCredentialSource === 'environment'
        ? '保存后会移除本机转写密钥；环境变量仍会继续生效。'
        : '实时转写配置将在保存时移除。';
      setStatusPresentation(transcriptionVerificationStatus, { label: '待移除', state: 'warning' });
      if (aiSettingsReset) aiSettingsReset.disabled = false;
      renderProviderNavigation();
    });
    contentProviderRemove?.addEventListener('click', () => {
      removeContentOnSave = true;
      dirty = hasChanges();
      if (llmApiKey) llmApiKey.value = '';
      contentProviderRemove.disabled = true;
      transcriptionSettingsNote.classList.remove('error', 'success');
      const profile = contentProfileFor(llmProvider?.value);
      transcriptionSettingsNote.textContent = profile.credentialSource === 'environment'
        ? '保存后会移除本机厂商密钥；环境变量仍会继续生效。'
        : '当前厂商配置将在保存时移除，其他厂商不受影响。';
      renderContentProviderFields();
    });
    settingsAiMigrationAck?.addEventListener('click', async () => {
      const result = await window.notchAPI?.acknowledgeAIMigration?.().catch(() => ({ ok: false }));
      if (!result?.ok) {
        setSettingsNote('无法保存迁移确认，请重试。', true);
        return;
      }
      config = result;
      exposeConfig();
      updateConfigUi();
      renderSettingsPanel();
    });
    aiDiagnosticsCopy?.addEventListener('click', async () => {
      const text = aiDiagnostics?.dataset.copyText || '';
      if (!text) {
        transcriptionSettingsNote.textContent = '暂无可复制的请求诊断。';
        return;
      }
      const result = await window.notchAPI?.writeClipboard?.({ type: 'text', text }).catch(() => false);
      transcriptionSettingsNote.textContent = result === false || result?.ok === false ? '复制诊断失败。' : '已复制脱敏请求诊断。';
    });
    aiDiagnosticsClear?.addEventListener('click', async () => {
      const result = await window.notchAPI?.clearAIDiagnostics?.().catch(() => ({ ok: false }));
      transcriptionSettingsNote.textContent = result?.ok ? '已清空请求诊断。' : '清空请求诊断失败。';
      if (result?.ok) await renderDiagnostics();
    });
    aiProviderTest?.addEventListener('click', () => testConfiguredProvider('content', aiProviderTest));
    transcriptionProviderTest?.addEventListener('click', () => testConfiguredProvider('transcription', transcriptionProviderTest));
    transcriptionApiHelp?.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
    llmApiHelp?.addEventListener('click', () => {
      const provider = selectedContentProvider();
      if (provider?.keyUrl) window.notchAPI?.openExternal(provider.keyUrl);
    });
    window.notchAPI?.onOpenApiSettings?.(() => { void open(); });
    window.addEventListener('notch:settings-category-change', (event) => {
      if (event.detail?.id !== 'api') return;
      renderProviderNavigation();
      void renderDiagnostics();
    });

    return Object.freeze({
      config: () => config,
      acceptConfig,
      load,
      open,
      renderProviderNavigation,
      renderDiagnostics,
    });
  }

  window.NotchWorkspaceAISettings = Object.freeze({ createController });
})();
