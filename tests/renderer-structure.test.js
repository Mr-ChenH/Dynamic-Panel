const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const financeIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'finance.js'), 'utf8');
const financeBackgroundJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'finance-background-refresh.js'), 'utf8');
const financeConfigResolverJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'finance-config-resolver.js'), 'utf8');
const financeProviderSettingsJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'finance-provider-settings.js'), 'utf8');
const financeHttpClientJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'finance-http-client.js'), 'utf8');
const homeIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'home.js'), 'utf8');
const systemIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'system.js'), 'utf8');
const windowIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'window.js'), 'utf8');
const shortcutServiceJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'shortcut-service.js'), 'utf8');
const launcherDomain = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'domain.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const shortcutRecorderControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shortcut-recorder-controller.js'), 'utf8');
const todoListControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-list-controller.js'), 'utf8');
const todoEditorControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-editor-controller.js'), 'utf8');
const todoMutationControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-mutation-controller.js'), 'utf8');
const todoScopeControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-scope-controller.js'), 'utf8');
const todoApiControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-api-controller.js'), 'utf8');
const clipboardDomainJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'clipboard-domain.js'), 'utf8');
const clipboardStoreJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'clipboard-store.js'), 'utf8');
const clipboardControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'clipboard-controller.js'), 'utf8');
const pomodoroControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pomodoro-controller.js'), 'utf8');
const homeLayoutControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-layout-controller.js'), 'utf8');
const notesMarkdownJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-markdown.js'), 'utf8');
const notesStoreJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-store.js'), 'utf8');
const notesAttachmentsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-attachments-controller.js'), 'utf8');
const notesTaxonomyJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-taxonomy-controller.js'), 'utf8');
const notesEditorJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-editor-controller.js'), 'utf8');
const notesControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes-controller.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const workspaceWindowsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-windows.js'), 'utf8');
const workspaceCredentialsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-credentials.js'), 'utf8');
const workspaceLinksDomainJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-links-domain.js'), 'utf8');
const workspaceLinksRendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-links-renderer.js'), 'utf8');
const workspaceLinksControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-links-controller.js'), 'utf8');
const workspaceLinksActionsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-links-actions.js'), 'utf8');
const workspaceLinksDragJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-links-drag.js'), 'utf8');
const workspaceLinksApiJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-links-api.js'), 'utf8');
const workspaceRecordingsApiJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-recordings-api.js'), 'utf8');
const workspaceRecordingsViewJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-recordings-view.js'), 'utf8');
const workspaceRecordingLifecycleJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-recording-lifecycle.js'), 'utf8');
const workspaceRecordingProjectionJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-recording-projection.js'), 'utf8');
const workspaceTranscriptionPipelineJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-transcription-pipeline.js'), 'utf8');
const workspaceAppSettingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-app-settings.js'), 'utf8');
const workspaceAISettingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-ai-settings.js'), 'utf8');
const panelControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'panel-controller.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const notesCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notes.css'), 'utf8');
const platformCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'platform.css'), 'utf8');
const todoPlannerCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-planner.css'), 'utf8');
const todoListCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-list.css'), 'utf8');
const aiCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai.css'), 'utf8');
const aiJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'settings.js'), 'utf8');
const homeWeatherJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-weather-controller.js'), 'utf8');
const homeMusicJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-music-controller.js'), 'utf8');
const homeQuickCaptureJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-quick-capture-controller.js'), 'utf8');
const homeChatContextJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-chat-context-controller.js'), 'utf8');
const homeChatGenerationJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-chat-generation-controller.js'), 'utf8');
const homeChatSessionJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-chat-session-controller.js'), 'utf8');
const homeChatReaderJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home-chat-reader-controller.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home.js'), 'utf8');
const homeCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home.css'), 'utf8');
const financeJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance.js'), 'utf8');
const financeRequestControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-request-controller.js'), 'utf8');
const financeOverviewControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-overview-controller.js'), 'utf8');
const financeRankingControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-ranking-controller.js'), 'utf8');
const financeAiControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-ai-controller.js'), 'utf8');
const financeWatchlistControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-watchlist-controller.js'), 'utf8');
const financeSettingsControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-settings-controller.js'), 'utf8');
const markdownJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'markdown.js'), 'utf8');
const chatContextJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat-context.js'), 'utf8');
const chatSessionsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat-sessions.js'), 'utf8');
const chatReaderJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat-reader.js'), 'utf8');

test('panel navigation is exposed by a dedicated controller through an injected host', () => {
  assert.ok(html.indexOf('app.js') < html.indexOf('panel-controller.js'));
  assert.match(appJs, /window\.NotchPanelHost\s*=/);
  assert.match(panelControllerJs, /window\.NotchPanel\s*=\s*Object\.freeze/);
  assert.match(panelControllerJs, /host\.navigate/);
  assert.doesNotMatch(appJs, /window\.NotchPanel\s*=\s*\{/);
});

test('preload exposes grouped domain APIs while retaining flat compatibility methods', () => {
  for (const group of ['window', 'finance', 'home', 'capture', 'recordings', 'notes', 'launcher', 'settings']) {
    assert.match(preloadJs, new RegExp(`api\\.${group}\\s*=\\s*Object\\.freeze`));
  }
  assert.match(preloadJs, /contextBridge\.exposeInMainWorld\('notchAPI', api\)/);
  assert.match(preloadJs, /setMode: \(mode\) =>/);
  assert.match(preloadJs, /getFinanceOverview: \(payload\) =>/);
  assert.match(preloadJs, /saveNoteImage: \(payload\) =>/);
});

test('current windows keep their domain state outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-windows.js') < html.indexOf('workspace.js'));
  assert.match(workspaceWindowsJs, /notchAPI\.listWindows/);
  assert.match(workspaceWindowsJs, /notchAPI\?\.focusWindow/);
  assert.match(workspaceWindowsJs, /notch-hidden-windows/);
  assert.match(workspaceWindowsJs, /window\.NotchWorkspaceWindows/);
  assert.doesNotMatch(workspaceJs, /function renderWindows\(/);
  assert.doesNotMatch(workspaceJs, /function refreshWindows\(/);
});

test('link data normalization and context formatting stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-links-domain.js') < html.indexOf('workspace.js'));
  assert.match(workspaceLinksDomainJs, /normalizeGroups/);
  assert.match(workspaceLinksDomainJs, /linkContext/);
  assert.match(workspaceLinksDomainJs, /chatRows/);
  assert.match(workspaceJs, /window\.NotchWorkspaceLinksDomain/);
  assert.doesNotMatch(workspaceJs, /String\(link\.title \|\| '未命名'\)/);
});

test('link list rendering stays in an injected renderer outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-links-renderer.js') < html.indexOf('workspace.js'));
  assert.match(workspaceLinksRendererJs, /createRenderer/);
  assert.match(workspaceLinksRendererJs, /linksSidebarGroups/);
  assert.match(workspaceLinksRendererJs, /links-load-more/);
  assert.match(workspaceJs, /NotchWorkspaceLinksRenderer\.createRenderer/);
  assert.doesNotMatch(workspaceJs, /function renderLinkGroups\(/);
});

test('link view controls use a dedicated injected controller', () => {
  assert.ok(html.indexOf('workspace-links-controller.js') < html.indexOf('workspace.js'));
  assert.match(workspaceLinksControllerJs, /resetView/);
  assert.match(workspaceLinksControllerJs, /deleteSelected/);
  assert.match(workspaceLinksControllerJs, /linksCollapseAll/);
  assert.match(workspaceJs, /NotchWorkspaceLinksController\.createController/);
  assert.doesNotMatch(workspaceJs, /linksSearch\?\.addEventListener\('input'/);
});

test('link editing and row actions use a dedicated injected controller', () => {
  assert.ok(html.indexOf('workspace-links-actions.js') < html.indexOf('workspace.js'));
  assert.match(workspaceLinksActionsJs, /editLink/);
  assert.match(workspaceLinksActionsJs, /toggle-link-favorite/);
  assert.match(workspaceLinksActionsJs, /updateRangeSelection/);
  assert.match(workspaceJs, /NotchWorkspaceLinksActions\.createController/);
  assert.doesNotMatch(workspaceJs, /linkGroupsEl\.addEventListener\('change'/);
});

test('link drag lifecycle uses a dedicated controller', () => {
  assert.ok(html.indexOf('workspace-links-drag.js') < html.indexOf('workspace.js'));
  assert.match(workspaceLinksDragJs, /pointerdown/);
  assert.match(workspaceLinksDragJs, /pointermove/);
  assert.match(workspaceLinksDragJs, /moveLinkToPosition/);
  assert.match(workspaceJs, /NotchWorkspaceLinksDrag\.createController/);
  assert.doesNotMatch(workspaceJs, /linkGroupsEl\.addEventListener\('pointerdown'/);
});

test('workspace public APIs are split into link and recording adapters', () => {
  assert.ok(html.indexOf('workspace-links-api.js') < html.indexOf('workspace.js'));
  assert.ok(html.indexOf('workspace-recordings-api.js') < html.indexOf('workspace.js'));
  assert.match(workspaceLinksApiJs, /saveCapturedLink/);
  assert.match(workspaceLinksApiJs, /applyAIName/);
  assert.match(workspaceRecordingsApiJs, /recordingContext/);
  assert.match(workspaceRecordingsApiJs, /recordingRows/);
  assert.match(workspaceJs, /const linksApi =/);
  assert.match(workspaceJs, /const recordingsApi =/);
  assert.match(workspaceJs, /window\.NotchWorkspace = \{/);
  assert.doesNotMatch(workspaceJs, /async saveCapturedLink\(rawValue\)/);
});

test('recording library rendering and audio URL ownership stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-recordings-view.js') < html.indexOf('workspace.js'));
  assert.match(workspaceRecordingsViewJs, /renderDetail/);
  assert.match(workspaceRecordingsViewJs, /renderList/);
  assert.match(workspaceRecordingsViewJs, /currentAudioUrl/);
  assert.match(workspaceJs, /NotchWorkspaceRecordingsView\.createView/);
  assert.doesNotMatch(workspaceJs, /function renderRecordingDetail\(/);
  assert.doesNotMatch(workspaceJs, /let currentAudioUrl/);
});

test('MediaRecorder and recording draft lifecycle stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-recording-lifecycle.js') < html.indexOf('workspace.js'));
  assert.match(workspaceRecordingLifecycleJs, /new MediaRecorder/);
  assert.match(workspaceRecordingLifecycleJs, /beginDraft/);
  assert.match(workspaceRecordingLifecycleJs, /finalize/);
  assert.match(workspaceRecordingLifecycleJs, /onAudioRecordingShortcut/);
  assert.match(workspaceJs, /NotchWorkspaceRecordingLifecycle\.createLifecycle/);
  assert.doesNotMatch(workspaceJs, /function startRecordingAttempt\(/);
  assert.doesNotMatch(workspaceJs, /let mediaRecorder/);
});

test('recording UI projection stays outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-recording-projection.js') < html.indexOf('workspace.js'));
  assert.match(workspaceRecordingProjectionJs, /syncDraftUi/);
  assert.match(workspaceRecordingProjectionJs, /notch:recording-state-changed/);
  assert.match(workspaceRecordingProjectionJs, /getAIConfig/);
  assert.match(workspaceRecordingProjectionJs, /NotchWorkspaceRecordingProjection/);
  assert.match(workspaceJs, /recordingProjection\.update/);
  assert.doesNotMatch(workspaceJs, /function updateRecordingUi\(/);
  assert.doesNotMatch(workspaceJs, /function syncRecordingDraftUi\(/);
});

test('cloud and browser transcription pipelines stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-transcription-pipeline.js') < html.indexOf('workspace.js'));
  assert.match(workspaceTranscriptionPipelineJs, /startAudioPipeline/);
  assert.match(workspaceTranscriptionPipelineJs, /startCloud/);
  assert.match(workspaceTranscriptionPipelineJs, /startBrowser/);
  assert.match(workspaceTranscriptionPipelineJs, /onTranscriptionEvent/);
  assert.match(workspaceJs, /NotchWorkspaceTranscriptionPipeline\.createPipeline/);
  assert.doesNotMatch(workspaceJs, /function startCloudTranscription\(/);
  assert.doesNotMatch(workspaceJs, /let speechRecognition/);
});

test('general app settings stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-app-settings.js') < html.indexOf('workspace.js'));
  assert.match(workspaceAppSettingsJs, /setFeature/);
  assert.match(workspaceAppSettingsJs, /setDefaultTab/);
  assert.match(workspaceAppSettingsJs, /setAutoLaunch/);
  assert.match(workspaceAppSettingsJs, /notch:record-shortcut/);
  assert.match(workspaceJs, /NotchWorkspaceAppSettings\.createController/);
  assert.doesNotMatch(workspaceJs, /settingsFeatureList/);
  assert.doesNotMatch(workspaceJs, /settingsVideoShortcutChange/);
  assert.doesNotMatch(workspaceJs, /function renderSettingsPanel\(/);
});

test('AI provider settings and diagnostics stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-ai-settings.js') < html.indexOf('workspace.js'));
  assert.match(workspaceAISettingsJs, /setTranscriptionConfig/);
  assert.match(workspaceAISettingsJs, /testConfiguredProvider/);
  assert.match(workspaceAISettingsJs, /renderDiagnostics/);
  assert.match(workspaceAISettingsJs, /llmModels:\s*normalizedModels/);
  assert.match(workspaceJs, /NotchWorkspaceAISettings\.createController/);
  assert.doesNotMatch(workspaceJs, /function renderAIProviderNavigation\(/);
  assert.doesNotMatch(workspaceJs, /const llmProvider =/);
});

test('credential storage and selection state stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-credentials.js') < html.indexOf('workspace.js'));
  assert.match(workspaceCredentialsJs, /listCredentials/);
  assert.match(workspaceCredentialsJs, /saveCredential/);
  assert.match(workspaceCredentialsJs, /notch:clear-selection/);
  assert.match(workspaceCredentialsJs, /window\.NotchWorkspaceCredentials/);
  assert.doesNotMatch(workspaceJs, /function renderCredentials\(/);
  assert.doesNotMatch(workspaceJs, /credentialSelection/);
});

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(clipboardControllerJs, /const starOutlineSvg\s*=/);
  assert.match(clipboardControllerJs, /const starFilledSvg\s*=/);
});

test('clipboard history and image state live in a shared persistent store', () => {
  assert.ok(html.indexOf('clipboard-store.js') < html.indexOf('app.js'));
  assert.match(clipboardStoreJs, /notch-clip-history/);
  assert.match(clipboardStoreJs, /notch-clip-favorites/);
  assert.match(clipboardStoreJs, /prependClipboardHistory/);
  assert.match(clipboardStoreJs, /onNewClipEntry/);
  assert.match(clipboardStoreJs, /readClipImage/);
  assert.match(clipboardStoreJs, /deleteClipImages/);
  assert.match(clipboardControllerJs, /NotchClipboardStore\.createController/);
  assert.match(clipboardControllerJs, /clipboardStore\.subscribe/);
  assert.match(clipboardControllerJs, /clipboardStore\.toggleFavorite/);
  assert.match(clipboardControllerJs, /clipboardStore\.removeEntry/);
  assert.match(clipboardControllerJs, /clipboardStore\.clear/);
  assert.doesNotMatch(appJs, /function loadClipHistory\(/);
  assert.doesNotMatch(appJs, /function loadClipFavorites\(/);
  assert.doesNotMatch(appJs, /window\.notchAPI\.onNewClipEntry/);
});

test('clipboard history UI and home favorites use a dedicated controller', () => {
  assert.ok(html.indexOf('clipboard-controller.js') < html.indexOf('app.js'));
  assert.match(clipboardControllerJs, /function renderClipList\(/);
  assert.match(clipboardControllerJs, /function renderClipFavs\(/);
  assert.match(clipboardControllerJs, /clip-toolbar/);
  assert.match(clipboardControllerJs, /toggleClipFavorite/);
  assert.match(clipboardControllerJs, /deleteClipEntry/);
  assert.match(clipboardControllerJs, /window\.NotchClipboardController/);
  assert.match(appJs, /NotchClipboardController\.createController/);
  assert.doesNotMatch(appJs, /function renderClipList\(/);
  assert.doesNotMatch(appJs, /function renderClipFavs\(/);
  assert.doesNotMatch(appJs, /function toggleClipFavorite\(/);
  assert.doesNotMatch(appJs, /function deleteClipEntry\(/);
});

test('pomodoro state and controls use a dedicated injected controller', () => {
  assert.ok(html.indexOf('pomodoro-controller.js') < html.indexOf('app.js'));
  assert.match(pomodoroControllerJs, /dynamic-panel-pomodoro-duration-v3/);
  assert.match(pomodoroControllerJs, /notifyPomodoro/);
  assert.match(pomodoroControllerJs, /showStatusToast/);
  assert.match(pomodoroControllerJs, /NotchPomodoroController/);
  assert.match(appJs, /NotchPomodoroController\.createController/);
  assert.doesNotMatch(appJs, /function renderPomodoro\(/);
  assert.doesNotMatch(appJs, /pomodoroToggle\?\.addEventListener/);
});

test('todo keeps P0-P3 storage while time scopes stay derived from deadlines', () => {
  for (const name of ['学习与课程', '内容与创作', '产品与开发', '生活与事务']) {
    assert.match(html, new RegExp(`value="${name}"`));
  }
  assert.match(appJs, /migrateTodoCategoryNames/);
  assert.equal((html.match(/data-todo-scope="(?:today|week|later|all)"/g) || []).length, 4);
  assert.equal((html.match(/data-todo-date-shortcut="(?:today|tomorrow|weekend|next-week)"/g) || []).length, 4);
  assert.match(todoListControllerJs, /filterTodosByTimeScope\(/);
  assert.match(todoListControllerJs, /todoTimeScopeCounts\(/);
  assert.match(todoListControllerJs, /data-todo-completed-toggle/);
  assert.match(appJs, /NotchTodoList\.createTodoListController/);
  assert.doesNotMatch(appJs, /function todoItemHtml\(/);
  assert.match(todoEditorControllerJs, /defaultTodoDeadlineForScope\(/);
  assert.match(todoEditorControllerJs, /shiftCalendarMonth/);
  assert.match(appJs, /NotchTodoEditor\.createTodoEditorController/);
  assert.match(todoMutationControllerJs, /createTodoMutationController/);
  assert.match(todoMutationControllerJs, /bindLists/);
  assert.match(todoMutationControllerJs, /bindBulkDelete/);
  assert.match(todoScopeControllerJs, /createTodoScopeController/);
  assert.match(todoScopeControllerJs, /bindControls/);
  assert.match(appJs, /NotchTodoScope\.createTodoScopeController/);
  assert.match(todoApiControllerJs, /createTodoApiController/);
  assert.match(todoApiControllerJs, /applyAIBatch/);
  assert.match(todoApiControllerJs, /undoAIBatch/);
  assert.match(appJs, /NotchTodoApi\.createTodoApiController/);
  assert.match(appJs, /todoScopeController\.setTimeScope/);
  assert.match(appJs, /NotchTodoMutation\.createTodoMutationController/);
  assert.doesNotMatch(appJs, /function (addTodo|editTodo|toggleTodo|deleteTodo)\(/);
  assert.doesNotMatch(appJs, /function renderTodoCalendar\(/);
  assert.match(appJs, /window\.addEventListener\('focus', refreshTodoTemporalView\)/);
  assert.match(todoPlannerCss, /\.todo-scope-control/);
  assert.match(todoListCss, /\.todo-completed-disclosure/);
  assert.doesNotMatch(appJs, /localStorage\.setItem\([^\n]*todo-time-scope/);
});

test('launcher loads the browser pinyin index before its shared search domain', () => {
  assert.ok(html.indexOf('pinyin-pro/dist/index.js') < html.indexOf('launcher/domain.js'));
  assert.match(launcherDomain, /pinyinPro\?\.pinyin/);
  assert.match(launcherDomain, /pattern: 'first'/);
});

test('global shortcuts expose configurable panel, launcher, screenshot, screen recording and audio actions', () => {
  for (const id of ['settings-shortcut-value', 'settings-launcher-shortcut-value', 'settings-screenshot-shortcut-value', 'settings-video-shortcut-value', 'settings-audio-shortcut-value']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(preloadJs, /setShortcut:.*settings:set-shortcut/);
  assert.match(preloadJs, /onAudioRecordingShortcut:.*shortcut:audio-recording/);
  assert.match(shortcutServiceJs, /onActionShortcut\(action\)/);
  assert.match(mainJs, /onActionShortcut: \(action\)/);
  assert.match(mainJs, /mode: 'video', region: true/);
  assert.match(mainJs, /captureService\.open\(request\)/);
  assert.match(workspaceAppSettingsJs, /settingsVideoShortcutChange/);
  assert.match(workspaceRecordingLifecycleJs, /onAudioRecordingShortcut/);
  assert.match(workspaceRecordingLifecycleJs, /await window\.NotchPanel\?\.navigate\(\{ tab: 'recordings' \}\)/);
  assert.ok(html.indexOf('shortcut-recorder-controller.js') < html.indexOf('app.js'));
  assert.match(shortcutRecorderControllerJs, /keyEventToAccelerator/);
  assert.match(shortcutRecorderControllerJs, /setShortcut/);
  assert.match(shortcutRecorderControllerJs, /notch:record-shortcut/);
  assert.doesNotMatch(appJs, /shortcutRecorderAction/);
  assert.doesNotMatch(appJs, /saveRecordedShortcut/);
});

test('Windows collapsed notch stays compact and grows only on approach', () => {
  assert.match(appJs, /app\.dataset\.platform\s*=\s*window\.notchAPI\?\.platform/);
  const compactRule = platformCss.match(/#app\[data-platform='win32'\]\.collapsed \.notch \{([\s\S]*?)\n\}/)?.[1] || '';
  const hoverRule = platformCss.match(/#app\[data-platform='win32'\]\.collapsed \.notch:hover \{([\s\S]*?)\n\}/)?.[1] || '';
  const closingRule = platformCss.match(/#app\[data-platform='win32'\]\.closing \.notch \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactRule, /width:\s*160px/);
  assert.match(compactRule, /height:\s*8px/);
  assert.match(compactRule, /width var\(--d-base\)/);
  assert.match(hoverRule, /width:\s*184px/);
  assert.match(hoverRule, /height:\s*30px/);
  assert.match(closingRule, /width:\s*160px/);
  assert.match(closingRule, /height:\s*8px/);
  assert.match(closingRule, /background:\s*var\(--bg-base\)/);
  assert.match(preloadJs, /setCollapsedHover:.*window:set-collapsed-hover/);
  assert.match(appJs, /notch\.addEventListener\('mouseenter'.*setCollapsedHover/s);
  assert.match(appJs, /notch\.addEventListener\('mouseleave'.*setCollapsedHover/s);
  assert.match(windowIpcJs, /ipcMain\.on\('window:set-collapsed-hover'/);
  assert.doesNotMatch(appJs, /native-resizing/);
});

test('Windows panel motion stays on compositor-only properties', () => {
  const shellRule = platformCss.match(/#app\[data-platform='win32'\] \.panel::before \{([\s\S]*?)\n\}/)?.[1] || '';
  const expandedRule = platformCss.match(/#app\[data-platform='win32'\]\.expanded \.panel::before \{([\s\S]*?)\n\}/)?.[1] || '';
  const closingShellRule = platformCss.match(/#app\[data-platform='win32'\]\.closing \.panel::before \{([\s\S]*?)\n\}/)?.[1] || '';
  const mainWindowOptions = mainJs.match(/mainWindow = new BrowserWindow\(\{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(mainWindowOptions, /backgroundThrottling:\s*false/);
  assert.match(shellRule, /clip-path:\s*none/);
  assert.match(shellRule, /transform:\s*scaleX\(0\.15\)/);
  assert.match(shellRule, /will-change:\s*transform, opacity/);
  assert.match(expandedRule, /transform:\s*scaleX\(1\)/);
  assert.match(closingShellRule, /transform:\s*scaleX\(0\.13\)/);
  assert.doesNotMatch(shellRule, /transition:[\s\S]*clip-path/);
});

test('notes provide local-first creation, rich editing, and guarded image attachments', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-new"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /class="notes-taxonomy tile"/);
  assert.match(html, /id="notes-taxonomy-tree"/);
  assert.match(html, /id="notes-category-filter"/);
  assert.match(html, /id="notes-category-add"/);
  assert.match(html, /id="notes-category-editor"/);
  assert.match(html, /id="notes-category-confirm"/);
  assert.match(html, /id="notes-tag-toolbar"/);
  assert.match(html, /id="notes-tag-filter"/);
  assert.match(html, /id="notes-tag-editor"/);
  assert.match(html, /id="notes-tag-confirm"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
  assert.ok(html.indexOf('notes-markdown.js') < html.indexOf('notes-store.js'));
  assert.ok(html.indexOf('notes-store.js') < html.indexOf('notes-attachments-controller.js'));
  assert.ok(html.indexOf('notes-attachments-controller.js') < html.indexOf('notes-taxonomy-controller.js'));
  assert.ok(html.indexOf('notes-taxonomy-controller.js') < html.indexOf('notes-editor-controller.js'));
  assert.ok(html.indexOf('notes-editor-controller.js') < html.indexOf('notes-controller.js'));
  assert.match(notesEditorJs, /window\.NotchNotesEditor/);
  assert.match(notesEditorJs, /createController/);
  assert.match(notesEditorJs, /flushDetailSave/);
  assert.match(notesEditorJs, /setDetailMode/);
  assert.match(notesEditorJs, /bindDetailEditor/);
  assert.doesNotMatch(notesControllerJs, /function applyNotesEditorFormat\(/);
  assert.doesNotMatch(notesControllerJs, /function continueNotesEditorList\(/);
  assert.doesNotMatch(notesControllerJs, /let pendingNotesEditor/);
  assert.ok(html.indexOf('notes-controller.js') < html.indexOf('app.js'));
  assert.match(notesMarkdownJs, /window\.NotchNotesMarkdown/);
  assert.match(notesStoreJs, /window\.NotchNotesStore/);
  assert.match(notesStoreJs, /loadArchive/);
  assert.match(notesStoreJs, /saveArchive/);
  assert.match(notesStoreJs, /loadCategories/);
  assert.match(notesStoreJs, /saveCategories/);
  assert.match(notesAttachmentsJs, /window\.NotchNotesAttachments/);
  assert.match(notesAttachmentsJs, /saveFiles/);
  assert.match(notesAttachmentsJs, /choose/);
  assert.match(notesAttachmentsJs, /deleteNoteImages/);
  assert.match(notesAttachmentsJs, /isSafeImageReference/);
  assert.match(notesTaxonomyJs, /NotchNotesTaxonomy/);
  assert.match(notesTaxonomyJs, /createController/);
  assert.match(notesTaxonomyJs, /removeNoteCategory/);
  assert.match(notesTaxonomyJs, /removeNoteTag/);
  assert.match(notesMarkdownJs, /safeNoteImageReference/);
  assert.match(notesMarkdownJs, /safeMarkdownUrl/);
  assert.match(notesMarkdownJs, /buildMarkdownPreview/);
  assert.match(notesControllerJs, /window\.NotchNotesController/);
  assert.match(notesControllerJs, /function createNote\(\)/);
  assert.match(notesControllerJs, /NotchNotesStore\.createStore/);
  assert.doesNotMatch(notesControllerJs, /NOTE_ARCHIVE_KEY|NOTE_CATEGORIES_KEY/);
  assert.doesNotMatch(notesControllerJs, /normalizeNoteArchive\(/);
  assert.match(notesEditorJs, /function applyTabIndentation/);
  assert.match(notesEditorJs, /applyTabIndentation\(noteInput/);
  assert.match(notesEditorJs, /addEventListener\('paste'/);
  assert.match(notesEditorJs, /addEventListener\('drop'/);
  assert.match(notesControllerJs, /safeNoteImageReference/);
  assert.match(notesControllerJs, /NotchNotesAttachments\.createController/);
  assert.doesNotMatch(notesControllerJs, /function saveNoteImageFiles\(/);
  assert.doesNotMatch(notesControllerJs, /function insertNoteImageReferences\(/);
  assert.match(appJs, /NotchNotesController\.createController/);
  assert.doesNotMatch(appJs, /function createNote\(\)/);
  assert.doesNotMatch(appJs, /function renderNotesTaxonomy\(/);
  assert.match(notesCss, /\.notes-list \{[^}]*scrollbar-gutter:\s*stable[^}]*scrollbar-color:\s*transparent transparent/);
  assert.match(notesCss, /\.notes-list:hover,\s*\.notes-list:focus-within \{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb-hover\)/);
  assert.match(notesCss, /\.notes-list::-webkit-scrollbar-button \{[^}]*display:\s*none[^}]*width:\s*0[^}]*height:\s*0/);
  assert.match(preloadJs, /notes:save-image/);
  assert.match(preloadJs, /notes:choose-images/);
  assert.match(preloadJs, /notes:read-image/);
  assert.match(preloadJs, /notes:delete-images/);
  assert.match(mainJs, /NOTE_IMAGE_MAX_BYTES\s*=\s*20 \* 1024 \* 1024/);
  assert.match(mainJs, /NOTE_IMAGE_MAX_EDGE\s*=\s*2400/);
  assert.match(mainJs, /getSafeNoteImagePath/);
  assert.match(mainJs, /NOTE_IMAGES_DIR_NAME/);
  assert.doesNotMatch(appJs, /data:image\/[^;]+;base64[^\n]*localStorage/);
});

test('home recent notes show category and tag while keeping inactive scrolling unobtrusive', () => {
  assert.match(html, /id="home-recent-summary"/);
  assert.match(homeJs, /category\.tags\.find\(\(item\) => item\.id === note\.tagId\)/);
  assert.match(homeJs, /className = 'home-note-tag'/);
  assert.match(homeCss, /\.home-note-rows \{[^}]*scrollbar-color:\s*transparent transparent/);
  assert.match(homeCss, /\.home-note-rows:hover, \.home-note-rows:focus-within/);
  assert.match(homeCss, /\.home-note-rows:focus-within::-webkit-scrollbar-thumb/);
});

test('home and settings remove the mirror module completely', () => {
  assert.doesNotMatch(html, /home-mirror|mirror-stage|mirror-video|data-settings-home-module="mirror"/);
  assert.doesNotMatch(stylesCss, /home-mirror|mirror-stage|mirror-video|--home-mirror|镜子/);
  assert.doesNotMatch(appJs, /HOME_MODULE_REGISTRY[^\n]*mirror|startMirror|stopMirror|getUserMedia/);
  assert.doesNotMatch(workspaceJs, /getMirrorImage|chooseMirrorImage|settingsMirrorPreview/);
  assert.doesNotMatch(mainJs, /MIRROR_IMAGE_FILE|mirror:choose-image|media:camera|替换镜子配图/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceRecordingLifecycleJs, /function beginDraft\(\)/);
  assert.match(workspaceRecordingsViewJs, /recordingLiveTranscript/);
  assert.match(workspaceRecordingsViewJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceRecordingsViewJs, /recording-live-pause/);
  assert.match(workspaceRecordingsViewJs, /recording-live-stop/);
  assert.match(workspaceRecordingLifecycleJs, /function togglePause\(\)/);
  assert.match(workspaceRecordingLifecycleJs, /function stop\(\)/);
  assert.match(workspaceRecordingLifecycleJs, /stopDurationMs = currentDuration\(\)/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.ok(html.indexOf('home-layout-controller.js') < html.indexOf('app.js'));
  assert.match(homeLayoutControllerJs, /notch-home-hidden-modules-v1/);
  assert.match(homeLayoutControllerJs, /validateHomeWidgetLayout/);
  assert.match(homeLayoutControllerJs, /const api = Object\.freeze/);
  assert.match(homeLayoutControllerJs, /notch:home-modules-changed/);
  assert.match(homeLayoutControllerJs, /notch:home-layout-error/);
  assert.match(homeLayoutControllerJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
  assert.match(homeLayoutControllerJs, /isRecordingActive/);
  assert.match(appJs, /NotchHomeLayoutController\.createController/);
  assert.doesNotMatch(appJs, /function setHomeModuleVisible\(/);
});

test('retired homepage widgets keep migration data but have no user-facing entry', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'music', 'pomodoro', 'recorder', 'windows', 'note', 'commands',
  ]);
  assert.doesNotMatch(html, /id="home-view-toggle"/);
  assert.match(html, /id="home-bento"[^>]*aria-hidden="true"[^>]*hidden[^>]*inert/);
  assert.doesNotMatch(settingsJs, /\{id:'home',title:'首页组件'/);
  assert.match(settingsJs, /retiredHomeCard\.hidden=true/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'finance', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceAppSettingsJs, /setDefaultTab/);
});

test('finance IPC turns expected cancellation into a structured result', () => {
  assert.match(mainJs, /registerFinanceIpc\(/);
  assert.match(financeIpcJs, /async function handleFinanceRequest\(work\)/);
  assert.match(financeIpcJs, /error\?\.code === 'cancelled'/);
  assert.match(financeIpcJs, /error\?\.name === 'AbortError'/);
  assert.doesNotMatch(financeIpcJs, /\/cancel\/i/);
  assert.match(financeIpcJs, /finance:quotes.*handleFinanceRequest/);
  assert.match(financeJs, /const isCancelledFinanceResult/);
  assert.ok((financeJs.match(/isCancelledFinanceResult\(/g) || []).length >= 9);
});

test('finance is a provider-backed peer workspace with management isolated in settings', () => {
  assert.match(html, /data-tab="finance"/);
  assert.match(html, /id="tab-finance"/);
  assert.match(html, /id="finance-market-status"/);
  assert.match(html, /id="finance-overview-chart"/);
  assert.match(html, /id="finance-overview-market-summaries"/);
  assert.match(html, /id="finance-overview-cn"/);
  assert.match(html, /id="finance-overview-us"/);
  assert.match(html, /id="finance-overview-crypto"/);
  assert.match(html, /class="finance-market-mover-grid"/);
  assert.match(html, /id="finance-ai-analyze"/);
  assert.match(html, /id="finance-ai-result"/);
  assert.match(html, /id="finance-ai-scope"/);
  assert.match(html, /id="finance-ranking-list"/);
  assert.match(html, /id="finance-ranking-source"/);
  assert.match(html, /id="finance-ranking-title"/);
  assert.match(html, /id="finance-ranking-total"/);
  assert.match(html, /id="finance-ranking-spotlight"/);
  assert.match(html, /id="finance-ranking-pagination"/);
  assert.match(html, /id="finance-ranking-previous"/);
  assert.match(html, /id="finance-ranking-next"/);
  assert.match(html, /class="finance-ranking-summary"/);
  assert.match(html, /class="finance-ranking-spotlight-section"/);
  assert.match(financeRankingControllerJs, /finance-ranking-spotlight-card/);
  assert.match(financeRankingControllerJs, /data-finance-ranking-asset/);
  assert.match(financeJs, /openRankingAsset/);
  assert.match(financeRankingControllerJs, /finance-ranking-sparkline/);
  assert.match(financeJs, /market: 'all', source: state\.preferences\.defaultSource, sort: 'gainers'/);
  assert.match(financeJs, /market: 'all', source: state\.preferences\.defaultSource, sort: 'losers'/);
  assert.match(financeJs, /market: 'all', source: state\.preferences\.defaultSource, sort: 'volume'/);
  assert.match(financeOverviewControllerJs, /data-finance-overview-asset/);
  assert.match(financeJs, /榜单已加载/);
  assert.match(financeJs, /openAssetDetail\(quote\)/);
  assert.match(financeJs, /Array\.isArray\(quote\.sparkline\) && quote\.sparkline\.length > 1/);
  assert.match(financeJs, /const OVERVIEW_MARKETS = Object\.freeze\(\[[\s\S]*?market: 'cn'[\s\S]*?market: 'us'[\s\S]*?market: 'crypto'/);
  assert.match(financeJs, /function overviewMarkets\(result\)/);
  assert.match(financeJs, /overviewMarkets\(result\)\.map/);
  assert.match(financeJs, /RANKING_PAGE_SIZE = 50/);
  assert.match(financeJs, /rankingPage/);
  assert.match(financeJs, /rememberRanking/);
  assert.match(financeJs, /function rankingSourceFor/);
  assert.match(financeJs, /sort === 'market_cap'.*source === 'binance'.*'coingecko'/);
  assert.match(financeJs, /value === null \|\| value === undefined/);
  assert.match(financeJs, /JSON\.stringify\(parsed\) !== JSON\.stringify\(normalized\).*localStorage\.setItem\(PREFERENCES_KEY/);
  assert.match(financeRankingControllerJs, /只统计 provider 返回结果/);
  assert.match(html, /id="finance-list-select"/);
  assert.match(html, /class="finance-watchlist-workspace"/);
  assert.match(html, /id="finance-quotes"/);
  assert.match(html, /id="finance-detail"/);
  assert.doesNotMatch(html, /class="finance-sidebar"/);
  assert.doesNotMatch(html, /id="finance-watchlists"/);
  assert.doesNotMatch(html, /id="finance-search"/);
  assert.doesNotMatch(html, /id="finance-add-list"/);

  assert.match(html, /id="finance-settings-asset-search"/);
  assert.match(html, /id="finance-settings-target-list"/);
  assert.match(html, /id="finance-settings-watchlists"/);
  assert.match(html, /id="finance-settings-default-view"/);
  assert.match(html, /id="finance-settings-default-source"/);
  assert.match(html, /class="finance-settings-nav"/);
  assert.match(html, /data-finance-settings-tab="crypto"/);
  assert.match(html, /<\/section>\s*<\/div>\s*<div class="finance-settings-preferences"/);
  assert.doesNotMatch(html, /<\/section>\s*<\/div>\s*<\/div>\s*<div class="finance-settings-preferences"/);
  assert.doesNotMatch(html, /data-finance-market="binance"/);
  assert.match(html, /id="finance-coingecko-key"[^>]*type="password"/);
  assert.match(html, /id="finance-binance-enabled"/);
  assert.match(html, /id="finance-alpha-vantage-key"[^>]*type="password"/);
  assert.match(html, /id="finance-alpaca-secret"[^>]*type="password"/);
  assert.match(html, /id="finance-twelve-data-key"[^>]*type="password"/);
  assert.match(html, /id="finance-sec-edgar-contact"[^>]*type="email"/);
  assert.match(html, /id="finance-quantdash-key"[^>]*type="password"/);
  assert.match(html, /id="finance-quantdash-enabled"/);
  assert.match(html, /id="finance-tencent-enabled"/);
  assert.match(html, /id="finance-eastmoney-enabled"/);
  assert.match(html, /id="finance-sina-enabled"/);
  assert.doesNotMatch(html, /id="finance-tushare-/);
  assert.match(html, /data-finance-provider-save="cn-stock"/);
  assert.match(html, /data-finance-provider-test="coingecko"/);
  assert.match(html, /data-finance-provider-test="binance"/);
  assert.match(html, /data-finance-provider-test="alpha-vantage"/);
  assert.match(html, /data-finance-provider-test="twelve-data"/);
  assert.match(html, /data-finance-provider-test="sec-edgar"/);
  assert.match(html, /data-finance-provider-test="cn-stock"/);
  assert.match(html, /data-finance-provider-save="cn-tencent"/);
  assert.match(html, /data-finance-provider-save="cn-eastmoney"/);
  assert.match(html, /data-finance-provider-save="cn-sina"/);
  assert.match(html, /data-finance-provider-capabilities="cn-stock"/);
  assert.match(html, /CN_Stock|标的池/);
  assert.match(html, /市值榜暂不提供/);
  assert.match(financeJs, /market_cap_not_supported/);
  assert.match(financeJs, /asset_search_symbol_only/);
  assert.match(financeJs, /capabilities\.fullMarket/);
  assert.match(settingsJs, /id:'finance'[\s\S]*?selector:'\.settings-finance-card'/);

  assert.match(financeJs, /notch-finance-view-preferences-v1/);
  assert.match(financeJs, /searchFinanceAssets/);
  assert.match(financeJs, /getFinanceQuotes/);
  assert.match(financeJs, /getFinanceHistory/);
  assert.match(financeJs, /getFinanceFundamentals/);
  assert.match(financeJs, /SEC 申报基本面/);
  assert.match(financeJs, /cancelFinanceRequests/);
  assert.match(financeJs, /runAI/);
  assert.match(financeJs, /financeInterpretation/);
  assert.match(financeJs, /renderFinanceInterpretation/);
  assert.match(financeJs, /retainFinanceInterpretation/);
  assert.match(financeJs, /正在生成新解读，显示上次解读/);
  assert.match(financeJs, /行情已更新，显示上次解读/);
  assert.match(financeJs, /financeSnapshotRevision/);
  assert.match(financeJs, /drawChart/);
  assert.doesNotMatch(financeJs, /renderBars/);
  assert.doesNotMatch(financeJs, /const ASSETS\s*=/);
  assert.doesNotMatch(financeJs, /Math\.(?:random|sin)/);
  assert.match(preloadJs, /getFinanceOverview/);
  assert.match(preloadJs, /getFinanceHistory/);
  assert.match(preloadJs, /getFinanceFundamentals/);
  assert.match(preloadJs, /cancelFinanceRequest/);
  assert.match(preloadJs, /setFinanceProvider/);
  assert.match(preloadJs, /setFinanceRefreshInterval/);
  assert.match(preloadJs, /onFinanceUpdate/);
  assert.match(financeJs, /setFinanceActivity/);
  assert.match(financeJs, /financeStartupReady/);
  assert.match(financeJs, /startupPrefetchRequested/);
  assert.match(financeJs, /prefetch: startupPrefetch/);
  assert.match(financeJs, /const startupPrefetch = !state\.startupPrefetchRequested;/);
  assert.doesNotMatch(financeJs, /!state\.startupPrefetchRequested && state\.preferences\.refreshSeconds > 0/);
  assert.match(financeJs, /onFinanceUpdate/);
  assert.match(financeJs, /Startup prefetch often completes while the workspace is collapsed/);
  assert.doesNotMatch(financeJs, /if \(!state\.financeActive\) return;\s*if \(state\.currentView === 'overview'\) renderOverview\(\);/);
  assert.match(financeJs, /后台更新中/);
  assert.doesNotMatch(financeJs, /refreshTimer/);
  assert.match(mainJs, /createFinanceService/);
  assert.match(mainJs, /refreshFinanceBackground/);
  assert.match(mainJs, /createFinanceBackgroundRefresh/);
  assert.doesNotMatch(mainJs, /clearFinanceBackgroundTimer/);
  assert.match(financeBackgroundJs, /allowInactive/);
  assert.match(financeBackgroundJs, /startupPrefetch/);
  assert.match(financeBackgroundJs, /if \(startupPrefetch\) void refresh\(\{ allowInactive: true \}\)/);
  assert.match(financeBackgroundJs, /interval \* 1000/);
  assert.match(mainJs, /finance:update/);
  assert.match(financeBackgroundJs, /Background refresh .* completed with issues/);
  assert.match(financeBackgroundJs, /Background refresh .* failed/);
  assert.match(mainJs, /api\.binance\.com/);
  assert.match(mainJs, /alphavantage\.co/);
  assert.match(mainJs, /api\.twelvedata\.com/);
  assert.match(mainJs, /data\.sec\.gov/);
  assert.match(mainJs, /api\.quantdash\.net/);
  assert.match(financeConfigResolverJs, /QUANTDASH_API_KEY/);
  assert.doesNotMatch(mainJs, /api\.tushare\.pro/);
  assert.doesNotMatch(mainJs, /TUSHARE_API_TOKEN/);
  assert.match(mainJs, /FINANCE_FETCH_MAX_REQUEST_BYTES/);
  assert.match(mainJs, /createFinanceHttpClient/);
  assert.match(financeHttpClientJs, /method === 'POST'/);
  assert.match(financeHttpClientJs, /response_too_large/);
  assert.match(financeIpcJs, /finance:history/);
  assert.match(financeIpcJs, /finance:fundamentals/);
  assert.match(financeIpcJs, /finance:cancel/);
  assert.match(mainJs, /createFinanceProviderSettings/);
  assert.match(financeProviderSettingsJs, /encryptString/);
  assert.match(financeProviderSettingsJs, /encryptedApiKey/);
  assert.doesNotMatch(mainJs, /function updateFinanceProvider\(/);
  assert.match(financeIpcJs, /capabilities: result\.ok && result\.capabilities/);
  assert.match(mainJs, /finance: true/);
  assert.match(appJs, /'finance'/);
});

test('finance overview projections use a dedicated injected classic-script controller', () => {
  assert.ok(html.indexOf('finance-overview-controller.js') < html.indexOf('finance.js'));
  assert.match(financeOverviewControllerJs, /window\.NotchFinanceOverview\s*=\s*Object\.freeze/);
  assert.match(financeOverviewControllerJs, /renderMovers/);
  assert.match(financeOverviewControllerJs, /renderMarketSummaries/);
  assert.match(financeJs, /NotchFinanceOverview\.createController/);
  assert.match(financeJs, /financeOverviewView\.renderMovers/);
  assert.match(financeJs, /financeOverviewView\.quotes\(\)/);
  assert.doesNotMatch(financeJs, /function renderOverviewMovers\(/);
});

test('finance ranking projections use a dedicated injected classic-script controller', () => {
  assert.ok(html.indexOf('finance-ranking-controller.js') < html.indexOf('finance.js'));
  assert.match(financeRankingControllerJs, /window\.NotchFinanceRanking\s*=\s*Object\.freeze/);
  assert.match(financeRankingControllerJs, /renderPagination/);
  assert.match(financeRankingControllerJs, /finance-ranking-spotlight-card/);
  assert.match(financeJs, /NotchFinanceRanking\.createController/);
  assert.match(financeJs, /financeRankingView\.render/);
  assert.doesNotMatch(financeJs, /function setSummary\(/);
});

test('finance AI facts and projections use a dedicated injected classic-script controller', () => {
  assert.ok(html.indexOf('finance-ai-controller.js') < html.indexOf('finance.js'));
  assert.match(financeAiControllerJs, /window\.NotchFinanceAI\s*=\s*Object\.freeze/);
  assert.match(financeAiControllerJs, /marketFacts/);
  assert.match(financeAiControllerJs, /renderInterpretation/);
  assert.match(financeAiControllerJs, /finance-ai-evidence/);
  assert.match(financeJs, /NotchFinanceAI\.createController/);
  assert.match(financeJs, /financeAiView\.marketFacts/);
  assert.match(financeJs, /api\.runAI/);
});

test('finance watchlist projections use a dedicated injected classic-script controller', () => {
  assert.ok(html.indexOf('finance-watchlist-controller.js') < html.indexOf('finance.js'));
  assert.match(financeWatchlistControllerJs, /window\.NotchFinanceWatchlist\s*=\s*Object\.freeze/);
  assert.match(financeWatchlistControllerJs, /selectedDetailAsset/);
  assert.match(financeWatchlistControllerJs, /render\(\)/);
  assert.match(financeJs, /NotchFinanceWatchlist\.createController/);
  assert.match(financeJs, /financeWatchlistView\.render/);
  assert.doesNotMatch(financeJs, /function sortedAssets\(/);
});

test('finance settings projections use a dedicated classic-script controller', () => {
  assert.ok(html.indexOf('finance-settings-controller.js') < html.indexOf('finance.js'));
  assert.match(financeSettingsControllerJs, /window\.NotchFinanceSettings\s*=\s*Object\.freeze/);
  assert.match(financeSettingsControllerJs, /renderPreferences/);
  assert.match(financeSettingsControllerJs, /renderWatchlists/);
  assert.match(financeSettingsControllerJs, /renderSearchResults/);
  assert.match(financeJs, /NotchFinanceSettings\.createController/);
  assert.match(financeJs, /financeSettingsView\.renderPreferences/);
  assert.doesNotMatch(financeJs, /state\.watchlists\.lists\.map\(\(list\) => `<section class=\"finance-settings-watchlist/);
});

test('finance request lifecycle uses an injected controller and resolves APIs dynamically', () => {
  assert.ok(html.indexOf('finance-request-controller.js') < html.indexOf('finance.js'));
  assert.match(financeRequestControllerJs, /window\.NotchFinanceRequests\s*=\s*Object\.freeze/);
  assert.match(financeRequestControllerJs, /getApi/);
  assert.match(financeRequestControllerJs, /cancelFinanceRequest/);
  assert.match(financeJs, /NotchFinanceRequests\.createController/);
  assert.match(financeJs, /new Proxy/);
  assert.doesNotMatch(financeJs, /financeRequestIds: new Set/);
  assert.doesNotMatch(financeJs, /const api = window\.notchAPI \|\| \{\}/);
});

test('home weather uses an injected controller with guarded refresh lifecycle', () => {
  assert.ok(html.indexOf('home-weather-controller.js') < html.indexOf('home.js'));
  assert.match(homeWeatherJs, /window\.NotchHomeWeather/);
  assert.match(homeWeatherJs, /createController\(host\)/);
  assert.match(homeWeatherJs, /getHomeWeather/);
  assert.match(homeWeatherJs, /searchWeatherCities/);
  assert.match(homeWeatherJs, /open-meteo\.com/);
  assert.match(homeWeatherJs, /invalidate\(\)/);
  assert.match(homeWeatherJs, /dispose\(\)/);
  assert.match(homeJs, /NotchHomeWeather\.createController/);
  assert.match(homeJs, /homeWeather\.tick\(\)/);
  assert.doesNotMatch(homeJs, /function weatherCondition\(/);
  assert.doesNotMatch(homeJs, /function renderWeather\(/);
});

test('home quick capture routes notes and links through explicit modes', () => {
  assert.match(html, /data-home-capture-mode="auto"[^>]*aria-pressed="true"/);
  assert.match(html, /data-home-capture-mode="note"/);
  assert.match(html, /data-home-capture-mode="link"/);
  assert.ok(html.indexOf('home-quick-capture-controller.js') < html.indexOf('home.js'));
  assert.match(homeQuickCaptureJs, /NotchHomeQuickCapture/);
  assert.match(homeQuickCaptureJs, /classifyHomeCapture/);
  assert.match(homeQuickCaptureJs, /saveCapturedLink/);
  assert.match(homeQuickCaptureJs, /saveCaptured/);
  assert.match(homeJs, /NotchHomeQuickCapture\.createController/);
  assert.doesNotMatch(homeJs, /classifyHomeCapture/);
  assert.match(notesControllerJs, /async saveCaptured\(content\)[\s\S]*?requestNoteTitle\(result\.note\)/);
  assert.match(workspaceLinksApiJs, /async saveCapturedLink\(rawValue\)/);
});

test('editable fields receive a native context menu without collapsing the panel', () => {
  assert.match(mainJs, /webContents\.on\('context-menu'/);
  assert.match(mainJs, /editableContextMenuTemplate\(params\.editFlags\)/);
  assert.match(mainJs, /transientSystemInteractionRequests\+\+/);
  assert.match(mainJs, /menu\.popup\(\{ window: owner, callback: release \}\)/);
});

test('home chat exposes temporary-session state, recovery controls and safe markdown', () => {
  assert.match(html, /id="home-chat-empty"/);
  assert.match(html, /id="home-chat-provider"/);
  assert.match(html, /id="home-chat-model-name"/);
  assert.match(html, /id="home-chat-new"[^>]*aria-label="新建对话"/);
  assert.match(html, /id="home-chat-session-save"[^>]*aria-label="保存到当前工作区"/);
  assert.match(html, /id="home-chat-sessions"[^>]*aria-controls="home-chat-session-panel"/);
  assert.match(html, /id="home-chat-session-panel"[^>]*role="dialog"/);
  assert.match(html, /id="home-chat-session-confirm-save"[^>]*hidden/);
  assert.match(html, /id="home-chat-reader"[^>]*role="region"/);
  assert.doesNotMatch(html, /id="home-chat-reader"[^>]*aria-modal/);
  assert.match(html, /id="home-chat-reader-outline"/);
  assert.match(html, /id="home-chat-reader-copy-selection"[^>]*disabled/);
  assert.match(html, /id="home-chat-reader-todos"/);
  assert.match(html, /id="home-chat-context-picker"[^>]*role="dialog"/);
  assert.match(html, /id="home-chat-context-add"[^>]*aria-expanded="false"/);
  assert.match(html, /data-chat-context-type="note"/);
  assert.match(html, /data-chat-context-type="recording"/);
  assert.match(html, /data-chat-context-type="todo"/);
  assert.match(html, /data-chat-context-type="link"/);
  assert.match(html, /data-chat-context-type="clipboard"/);
  assert.match(html, /script src="chat-context\.js"/);
  assert.match(html, /script src="chat-sessions\.js"/);
  assert.match(html, /script src="chat-reader\.js"/);
  assert.match(html, /script src="home-chat-context-controller\.js"/);
  assert.match(html, /script src="home-chat-generation-controller\.js"/);
  assert.match(html, /script src="home-chat-session-controller\.js"/);
  assert.match(html, /script src="home-chat-reader-controller\.js"/);
  assert.ok(html.indexOf('home-chat-context-controller.js') < html.indexOf('home-chat-generation-controller.js'));
  assert.ok(html.indexOf('home-chat-generation-controller.js') < html.indexOf('home-chat-session-controller.js'));
  assert.ok(html.indexOf('home-chat-session-controller.js') < html.indexOf('home-chat-reader-controller.js'));
  assert.ok(html.indexOf('home-chat-reader-controller.js') < html.indexOf('home.js'));
  assert.match(html, /script src="markdown\.js"/);
  assert.match(chatContextJs, /MAX_SOURCES = 3/);
  assert.match(chatSessionsJs, /STORAGE_KEY = 'notch-ai-chat-sessions-v1'/);
  assert.match(chatSessionsJs, /MAX_SESSIONS = 30/);
  assert.match(chatSessionsJs, /MAX_SESSION_CHARS = 512000/);
  assert.match(chatSessionsJs, /MAX_TOTAL_CHARS = 2000000/);
  assert.match(chatReaderJs, /MIN_LONG_CHARS = 600/);
  assert.match(chatReaderJs, /MAX_TODO_SOURCE_CHARS = 12000/);
  assert.match(chatContextJs, /用户显式选择的本地参考资料/);
  assert.match(markdownJs, /window\.NotchMarkdown = \{ render \}/);
  assert.match(markdownJs, /code\.textContent = codeText/);
  assert.doesNotMatch(markdownJs, /container\.innerHTML\s*=/);
  assert.match(mainJs, /registerSystemIpc\(/);
  assert.match(systemIpcJs, /ipcMain\.handle\('shell:openExternal',[\s\S]*?validatePublicHttpUrl\(value\)/);
  assert.match(homeChatGenerationJs, /NotchHomeChatGeneration/);
  assert.match(homeChatGenerationJs, /function cancel\(\)/);
  assert.match(homeChatGenerationJs, /function submit\(rawText/);
  assert.match(homeChatGenerationJs, /onAIEvent/);
  assert.match(homeChatGenerationJs, /cancelAI/);
  assert.match(homeChatGenerationJs, /saveGenerated/);
  assert.doesNotMatch(homeJs, /function submitChat\(/);
  assert.doesNotMatch(homeJs, /api\?\.onAIEvent/);
  assert.match(homeChatContextJs, /NotchHomeChatContext/);
  assert.match(homeChatContextJs, /MAX_SOURCES/);
  assert.match(homeChatContextJs, /getSelectedSources/);
  assert.match(homeChatContextJs, /renderPicker/);
  assert.match(homeJs, /NotchHomeChatContext\.createController/);
  assert.match(homeJs, /NotchNotes\?\.chatContexts/);
  assert.match(homeJs, /NotchWorkspace\?\.chatContexts/);
  assert.match(homeJs, /NotchTodo\?\.chatContexts/);
  assert.match(homeJs, /NotchClipboard\?\.chatContexts/);
  assert.match(homeChatGenerationJs, /context: \{ sourceType: 'manual', text, sources \}/);
  assert.match(homeJs, /NotchHomeChatSession\.createController/);
  assert.match(homeChatSessionJs, /NotchHomeChatSession/);
  assert.match(homeChatSessionJs, /ChatSessions\.searchSessions/);
  assert.match(homeChatSessionJs, /ChatSessions\.renameSession/);
  assert.match(homeChatSessionJs, /ChatSessions\.removeSession/);
  assert.match(homeChatSessionJs, /function persist\(\{ create = false \} = \{\}\)/);
  assert.match(homeChatSessionJs, /ChatSessions\.STORAGE_KEY/);
  assert.match(homeChatReaderJs, /ChatReader\.todoSource/);
  assert.match(homeChatReaderJs, /function open\(turn\)/);
  assert.match(homeChatReaderJs, /host\.toggleTurnNote/);
  assert.match(homeJs, /NotchHomeChatReader\.createController/);
  assert.match(homeJs, /window\.NotchChatReaderView = Object\.freeze/);
  assert.match(appJs, /NotchChatReaderView\?\.handleEscape\(\)/);
  assert.match(aiJs, /returnFocus = active instanceof HTMLElement/);
  assert.doesNotMatch(homeJs, /pendingReply\?\.remove|pendingUser\?\.remove/);
  assert.doesNotMatch(homeJs, /function openReader\(turn\)|readerSelectionText\(\)/);
  assert.doesNotMatch(homeJs, /function renderSessionPanel\(|function openSavedSession\(/);
});

test('home music is app-owned and switches local, HTTPS and go-music-dl playlists', () => {
  assert.match(html, /id="home-music-audio"/);
  assert.match(html, /data-home-media="shuffle"/);
  assert.ok(html.indexOf('home-music-controller.js') < html.indexOf('home.js'));
  assert.match(homeMusicJs, /window\.NotchHomeMusic/);
  assert.match(homeMusicJs, /createController\(host/);
  assert.match(homeMusicJs, /MUSIC_SHUFFLE_KEY/);
  assert.match(homeMusicJs, /shuffledMusicTrack/);
  assert.match(html, /id="home-media-cover"/);
  assert.match(html, /id="home-media-discover"/);
  assert.match(html, /id="home-media-discovery"/);
  assert.match(html, /id="home-media-source-select"/);
  assert.match(html, /class="music-settings-modebar"/);
  assert.match(html, /id="home-media-platform-select"/);
  assert.match(html, /id="home-media-online-results"/);
  assert.match(html, /class="links-layout"/);
  assert.match(html, /class="links-sidebar"/);
  assert.match(html, /data-links-sidebar-view="favorite"/);
  assert.match(html, /id="links-sidebar-groups"/);
  assert.match(html, /id="links-sidebar-tags"/);
  assert.match(html, /class="links-page-head"/);
  assert.match(html, /class="links-capture-bar"/);
  assert.match(html, /id="links-add-submit"/);
  assert.match(html, /class="links-search-wrap"/);
  assert.match(html, /id="links-view-filter"/);
  assert.match(html, /id="links-tag-filter"/);
  assert.match(html, /搜索标题、网址、描述或标签/);
  assert.match(html, /img-src 'self' data: blob:/);
  assert.match(html, /data-music-catalog-view="mine"/);
  assert.match(html, /data-music-catalog-view="discover"/);
  assert.match(html, /id="home-media-library"[^>]*aria-label="打开音乐库"/);
  assert.match(html, /id="home-media-queue"/);
  assert.match(html, /id="home-media-queue-label"/);
  assert.match(html, /id="music-source-select"/);
  assert.match(html, /id="music-playlist-select"/);
  assert.match(html, /id="music-platform-select"/);
  assert.match(html, /id="music-category-select"/);
  assert.match(html, /id="music-playlist-search-form"/);
  assert.match(html, /id="music-online-results"/);
  assert.match(homeCss, /\.music-online-results \{[^}]*min-height: 160px; max-height: 360px/);
  assert.match(html, /id="music-source-form"/);
  assert.match(html, /id="music-local-add-folder"/);
  assert.match(html, /id="music-volume"[^>]*type="range"/);
  assert.match(settingsJs, /id:'music'/);
  for (const api of ['getHomeMusicLibrary', 'setHomeMusicMode', 'selectHomeMusicPlaylist', 'refreshHomeMusicSource', 'addHomeMusicSource', 'removeHomeMusicSource', 'browseHomeMusicCategories', 'searchHomeMusicPlaylists', 'browseHomeMusicCategory', 'browseHomeMusicRecommend', 'browseHomeMusicUserPlaylists', 'selectHomeMusicOnlinePlaylist', 'loadHomeMusicCover', 'chooseHomeMusicFiles', 'chooseHomeMusicFolder', 'addHomeMusicUrl', 'removeHomeMusicTrack', 'loadHomeMusicTrack']) assert.match(preloadJs, new RegExp(api));
  for (const channel of ['home:music-library', 'home:music-mode', 'home:music-select-playlist', 'home:music-refresh-source', 'home:music-add-source', 'home:music-remove-source', 'home:music-browse-categories', 'home:music-search-playlists', 'home:music-browse-category', 'home:music-browse-recommend', 'home:music-browse-user-playlists', 'home:music-select-online-playlist', 'home:music-cover', 'home:music-choose-files', 'home:music-choose-folder', 'home:music-add-network', 'home:music-remove', 'home:music-load']) assert.match(homeIpcJs, new RegExp(channel));
  assert.match(homeMusicJs, /URL\.createObjectURL/);
  assert.match(homeMusicJs, /loadHomeMusicCover\?\.\(reference\)/);
  assert.match(homeMusicJs, /browseHomeMusicCategories/);
  assert.match(homeMusicJs, /browseHomeMusicUserPlaylists/);
  assert.match(homeMusicJs, /home-media-discovery/);
  assert.match(homeMusicJs, /homeDiscoverySource/);
  assert.match(homeMusicJs, /ensureHomeMusicCategories/);
  assert.match(homeMusicJs, /ensureMusicSettingsCategories/);
  assert.match(homeMusicJs, /notch:settings-category-change/);
  assert.match(homeMusicJs, /MUSIC_DISCOVERY_FILTER_KEY/);
  assert.match(homeMusicJs, /saveMusicDiscoveryFilter/);
  assert.match(homeJs, /NotchHomeMusic\.createController/);
  assert.match(homeJs, /homeMusic\.dispose\(\)/);
  assert.match(workspaceLinksRendererJs, /parseLinkQuery/);
  assert.match(workspaceLinksRendererJs, /toggle-link-favorite/);
  assert.match(workspaceLinksRendererJs, /toggle-link-read/);
  assert.match(workspaceLinksRendererJs, /link\.description/);
  assert.match(aiJs, /ai-metadata-tags/);
  assert.match(homeMusicJs, /settingsPlaylists = musicCatalogView === 'mine'/);
  assert.match(homeMusicJs, /home-media-progress'\)\.hidden = !activeMusicTrack\(\)/);
  assert.doesNotMatch(homeJs, /function renderMusicNavigation\(/);
  assert.doesNotMatch(homeJs, /function loadMusicTrack\(/);
  assert.doesNotMatch(homeJs, /MUSIC_DISCOVERY_FILTER_KEY/);
  assert.doesNotMatch(preloadJs, /getHomeMedia|controlHomeMedia|getMusicStatus|controlMusic/);
  assert.doesNotMatch(mainJs, /home:media-status|home:media-control|music:status|music:control|SODA_MUSIC/);
  assert.doesNotMatch(workspaceJs, /getMusicStatus|controlMusic/);
});

test('AI providers configure directly inside the settings page', () => {
  assert.match(html, /class="tile settings-card settings-api-card"/);
  assert.match(html, /class="ai-provider-sidebar"/);
  assert.match(html, /id="ai-content-provider-list"/);
  assert.match(html, /class="ai-provider-config"/);
  assert.match(html, /id="llm-model-list"/);
  assert.match(html, /id="llm-model-add"/);
  assert.match(workspaceAISettingsJs, /llmModels:\s*normalizedModels/);
  assert.doesNotMatch(html, /id="transcription-settings-backdrop"|id="settings-api-configure"|id="ai-service-tab-content"/);
  assert.match(workspaceAISettingsJs, /data-ai-provider/);
  assert.match(workspaceAISettingsJs, /NotchSettings\?\.select\('api'\)/);
  assert.match(aiCss, /\.ai-settings-layout[^}]*grid-template-columns:\s*196px minmax\(0,1fr\)/);
});

test('automatic AI naming sends stable source identities', () => {
  assert.match(notesControllerJs, /organizeMaterial\(\{ kind: 'note', sourceId: note\.id, text: expectedContent \}\)/);
  assert.match(workspaceRecordingLifecycleJs, /organizeMaterial\(\{ kind: 'recording', sourceId: recording\.id, text: expectedTranscript \}\)/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /notch:home-modules-changed/);
  assert.match(workspaceWindowsJs, /NotchHome\?\.isVisible/);
});
