const {
  app,
  BrowserWindow,
  webContents,
  screen,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  systemPreferences,
  clipboard,
  globalShortcut,
  safeStorage,
  dialog,
  desktopCapturer,
  ClipboardItem,
} = require('electron');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { Readable } = require('stream');
const crypto = require('crypto');
const { execFile } = require('child_process');
const platformPolicy = require('./platform');
const { createLauncherService } = require('./launcher/service');
const { createAIService } = require('./ai/service');
const { createFinanceService } = require('./finance-service');
const { registerCaptureScheme, createCaptureService } = require('./captureService');
const { copyCaptures } = require('./captureStorage');
const { createWindowGeometry } = require('./main/window-geometry');
const { createNetworkSecurity } = require('./main/network-security');
const { createLinkInspector } = require('./main/link-inspector');
const { createWorkspaceFiles } = require('./main/workspace-files');
const { createClipboardService } = require('./main/clipboard-service');
const { createTaskNotificationServer } = require('./main/task-notification-server');
const { createTaskNotificationDomain } = require('./main/task-notification-domain');
const { createTaskNotificationQueue } = require('./main/task-notification-queue');
const { createTaskNotificationTimers } = require('./main/task-notification-timers');
const { createTaskNotificationWindowState } = require('./main/task-notification-window-state');
const { createTaskNotificationWindowFactory } = require('./main/task-notification-window');
const { createTaskNotificationController } = require('./main/task-notification-controller');
const { createTodoReminderService } = require('./main/todo-reminder-service');
const { createFinanceConfigResolver } = require('./main/finance-config-resolver');
const { createFinanceProviderSettings } = require('./main/finance-provider-settings');
const { createFinanceHttpClient } = require('./main/finance-http-client');
const { createSystemAppIconService } = require('./main/system-app-icon-service');
const { createPasteTargetService } = require('./main/paste-target-service');
const { createPermissionService } = require('./main/permission-service');
const { createAppSettingsService } = require('./main/app-settings-service');
const { createLauncherSettingsStore } = require('./main/launcher-settings-store');
const { createNotchTrayIcon } = require('./main/tray-icon');
const { createTranscriptionSettingsStore } = require('./main/transcription-settings-store');
const { createTranscriptionService } = require('./main/transcription-service');
const { createAIProviderConfig } = require('./main/ai-provider-config');
const { createJsonFileStore } = require('./main/json-file-store');
const { createStoredSecretDecryptor } = require('./main/secret-decryptor');
const { createBoundedResponseTextReader } = require('./main/response-text-reader');
const { taskWindowMatchScore } = require('./main/task-window-matcher');
const { createTaskNotificationLayout } = require('./main/task-notification-layout');
const { createFinanceBackgroundRefresh } = require('./main/finance-background-refresh');
const { registerFinanceIpc } = require('./main/ipc/finance');
const { registerRecordingsIpc } = require('./main/ipc/recordings');
const { registerNotesIpc } = require('./main/ipc/notes');
const { registerClipboardIpc } = require('./main/ipc/clipboard');
const { registerAiIpc } = require('./main/ipc/ai');
const { registerTranscriptionIpc } = require('./main/ipc/transcription');
const { registerHomeIpc } = require('./main/ipc/home');
const { privacySettingsPanesFor, registerSystemIpc } = require('./main/ipc/system');
const { createWorkspaceController } = require('./main/workspace-controller');
const { registerWorkspaceIpc } = require('./main/ipc/workspace');
const { createSettingsController } = require('./main/settings-controller');
const { registerSettingsIpc } = require('./main/ipc/settings');
const { createShortcutService } = require('./main/shortcut-service');
const { createCredentialsVault } = require('./main/credentials-vault');
const { registerCredentialsIpc } = require('./main/ipc/credentials');
const { registerLinksIpc } = require('./main/ipc/links');
const { registerWindowIpc } = require('./main/ipc/window');
const { registerWindowsIpc } = require('./main/ipc/windows');
const { registerTaskNotificationIpc } = require('./main/ipc/task-notification');
const { registerLauncherIpc } = require('./main/ipc/launcher');
registerCaptureScheme();
let captureService = null;
let captureQuitPending = false;
let captureQuitReady = false;
const {
  PROVIDERS,
  providerFor,
  normalizeContentProfile,
  normalizeContentProfiles,
  normalizeContentService,
  normalizeModelList,
  normalizeModelName,
  normalizeTranscriptionService,
  publicContentProviders,
  contentConfigRevision,
} = require('./ai/providers');
const { resolveLaunchPath } = require('./launcher/paths');
const launcherFocus = require('./launcher/focus').createFocusService();
const launcherApplications = require('./launcher/application-actions').createApplicationActions({readShortcut:file=>shell.readShortcutLink(file),owner:()=>mainWindow&&!mainWindow.isDestroyed()?mainWindow.getNativeWindowHandle().readBigUInt64LE(0):null});
const PLATFORM_CAPABILITIES = platformPolicy.capabilities(process.platform);
const pasteTargetService = createPasteTargetService({
  execFile,
  automaticPaste: PLATFORM_CAPABILITIES.automaticPaste,
});
const {
  validNoteId,
  parseNoteImageReference,
  isPrivateAddress,
  extractPageTitle,
  extractPageDescription,
  recordingExtension,
  normalizeWindowRows,
  todoReminderState,
  todoReminderTimerDelay,
  taskNotificationIdentity,
  normalizeCredentialInput,
  extractFaviconHref,
  clipboardServicePolicy,
  createClipboardImageFingerprint,
  prepareClipboardImagePayload,
  installLocalWebContentsGuards,
  runOwnedOpenDialog,
  readClipboardObservation,
  screenRecordingProbePolicy,
  taskNotificationWindowPolicy,
  updateFeaturePreference,
  editableContextMenuTemplate,
  selectTranscriptionSettings,
  createWorkspacePersistenceGate,
  hoverSpacePollingPolicy,
  collapsedDisplayFollowPolicy,
  collapsedDisplayRelocationPolicy,
  panelBlurCollapsePolicy,
  isValidShortcutAccelerator,
  shortcutAssignmentConflict,
  reduceClipboardObservation,
  normalizeDefaultTabPreference,
  updateDefaultTabPreference,
  createForegroundMediaPermissionCoordinator,
} = require('./main-services');

// Keep the historical data directory so upgrading users retain notes, links,
// recordings and encrypted settings after the public product rename.
const LEGACY_USER_DATA_PATH = path.join(app.getPath('appData'), 'Dynamic Panel');
app.setName('Dynamic Panel');
// Honor Electron's standard profile switch for isolated automated tests.
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') || LEGACY_USER_DATA_PATH);

const COLLAPSED_WIDTH = 200;
const COLLAPSED_MIN_HEIGHT = 38;
// NOTCH_LIP（原 6px 唇边）已移除：折叠条高度现在恰好等于菜单栏高（≈物理刘海高），
// 一个像素都不超出物理刘海。虽然折叠条完全在菜单栏拦截带内，
// 但本项目窗口使用 setAlwaysOnTop(true,'screen-saver') 级别，
// 实测菜单栏不拦截该级别窗口的点击，折叠条仍可点击展开。
// （见项目记忆 notch-top-geometry-constraint / commit f12aea1）

// 所有 Tab 共用同一展开尺寸，切换内容时不再改变原生窗口边界。
// 原生窗口只在折叠/展开两个模式间切换，避免 Tab 切换产生明显的宽高跳变。
const EXPANDED_WIDTH = 1240;
const EXPANDED_PANEL_HEIGHT = 540;
const TAB_SIZES = {
  home: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  todo: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  notes: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  clip: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  links: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  recordings: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  credentials: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  settings: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
};
// 与渲染层结构常量对应：panel padding-top(--s-2 8) + 顶栏(--topbar-h 40)
// + panels margin-top(--s-3 12) + panel padding-bottom(--s-4 16)。内容顶到屏幕最上沿，不留菜单栏带。
const EXPANDED_CHROME_Y = 76;
const SCREEN_MARGIN = 24; // 宽度超屏时两侧保留的安全边
const COLLAPSE_WATCHDOG_MS = 650;

const CLIP_MAX_ITEMS = 100;
const CLIP_POLL_INTERVAL_MS = 500;
// 大图从系统 ClipboardItem 复制到进程仍有固定成本；图片探测降到 3 秒一次，
// 文本继续保持 500ms 响应，不影响日常文字剪贴体验。
const CLIP_IMAGE_POLL_INTERVAL_MS = 3000;
const CLIP_IMAGES_DIR_NAME = 'clipboard-images';
const NOTE_IMAGES_DIR_NAME = 'note-images';
const NOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const NOTE_IMAGE_MAX_EDGE = 2400;

const RECORDINGS_DIR_NAME = 'recordings';
const TRANSCRIPTION_SETTINGS_FILE = 'transcription-settings.json';
const AI_DIAGNOSTICS_FILE = 'ai-diagnostics.json';
const FINANCE_SETTINGS_FILE = 'finance-settings.json';
const CREDENTIALS_VAULT_FILE = 'credentials.vault.json';
const APP_SETTINGS_FILE = 'app-settings.json';
const WORKSPACE_SETTINGS_FILE = 'workspace-settings.json';
const WORKSPACE_DATA_FILE = 'workspace.json';
const workspacePersistenceGate = createWorkspacePersistenceGate();
const TRANSCRIPTION_MODEL = 'qwen3-asr-flash-realtime';
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const TRANSCRIPTION_FINISH_TIMEOUT_MS = 7000;

const decryptStoredSecret = createStoredSecretDecryptor({ safeStorage, BufferImpl: Buffer });
const RECORDING_MAX_BYTES = 200 * 1024 * 1024;
const LINK_FETCH_TIMEOUT_MS = 8000;
const LINK_FETCH_MAX_BYTES = 512 * 1024;
const LINK_FETCH_MAX_REDIRECTS = 3;
const FINANCE_FETCH_TIMEOUT_MS = 10000;
const FINANCE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const FINANCE_FETCH_MAX_REQUEST_BYTES = 32 * 1024;
const FINANCE_ALLOWED_ORIGINS = new Set([
  'https://api.coingecko.com',
  'https://api.binance.com',
  'https://www.alphavantage.co',
  'https://data.alpaca.markets',
  'https://paper-api.alpaca.markets',
  'https://api.twelvedata.com',
  'https://www.sec.gov',
  'https://data.sec.gov',
  'https://api.quantdash.net',
  'https://qt.gtimg.cn',
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
  'https://push2his.eastmoney.com',
  'https://hq.sinajs.cn',
]);

const TASK_NOTIFICATION_WIDTH = 400;
const TASK_NOTIFICATION_HEIGHT = 96;
const TASK_NOTIFICATION_SCREEN_MARGIN = 12;
const TASK_NOTIFICATION_VISIBLE_MS = 6000;
const TASK_NOTIFICATION_LEAVE_MS = 360;
const TASK_NOTIFICATION_DEDUPE_MS = 2000;
const TASK_NOTIFICATION_MAX_QUEUE = 5;
const TASK_NOTIFICATION_BODY_LIMIT = 64 * 1024;
const TASK_NOTIFICATION_HOST = '127.0.0.1';
const TASK_NOTIFICATION_PORT = 43821;
// /notify/<source> 的来源白名单：只放行已知 Agent，其余一律 404。
const TASK_NOTIFICATION_SOURCES = new Set(['codex', 'gpt', 'claude']);
const TODO_REMINDER_LEAD_MS = 60 * 60 * 1000;

let mainWindow = null;
let tray = null;
let currentMode = 'collapsed';
let currentTab = 'home';
let collapseWatchdog = null;
let collapseGeneration = 0;
let hideWhenCollapsed = false;
let isQuitting = false;
let mediaPermissionRequests = 0;
let transientSystemInteractionRequests = 0;
const mediaPermissionCoordinator = createForegroundMediaPermissionCoordinator();

let notificationWindow = null;
let taskNotificationController = null;

let windowsCollapsedHovering = false;
let displayFollowTimer = null;
let displayRelocationTimer = null;
let displayRelocationGeneration = 0;
let panelBlurTimer = null;
let panelBlurGeneration = 0;
let launcherService;
let launcherManaging = false;
let aiModelService = null;
let aiContextGeneration = 0;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      hideWhenCollapsed = false;
      repositionWindow(getTargetDisplay());
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

const windowGeometry = createWindowGeometry({
  screen,
  platformPolicy,
  platform: process.platform,
  collapsedWidth: COLLAPSED_WIDTH,
  collapsedMinHeight: COLLAPSED_MIN_HEIGHT,
  expandedChromeY: EXPANDED_CHROME_Y,
  screenMargin: SCREEN_MARGIN,
  tabSizes: TAB_SIZES,
  getCurrentTab: () => currentTab,
  getMainWindow: () => mainWindow,
  isCollapsedHovering: () => windowsCollapsedHovering,
});
const {
  getTargetDisplay,
  getWindowDisplay,
  getCenteredBounds,
  getMenuBarHeight,
  getCollapsedHeight,
  getExpandedSize,
  getBoundsForMode,
  applyWindowGeometry,
} = windowGeometry;

function cancelCollapseWatchdog() {
  collapseGeneration++;
  if (collapseWatchdog) {
    clearTimeout(collapseWatchdog);
    collapseWatchdog = null;
  }
}

function applyMode(mode, display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  cancelCollapseWatchdog();
  if (mode !== 'collapsed') cancelDisplayRelocation();
  if (mode !== 'collapsed') windowsCollapsedHovering = false;
  applyWindowGeometry(mode, display);
  mainWindow.setIgnoreMouseEvents(false);
  currentMode = mode;
  if (mode === 'expanded') hideWhenCollapsed = false;
  if (mode === 'collapsed' && hideWhenCollapsed) {
    hideWhenCollapsed = false;
    mainWindow.hide();
    refreshTrayMenu();
  }
  syncHoverSpacePolling();
  syncDisplayFollowPolling();
}

// 纯重新定位不能改变收起事务，否则屏幕变化会取消 watchdog 并重新吞掉鼠标。
function cancelDisplayRelocation(restoreOpacity = true) {
  displayRelocationGeneration++;
  if (displayRelocationTimer) clearTimeout(displayRelocationTimer);
  displayRelocationTimer = null;
  if (restoreOpacity && mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(1);
}

function repositionWindow(display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentDisplay = getWindowDisplay();
  const policy = collapsedDisplayRelocationPolicy({
    visible: mainWindow.isVisible(),
    mode: currentMode,
    currentDisplayId: currentDisplay.id,
    targetDisplayId: display?.id,
  });
  if (!policy.conceal) {
    applyWindowGeometry(currentMode, display);
    return;
  }

  // Windows can commit cross-monitor position and canvas-size changes on separate
  // compositor frames. Keep the shaped strip invisible until both settle.
  const target = mainWindow;
  const generation = ++displayRelocationGeneration;
  if (displayRelocationTimer) clearTimeout(displayRelocationTimer);
  target.setOpacity(0);
  applyWindowGeometry('collapsed', display);
  displayRelocationTimer = setTimeout(() => {
    if (generation !== displayRelocationGeneration || mainWindow !== target || target.isDestroyed()) return;
    displayRelocationTimer = null;
    applyWindowGeometry('collapsed', display);
    target.setOpacity(1);
  }, policy.settleDelayMs);
}

function beginNativeCollapse() {
  if (!mainWindow || currentMode !== 'expanded') return;
  const targetWindow = mainWindow;
  const generation = ++collapseGeneration;
  targetWindow.setIgnoreMouseEvents(true);
  if (collapseWatchdog) clearTimeout(collapseWatchdog);
  collapseWatchdog = setTimeout(() => {
    if (generation !== collapseGeneration) return;
    collapseWatchdog = null;
    if (mainWindow === targetWindow && currentMode === 'expanded') {
      applyMode('collapsed');
    }
  }, COLLAPSE_WATCHDOG_MS);
}

function requestRendererCollapse() {
  if (!mainWindow || currentMode !== 'expanded') return;
  beginNativeCollapse();
  mainWindow.webContents.send('window:request-collapse');
}

function cancelPanelBlurCollapse() {
  panelBlurGeneration++;
  if (panelBlurTimer) clearTimeout(panelBlurTimer);
  panelBlurTimer = null;
}

function schedulePanelBlurCollapse() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const target = mainWindow;
  const generation = ++panelBlurGeneration;
  if (panelBlurTimer) clearTimeout(panelBlurTimer);
  const initial = panelBlurCollapsePolicy({ mode: currentMode });
  panelBlurTimer = setTimeout(() => {
    if (generation !== panelBlurGeneration || mainWindow !== target || target.isDestroyed()) return;
    panelBlurTimer = null;
    const policy = panelBlurCollapsePolicy({
      mode: currentMode,
      windowFocused: target.isFocused(),
      guarded: mediaPermissionRequests > 0 || transientSystemInteractionRequests > 0 || launcherManaging,
    });
    if (!policy.collapse) return;
    if (policy.closeLauncher) target.webContents.send('launcher:close');
    else requestRendererCollapse();
  }, initial.settleDelayMs);
}

function hideWindowAfterCollapse() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (currentMode === 'expanded') {
    hideWhenCollapsed = true;
    requestRendererCollapse();
    return;
  }
  hideWhenCollapsed = false;
  mainWindow.hide();
  refreshTrayMenu();
}

// ============ Codex / Claude / GPT 任务完成提醒 ============
// 使用独立的非激活窗口，避免打断主刘海窗口的展开、收起和焦点状态机。

const taskNotificationDomain = createTaskNotificationDomain({ taskNotificationIdentity });
const { normalize: normalizeTaskNotification } = taskNotificationDomain;

const taskNotificationWindowState = createTaskNotificationWindowState();

const taskNotificationTimers = createTaskNotificationTimers({
  visibleMs: TASK_NOTIFICATION_VISIBLE_MS,
  isActive: () => Boolean(taskNotificationWindowState.active()),
  isLeaving: () => taskNotificationWindowState.isLeaving(),
  onDismiss: () => beginTaskNotificationDismiss(),
});

const taskNotificationQueue = createTaskNotificationQueue({
  dedupeMs: TASK_NOTIFICATION_DEDUPE_MS,
  maxQueue: TASK_NOTIFICATION_MAX_QUEUE,
  isActive: () => Boolean(taskNotificationWindowState.active()),
  onHistory: (notification) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completion:new', notification);
    }
  },
  onQueueChange: (count) => sendTaskNotificationQueueCount(count),
  onIdle: () => showNextTaskNotification(),
});

function getPendingTaskNotificationCount() {
  return taskNotificationQueue.pendingCount();
}

function sendTaskNotificationQueueCount(count = getPendingTaskNotificationCount()) {
  if (
    !notificationWindow ||
    notificationWindow.isDestroyed() ||
    !taskNotificationWindowState.isReady() ||
    !taskNotificationWindowState.active()
  ) {
    return;
  }
  notificationWindow.webContents.send(
    'task-notification:queue',
    count
  );
}

function enqueueTaskNotification(notification) {
  return taskNotificationQueue.enqueue(notification);
}

const todoReminderService = createTodoReminderService({
  reminderState: todoReminderState,
  timerDelay: todoReminderTimerDelay,
  leadMs: TODO_REMINDER_LEAD_MS,
  enqueue: enqueueTaskNotification,
  getMainWindow: () => mainWindow,
});


const taskNotificationLayout = createTaskNotificationLayout({
  getTargetDisplay,
  getCenteredBounds,
  width: TASK_NOTIFICATION_WIDTH,
  height: TASK_NOTIFICATION_HEIGHT,
  screenMargin: TASK_NOTIFICATION_SCREEN_MARGIN,
});

const taskNotificationWindowFactory = createTaskNotificationWindowFactory({
  BrowserWindow,
  preloadPath: path.join(__dirname, 'preload.js'),
  htmlPath: path.join(__dirname, 'renderer', 'notification.html'),
  getBounds: () => taskNotificationLayout.getBounds(),
  installLocalWebContentsGuards,
  onReady: (targetWindow) => taskNotificationController?.onReady(targetWindow),
  onRenderProcessGone: (targetWindow) => {
    if (!targetWindow.isDestroyed()) targetWindow.destroy();
  },
  onClosed: (targetWindow) => taskNotificationController?.onClosed(targetWindow),
});

taskNotificationController = createTaskNotificationController({
  queue: taskNotificationQueue,
  state: taskNotificationWindowState,
  timers: taskNotificationTimers,
  windowFactory: taskNotificationWindowFactory,
  getBounds: () => taskNotificationLayout.getBounds(),
  visibleMs: TASK_NOTIFICATION_VISIBLE_MS,
  leaveMs: TASK_NOTIFICATION_LEAVE_MS,
  windowPolicy: taskNotificationWindowPolicy,
  isQuitting: () => isQuitting,
  onQueueCount: (count) => sendTaskNotificationQueueCount(count),
  onWindowChange: (window) => { notificationWindow = window; },
});

function createTaskNotificationWindow() { return taskNotificationController.ensureWindow(); }
function clearTaskNotificationTimers() { taskNotificationController.clearTimers(); }
function scheduleTaskNotificationDismiss() { taskNotificationTimers.schedule(); }
function setTaskNotificationPaused(paused) { taskNotificationTimers.setPaused(paused); }
function showNextTaskNotification() { taskNotificationController.showNext(); }
function beginTaskNotificationDismiss() { taskNotificationController.beginDismiss(); }
function finishTaskNotification(eventId) { taskNotificationController.finish(eventId); }

const taskNotificationServer = createTaskNotificationServer({
  http,
  host: TASK_NOTIFICATION_HOST,
  port: TASK_NOTIFICATION_PORT,
  sources: TASK_NOTIFICATION_SOURCES,
  bodyLimit: TASK_NOTIFICATION_BODY_LIMIT,
  normalize: normalizeTaskNotification,
  enqueue: enqueueTaskNotification,
  onAvailabilityChange: () => refreshTrayMenu(),
});
const startTaskNotificationServer = () => taskNotificationServer.start();
const stopTaskNotificationServer = () => taskNotificationServer.stop();


function createWindow() {
  const initial = process.platform === 'win32'
    ? platformPolicy.windowsPanelLayout(getTargetDisplay(), false).bounds
    : getCenteredBounds(COLLAPSED_WIDTH, getCollapsedHeight(getTargetDisplay()));

  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    // 必须显式给透明底色：只写 transparent 时 BrowserWindow 仍保留不透明的默认底色，
    // 展开瞬间 setBounds 放大后，新暴露的区域会先用它画一两帧，
    // 在菜单栏带上表现为一次黑块闪烁（通知窗口一直是这么写的）。
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 折叠窗口长期不聚焦时仍需保持首次展开帧率；后台视觉循环均由渲染层自行停机。
      backgroundThrottling: false,
    },
  });

  installLocalWebContentsGuards(mainWindow.webContents);
  mainWindow.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable || !mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    const owner = mainWindow;
    const menu = Menu.buildFromTemplate(editableContextMenuTemplate(params.editFlags));
    transientSystemInteractionRequests++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      transientSystemInteractionRequests = Math.max(0, transientSystemInteractionRequests - 1);
    };
    try { menu.popup({ window: owner, callback: release }); }
    catch (error) { release(); }
  });
  const rendererOwnerId = mainWindow.webContents.id;
  mainWindow.webContents.on('render-process-gone', () => aiModelService?.cancelOwner(rendererOwnerId));

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === 'win32') mainWindow.setMenu(null);

  // Escape 在到达页面前会被 Chromium 浏览器层吞掉（实测 document keydown 收不到），
  // 用 before-input-event 在分发前拦截并转发给渲染层处理（退出输入 / 收起面板）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow.webContents.send('key:escape');
    }
  });

  // Windows 的 Tab、原生下拉框和同应用弹层可能让 BrowserWindow 短暂 blur。
  // 等焦点状态稳定后再判断应用是否真的失去前台，避免面板内点击触发误收起。
  mainWindow.on('blur', schedulePanelBlurCollapse);
  mainWindow.on('focus', cancelPanelBlurCollapse);

  mainWindow.on('show', () => {
    syncHoverSpacePolling();
    syncDisplayFollowPolling();
  });
  mainWindow.on('hide', () => {
    cancelPanelBlurCollapse();
    cancelDisplayRelocation();
    syncHoverSpacePolling();
    syncDisplayFollowPolling();
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    applyMode('collapsed');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    cancelPanelBlurCollapse();
    cancelCollapseWatchdog();
    cancelDisplayRelocation(false);
    hideWhenCollapsed = false;
    mainWindow = null;
    stopDisplayFollowPolling();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideWindowAfterCollapse();
  });
}

function toggleVisibility() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    hideWindowAfterCollapse();
  } else {
    hideWhenCollapsed = false;
    repositionWindow(getTargetDisplay()); // 显示前先回到鼠标所在屏顶部
    mainWindow.show();
    refreshTrayMenu();
  }
}

function isAutoLaunchEnabled() {
  if (!PLATFORM_CAPABILITIES.autoLaunch) return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
}

function setAutoLaunch(enabled) {
  if (!PLATFORM_CAPABILITIES.autoLaunch) return false;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    return isAutoLaunchEnabled() === enabled;
  } catch (e) {
    return false;
  }
}

function getJsonSettingsPath(name) {
  return path.join(app.getPath('userData'), name);
}

const { readJsonFile, writeJsonFile } = createJsonFileStore({ fsModule: fs, pathModule: path });

const launcherSettingsStore = createLauncherSettingsStore({
  readJsonFile,
  writeJsonFile,
  getSettingsPath: getJsonSettingsPath,
  statFile: (file) => fs.statSync(file),
});
const launcherConfig = launcherSettingsStore.read;
const writeLauncherSettings = launcherSettingsStore.write;

const appSettingsService = createAppSettingsService({
  readJsonFile,
  writeJsonFile,
  getSettingsPath: getJsonSettingsPath,
  fileName: APP_SETTINGS_FILE,
  defaultFeatures: {
    home: true,
    todo: true,
    finance: true,
    notes: true,
    links: true,
    recordings: true,
    credentials: true,
    clip: false,
  },
  normalizeDefaultTabPreference,
  isValidPanelShortcut,
  isValidOptionalShortcut,
  launcherConfig,
  isAutoLaunchEnabled,
});
const readAppSettings = appSettingsService.read;
const publicAppSettings = appSettingsService.publicSettings;
const saveAppSettings = appSettingsService.save;

const financeSettingsStore = require('./main/finance-settings-store').createFinanceSettingsStore({
  readJsonFile,
  writeJsonFile,
  getSettingsPath: getJsonSettingsPath,
  fileName: FINANCE_SETTINGS_FILE,
});
const readFinanceSettings = financeSettingsStore.read;
const writeFinanceSettings = financeSettingsStore.write;

const financeConfigResolver = createFinanceConfigResolver({
  readSettings: readFinanceSettings,
  decryptStoredSecret,
});
const normalizeSecEdgarContact = financeConfigResolver.normalizeSecEdgarContact;
const resolveFinanceConfig = financeConfigResolver.resolve;

let financeService = null;
function getFinanceService() {
  if (!financeService) financeService = createFinanceService({ requestJson: requestFinanceJson, getConfig: resolveFinanceConfig });
  return financeService;
}

function publicFinanceSettings() {
  const stored = readFinanceSettings();
  const config = resolveFinanceConfig();
  const states = getFinanceService().providerStates();
  return {
    ok: true,
    schemaVersion: 2,
    refreshSeconds: stored.refreshSeconds,
    secureStorage: safeStorage.isEncryptionAvailable(),
    providers: states.map((provider) => ({
      ...provider,
      hasCredential: provider.id === 'coingecko' ? Boolean(config.coingecko.apiKey)
        : provider.id === 'alpha-vantage' ? Boolean(config.alphaVantage.apiKey)
          : provider.id === 'alpaca' ? Boolean(config.alpaca.keyId && config.alpaca.secretKey)
            : provider.id === 'twelve-data' ? Boolean(config.twelveData.apiKey)
              : provider.id === 'sec-edgar' ? Boolean(config.secEdgar.contact)
                : provider.id === 'cn-stock' ? Boolean(config.cnStock.apiKey) : false,
      verification: provider.id === 'coingecko' ? stored.providers.coingecko.verification
        : provider.id === 'binance' ? stored.providers.binance.verification
          : provider.id === 'alpha-vantage' ? stored.providers['alpha-vantage'].verification
            : provider.id === 'alpaca' ? stored.providers.alpaca.verification
              : provider.id === 'twelve-data' ? stored.providers['twelve-data'].verification
                : provider.id === 'sec-edgar' ? stored.providers['sec-edgar'].verification
                  : provider.id === 'cn-stock' ? stored.providers['cn-stock'].verification
                    : provider.id === 'cn-tencent' ? stored.providers['cn-tencent'].verification
                      : provider.id === 'cn-eastmoney' ? stored.providers['cn-eastmoney'].verification
                        : provider.id === 'cn-sina' ? stored.providers['cn-sina'].verification : null,
    })),
  };
}

const financeProviderSettings = createFinanceProviderSettings({
  readSettings: readFinanceSettings,
  writeSettings: writeFinanceSettings,
  normalizeSecEdgarContact,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  onSaved: () => {
    getFinanceService().clearCache({ includeQuotaProtected: true });
    financeBackgroundService.invalidate();
    return publicFinanceSettings();
  },
});
const updateFinanceProvider = (payload) => financeProviderSettings.update(payload);

const financeBackgroundService = createFinanceBackgroundRefresh({
  getFinanceService,
  getMainWindow: () => mainWindow,
  readAppSettings,
  readFinanceSettings,
  isQuitting: () => isQuitting,
  sendUpdate: (window, snapshot) => window.webContents.send('finance:update', snapshot),
});

function refreshFinanceBackground(options) {
  return financeBackgroundService.refresh(options);
}

function setFinanceBackgroundActivity(payload = {}) {
  return financeBackgroundService.setActivity(payload);
}

function updateFinanceRefreshInterval(value) {
  const refreshSeconds = [0, 30, 60, 120, 300].includes(Number(value)) ? Number(value) : null;
  if (refreshSeconds === null) return { ok: false, error: 'invalid_refresh_interval' };
  const current = readFinanceSettings();
  if (!writeJsonFile(getJsonSettingsPath(FINANCE_SETTINGS_FILE), { schemaVersion: 2, refreshSeconds, providers: current.providers })) {
    return { ok: false, error: 'save_failed' };
  }
  financeBackgroundService.updateInterval(refreshSeconds);
  return publicFinanceSettings();
}

function showOwnedOpenDialog(options) {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (owner) {
    if (!owner.isVisible()) owner.show();
    owner.focus();
  }
  return runOwnedOpenDialog(
    dialog.showOpenDialog.bind(dialog),
    owner,
    options,
    (delta) => {
      transientSystemInteractionRequests = Math.max(0, transientSystemInteractionRequests + delta);
    }
  );
}

const workspaceController = createWorkspaceController({
  fs,
  path,
  getUserDataPath: () => app.getPath('userData'),
  getSettingsPath: getJsonSettingsPath,
  readJsonFile,
  writeJsonFile,
  workspaceSettingsFile: WORKSPACE_SETTINGS_FILE,
  workspaceDataFile: WORKSPACE_DATA_FILE,
  recordingsDirName: RECORDINGS_DIR_NAME,
  clipImagesDirName: CLIP_IMAGES_DIR_NAME,
  noteImagesDirName: NOTE_IMAGES_DIR_NAME,
  portableMediaPath: (directory, filePath) => platformPolicy.portableMediaPath(directory, filePath),
  persistenceGate: workspacePersistenceGate,
  copyCaptures,
  isCaptureBusy: () => Boolean(captureService?.busy()),
  showMessageBox: (options) => dialog.showMessageBox(options),
  showOwnedOpenDialog,
  openPath: (target) => shell.openPath(target),
  onContextChanged: () => {
    aiContextGeneration += 1;
    aiModelService?.cancelAll();
  },
  onWorkspaceChanged: (selected) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed', { path: selected });
    captureService?.refresh();
    refreshTrayMenu();
  },
});
const workspaceRoot = () => workspaceController.root();
const workspacePath = (name) => workspaceController.path(name);
const chooseWorkspaceFolder = () => workspaceController.choose();

function applyFeatureServices(features) {
  const policy = clipboardServicePolicy(features);
  if (policy.recordHistory) startClipboardPolling();
  else stopClipboardPolling();
}

function isValidPanelShortcut(shortcut) {
  return isValidShortcutAccelerator(shortcut, { allowSpace: true });
}

function isValidOptionalShortcut(shortcut) {
  return isValidShortcutAccelerator(shortcut, { allowEmpty: true });
}

const shortcutService = createShortcutService({
  globalShortcut,
  isValidPanelShortcut,
  isValidOptionalShortcut,
  shortcutAssignmentConflict,
  hoverSpacePollingPolicy,
  getPanelState: () => ({
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    mode: currentMode,
  }),
  getCursorPoint: () => screen.getCursorScreenPoint(),
  getCollapsedBounds: () => getBoundsForMode('collapsed'),
  onPanelShortcut: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    hideWhenCollapsed = false;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('shortcut:toggle-panel');
  },
  onHoverSpaceShortcut: async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // A second Space can arrive before expanded mode disables the temporary registration.
    if (currentMode === 'expanded') {
      mainWindow.webContents.send('shortcut:toggle-panel');
      return;
    }
    await pasteTargetService.remember();
    hideWhenCollapsed = false;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('shortcut:toggle-panel');
  },
  onLauncherShortcut: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    launcherFocus.capture({ keepWhenOwned: currentMode === 'launcher' });
    hideWhenCollapsed = false;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('shortcut:toggle-launcher');
  },
  onActionShortcut: (action) => {
    if (['screenshot', 'screenRecording'].includes(action)) {
      if (!captureService || captureService.busy()) return;
      const request = action === 'screenRecording' ? { mode: 'video', region: true } : 'screenshot';
      void captureService.open(request).catch(() => {});
      return;
    }
    if (action === 'audioRecording') openRendererPanel('shortcut:audio-recording');
  },
});
const setPanelShortcut = (shortcut) => shortcutService.setPanelShortcut(shortcut);
const setLauncherShortcut = (shortcut = launcherConfig().shortcut) => shortcutService.setLauncherShortcut(shortcut);
const setActionShortcut = (action, shortcut) => shortcutService.setActionShortcut(action, shortcut);
const syncHoverSpacePolling = () => shortcutService.syncHoverSpacePolling();
const stopHoverSpaceShortcut = () => shortcutService.stopHoverSpacePolling();

function getLauncherService() {
  if (!launcherService) launcherService = createLauncherService({ dataRoot: app.getPath('userData'), executable: process.execPath, getSettings: launcherConfig, readShortcut: (file) => shell.readShortcutLink(file) });
  return launcherService;
}
function applyAppSettings() {
  const settings = readAppSettings();
  applyFeatureServices(settings.features);
  let changed = false;
  if (!setPanelShortcut(settings.shortcut)) {
    settings.shortcut = 'Space';
    changed = true;
    setPanelShortcut('Space');
  }
  setLauncherShortcut();
  for (const action of shortcutService.actionNames()) {
    if (setActionShortcut(action, settings.shortcuts[action])) continue;
    settings.shortcuts[action] = '';
    changed = true;
    setActionShortcut(action, '');
  }
  if (changed) saveAppSettings(settings);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
}

function openRendererPanel(channel) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hideWhenCollapsed = false;
  repositionWindow(getTargetDisplay());
  mainWindow.show();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
  };
  if (mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function refreshTrayMenu() {
  if (!tray) return;
  const autoLaunch = isAutoLaunchEnabled();
  const settings = readAppSettings();
  const featureLabels = { todo: '待办', finance: '行情', notes: '笔记', links: '链接', recordings: '录制', credentials: '密钥', clip: '剪贴板' };
  const menu = Menu.buildFromTemplate([
    ...(captureService && captureService.state().phase !== 'idle' ? [
      { label: captureService.state().phase === 'recording' ? '● 正在录屏' : '屏幕采集中', enabled: false },
      { label: captureService.state().mode === 'video' ? '停止并保存' : '取消采集', click: () => { void captureService.stop(); } },
      ...(captureService.state().mode === 'video' ? [{ label: '取消并丢弃录屏', click: () => { void captureService.discard(); } }] : []),
      { type: 'separator' },
    ] : []),
    {
      label: 'API 配置…',
      click: () => openRendererPanel('app:open-api-settings'),
    },
    {
      label: '显示功能',
      submenu: Object.entries(featureLabels).map(([id, label]) => ({
        label,
        type: 'checkbox',
        checked: settings.features[id] !== false,
        click: (item) => {
          const next = readAppSettings();
          next.features[id] = item.checked;
          saveAppSettings(next);
          applyAppSettings();
          refreshTrayMenu();
        },
      })),
    },
    {
      label: `设置快捷键…  当前：${settings.shortcut}`,
      click: () => openRendererPanel('app:record-shortcut'),
    },
    {
      label: '数据文件夹',
      submenu: [
        { label: '打开文件夹', click: () => shell.openPath(workspaceRoot()) },
        { label: '更换文件夹…', click: chooseWorkspaceFolder },
      ],
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        setAutoLaunch(item.checked);
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '关于',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: '关于 Dynamic Panel',
          message: 'Dynamic Panel',
          detail:
            `版本 ${app.getVersion()}\n\n一个开源、常驻屏幕顶部的本地工作台。工作区数据默认保存在本机；账号密码与 API Key 由系统安全存储加密。\n\nMIT License`,
          buttons: ['查看 GitHub', '好'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }).then(({ response }) => {
          if (response === 0) shell.openExternal('https://github.com/xiaopu-ai/TO-DO-Panel');
        });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      accelerator: 'CommandOrControl+Q',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(createNotchTrayIcon({
    platform: process.platform,
    nativeImage,
    path,
    resourcesRoot: __dirname,
  }));
  tray.setToolTip('Dynamic Panel');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) {
      hideWhenCollapsed = false;
      repositionWindow(getTargetDisplay());
      mainWindow.show();
      refreshTrayMenu();
    }
  });
  refreshTrayMenu();
}


const settingsController = createSettingsController({
  readAppSettings,
  saveAppSettings,
  publicAppSettings,
  applyAppSettings,
  refreshTrayMenu,
  updateFeaturePreference,
  updateDefaultTabPreference,
  isMainWindowSender,
  setAutoLaunch,
  isAutoLaunchEnabled,
  isValidPanelShortcut,
  isValidOptionalShortcut,
  launcherConfig,
  writeLauncherSettings,
  setLauncherShortcut,
  setPanelShortcut,
  setActionShortcut,
  sendSettingsChanged: (settings) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
  },
});
registerSettingsIpc({ ipcMain, settingsController });
registerWorkspaceIpc({ ipcMain, workspaceController });

function isMainWindowSender(sender) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents);
}

registerWindowIpc({
  ipcMain,
  isMainWindowSender,
  setMode: async (mode) => {
    if (mode === 'expanded') await pasteTargetService.remember();
    const normalized = mode === 'launcher' ? 'launcher' : mode === 'expanded' ? 'expanded' : 'collapsed';
    applyMode(normalized, normalized === 'launcher' ? getTargetDisplay() : undefined);
  },
  beginCollapse: beginNativeCollapse,
  setCollapsedHover: (hovering) => {
    if (process.platform !== 'win32' || currentMode !== 'collapsed' || hovering === windowsCollapsedHovering) return;
    windowsCollapsedHovering = hovering;
    applyWindowGeometry('collapsed');
  },
  getMetrics: windowGeometry.getLayoutMetrics,
  keepOpen: () => {
    cancelPanelBlurCollapse();
    if (currentMode === 'expanded' && !mainWindow.isFocused()) mainWindow.focus();
  },
  setTab: (tab) => {
    cancelPanelBlurCollapse();
    currentTab = Object.prototype.hasOwnProperty.call(TAB_SIZES, tab) ? tab : 'home';
  },
  getHoverSpaceStatus: () => ({
    registered: shortcutService.state().hoverRegistered,
    mode: currentMode,
    cursor: screen.getCursorScreenPoint(),
    bounds: getBoundsForMode(currentMode),
  }),
});

async function requestMacMediaAccess(mediaType) {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus(mediaType) === 'granted') return true;
  return mediaPermissionCoordinator.run({
    owner: mainWindow,
    // screen-saver 层级会压住 macOS 的 TCC 授权气泡。请求前临时降到普通层，
    // 并把应用激活，让“不允许 / 允许”确实处在可点击的最前方。
    activate: () => app.focus({ steal: true }),
    track: (delta) => {
      mediaPermissionRequests = Math.max(0, mediaPermissionRequests + delta);
    },
    request: () => systemPreferences.askForMediaAccess(mediaType),
  });
}

const networkSecurity = createNetworkSecurity({
  dns,
  https,
  readable: Readable,
  isPrivateAddress,
});
const {
  validatePublicHttpUrl,
  resolvePinnedAIEndpoint,
  fetchPinnedAIEndpoint,
} = networkSecurity;

const financeHttpClient = createFinanceHttpClient({
  allowedOrigins: FINANCE_ALLOWED_ORIGINS,
  resolvePinnedEndpoint: resolvePinnedAIEndpoint,
  fetchPinnedEndpoint: fetchPinnedAIEndpoint,
  timeoutMs: FINANCE_FETCH_TIMEOUT_MS,
  maxResponseBytes: FINANCE_FETCH_MAX_BYTES,
  maxRequestBytes: FINANCE_FETCH_MAX_REQUEST_BYTES,
});
const requestFinanceJson = financeHttpClient.requestJson;

const PRIVACY_SETTINGS_PANES = privacySettingsPanesFor(process.platform);
registerSystemIpc({
  ipcMain,
  requestMicrophoneAccess: () => requestMacMediaAccess('microphone'),
  validatePublicHttpUrl,
  openExternal: (target) => shell.openExternal(target),
  openPath: (target) => shell.openPath(target),
  isAbsolutePath: (target) => path.isAbsolute(target),
  privacySettingsPanes: PRIVACY_SETTINGS_PANES,
});

registerLauncherIpc({
  ipcMain,
  getMainWindow: () => mainWindow,
  getLauncherService,
  launcherFocus,
  launcherConfig,
  getShortcutState: () => shortcutService.state(),
  setLauncherShortcut,
  writeLauncherSettings,
  app,
  path,
  fs,
  dialog,
  shell,
  validatePublicHttpUrl,
  launcherApplications,
  resolveLaunchPath,
  clipboard,
  getLauncherManaging: () => launcherManaging,
  setLauncherManaging: (value) => { launcherManaging = value; },
  adjustTransientSystemInteractionRequests: (delta) => { transientSystemInteractionRequests += delta; },
});

// ============ 启动时的权限自检 ============
// 权限查询、无缩略图录屏探测和 macOS 隐私设置跳转由独立 service 管理。
const permissionService = createPermissionService({
  platform: process.platform,
  systemPreferences,
  desktopCapturer,
  screenRecordingProbePolicy,
  app,
  path,
  fs,
  dialog,
  shell,
  privacySettingsPanes: PRIVACY_SETTINGS_PANES,
});
const { hasScreenRecordingAccess, promptForMissingPermissions } = permissionService;

const readResponseText = createBoundedResponseTextReader({ maxBytes: LINK_FETCH_MAX_BYTES, BufferImpl: Buffer });

const linkInspector = createLinkInspector({
  validatePublicHttpUrl,
  extractFaviconHref,
  extractPageTitle,
  extractPageDescription,
  readResponseText,
  getTranscriptionSettings: () => readStoredTranscriptionSettings(),
  getLlmConfig: () => resolveLlmConfig(),
  getAIService: () => aiModelService,
  crypto,
  timeoutMs: LINK_FETCH_TIMEOUT_MS,
  maxRedirects: LINK_FETCH_MAX_REDIRECTS,
});
const { inspectLink } = linkInspector;
registerLinksIpc({
  ipcMain,
  inspectLink,
  getAIModelService: () => aiModelService,
  crypto,
});

registerFinanceIpc({
  ipcMain,
  getFinanceService,
  publicFinanceSettings,
  updateFinanceProvider,
  updateFinanceRefreshInterval,
  setFinanceBackgroundActivity,
  readFinanceSettings,
  writeFinanceSettings,
  isMainWindowSender: (sender) => Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents),
});

const systemAppIconService = createSystemAppIconService({ fs, path, execFile, platform: process.platform });
const currentWindowService = require('./main/current-window-service').createCurrentWindowService({
  execFile,
  platform: process.platform,
  processId: process.pid,
  normalizeWindowRows,
  withTimeout: systemAppIconService.withTimeout,
  readWindowAppIcon: systemAppIconService.readWindowAppIcon,
});

registerWindowsIpc({
  ipcMain,
  listWindows: currentWindowService.list,
  focusWindow: currentWindowService.focus,
});

async function activateActiveTaskNotification(eventId = null) {
  const notification = taskNotificationWindowState.active();  if (!notification || (eventId && notification.eventId !== eventId) || notification.source === 'todo') return false;
  const result = await scanCurrentWindows();
  const target = (result.items || [])
    .map((item) => ({ item, score: taskWindowMatchScore(notification, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
  if (!target) return false;
  try {
    const focused = await currentWindowService.focusTarget(target);
    if (focused) beginTaskNotificationDismiss();
    return focused;
  } catch (error) {
    return false;
  }
}


registerTaskNotificationIpc({
  ipcMain,
  scheduleReminders: (items) => {
    const normalized = Array.isArray(items)
      ? items
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: String(item.id || '').slice(0, 160),
          text: String(item.text || '').trim().slice(0, 160),
          deadline: String(item.deadline || ''),
          done: item.done === true,
          remindedAt: Math.max(0, Number(item.remindedAt) || 0),
        }))
        .filter((item) => item.id && item.text)
      : [];
    return { ok: true, count: todoReminderService.setReminders(normalized) };
  },
  notifyPomodoro: (minutes) => {
    const safeMinutes = Math.max(1, Math.min(120, Math.round(Number(minutes) || 25)));
    const completedAt = Date.now();
    const notification = {
      eventId: `pomodoro-${completedAt}`,
      taskId: `pomodoro-${completedAt}`,
      source: 'pomodoro',
      project: '番茄钟',
      title: '专注完成',
      body: `${safeMinutes} 分钟专注计时已结束`,
      completedAt,
    };
    return { ok: true, result: enqueueTaskNotification(notification) };
  },
  getHistory: () => taskNotificationQueue.history(),
  onHover: (sender, paused) => taskNotificationController.handleHover(sender, paused),
  onDismissed: (sender, eventId) => taskNotificationController.handleDismissed(sender, eventId),
  activate: async (sender, eventId) => {
    if (!notificationWindow || notificationWindow.isDestroyed() || sender !== notificationWindow.webContents) return false;
    return activateActiveTaskNotification(eventId);
  },
});

const credentialsVault = createCredentialsVault({
  fs,
  safeStorage,
  normalizeCredentialInput,
  vaultPath: path.join(app.getPath('userData'), CREDENTIALS_VAULT_FILE),
  randomId: () => crypto.randomUUID(),
  processId: process.pid,
});
registerCredentialsIpc({ ipcMain, credentialsVault, clipboard });

const homeWeather = require('./home-services').createWeatherService();
const homeMusic = require('./home-media').createMusicLibrary({ filePath: getJsonSettingsPath('music-library.json') });
registerHomeIpc({ ipcMain, weatherService: homeWeather, musicLibrary: homeMusic, showOwnedOpenDialog });

// ============ 百炼实时语音转写 ============
const transcriptionSettingsStore = createTranscriptionSettingsStore({
  fs,
  path,
  getUserDataPath: () => app.getPath('userData'),
  getLegacyAppDataPath: () => app.getPath('appData'),
  fileName: TRANSCRIPTION_SETTINGS_FILE,
  selectSettings: selectTranscriptionSettings,
});
const readStoredTranscriptionSettings = transcriptionSettingsStore.read;
const writeTranscriptionSettings = transcriptionSettingsStore.write;

const aiProviderConfig = createAIProviderConfig({
  fs,
  path,
  crypto,
  safeStorage,
  WebSocket,
  env: process.env,
  readSettings: readStoredTranscriptionSettings,
  writeSettings: writeTranscriptionSettings,
  getUserDataPath: () => app.getPath('userData'),
  fileName: AI_DIAGNOSTICS_FILE,
  transcriptionModel: TRANSCRIPTION_MODEL,
  providers: PROVIDERS,
  providerFor,
  normalizeContentProfile,
  normalizeContentProfiles,
  normalizeContentService,
  normalizeTranscriptionService,
  normalizeModelList,
  contentConfigRevision,
  publicContentProviders,
  decryptStoredSecret,
});
const {
  appendDiagnostic: appendAIDiagnostic,
  readDiagnostics: readAIDiagnostics,
  storedContentCredential,
  resolveLlmConfig,
  resolveTranscriptionConfig,
  transcriptionConfigRevision,
  providerVerificationRevision,
  publicConfig: publicTranscriptionConfig,
  transcriptionUrl,
  eventId: transcriptionEventId,
  persistProviderVerification,
  testTranscriptionProvider,
  clearDiagnostics,
  acknowledgeMigration,
} = aiProviderConfig;

const transcriptionService = createTranscriptionService({
  WebSocket,
  getConfig: resolveTranscriptionConfig,
  sampleRate: TRANSCRIPTION_SAMPLE_RATE,
  finishTimeoutMs: TRANSCRIPTION_FINISH_TIMEOUT_MS,
  senderFor: () => null,
  eventId: transcriptionEventId,
  urlFor: transcriptionUrl,
});

const closeTranscriptionSession = (session, result) => transcriptionService.closeFor(session?.senderId, result);

aiModelService = createAIService({
  fetchImpl: fetchPinnedAIEndpoint,
  getConfig: resolveLlmConfig,
  getBinding: () => String(aiContextGeneration),
  validateEndpoint: resolvePinnedAIEndpoint,
  onDiagnostic: appendAIDiagnostic,
  onEvent: (ownerId, event) => {
    const target = webContents.fromId(Number(ownerId));
    if (target && !target.isDestroyed()) target.send('ai:event', event);
  },
});

registerAiIpc({
  ipcMain,
  crypto,
  getAIService: () => aiModelService,
  getProviderVerificationRevision: providerVerificationRevision,
  resolveTranscriptionConfig,
  resolveLlmConfig,
  testTranscriptionProvider,
  persistProviderVerification,
  readDiagnostics: readAIDiagnostics,
  clearDiagnostics,
  acknowledgeMigration,
  publicTranscriptionConfig,
});

registerTranscriptionIpc({
  ipcMain,
  providers: PROVIDERS,
  providerFor,
  normalizeContentProfile,
  normalizeContentProfiles,
  normalizeModelList,
  normalizeModelName,
  contentConfigRevision,
  transcriptionModel: TRANSCRIPTION_MODEL,
  safeStorage,
  env: process.env,
  readSettings: readStoredTranscriptionSettings,
  writeSettings: writeTranscriptionSettings,
  resolveLlmConfig,
  resolveTranscriptionConfig,
  transcriptionConfigRevision,
  storedContentCredential,
  decryptStoredSecret,
  publicConfig: publicTranscriptionConfig,
  transcriptionService,
  onConfigChanged: ({ transcriptionChanged }) => {
    aiContextGeneration += 1;
    aiModelService?.cancelAll();
    if (transcriptionChanged) transcriptionService.closeAll();
  },
});

function closeAllTranscriptionSessions() {
  transcriptionService.closeAll();
}

// ============ 工作区文件服务 ============
const workspaceFiles = createWorkspaceFiles({
  fs,
  path,
  crypto,
  nativeImage,
  workspaceRoot,
  workspacePath,
  platformPolicy,
  validNoteId,
  parseNoteImageReference,
  recordingExtension,
  recordingsDirName: RECORDINGS_DIR_NAME,
  noteImagesDirName: NOTE_IMAGES_DIR_NAME,
  clipImagesDirName: CLIP_IMAGES_DIR_NAME,
  recordingMaxBytes: RECORDING_MAX_BYTES,
  noteImageMaxBytes: NOTE_IMAGE_MAX_BYTES,
  noteImageMaxEdge: NOTE_IMAGE_MAX_EDGE,
});
const {
  getRecordingsDir,
  ensureRecordingsDir,
  getSafeRecordingPath,
  saveRecording,
  readRecording,
  deleteRecording,
  getNoteImagesDir,
  getNoteImageDirectory,
  portableNoteImagePath,
  getSafeNoteImagePath,
  persistNoteImage,
  deleteNoteImages,
  getClipImagesDir,
  getSafeClipImagePath,
  ensureClipImagesDir,
} = workspaceFiles;

const clipboardService = createClipboardService({
  clipboard,
  nativeImage,
  ClipboardItem,
  fs,
  path,
  workspaceFiles,
  readClipboardObservation,
  prepareClipboardImagePayload,
  reduceClipboardObservation,
  createClipboardImageFingerprint,
  getMainWindow: () => mainWindow,
  portableImagePath: (directory, filePath) => platformPolicy.portableMediaPath(directory, filePath),
  pollIntervalMs: CLIP_POLL_INTERVAL_MS,
  imagePollIntervalMs: CLIP_IMAGE_POLL_INTERVAL_MS,
  imageDirectoryName: CLIP_IMAGES_DIR_NAME,
});
const startClipboardPolling = () => clipboardService.start();
const stopClipboardPolling = () => clipboardService.stop();
const writeClipboardEntry = (entry) => clipboardService.writeEntry(entry);

registerRecordingsIpc({
  ipcMain,
  saveRecording,
  readRecording,
  deleteRecording,
  getSafeRecordingPath,
  revealItem: (safePath) => shell.showItemInFolder(safePath),
});

// ============ 笔记图片 ============

registerNotesIpc({
  ipcMain,
  fs,
  path,
  validNoteId,
  persistNoteImage,
  showOwnedOpenDialog,
  getSafeNoteImagePath,
  getNoteImagesDir,
  getNoteImageDirectory,
  noteImageMaxBytes: NOTE_IMAGE_MAX_BYTES,
});

// ============ 剪贴板历史 ============

function followCursorDisplay() {
  if (!mainWindow || mainWindow.isDestroyed() || currentMode !== 'collapsed') return;
  const targetDisplay = getTargetDisplay();
  const windowDisplay = getWindowDisplay();
  if (targetDisplay.id !== windowDisplay.id) repositionWindow(targetDisplay);
}

function stopDisplayFollowPolling() {
  if (displayFollowTimer) clearInterval(displayFollowTimer);
  displayFollowTimer = null;
}

function syncDisplayFollowPolling() {
  const policy = collapsedDisplayFollowPolicy({
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    mode: currentMode,
    displayCount: screen.getAllDisplays().length,
  });
  if (!policy.enabled) {
    stopDisplayFollowPolling();
    return;
  }
  followCursorDisplay();
  if (!displayFollowTimer) displayFollowTimer = setInterval(followCursorDisplay, policy.intervalMs);
}

function waitForCollapsedPanel(timeoutMs = 950) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (currentMode !== 'expanded' || Date.now() >= deadline) return resolve(currentMode !== 'expanded');
      setTimeout(check, 32);
    };
    check();
  });
}

registerClipboardIpc({
  ipcMain,
  fs,
  getSafeClipImagePath,
  writeClipboardEntry,
  automaticPaste: PLATFORM_CAPABILITIES.automaticPaste,
  isAccessibilityTrusted: () => process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(true),
  getPreviousPasteTarget: () => pasteTargetService.getPreviousTarget(),
  requestRendererCollapse,
  waitForCollapsedPanel,
  pasteToPreviousApp: pasteTargetService.pasteToPreviousApp,
});

function ensureFirstRunAutoLaunch() {
  // 首次运行时默认开启开机自启；之后尊重用户在托盘菜单的选择
  if (process.platform !== 'darwin') return;
  const marker = path.join(app.getPath('userData'), '.first-run-done');
  if (fs.existsSync(marker)) return;
  try {
    setAutoLaunch(true);
    fs.writeFileSync(marker, String(Date.now()));
  } catch (e) {
    // ignore
  }
}

function watchDisplayChanges() {
  // 接/拔外接屏、改变屏幕排列、改分辨率 → 自动重新定位到当前活跃屏顶部居中
  // 加 100ms 防抖：插拔屏时系统会连续触发多次事件
  let timer = null;
  const reposition = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!mainWindow) return;
      repositionWindow();
      syncDisplayFollowPolling();
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:metrics-changed', getLayoutMetrics());
      }
      if (notificationWindow && !notificationWindow.isDestroyed() && notificationWindow.isVisible()) {
        notificationWindow.setBounds(taskNotificationLayout.getBounds());
      }
    }, 100);
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.dynamicpanel.app');
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  ensureFirstRunAutoLaunch();
  captureService = createCaptureService({
    getMainWindow: () => mainWindow,
    getRoot: workspaceRoot,
    getSettings: () => readJsonFile(getJsonSettingsPath('capture-settings.json'), {}),
    saveSettings: (settings) => {
      if (!writeJsonFile(getJsonSettingsPath('capture-settings.json'), settings)) throw new Error('write_failed');
    },
    ensureMicrophone: () => requestMacMediaAccess('microphone'),
    onChange: refreshTrayMenu,
    suspendPanel: () => {
      const mode = currentMode, display = getWindowDisplay();
      const visible = mainWindow?.isVisible();
      let exposedDuringRecording = false;
      let interactionGuardReleased = false;
      let restored = false;
      transientSystemInteractionRequests++;
      // A screen-saver level panel otherwise obscures the source picker and TCC dialogs.
      mainWindow?.hide();
      const releaseInteractionGuard = () => {
        if (interactionGuardReleased) return;
        interactionGuardReleased = true;
        transientSystemInteractionRequests = Math.max(0, transientSystemInteractionRequests - 1);
      };
      const restore = () => {
        if (restored) return;
        restored = true;
        releaseInteractionGuard();
        if (!mainWindow || mainWindow.isDestroyed() || captureQuitPending) return;
        mainWindow.setContentProtection(false);
        if (visible) {
          // Preserve the mode and display selected while the recording was live.
          applyMode(currentMode, getWindowDisplay());
          mainWindow.show();
        } else {
          applyMode(mode, display);
          mainWindow.hide();
        }
        refreshTrayMenu();
      };
      restore.showDuringRecording = async () => {
        if (exposedDuringRecording || restored || !mainWindow || mainWindow.isDestroyed() || captureQuitPending) return;
        exposedDuringRecording = true;
        releaseInteractionGuard();
        hideWhenCollapsed = false;
        mainWindow.setContentProtection(true);
        // The renderer may still believe the panel is expanded because the
        // capture worker is a separate window. Reuse the normal collapse path
        // before exposing the panel, otherwise the full workbench flashes until
        // the user clicks it once.
        if (currentMode === 'expanded') {
          requestRendererCollapse();
          await waitForCollapsedPanel();
        }
        if (!mainWindow || mainWindow.isDestroyed() || captureQuitPending) return;
        if (currentMode !== 'collapsed') applyMode('collapsed', getWindowDisplay());
        mainWindow.showInactive();
        syncHoverSpacePolling();
        syncDisplayFollowPolling();
        refreshTrayMenu();
      };
      return restore;
    },
  });
  createWindow();
  createTray();
  watchDisplayChanges();
  ensureClipImagesDir();
  ensureRecordingsDir();
  applyAppSettings();
  if(launcherConfig().sources.apps) setImmediate(()=>getLauncherService().warmApplications().catch(()=>{}));
  startTaskNotificationServer();
  void promptForMissingPermissions();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 常驻菜单栏应用：所有窗口暂时关闭时仍保持后台运行。
app.on('window-all-closed', () => {});

app.on('before-quit', (event) => {
  if (!captureQuitReady && captureService?.state().phase !== 'idle' && captureService) {
    event.preventDefault();
    if (!captureQuitPending) {
      captureQuitPending = true;
      captureService.stop().finally(() => { captureQuitReady = true; app.quit(); });
    }
    return;
  }
  launcherService?.cancel().catch(() => {});
  financeBackgroundService.dispose();
  isQuitting = true;
  hideWhenCollapsed = false;
});

app.on('will-quit', () => {
  cancelCollapseWatchdog();
  todoReminderService.clear();
  stopHoverSpaceShortcut();
  stopDisplayFollowPolling();
  clearTaskNotificationTimers();
  stopTaskNotificationServer();
  closeAllTranscriptionSessions();
  globalShortcut.unregisterAll();
  stopClipboardPolling();
});
