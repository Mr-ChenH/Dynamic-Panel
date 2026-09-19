(function initWorkspace() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const LINKS_KEY = 'notch-link-groups';
  const RECORDINGS_KEY = 'notch-recordings';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const AI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
  const STAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>';
  const READ_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  async function syncWorkspaceData() {
    if (!window.notchAPI?.saveWorkspaceData) return true;
    const storage = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) storage[key] = localStorage.getItem(key);
    }
    try { return await window.notchAPI.saveWorkspaceData(storage) !== false; } catch (error) { return false; }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // ============ 链接收藏夹 ============
  const linkInput = document.getElementById('link-add');
  const linkBulkDelete = document.getElementById('link-bulk-delete');
  const linkGroupsEl = document.getElementById('link-groups');
  const linksStatus = document.getElementById('links-status');
  let linkGroups = loadJson(LINKS_KEY, []);
  if (!Array.isArray(linkGroups)) linkGroups = [];
  const LinksDomain = window.NotchWorkspaceLinksDomain;
  linkGroups = LinksDomain?.normalizeGroups(linkGroups) || [];
  let linkSelection = new Set();
  let linkSelectionAnchor = null;
  let addingLinkGroupId = '';
  const linksSearch=document.getElementById('links-search'),groupFilter=document.getElementById('links-group-filter'),viewFilter=document.getElementById('links-view-filter'),tagFilter=document.getElementById('links-tag-filter');
  const linksSidebar=document.querySelector('.links-sidebar'),linksSidebarGroups=document.getElementById('links-sidebar-groups'),linksSidebarTags=document.getElementById('links-sidebar-tags');
  const linksCollapseAll=document.getElementById('links-collapse-all');
  const linksAddSubmit=document.getElementById('links-add-submit');
  const linkLimits=new Map();
  const LINK_PAGE_SIZE=40;

  function persistLinks() {
    return saveJson(LINKS_KEY, linkGroups);
  }

  function setLinksStatus(message, tone = '') {
    if (linksStatus) {
      linksStatus.textContent = '';
      linksStatus.dataset.tone = tone;
    }
    if (message && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function allLinks() {
    return linkGroups.flatMap((group) => Array.isArray(group.links) ? group.links : []);
  }

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  const renderLinkGroups = window.NotchWorkspaceLinksRenderer.createRenderer({
    Domain,
    getGroups: () => linkGroups,
    getSelection: () => linkSelection,
    getAddingGroupId: () => addingLinkGroupId,
    getLimit: (groupId) => linkLimits.get(groupId),
    setLimit: (groupId, limit) => linkLimits.set(groupId, limit),
    getSearch: () => linksSearch,
    getGroupFilter: () => groupFilter,
    getViewFilter: () => viewFilter,
    getTagFilter: () => tagFilter,
    elements: { linkGroupsEl, linkBulkDelete, linksSidebarGroups, linksSidebarTags },
    createIconButton,
    icons: {
      'add-link-to-group': ADD_ICON,
      'delete-group': DELETE_ICON,
      'toggle-link-favorite': STAR_ICON,
      'toggle-link-read': READ_ICON,
      'open-link': OPEN_ICON,
      'name-link-ai': AI_ICON,
      'edit-link': EDIT_ICON,
      'delete-link': DELETE_ICON,
    },
    setStatus: setLinksStatus,
    pageSize: LINK_PAGE_SIZE,
  });

  function addLink(rawValue, requestedGroupId = '') {
    const normalized = Domain.normalizeHttpUrl(rawValue);
    if (!normalized) {
      setLinksStatus('请输入有效的公开网址', 'error');
      return false;
    }
    if (allLinks().some((link) => link.url === normalized)) {
      setLinksStatus('这个链接已经收藏过了', 'error');
      return false;
    }
    const previousLinkGroups = structuredClone(linkGroups);
    const link = { id: uid('link'), url: normalized, title: '未命名', description: '', tags: [], favorite: false, read: false, note: '', icon: '', createdAt: Date.now(), updatedAt: Date.now() };
    const preferredGroupId = requestedGroupId || Domain.preferredLinkGroupId(linkGroups, normalized);
    const preferredGroup = linkGroups.find((group) => group.id === preferredGroupId);
    if (preferredGroup) {
      linkGroups = linkGroups.map((group) => group.id === preferredGroup.id
        ? { ...group, collapsed: false, links: [...(group.links || []), link] }
        : group);
    } else {
      linkGroups = Domain.addLinkToGroups(linkGroups, link, Domain.classifyLink(normalized, ''));
    }
    const destination=linkGroups.find(group=>(group.links||[]).some(item=>item.id===link.id));
    if(destination)linkLimits.set(destination.id,Math.max(LINK_PAGE_SIZE,destination.links.length));
    if(linksSearch)linksSearch.value='';if(groupFilter)groupFilter.value='';
    linkSelection.clear();linkSelectionAnchor=null;
    if (!persistLinks()) {
      linkGroups = previousLinkGroups;
      renderLinkGroups();
      setLinksStatus('链接保存失败，请检查存储空间', 'error');
      return false;
    }
    renderLinkGroups();
    requestAnimationFrame(()=>linkGroupsEl.querySelector(`[data-link-id="${CSS.escape(String(link.id))}"]`)?.scrollIntoView({block:'nearest'}));
    setLinksStatus('链接已保存');

    // 保存动作不等待网络或大模型。标题、图标和分组在后台静默补全。
    Promise.resolve(window.notchAPI?.inspectLink?.(normalized)).then((inspected) => {
      if (!inspected?.ok) return;
      let sourceGroup = null;
      let savedLink = null;
      linkGroups.some((group) => {
        const found = (group.links || []).find((item) => item.id === link.id);
        if (!found) return false;
        sourceGroup = group;
        savedLink = found;
        return true;
      });
      if (!savedLink || !sourceGroup) return;
      savedLink.url = inspected.url || savedLink.url;
      savedLink.title = inspected.title || savedLink.title || '未命名';
      savedLink.description = String(inspected.description || savedLink.description || '').trim().slice(0, 500);
      savedLink.tags = Domain.normalizeLinkTags([...(savedLink.tags || []), ...(inspected.tags || [])]);
      savedLink.icon = inspected.icon || savedLink.icon || '';
      savedLink.updatedAt = Date.now();
      // 手动定向或同站点复用后锁定分组；自动分类只使用可预测的本地规则，
      // 避免模型自由命名生成多个近义分组。
      const lockedGroupId = preferredGroup?.id || Domain.preferredLinkGroupId(
        linkGroups.map((group) => ({
          ...group,
          links: (group.links || []).filter((item) => item.id !== savedLink.id),
        })),
        savedLink.url
      );
      const nextCategory = Domain.classifyLink(savedLink.url, savedLink.title);
      if (!lockedGroupId && nextCategory && nextCategory !== sourceGroup.name) {
        const target = linkGroups.find((group) => group.name === nextCategory);
        if (target) {
          linkGroups = Domain.moveLinkToGroup(linkGroups, savedLink.id, target.id);
        } else {
          sourceGroup.links = sourceGroup.links.filter((item) => item.id !== savedLink.id);
          linkGroups = Domain.addLinkToGroups(linkGroups, savedLink, nextCategory);
        }
      }
      persistLinks();
      renderLinkGroups();
      void syncWorkspaceData();
    }).catch(() => {});
    return true;
  }

  window.NotchWorkspaceLinksActions.createController({
    Domain,
    elements: { linkGroupsEl },
    getGroups: () => linkGroups,
    setGroups: (groups) => { linkGroups = groups; },
    getSelection: () => linkSelection,
    setSelection: (selection) => { linkSelection = selection; },
    getSelectionAnchor: () => linkSelectionAnchor,
    setSelectionAnchor: (anchor) => { linkSelectionAnchor = anchor; },
    getAddingGroupId: () => addingLinkGroupId,
    setAddingGroupId: (value) => { addingLinkGroupId = value; },
    persist: persistLinks,
    render: renderLinkGroups,
    addLink,
  });

  window.NotchWorkspaceLinksDrag.createController({
    Domain,
    elements: { linkGroupsEl, linksSearch, groupFilter },
    getGroups: () => linkGroups,
    setGroups: (groups) => { linkGroups = groups; },
    persist: persistLinks,
    render: renderLinkGroups,
    setStatus: setLinksStatus,
  });

  window.NotchWorkspaceLinksController.createController({
    elements: {
      linkGroupsEl,
      linkBulkDelete,
      linkInput,
      linksSearch,
      groupFilter,
      viewFilter,
      tagFilter,
      linksSidebar,
      linksSidebarGroups,
      linksSidebarTags,
      linksCollapseAll,
      linksAddSubmit,
      linkGroups: linkGroupsEl,
    },
    getGroups: () => linkGroups,
    getSelection: () => linkSelection,
    clearSelection: () => linkSelection.clear(),
    clearSelectionAnchor: () => { linkSelectionAnchor = null; },
    clearLimits: () => linkLimits.clear(),
    persist: persistLinks,
    render: renderLinkGroups,
    setStatus: setLinksStatus,
    addLink,
    deleteSelected: () => {
      linkGroups = linkGroups.map((group) => ({
        ...group,
        links: (group.links || []).filter((link) => !linkSelection.has(link.id)),
      }));
      linkSelection.clear();
      linkSelectionAnchor = null;
      persistLinks();
      renderLinkGroups();
    },
  });

  // ============ 录音与转写 ============
  const homeRecorder = document.getElementById('home-recorder');
  const recordingDot = document.getElementById('home-recording-dot');
  const recordingStateLabel = document.getElementById('home-recording-state');
  const recordingTime = document.getElementById('home-recording-time');
  const recordingStrands = document.getElementById('recording-strands');
  const liveTranscript = document.getElementById('home-live-transcript');
  const recordStart = document.getElementById('record-start');
  const recordPause = document.getElementById('record-pause');
  const recordStop = document.getElementById('record-stop');
  const recordingNew = document.getElementById('recording-new');
  const recordingConfigure = document.getElementById('recording-configure');
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
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
  const settingsFeatureList = document.getElementById('settings-feature-list');
  const settingsHomeModuleList = document.getElementById('settings-home-module-list');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsLauncherShortcutValue = document.getElementById('settings-launcher-shortcut-value');
  const settingsLauncherShortcutChange = document.getElementById('settings-launcher-shortcut-change');
  const settingsScreenshotShortcutValue = document.getElementById('settings-screenshot-shortcut-value');
  const settingsScreenshotShortcutChange = document.getElementById('settings-screenshot-shortcut-change');
  const settingsVideoShortcutValue = document.getElementById('settings-video-shortcut-value');
  const settingsVideoShortcutChange = document.getElementById('settings-video-shortcut-change');
  const settingsAudioShortcutValue = document.getElementById('settings-audio-shortcut-value');
  const settingsAudioShortcutChange = document.getElementById('settings-audio-shortcut-change');
  const settingsDefaultTab = document.getElementById('settings-default-tab');
  const settingsTheme = document.getElementById('settings-theme');
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsInlineNote = document.getElementById('settings-inline-note');

  let recordings = loadJson(RECORDINGS_KEY, []).map(Domain.createRecording).filter(Boolean);
  let selectedRecordingId = recordings[0] && recordings[0].id;
  let recordingSelection = new Set();
  let recordingSelectionAnchor = selectedRecordingId || null;
  let recordingLifecycle = null;
  let transcriptionPipeline = null;
  let transcriptionConfig = {
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
  };
  let settingsAppSettings = null;
  let settingsWorkspace = null;
  let activeAIServicePanel = 'content';
  let removeAsrOnSave = false;
  let removeContentOnSave = false;
  let aiSettingsDirty = false;
  let strandsAudioContext = null;
  let strandsAudioSource = null;
  let strandsAnalyser = null;
  let strandsFrame = null;
  let strandsSamples = null;
  let strandsLevel = 0;
  function isRecordingActive() {
    return recordingLifecycle?.isActive() === true;
  }

  function isRecordingBusy() {
    return recordingLifecycle?.isBusy() === true;
  }

  function stopRecordingStrands() {
    if (strandsFrame) cancelAnimationFrame(strandsFrame);
    strandsFrame = null;
    try { strandsAudioSource?.disconnect(); } catch (error) {}
    if (strandsAudioContext) strandsAudioContext.close().catch(() => {});
    strandsAudioContext = null;
    strandsAudioSource = null;
    strandsAnalyser = null;
    strandsSamples = null;
    strandsLevel = 0;
    const context = recordingStrands?.getContext('2d');
    context?.clearRect(0, 0, recordingStrands.width, recordingStrands.height);
  }

  function drawRecordingStrands(now) {
    if (!recordingStrands || !strandsAnalyser || !strandsSamples) {
      strandsFrame = null;
      return;
    }
    const bounds = recordingStrands.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (recordingStrands.width !== width || recordingStrands.height !== height) {
      recordingStrands.width = width;
      recordingStrands.height = height;
    }
    strandsAnalyser.getFloatTimeDomainData(strandsSamples);
    const measured = recordingLifecycle?.status() === 'recording' ? Domain.calculateAudioLevel(strandsSamples) : 0;
    strandsLevel += (measured - strandsLevel) * (measured > strandsLevel ? 0.34 : 0.08);
    const context = recordingStrands.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    context.globalCompositeOperation = 'lighter';
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    const activeLevel = Math.min(1, strandsLevel * 6);
    const centerY = cssHeight * 0.55;
    const phase = now * 0.00115;
    const colors = [
      ['rgba(82, 224, 255, 0)', `rgba(82, 224, 255, ${0.2 + activeLevel * 0.44})`, 'rgba(82, 224, 255, 0)'],
      ['rgba(111, 128, 255, 0)', `rgba(111, 128, 255, ${0.22 + activeLevel * 0.5})`, 'rgba(111, 128, 255, 0)'],
      ['rgba(209, 96, 255, 0)', `rgba(209, 96, 255, ${0.19 + activeLevel * 0.46})`, 'rgba(209, 96, 255, 0)'],
      ['rgba(255, 102, 184, 0)', `rgba(255, 102, 184, ${0.17 + activeLevel * 0.4})`, 'rgba(255, 102, 184, 0)'],
      ['rgba(255, 210, 91, 0)', `rgba(255, 210, 91, ${0.14 + activeLevel * 0.34})`, 'rgba(255, 210, 91, 0)'],
    ];
    context.filter = `blur(${8 + activeLevel * 10}px)`;
    colors.forEach((palette, layer) => {
      const gradient = context.createLinearGradient(cssWidth * 0.08, 0, cssWidth * 0.92, 0);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.36 + layer * 0.025, palette[1]);
      gradient.addColorStop(0.72 - layer * 0.02, palette[1]);
      gradient.addColorStop(1, palette[2]);
      const heightScale = cssHeight * (0.06 + layer * 0.012 + activeLevel * (0.18 + layer * 0.014));
      const drift = Math.sin(phase + layer * 0.92) * cssHeight * 0.025;
      context.beginPath();
      context.moveTo(cssWidth * 0.04, centerY);
      for (let x = cssWidth * 0.04; x <= cssWidth * 0.96; x += 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.sin(progress * Math.PI * (2.2 + layer * 0.18) + phase + layer) * heightScale * 0.16;
        context.lineTo(x, centerY - envelope * heightScale - ripple + drift);
      }
      for (let x = cssWidth * 0.96; x >= cssWidth * 0.04; x -= 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.cos(progress * Math.PI * (2 + layer * 0.14) - phase - layer) * heightScale * 0.14;
        context.lineTo(x, centerY + envelope * heightScale + ripple + drift);
      }
      context.closePath();
      context.fillStyle = gradient;
      context.globalAlpha = 0.58 - layer * 0.055;
      context.fill();
    });
    context.filter = 'blur(2px)';
    const core = context.createLinearGradient(cssWidth * 0.16, 0, cssWidth * 0.84, 0);
    core.addColorStop(0, 'rgba(66, 191, 255, 0)');
    core.addColorStop(0.34, `rgba(172, 238, 255, ${0.3 + activeLevel * 0.55})`);
    core.addColorStop(0.58, `rgba(255, 209, 255, ${0.38 + activeLevel * 0.58})`);
    core.addColorStop(0.78, `rgba(255, 213, 117, ${0.24 + activeLevel * 0.5})`);
    core.addColorStop(1, 'rgba(255, 130, 196, 0)');
    context.globalAlpha = 1;
    context.fillStyle = core;
    context.fillRect(cssWidth * 0.08, centerY - 1.3 - activeLevel, cssWidth * 0.84, 2.6 + activeLevel * 2);
    context.restore();
    homeRecorder?.style.setProperty('--recording-level', strandsLevel.toFixed(3));
    strandsFrame = requestAnimationFrame(drawRecordingStrands);
  }

  function startRecordingStrands(stream) {
    stopRecordingStrands();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream || !recordingStrands) return;
    try {
      strandsAudioContext = new AudioContext();
      strandsAudioSource = strandsAudioContext.createMediaStreamSource(stream);
      strandsAnalyser = strandsAudioContext.createAnalyser();
      strandsAnalyser.fftSize = 512;
      strandsAnalyser.smoothingTimeConstant = 0.72;
      strandsSamples = new Float32Array(strandsAnalyser.fftSize);
      strandsAudioSource.connect(strandsAnalyser);
      strandsFrame = requestAnimationFrame(drawRecordingStrands);
    } catch (error) {
      stopRecordingStrands();
    }
  }

  function verificationPresentation(verification, configured) {
    if (!configured) return { label: '未配置', state: 'empty' };
    if (verification?.state === 'verified') return { label: '已验证', state: 'saved' };
    if (verification?.state === 'failed') return { label: '验证失败', state: 'error' };
    return { label: '待验证', state: 'warning' };
  }

  function selectedContentProvider() {
    const providers = Array.isArray(transcriptionConfig.contentProviders) ? transcriptionConfig.contentProviders : [];
    return providers.find((provider) => provider.id === llmProvider?.value)
      || providers.find((provider) => provider.id === transcriptionConfig.llmProviderId)
      || null;
  }

  function setStatusPresentation(element, presentation) {
    if (!element) return;
    element.textContent = presentation.label;
    element.dataset.state = presentation.state;
  }

  function contentProfileFor(providerId) {
    const provider = (transcriptionConfig.contentProviders || []).find((item) => item.id === providerId);
    const saved = (transcriptionConfig.contentProviderConfigs || []).find((item) => item.providerId === providerId);
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
      || transcriptionRegion?.value !== (transcriptionConfig.region || 'beijing')
      || transcriptionWorkspace?.value.trim() !== (transcriptionConfig.workspaceId || '');
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
    return llmProvider?.value !== transcriptionConfig.llmProviderId || contentProfileFieldsChanged();
  }

  function hasAISettingsChanges() {
    return transcriptionConnectionChanged()
      || contentConnectionChanged()
      || aiAutoNameNotes?.checked !== (transcriptionConfig.autoNameNotes === true)
      || aiAutoNameRecordings?.checked !== (transcriptionConfig.autoNameRecordings === true)
      || aiAutoOrganizeLinks?.checked !== (transcriptionConfig.autoOrganizeLinks === true);
  }

  function contentProviderPresentation(providerId) {
    const profile = contentProfileFor(providerId);
    if (removeContentOnSave && providerId === llmProvider?.value && profile.configured) return { label: '待移除', state: 'warning' };
    if (providerId === llmProvider?.value && contentConnectionChanged()) return { label: '待保存', state: 'warning' };
    const active = profile.models.find((item) => item.name === profile.activeModel) || profile.models[0];
    return verificationPresentation(active?.verification, profile.configured);
  }

  function renderAIProviderNavigation() {
    const transcriptionPresentation = removeAsrOnSave && transcriptionConfig.configured
      ? { label: '待移除', state: 'warning' }
      : transcriptionConnectionChanged()
        ? { label: '待保存', state: 'warning' }
        : verificationPresentation(transcriptionConfig.transcriptionVerification, transcriptionConfig.configured);
    if (aiProviderTranscription) aiProviderTranscription.setAttribute('aria-selected', String(activeAIServicePanel === 'transcription'));
    if (aiTranscriptionNavStatus) {
      aiTranscriptionNavStatus.dataset.state = transcriptionPresentation.state;
      aiTranscriptionNavStatus.setAttribute('aria-label', transcriptionPresentation.label);
      aiTranscriptionNavStatus.title = transcriptionPresentation.label;
    }
    if (!aiContentProviderList) return;
    const providers = Array.isArray(transcriptionConfig.contentProviders) ? transcriptionConfig.contentProviders : [];
    aiContentProviderList.replaceChildren(...providers.map((provider) => {
      const profile = contentProfileFor(provider.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-provider-option';
      button.dataset.aiService = 'content';
      button.dataset.aiProvider = provider.id;
      button.dataset.activeProvider = String(provider.id === transcriptionConfig.llmProviderId);
      button.setAttribute('aria-selected', String(activeAIServicePanel === 'content' && llmProvider?.value === provider.id));
      const copy = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = provider.label;
      const detail = document.createElement('small');
      detail.textContent = `${profile.models.length} 个模型 · ${profile.activeModel || '未命名'}`;
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
    if (llmApiKey) llmApiKey.placeholder = profile.configured
      ? '已配置，留空表示不更换'
      : `请输入 ${provider.label} API Key`;
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
    if (aiSettingsReset) aiSettingsReset.disabled = !hasAISettingsChanges();
    renderAIProviderNavigation();
  }

  function populateContentProviders() {
    if (!llmProvider) return;
    const providers = Array.isArray(transcriptionConfig.contentProviders) ? transcriptionConfig.contentProviders : [];
    llmProvider.replaceChildren(...providers.map((provider) => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.label;
      return option;
    }));
    llmProvider.value = providers.some((provider) => provider.id === transcriptionConfig.llmProviderId)
      ? transcriptionConfig.llmProviderId : providers[0]?.id || 'deepseek';
  }

  function updateTranscriptionConfigUi() {
    const statuses = Domain.apiCredentialStatuses(transcriptionConfig);
    const transcriptionCredentialStatus = transcriptionConfig.asrCredentialSource === 'environment'
      ? { label: '由环境变量提供', state: 'saved' }
      : statuses.transcription;
    setStatusPresentation(transcriptionApiStatus, transcriptionCredentialStatus);
    if (transcriptionRegion) transcriptionRegion.value = transcriptionConfig.region || 'beijing';
    if (transcriptionWorkspace) transcriptionWorkspace.value = transcriptionConfig.workspaceId || '';
    const transcriptionVerification = removeAsrOnSave && transcriptionConfig.configured
      ? { label: '待移除', state: 'warning' }
      : transcriptionConnectionChanged()
        ? { label: '待保存', state: 'warning' }
        : verificationPresentation(transcriptionConfig.transcriptionVerification, transcriptionConfig.configured);
    setStatusPresentation(transcriptionVerificationStatus, transcriptionVerification);
    populateContentProviders();
    const activeContentProfile = contentProfileFor(llmProvider?.value);
    if (llmBaseUrl) llmBaseUrl.value = activeContentProfile.baseUrl;
    if (llmTimeout) llmTimeout.value = String(activeContentProfile.timeoutMs || 30000);
    renderContentModels(activeContentProfile);
    renderContentProviderFields();
    if (aiAutoNameNotes) aiAutoNameNotes.checked = transcriptionConfig.autoNameNotes === true;
    if (aiAutoNameRecordings) aiAutoNameRecordings.checked = transcriptionConfig.autoNameRecordings === true;
    if (aiAutoOrganizeLinks) aiAutoOrganizeLinks.checked = transcriptionConfig.autoOrganizeLinks === true;
    if (settingsAiMigration) settingsAiMigration.hidden = transcriptionConfig.aiMigrationNoticePending !== true;
    if (transcriptionProviderRemove) transcriptionProviderRemove.disabled = !transcriptionConfig.configured || removeAsrOnSave;
    if (aiSettingsReset) aiSettingsReset.disabled = !hasAISettingsChanges();
    renderAIProviderNavigation();
  }

  function diagnosticText(items) {
    return items.map((item) => `${item.at} | ${item.action} | ${item.provider} | ${item.model || '-'} | ${item.status}${item.error ? `:${item.error}` : ''} | wait:${item.queueWaitMs || 0}ms run:${item.durationMs}ms | in:${item.usage?.inputTokens || 0} out:${item.usage?.outputTokens || 0} | ${item.promptVersion || '-'}`).join('\n');
  }

  async function renderAIDiagnostics() {
    if (!aiDiagnostics) return;
    const result = await window.notchAPI?.getAIDiagnostics?.().catch(() => ({ ok: false }));
    const items = result?.ok && Array.isArray(result.items) ? result.items.slice().reverse() : [];
    aiDiagnostics.replaceChildren();
    aiDiagnostics.dataset.copyText = '';
    if (!items.length) { const empty = document.createElement('p'); empty.textContent = result?.ok ? '暂无请求记录' : '无法读取请求诊断'; aiDiagnostics.append(empty); return; }
    items.forEach((item) => {
      const row = document.createElement('section'); row.className = 'ai-diagnostic-row';
      const name = document.createElement('strong'); name.textContent = `${item.action} · ${item.status}`;
      const time = document.createElement('time'); time.textContent = new Date(item.at).toLocaleString();
      const detail = document.createElement('span'); detail.textContent = `${item.provider} · ${item.model || '未记录模型'} · 等待 ${item.queueWaitMs || 0}ms · 请求 ${item.durationMs}ms${item.error ? ` · ${item.error}` : ''}`;
      row.append(name, time, detail); aiDiagnostics.append(row);
    });
    aiDiagnostics.dataset.copyText = diagnosticText(items.slice().reverse());
  }

  function shortcutLabel(value) {
    if (!value) return '未设置';
    const mac = window.notchAPI?.platform === 'darwin';
    return String(value).split('+').map((part) => ({
      CommandOrControl: mac ? 'Cmd' : 'Ctrl',
      Command: 'Cmd',
      Control: 'Ctrl',
      Option: 'Option',
      Alt: mac ? 'Option' : 'Alt',
    })[part] || part).join(' + ');
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  function showAISettingsDirtyNote() {
    if (!aiSettingsDirty || !transcriptionSettingsNote) return;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '有未保存的 AI 配置更改。';
  }

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: transcriptionConfig,
    });
    if (settingsShortcutValue) settingsShortcutValue.textContent = shortcutLabel(summary.shortcut);
    if (settingsLauncherShortcutValue) settingsLauncherShortcutValue.textContent = shortcutLabel(settingsAppSettings?.shortcuts?.launcher);
    if (settingsScreenshotShortcutValue) settingsScreenshotShortcutValue.textContent = shortcutLabel(settingsAppSettings?.shortcuts?.screenshot);
    if (settingsVideoShortcutValue) settingsVideoShortcutValue.textContent = shortcutLabel(settingsAppSettings?.shortcuts?.screenRecording);
    if (settingsAudioShortcutValue) settingsAudioShortcutValue.textContent = shortcutLabel(settingsAppSettings?.shortcuts?.audioRecording);
    if (settingsTheme) {
      const theme = settingsAppSettings?.theme === 'light' ? 'light' : 'dark';
      settingsTheme.querySelectorAll('[data-theme-value]').forEach((button) => {
        const selected = button.dataset.themeValue === theme;
        button.setAttribute('aria-pressed', String(selected));
      });
    }
    if (settingsDefaultTab) {
      const visibleTabs = new Set(Domain.visiblePanelTabs(
        ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'],
        settingsAppSettings?.features
      ));
      Array.from(settingsDefaultTab.options).forEach((option) => {
        const visible = visibleTabs.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });
      settingsDefaultTab.value = visibleTabs.has(summary.defaultTab) ? summary.defaultTab : 'home';
    }
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      settingsWorkspacePath.textContent = summary.workspacePath || '默认数据目录';
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    settingsFeatureList?.querySelectorAll('input[data-settings-feature]').forEach((input) => {
      input.checked = settingsAppSettings?.features?.[input.dataset.settingsFeature] !== false;
    });
    renderHomeModuleSettings();
  }

  function renderHomeModuleSettings() {
    const state = window.NotchHome?.getVisibility?.();
    const hidden = new Set(state?.hiddenIds || []);
    const recordingActive = window.NotchWorkspace?.isRecordingActive?.() ?? isRecordingActive();
    settingsHomeModuleList?.querySelectorAll('input[data-settings-home-module]').forEach((input) => {
      const moduleId = input.dataset.settingsHomeModule;
      const unavailable = state?.unavailableIds?.includes(moduleId) === true;
      input.closest('label').hidden = unavailable;
      input.checked = !hidden.has(moduleId);
      input.disabled = unavailable || state?.readOnly === true
        || (moduleId === 'recorder' && recordingActive && input.checked);
    });
    const recorderNote = settingsHomeModuleList?.querySelector('[data-home-module-setting-note="recorder"]');
    if (recorderNote) recorderNote.textContent = recordingActive ? '录音进行中' : '录音与转写';
    const status = document.getElementById('settings-home-module-status');
    if (status) {
      status.textContent = state?.readOnly
        ? '安全模式 · 暂不可修改'
        : state?.persisted === false
          ? '仅当前会话 · 未能保存'
          : '隐藏后自动填充 · 至少保留一个';
      status.dataset.state = state?.readOnly || state?.persisted === false ? 'warning' : 'saved';
    }
  }

  async function refreshSettingsPanel() {
    if (!window.notchAPI) return;
    const [appSettings, workspace, config] = await Promise.all([
      window.notchAPI.getAppSettings?.().catch(() => null),
      window.notchAPI.getWorkspace?.().catch(() => null),
      window.notchAPI.getTranscriptionConfig?.().catch(() => null),
    ]);
    if (appSettings) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (config) {
      transcriptionConfig = config;
      updateTranscriptionConfigUi();
      updateRecordingUi();
    }
    renderSettingsPanel();
  }

  async function loadTranscriptionConfig() {
    if (!window.notchAPI || typeof window.notchAPI.getTranscriptionConfig !== 'function') return;
    try {
      const config = await window.notchAPI.getTranscriptionConfig();
      if (config) transcriptionConfig = config;
    } catch (error) {}
    window.NotchAISettings = { ...transcriptionConfig };
    updateTranscriptionConfigUi();
    updateRecordingUi();
    renderSettingsPanel();
  }

  function selectAIServicePanel(slot, focus = false) {
    activeAIServicePanel = slot === 'transcription' ? 'transcription' : 'content';
    const transcriptionActive = activeAIServicePanel === 'transcription';
    if (aiServicePanelTranscription) aiServicePanelTranscription.hidden = !transcriptionActive;
    if (aiServicePanelContent) aiServicePanelContent.hidden = transcriptionActive;
    if (aiContentSettingsSecondary) aiContentSettingsSecondary.hidden = transcriptionActive;
    renderAIProviderNavigation();
    if (!focus) return;
    const target = transcriptionActive
      ? aiProviderTranscription
      : aiContentProviderList?.querySelector(`[data-ai-provider="${CSS.escape(llmProvider?.value || '')}"]`);
    target?.focus();
  }

  async function openTranscriptionSettings(slot = 'content') {
    if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
    if (window.NotchPanel?.navigate) await window.NotchPanel.navigate({ tab: 'settings' });
    else document.querySelector('[data-tab="settings"]')?.click();
    window.NotchSettings?.select('api');
    transcriptionSettingsNote?.classList.remove('error', 'success');
    if (transcriptionSettingsNote && !aiSettingsDirty) {
      transcriptionSettingsNote.textContent = transcriptionConfig.asrNeedsReentry || transcriptionConfig.llmNeedsReentry
        ? '检测到无法解密的旧密钥，请在对应服务中重新输入。'
        : '已配置的 API Key 可留空；新输入的密钥会覆盖旧值。';
    }
    selectAIServicePanel(slot);
    void renderAIDiagnostics();
    setTimeout(() => {
      if (slot === 'transcription') aiProviderTranscription?.focus();
      else aiContentProviderList?.querySelector('[aria-selected="true"]')?.focus();
    }, 0);
  }

  async function saveTranscriptionSettings() {
    if (!window.notchAPI || !transcriptionSettingsSave) return;
    const provider = selectedContentProvider();
    const llmModels = currentContentModels();
    const normalizedModels = llmModels.map((model) => model.replace(/\s+/g, ' ').trim());
    if (!removeContentOnSave && (!provider || !normalizedModels.length || normalizedModels.some((model) => !model))) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '每个模型都需要填写有效名称。';
      selectAIServicePanel('content');
      llmModelList?.querySelector('input[value=""]')?.focus();
      return;
    }
    if (!removeContentOnSave && new Set(normalizedModels).size !== normalizedModels.length) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '同一厂商下不能添加重名模型。';
      selectAIServicePanel('content');
      return;
    }
    if (!removeContentOnSave && provider.endpointEditable && !llmBaseUrl?.value.trim()) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '请填写该厂商的 Base URL。';
      selectAIServicePanel('content');
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
    if (!result || !result.ok) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = result && result.error === 'invalid_workspace'
        ? 'Workspace ID 格式不正确。'
        : result && result.error === 'invalid_provider'
          ? '不支持所选 AI 厂商。'
          : result && result.error === 'invalid_llm_url'
            ? '内容整理 Base URL 必须是有效的 HTTPS 地址。'
            : result && ['invalid_model', 'invalid_model_count'].includes(result.error)
              ? '请添加 1 至 12 个有效模型。'
              : result && result.error === 'duplicate_model'
                ? '同一厂商下不能添加重名模型。'
              : result && result.error === 'secure_storage_unavailable'
                ? '当前系统安全存储不可用，可改用环境变量提供 API Key。'
                : '配置保存失败，请重试。';
      return;
    }
    transcriptionConfig = result;
    window.NotchAISettings = { ...transcriptionConfig };
    window.dispatchEvent(new CustomEvent('notch:ai-settings-changed'));
    removeAsrOnSave = false;
    removeContentOnSave = false;
    aiSettingsDirty = false;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.classList.add('success');
    transcriptionSettingsNote.textContent = '配置已安全保存。新配置需要单独验证后才会显示为已验证。';
    transcriptionSettingsSave.textContent = '已保存';
    setTimeout(() => {
      if (transcriptionSettingsSave) transcriptionSettingsSave.textContent = '保存更改';
    }, 1200);
    if (
      transcriptionConfig.configured
      && ['recording', 'paused'].includes(recordingLifecycle.status())
      && !transcriptionPipeline.hasCloudSession()
    ) {
      transcriptionPipeline.stopBrowser();
      transcriptionPipeline.startCloud(recordingLifecycle.stream());
    }
    updateRecordingUi();
    renderSettingsPanel();
  }

  function persistRecordings() {
    return saveJson(RECORDINGS_KEY, recordings.filter((recording) => !recording.isDraft));
  }

  function currentRecordingText() {
    return recordingLifecycle?.currentText() || '';
  }

  function currentRecordingFeedback() {
    return recordingLifecycle?.currentFeedback() || '正在录音';
  }

  function syncRecordingDraftUi() {
    const draft = recordingLifecycle?.activeDraft();
    if (!draft) return;
    const durationMs = recordingLifecycle.stopDuration() || recordingLifecycle.currentDuration();
    const text = currentRecordingText();
    const status = recordingLifecycle.status();
    draft.durationMs = durationMs;
    draft.transcript = recordingLifecycle.transcript();
    const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
    const preview = row?.querySelector('[data-recording-preview]');
    const meta = row?.querySelector('[data-recording-meta]');
    if (preview) preview.textContent = text || currentRecordingFeedback();
    if (meta) meta.textContent = `${status === 'saving' ? '保存中' : status === 'paused' ? '已暂停' : '录音中'} · ${formatClock(durationMs)}`;
    if (selectedRecordingId !== draft.id) return;
    const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
    const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
    const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
    const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
    const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
    const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
    const detailPause = recordingDetail?.querySelector('.recording-live-pause');
    const detailStop = recordingDetail?.querySelector('.recording-live-stop');
    if (detailState) detailState.textContent = status === 'saving' ? '正在保存' : status === 'paused' ? '已暂停' : '正在录音';
    if (detailDot) detailDot.dataset.state = status;
    if (detailTime) detailTime.textContent = formatClock(durationMs);
    if (detailTranscript && detailTranscript.value !== text) detailTranscript.value = text;
    if (detailFeedback) detailFeedback.textContent = text ? '转写内容会随录音实时更新' : currentRecordingFeedback();
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      detailPause.textContent = status === 'paused' ? '继续' : '暂停';
      detailPause.disabled = status === 'saving';
    }
    if (detailStop) detailStop.disabled = status === 'saving';
  }

  recordingLifecycle = window.NotchWorkspaceRecordingLifecycle.createLifecycle({
    Domain,
    elements: { liveTranscript, recordStart, recordPause, recordStop, recordingNew },
    getRecordings: () => recordings,
    setRecordings: (value) => { recordings = value; },
    getSelectedId: () => selectedRecordingId,
    setSelectedId: (value) => { selectedRecordingId = value; },
    getSelection: () => recordingSelection,
    setSelectionAnchor: (value) => { recordingSelectionAnchor = value; },
    getConfig: () => transcriptionConfig,
    getPipeline: () => transcriptionPipeline,
    persist: persistRecordings,
    render: () => renderRecordings(),
    startStrands: startRecordingStrands,
    stopStrands: stopRecordingStrands,
    uid,
    formatClock,
    updateUi: () => updateRecordingUi(),
  });
  transcriptionPipeline = window.NotchWorkspaceTranscriptionPipeline.createPipeline({
    Domain,
    getConfig: () => transcriptionConfig,
    getStream: () => recordingLifecycle.stream(),
    getRecordingStatus: () => recordingLifecycle.status(),
    getTranscript: () => recordingLifecycle.transcript(),
    setTranscript: (value) => recordingLifecycle.setTranscript(value),
    getInterimTranscript: () => recordingLifecycle.interimTranscript(),
    setInterimTranscript: (value) => recordingLifecycle.setInterimTranscript(value),
    updateUi: () => updateRecordingUi(),
  });

  function updateRecordingUi() {
    const recordingActive = isRecordingActive();
    const recordingBusy = isRecordingBusy();
    const status = recordingLifecycle?.status() || 'idle';
    const starting = recordingLifecycle?.isStarting() === true;
    const visualState = starting ? 'requesting' : status;
    if (homeRecorder) homeRecorder.dataset.state = visualState;
    if (recordingDot) recordingDot.dataset.state = visualState;
    if (recordingStateLabel) {
      recordingStateLabel.textContent = starting
        ? '等待录音权限'
        : status === 'recording'
        ? '正在录音'
        : status === 'paused'
          ? '已暂停'
          : status === 'saving'
            ? '正在保存'
            : '快速录音';
    }
    if (recordingTime) recordingTime.textContent = formatClock(recordingActive ? recordingLifecycle.currentDuration() : 0);
    if (recordStart) recordStart.disabled = recordingBusy;
    if (recordPause) {
      recordPause.disabled = !['recording', 'paused'].includes(status);
      recordPause.setAttribute('aria-label', status === 'paused' ? '继续录音' : '暂停录音');
      recordPause.classList.toggle('resume', status === 'paused');
    }
    if (recordStop) recordStop.disabled = !['recording', 'paused'].includes(status);
    if (recordingNew) {
      recordingNew.disabled = recordingBusy;
      recordingNew.textContent = recordingBusy ? '录制' : '录音';
      recordingNew.setAttribute('aria-label', starting
        ? '正在请求麦克风权限'
        : recordingActive ? '录音进行中' : '开始录音');
    }
    if (liveTranscript && recordingBusy) {
      const text = currentRecordingText();
      // asrNeedsReentry = 密文还在但当前应用解不开它。safeStorage 的密钥存在钥匙串里、
      // ACL 绑代码签名，所以开发版存的 Key 装成 DMG 后就读不出来（ad-hoc 签名每次打包
      // 都会换 cdhash，也是同样的结果）。这种情况下录音正常、只有转写不工作，
      // 原来只在设置面板里提示一行，录音的人看不到，表现就是「能录但不转写」。
      const fallback = currentRecordingFeedback();
      liveTranscript.textContent = text || fallback;
      liveTranscript.hidden = !(text || fallback);
    }
    syncRecordingDraftUi();
    renderHomeModuleSettings();
    document.dispatchEvent(new CustomEvent('notch:recording-state-changed', {
      detail: { active: recordingBusy },
    }));
  }

  if (recordingConfigure) recordingConfigure.addEventListener('click', () => { void openTranscriptionSettings('transcription'); });
  if (transcriptionSettingsSave) transcriptionSettingsSave.addEventListener('click', saveTranscriptionSettings);
  aiProviderTranscription?.addEventListener('click', () => selectAIServicePanel('transcription'));
  aiContentProviderList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-provider]');
    if (!button || !llmProvider) return;
    const providerId = button.dataset.aiProvider;
    if (llmProvider.value === providerId) selectAIServicePanel('content');
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
    aiSettingsDirty = hasAISettingsChanges();
    selectAIServicePanel('content');
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
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
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
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
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
    aiSettingsDirty = false;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '未保存的更改已撤销。';
  });
  aiSettingsRoot?.addEventListener('input', (event) => {
    if (!event.target.closest('.ai-service-panel, .ai-auto-settings')) return;
    if (event.target === transcriptionApiKey) {
      removeAsrOnSave = false;
      if (transcriptionProviderRemove) transcriptionProviderRemove.disabled = !transcriptionConfig.configured;
    }
    if (event.target === llmApiKey) {
      removeContentOnSave = false;
      if (contentProviderRemove) {
        const profile = contentProfileFor(llmProvider?.value);
        contentProviderRemove.disabled = !profile.saved && !profile.configured;
      }
    }
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
    if (event.target.closest('#ai-service-panel-content')) renderContentProviderFields();
    if (event.target.closest('#ai-service-panel-transcription')) {
      setStatusPresentation(transcriptionVerificationStatus, { label: '待保存', state: 'warning' });
      renderAIProviderNavigation();
    }
  });
  aiSettingsRoot?.addEventListener('change', (event) => {
    if (!event.target.closest('.ai-service-panel, .ai-auto-settings')) return;
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
    if (event.target.closest('#ai-service-panel-content')) renderContentProviderFields();
    if (event.target.closest('#ai-service-panel-transcription')) {
      setStatusPresentation(transcriptionVerificationStatus, transcriptionConnectionChanged()
        ? { label: '待保存', state: 'warning' }
        : verificationPresentation(transcriptionConfig.transcriptionVerification, transcriptionConfig.configured));
      renderAIProviderNavigation();
    }
  });
  transcriptionProviderRemove?.addEventListener('click', () => {
    removeAsrOnSave = true;
    aiSettingsDirty = hasAISettingsChanges();
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    transcriptionProviderRemove.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = transcriptionConfig.asrCredentialSource === 'environment'
      ? '保存后会移除本机转写密钥；环境变量仍会继续生效。'
      : '实时转写配置将在保存时移除。';
    setStatusPresentation(transcriptionVerificationStatus, { label: '待移除', state: 'warning' });
    if (aiSettingsReset) aiSettingsReset.disabled = false;
    renderAIProviderNavigation();
  });
  contentProviderRemove?.addEventListener('click', () => {
    removeContentOnSave = true;
    aiSettingsDirty = hasAISettingsChanges();
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
    if (!result?.ok) { setSettingsNote('无法保存迁移确认，请重试。', true); return; }
    transcriptionConfig = result; window.NotchAISettings = { ...transcriptionConfig }; updateTranscriptionConfigUi(); renderSettingsPanel();
  });
  aiDiagnosticsCopy?.addEventListener('click', async () => {
    const text = aiDiagnostics?.dataset.copyText || '';
    if (!text) { transcriptionSettingsNote.textContent = '暂无可复制的请求诊断。'; return; }
    const result = await window.notchAPI?.writeClipboard?.({ type: 'text', text }).catch(() => false);
    transcriptionSettingsNote.textContent = result === false || result?.ok === false ? '复制诊断失败。' : '已复制脱敏请求诊断。';
  });
  aiDiagnosticsClear?.addEventListener('click', async () => {
    const result = await window.notchAPI?.clearAIDiagnostics?.().catch(() => ({ ok: false }));
    transcriptionSettingsNote.textContent = result?.ok ? '已清空请求诊断。' : '清空请求诊断失败。';
    if (result?.ok) await renderAIDiagnostics();
  });
  async function testConfiguredProvider(slot, button) {
    const configured = slot === 'transcription' ? transcriptionConfig.configured : transcriptionConfig.llmConfigured;
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
      transcriptionConfig = refreshed;
      window.NotchAISettings = { ...transcriptionConfig };
      updateTranscriptionConfigUi();
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
    if (slot === 'content') await renderAIDiagnostics();
  }
  aiProviderTest?.addEventListener('click', () => testConfiguredProvider('content', aiProviderTest));
  transcriptionProviderTest?.addEventListener('click', () => testConfiguredProvider('transcription', transcriptionProviderTest));
  if (transcriptionApiHelp) {
    transcriptionApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
  }
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      const provider = selectedContentProvider();
      if (provider?.keyUrl) window.notchAPI?.openExternal(provider.keyUrl);
    });
  }
  if (window.notchAPI && typeof window.notchAPI.onOpenApiSettings === 'function') {
    window.notchAPI.onOpenApiSettings(() => { void openTranscriptionSettings(); });
  }
  window.addEventListener('notch:settings-category-change', (event) => {
    if (event.detail?.id !== 'api') return;
    renderAIProviderNavigation();
    void renderAIDiagnostics();
  });
  settingsFeatureList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-feature]');
    if (!input || !window.notchAPI?.setFeature) return;
    input.disabled = true;
    const result = await window.notchAPI.setFeature(input.dataset.settingsFeature, input.checked)
      .catch(() => ({ ok: false }));
    input.disabled = false;
    if (!result?.ok) {
      input.checked = !input.checked;
      setSettingsNote('功能显示设置保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote('显示功能已更新。');
  });
  settingsHomeModuleList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-home-module]');
    if (!input || !window.NotchHome?.setModuleVisible) return;
    input.disabled = true;
    const result = await window.NotchHome.setModuleVisible(
      input.dataset.settingsHomeModule,
      input.checked
    );
    renderHomeModuleSettings();
    if (!result?.ok) {
      const message = result?.error === 'at_least_one_required'
        ? '首页至少保留一个组件'
        : result?.error === 'recording_active'
          ? '录音进行中，暂时不能隐藏快速录音'
          : result?.error === 'layout_read_only'
            ? '首页布局已进入安全模式，本次会话不能修改组件'
            : result?.error === 'layout_invalid'
              ? '新布局校验失败，原布局已保留'
              : result?.error === 'dom_apply_failed'
                ? '布局应用失败，原布局已恢复'
                : '首页组件设置未更新';
      if (typeof showStatusToast === 'function') showStatusToast(message);
      return;
    }
    if (result.changed === false) return;
    const message = result.persisted === false
      ? '布局已更新，仅当前会话生效，设置未能保存'
      : input.checked ? '首页组件已恢复' : '首页组件已隐藏';
    if (typeof showStatusToast === 'function') showStatusToast(message);
  });
  const shortcutControls = [
    [settingsShortcutChange, 'panel', () => settingsAppSettings?.shortcut || 'Space'],
    [settingsLauncherShortcutChange, 'launcher', () => settingsAppSettings?.shortcuts?.launcher || ''],
    [settingsScreenshotShortcutChange, 'screenshot', () => settingsAppSettings?.shortcuts?.screenshot || ''],
    [settingsVideoShortcutChange, 'screenRecording', () => settingsAppSettings?.shortcuts?.screenRecording || ''],
    [settingsAudioShortcutChange, 'audioRecording', () => settingsAppSettings?.shortcuts?.audioRecording || ''],
  ];
  shortcutControls.forEach(([button, action, current]) => button?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut', { detail: { action, current: current() } }));
  }));
  settingsTheme?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-theme-value]');
    if (!button || button.disabled || !window.notchAPI?.setTheme) return;
    const theme = button.dataset.themeValue === 'light' ? 'light' : 'dark';
    const buttons = [...settingsTheme.querySelectorAll('[data-theme-value]')];
    buttons.forEach((item) => { item.disabled = true; });
    const result = await window.notchAPI.setTheme(theme).catch(() => ({ ok: false }));
    buttons.forEach((item) => { item.disabled = false; });
    if (!result?.ok) {
      renderSettingsPanel();
      setSettingsNote('主题设置保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(theme === 'light' ? '已切换为亮色主题。' : '已切换为深色主题。');
  });
  settingsDefaultTab?.addEventListener('change', async () => {
    if (!window.notchAPI?.setDefaultTab) return;
    const previous = settingsAppSettings?.defaultTab || 'home';
    settingsDefaultTab.disabled = true;
    const result = await window.notchAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
    settingsDefaultTab.disabled = false;
    if (!result?.ok) {
      settingsDefaultTab.value = previous;
      setSettingsNote('默认展开页保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(`下次唤出将默认显示${settingsDefaultTab.selectedOptions[0]?.textContent || '所选页面'}。`);
  });
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.notchAPI?.openWorkspace?.().catch(() => setSettingsNote('无法打开数据文件夹。', true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.notchAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote('数据文件夹已更新。');
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.notchAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote('开机启动设置失败。', true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  });
  window.notchAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.notchAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());

  const recordingsView = window.NotchWorkspaceRecordingsView.createView({
    Domain,
    elements: { recordingList, recordingDetail, recordingCount, recordingBulkDelete },
    getRecordings: () => recordings,
    setRecordings: (value) => { recordings = value; },
    getSelectedId: () => selectedRecordingId,
    setSelectedId: (value) => { selectedRecordingId = value; },
    getSelection: () => recordingSelection,
    setSelection: (value) => { recordingSelection = value; },
    getSelectionAnchor: () => recordingSelectionAnchor,
    setSelectionAnchor: (value) => { recordingSelectionAnchor = value; },
    getStatus: () => recordingLifecycle.status(),
    currentText: currentRecordingText,
    currentFeedback: currentRecordingFeedback,
    formatClock,
    formatShortDate,
    persist: persistRecordings,
    syncDraftUi: syncRecordingDraftUi,
    pauseRecording: recordingLifecycle.togglePause,
    stopRecording: recordingLifecycle.stop,
    openTranscriptionSettings,
    createIconButton,
    icons: { copy: COPY_ICON, open: OPEN_ICON, delete: DELETE_ICON },
  });
  const renderRecordingDetail = recordingsView.renderDetail;
  const renderRecordingList = recordingsView.renderList;
  const renderRecordings = recordingsView.render;

  document.addEventListener('notch:clear-selection', () => {
    linkSelection.clear();
    linkSelectionAnchor = null;
    recordingSelection.clear();
    recordingSelectionAnchor = selectedRecordingId || null;
    renderLinkGroups();
    renderRecordingList();
  });

  window.addEventListener('beforeunload', () => {
    recordingLifecycle.dispose();
    recordingsView.dispose();
  });

  renderLinkGroups();
  renderRecordings();
  updateRecordingUi();
  loadTranscriptionConfig();
  refreshSettingsPanel();

  window.NotchWorkspaceWindowsHost = {
    refreshSettingsPanel,
    refreshHomeModuleSettings: renderHomeModuleSettings,
  };

  const linksApi = window.NotchWorkspaceLinksApi.createApi({
    Domain,
    LinksDomain,
    getGroups: () => linkGroups,
    setGroups: (groups) => { linkGroups = groups; },
    allLinks,
    addLink,
    persist: persistLinks,
    render: renderLinkGroups,
    syncWorkspaceData,
    uid,
    linkLimits,
    pageSize: LINK_PAGE_SIZE,
    elements: { linksSearch, groupFilter },
  });
  const recordingsApi = window.NotchWorkspaceRecordingsApi.createApi({
    Domain,
    getRecordings: () => recordings,
    getSelectedRecordingId: () => selectedRecordingId,
    persist: persistRecordings,
    render: renderRecordings,
    syncWorkspaceData,
    startRecording: recordingLifecycle.start,
    isRecordingActive: isRecordingBusy,
  });

  window.NotchWorkspace = {
    ...linksApi,
    recordingContext: recordingsApi.recordingContext,
    chatContexts() {
      return [...recordingsApi.recordingRows(), ...(LinksDomain?.chatRows(linkGroups) || [])];
    },
    applyAIName(source, titleValue, categoryValue, tagsValue = '') {
      return source?.sourceType === 'link'
        ? linksApi.applyAIName(source, titleValue, categoryValue, tagsValue)
        : recordingsApi.applyAIName(source, titleValue, categoryValue);
    },
    undoAIName(token) {
      return token?.sourceType === 'link'
        ? linksApi.undoAIName(token)
        : recordingsApi.undoAIName(token);
    },
    refreshWindows: (...args) => window.NotchWorkspaceWindows?.refreshWindows?.(...args),
    startRecording: recordingsApi.startRecording,
    isRecordingActive: recordingsApi.isRecordingActive,
  };
})();
