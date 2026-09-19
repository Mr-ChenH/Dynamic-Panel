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
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
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
  let aiSettingsController = null;
  let settingsAppSettings = null;
  let settingsWorkspace = null;
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

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: aiSettingsController?.config(),
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
      aiSettingsController.acceptConfig(config);
      updateRecordingUi();
    }
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
    const transcriptionConfig = aiSettingsController.config();
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      detailPause.textContent = status === 'paused' ? '继续' : '暂停';
      detailPause.disabled = status === 'saving';
    }
    if (detailStop) detailStop.disabled = status === 'saving';
  }

  aiSettingsController = window.NotchWorkspaceAISettings.createController({
    Domain,
    setMode,
    setSettingsNote,
    renderSettingsPanel,
    updateRecordingUi,
    getRecordingLifecycle: () => recordingLifecycle,
    getTranscriptionPipeline: () => transcriptionPipeline,
  });

  recordingLifecycle = window.NotchWorkspaceRecordingLifecycle.createLifecycle({
    Domain,
    elements: { liveTranscript, recordStart, recordPause, recordStop, recordingNew },
    getRecordings: () => recordings,
    setRecordings: (value) => { recordings = value; },
    getSelectedId: () => selectedRecordingId,
    setSelectedId: (value) => { selectedRecordingId = value; },
    getSelection: () => recordingSelection,
    setSelectionAnchor: (value) => { recordingSelectionAnchor = value; },
    getConfig: () => aiSettingsController.config(),
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
    getConfig: () => aiSettingsController.config(),
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
    openTranscriptionSettings: aiSettingsController.open,
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
  aiSettingsController.load();
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
