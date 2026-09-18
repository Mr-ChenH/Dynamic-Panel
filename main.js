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
const zlib = require('zlib');
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
const { createTranscriptionService } = require('./main/transcription-service');
const { createFinanceBackgroundRefresh } = require('./main/finance-background-refresh');
const { registerFinanceIpc } = require('./main/ipc/finance');
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

// ============ 托盘图标 PNG 生成 ============
// 直接在主进程编码 PNG，避免引入额外资源文件
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 4);
    scanlines[off] = 0;
    pixels.copy(scanlines, off + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(scanlines);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 生成刘海形状：扁平顶 + 圆角底，居中偏上
function makeNotchPng(scale) {
  const size = 16 * scale;
  const pixels = Buffer.alloc(size * size * 4);

  // 形状参数（pt 单位 × scale）
  const W = 10 * scale; // 刘海宽
  const H = 5 * scale; // 刘海高
  const R = 2 * scale; // 下方圆角半径
  const x0 = (size - W) / 2;
  const y0 = 3.5 * scale; // 距顶 padding

  function isInside(px, py) {
    if (px < x0 || px > x0 + W || py < y0 || py > y0 + H) return false;
    const bottomR = y0 + H - R;
    if (py < bottomR) return true;
    const leftR = x0 + R;
    const rightR = x0 + W - R;
    if (px >= leftR && px <= rightR) return true;
    if (px < leftR) {
      const dx = leftR - px;
      const dy = py - bottomR;
      return dx * dx + dy * dy <= R * R;
    }
    const dx = px - rightR;
    const dy = py - bottomR;
    return dx * dx + dy * dy <= R * R;
  }

  // 4×4 超采样抗锯齿
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let count = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (isInside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) count++;
        }
      }
      const alpha = Math.round((count / 16) * 255);
      const idx = (y * size + x) * 4;
      pixels[idx + 3] = alpha;
    }
  }

  return encodePng(size, size, pixels);
}

function createNotchTrayIcon() {
  if (process.platform === 'win32') return nativeImage.createFromPath(path.join(__dirname, 'build', 'to-do-panel-icon.png')).resize({ width: 32, height: 32 });
  const png2x = makeNotchPng(2);
  const icon = nativeImage.createFromBuffer(png2x, { scaleFactor: 2 });
  icon.setTemplateImage(true);
  return icon;
}

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
let todoReminderTimer = null;
let scheduledTodoReminders = [];

let spaceShortcutTimer = null;
let spaceShortcutRegistered = false;
let windowsCollapsedHovering = false;
let displayFollowTimer = null;
let displayRelocationTimer = null;
let displayRelocationGeneration = 0;
let panelBlurTimer = null;
let panelBlurGeneration = 0;
let configuredShortcut = '';
let configuredLauncherShortcut = '';
let configuredActionShortcuts = { screenshot: '', screenRecording: '', audioRecording: '' };
let launcherService;
let launcherManaging = false;
let previousPasteTarget = null;
let windowScanCache = new Map();
const windowIconCache = new Map();
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

function clearTodoReminderTimer() {
  if (todoReminderTimer) clearTimeout(todoReminderTimer);
  todoReminderTimer = null;
}

function fireTodoReminder(todo) {
  const deadline = Date.parse(String(todo.deadline || ''));
  const notification = {
    eventId: `todo-${todo.id}-${deadline}`,
    source: 'todo',
    taskId: String(todo.id || ''),
    title: String(todo.text || '').trim() || '待办即将截止',
    project: '',
    detail: '将在 1 小时内截止',
    deadline,
    completedAt: Date.now(),
  };
  enqueueTaskNotification(notification);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('todo:reminded', {
      id: notification.taskId,
      deadline: String(todo.deadline || ''),
      remindedAt: notification.completedAt,
    });
  }
}

function scheduleNextTodoReminder() {
  clearTodoReminderTimer();
  const now = Date.now();
  let nextDelay = Infinity;
  for (const todo of scheduledTodoReminders) {
    const status = todoReminderState(todo, now, TODO_REMINDER_LEAD_MS);
    if (status.state === 'due') {
      todo.remindedAt = now;
      fireTodoReminder(todo);
      continue;
    }
    if (status.state === 'scheduled') nextDelay = Math.min(nextDelay, status.delayMs);
  }
  if (Number.isFinite(nextDelay)) {
    todoReminderTimer = setTimeout(scheduleNextTodoReminder, todoReminderTimerDelay(nextDelay));
  }
}

ipcMain.handle('todos:schedule-reminders', (event, items) => {
  scheduledTodoReminders = Array.isArray(items)
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
  scheduleNextTodoReminder();
  return { ok: true, count: scheduledTodoReminders.length };
});

ipcMain.handle('pomodoro:notify', (event, minutes) => {
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
});

function getTaskNotificationBounds(display) {
  const d = display || getTargetDisplay();
  const width = Math.min(
    TASK_NOTIFICATION_WIDTH,
    Math.max(280, d.bounds.width - TASK_NOTIFICATION_SCREEN_MARGIN * 2)
  );
  return getCenteredBounds(width, TASK_NOTIFICATION_HEIGHT, d);
}

const taskNotificationWindowFactory = createTaskNotificationWindowFactory({
  BrowserWindow,
  preloadPath: path.join(__dirname, 'preload.js'),
  htmlPath: path.join(__dirname, 'renderer', 'notification.html'),
  getBounds: () => getTaskNotificationBounds(getTargetDisplay()),
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
  getBounds: () => getTaskNotificationBounds(getTargetDisplay()),
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

ipcMain.on('task-notification:hover', (event, paused) => {
  taskNotificationController.handleHover(event.sender, paused);
});

ipcMain.on('task-notification:dismissed', (event, eventId) => {
  taskNotificationController.handleDismissed(event.sender, eventId);
});

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

const DEFAULT_FEATURES = {
  home: true,
  todo: true,
  finance: true,
  notes: true,
  links: true,
  recordings: true,
  credentials: true,
  clip: false,
};

function getJsonSettingsPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJsonFile(filePath, fallback = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
    return false;
  }
}

function readAppSettings() {
  const stored = readJsonFile(getJsonSettingsPath(APP_SETTINGS_FILE));
  const features = { ...DEFAULT_FEATURES, ...(stored.features || {}), home: true };
  const shortcuts = stored.shortcuts && typeof stored.shortcuts === 'object' && !Array.isArray(stored.shortcuts)
    ? stored.shortcuts : {};
  return {
    features,
    shortcut: isValidPanelShortcut(stored.shortcut) ? stored.shortcut : 'Space',
    shortcuts: {
      screenshot: isValidOptionalShortcut(shortcuts.screenshot) ? shortcuts.screenshot : '',
      screenRecording: isValidOptionalShortcut(shortcuts.screenRecording) ? shortcuts.screenRecording : '',
      audioRecording: isValidOptionalShortcut(shortcuts.audioRecording) ? shortcuts.audioRecording : '',
    },
    defaultTab: normalizeDefaultTabPreference(stored.defaultTab, features),
    theme: stored.theme === 'light' ? 'light' : 'dark',
  };
}

function publicAppSettings() {
  const settings = readAppSettings();
  return {
    ...settings,
    shortcuts: { ...settings.shortcuts, launcher: launcherConfig().shortcut },
    autoLaunch: isAutoLaunchEnabled(),
  };
}

function saveAppSettings(settings) {
  return writeJsonFile(getJsonSettingsPath(APP_SETTINGS_FILE), settings);
}

function readFinanceSettings() {
  const stored = readJsonFile(getJsonSettingsPath(FINANCE_SETTINGS_FILE));
  const providers = stored.providers && typeof stored.providers === 'object' && !Array.isArray(stored.providers)
    ? stored.providers : {};
  const coingecko = providers.coingecko && typeof providers.coingecko === 'object' ? providers.coingecko : {};
  const binance = providers.binance && typeof providers.binance === 'object' ? providers.binance : {};
  const alphaVantage = providers['alpha-vantage'] && typeof providers['alpha-vantage'] === 'object' ? providers['alpha-vantage'] : {};
  const alpaca = providers.alpaca && typeof providers.alpaca === 'object' ? providers.alpaca : {};
  const twelveData = providers['twelve-data'] && typeof providers['twelve-data'] === 'object' ? providers['twelve-data'] : {};
  const secEdgar = providers['sec-edgar'] && typeof providers['sec-edgar'] === 'object' ? providers['sec-edgar'] : {};
  const cnStock = providers['cn-stock'] && typeof providers['cn-stock'] === 'object' ? providers['cn-stock'] : {};
  const cnTencent = providers['cn-tencent'] && typeof providers['cn-tencent'] === 'object' ? providers['cn-tencent'] : {};
  const cnEastmoney = providers['cn-eastmoney'] && typeof providers['cn-eastmoney'] === 'object' ? providers['cn-eastmoney'] : {};
  const cnSina = providers['cn-sina'] && typeof providers['cn-sina'] === 'object' ? providers['cn-sina'] : {};
  const refreshSeconds = [0, 30, 60, 120, 300].includes(Number(stored.refreshSeconds)) ? Number(stored.refreshSeconds) : 60;
  return {
    schemaVersion: 2,
    refreshSeconds,
    providers: {
      coingecko: {
        enabled: coingecko.enabled !== false,
        encryptedApiKey: String(coingecko.encryptedApiKey || ''),
        verification: coingecko.verification && typeof coingecko.verification === 'object' ? coingecko.verification : null,
      },
      binance: {
        enabled: binance.enabled !== false,
        verification: binance.verification && typeof binance.verification === 'object' ? binance.verification : null,
      },
      'alpha-vantage': {
        enabled: alphaVantage.enabled === true,
        encryptedApiKey: String(alphaVantage.encryptedApiKey || ''),
        verification: alphaVantage.verification && typeof alphaVantage.verification === 'object' ? alphaVantage.verification : null,
      },
      alpaca: {
        enabled: alpaca.enabled === true,
        feed: alpaca.feed === 'sip' ? 'sip' : 'iex',
        encryptedKeyId: String(alpaca.encryptedKeyId || ''),
        encryptedSecretKey: String(alpaca.encryptedSecretKey || ''),
        verification: alpaca.verification && typeof alpaca.verification === 'object' ? alpaca.verification : null,
      },
      'twelve-data': {
        enabled: twelveData.enabled === true,
        encryptedApiKey: String(twelveData.encryptedApiKey || ''),
        verification: twelveData.verification && typeof twelveData.verification === 'object' ? twelveData.verification : null,
      },
      'sec-edgar': {
        enabled: secEdgar.enabled === true,
        encryptedContact: String(secEdgar.encryptedContact || ''),
        verification: secEdgar.verification && typeof secEdgar.verification === 'object' ? secEdgar.verification : null,
      },
      'cn-stock': {
        enabled: cnStock.enabled === true,
        encryptedApiKey: String(cnStock.encryptedApiKey || ''),
        verification: cnStock.verification && typeof cnStock.verification === 'object' ? cnStock.verification : null,
      },
      'cn-tencent': {
        enabled: cnTencent.enabled !== false,
        verification: cnTencent.verification && typeof cnTencent.verification === 'object' ? cnTencent.verification : null,
      },
      'cn-eastmoney': {
        enabled: cnEastmoney.enabled !== false,
        verification: cnEastmoney.verification && typeof cnEastmoney.verification === 'object' ? cnEastmoney.verification : null,
      },
      'cn-sina': {
        enabled: cnSina.enabled !== false,
        verification: cnSina.verification && typeof cnSina.verification === 'object' ? cnSina.verification : null,
      },
    },
  };
}

function normalizeSecEdgarContact(value) {
  const contact = String(value || '').trim().slice(0, 160);
  return contact.includes('@') && !/[\r\n]/.test(contact) ? contact : '';
}

function resolveFinanceConfig() {
  const stored = readFinanceSettings();
  const environmentCoinGeckoKey = String(process.env.COINGECKO_API_KEY || '').trim();
  const environmentAlphaVantageKey = String(process.env.ALPHA_VANTAGE_API_KEY || '').trim();
  const environmentAlpacaKey = String(process.env.ALPACA_API_KEY_ID || '').trim();
  const environmentAlpacaSecret = String(process.env.ALPACA_API_SECRET_KEY || '').trim();
  const environmentTwelveDataKey = String(process.env.TWELVE_DATA_API_KEY || '').trim();
  const environmentSecEdgarContact = normalizeSecEdgarContact(process.env.SEC_EDGAR_CONTACT);
  const environmentQuantDashKey = String(process.env.QUANTDASH_API_KEY || '').trim();
  const coinGeckoKey = environmentCoinGeckoKey || decryptStoredSecret(stored.providers.coingecko.encryptedApiKey).trim();
  const alphaVantageKey = environmentAlphaVantageKey || decryptStoredSecret(stored.providers['alpha-vantage'].encryptedApiKey).trim();
  const alpacaKey = environmentAlpacaKey || decryptStoredSecret(stored.providers.alpaca.encryptedKeyId).trim();
  const alpacaSecret = environmentAlpacaSecret || decryptStoredSecret(stored.providers.alpaca.encryptedSecretKey).trim();
  const twelveDataKey = environmentTwelveDataKey || decryptStoredSecret(stored.providers['twelve-data'].encryptedApiKey).trim();
  const secEdgarContact = environmentSecEdgarContact || normalizeSecEdgarContact(decryptStoredSecret(stored.providers['sec-edgar'].encryptedContact));
  const quantDashKey = environmentQuantDashKey || decryptStoredSecret(stored.providers['cn-stock'].encryptedApiKey).trim();
  return {
    coingecko: {
      enabled: stored.providers.coingecko.enabled,
      apiKey: coinGeckoKey,
      credentialSource: environmentCoinGeckoKey ? 'environment' : coinGeckoKey ? 'stored' : 'none',
    },
    binance: {
      enabled: stored.providers.binance.enabled,
    },
    alphaVantage: {
      enabled: stored.providers['alpha-vantage'].enabled,
      apiKey: alphaVantageKey,
      credentialSource: environmentAlphaVantageKey ? 'environment' : alphaVantageKey ? 'stored' : 'none',
    },
    alpaca: {
      enabled: stored.providers.alpaca.enabled,
      feed: stored.providers.alpaca.feed,
      keyId: alpacaKey,
      secretKey: alpacaSecret,
      credentialSource: environmentAlpacaKey && environmentAlpacaSecret ? 'environment' : alpacaKey && alpacaSecret ? 'stored' : 'none',
    },
    twelveData: {
      enabled: stored.providers['twelve-data'].enabled,
      apiKey: twelveDataKey,
      credentialSource: environmentTwelveDataKey ? 'environment' : twelveDataKey ? 'stored' : 'none',
    },
    secEdgar: {
      enabled: stored.providers['sec-edgar'].enabled,
      contact: secEdgarContact,
      credentialSource: environmentSecEdgarContact ? 'environment' : secEdgarContact ? 'stored' : 'none',
    },
    cnStock: {
      enabled: stored.providers['cn-stock'].enabled,
      apiKey: quantDashKey,
      credentialSource: environmentQuantDashKey ? 'environment' : quantDashKey ? 'stored' : 'none',
      label: 'QuantDash',
    },
    cnTencent: { enabled: stored.providers['cn-tencent'].enabled },
    cnEastmoney: { enabled: stored.providers['cn-eastmoney'].enabled },
    cnSina: { enabled: stored.providers['cn-sina'].enabled },
  };
}

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

function updateFinanceProvider(payload) {
  const providerId = String(payload?.providerId || '');
  if (!['coingecko', 'binance', 'alpha-vantage', 'alpaca', 'twelve-data', 'sec-edgar', 'cn-stock', 'cn-tencent', 'cn-eastmoney', 'cn-sina'].includes(providerId)) return { ok: false, error: 'invalid_provider' };
  const current = readFinanceSettings();
  const apiKey = String(payload?.apiKey || '').trim();
  const keyId = String(payload?.keyId || '').trim();
  const secretKey = String(payload?.secretKey || '').trim();
  const rawContact = String(payload?.contact || '').trim();
  const contact = normalizeSecEdgarContact(rawContact);
  if (apiKey.length > 512 || keyId.length > 256 || secretKey.length > 512 || rawContact.length > 160) return { ok: false, error: 'invalid_credential' };
  if (providerId === 'sec-edgar' && rawContact && !contact) return { ok: false, error: 'invalid_contact' };
  if ((apiKey || keyId || secretKey || contact) && !safeStorage.isEncryptionAvailable()) return { ok: false, error: 'secure_storage_unavailable' };
  const providers = { ...current.providers };
  if (providerId === 'coingecko') {
    providers.coingecko = {
      enabled: payload?.enabled !== false,
      encryptedApiKey: payload?.removeCredential === true ? '' : apiKey
        ? safeStorage.encryptString(apiKey).toString('base64') : current.providers.coingecko.encryptedApiKey,
      verification: null,
    };
  } else if (providerId === 'binance') {
    providers.binance = { enabled: payload?.enabled !== false, verification: null };
  } else if (providerId === 'alpha-vantage') {
    providers['alpha-vantage'] = {
      enabled: payload?.enabled === true,
      encryptedApiKey: payload?.removeCredential === true ? '' : apiKey
        ? safeStorage.encryptString(apiKey).toString('base64') : current.providers['alpha-vantage'].encryptedApiKey,
      verification: null,
    };
  } else if (providerId === 'alpaca') {
    providers.alpaca = {
      enabled: payload?.enabled === true,
      feed: payload?.feed === 'sip' ? 'sip' : 'iex',
      encryptedKeyId: payload?.removeCredential === true ? '' : keyId
        ? safeStorage.encryptString(keyId).toString('base64') : current.providers.alpaca.encryptedKeyId,
      encryptedSecretKey: payload?.removeCredential === true ? '' : secretKey
        ? safeStorage.encryptString(secretKey).toString('base64') : current.providers.alpaca.encryptedSecretKey,
      verification: null,
    };
  } else if (providerId === 'twelve-data') {
    providers['twelve-data'] = {
      enabled: payload?.enabled === true,
      encryptedApiKey: payload?.removeCredential === true ? '' : apiKey
        ? safeStorage.encryptString(apiKey).toString('base64') : current.providers['twelve-data'].encryptedApiKey,
      verification: null,
    };
  } else if (providerId === 'sec-edgar') {
    providers['sec-edgar'] = {
      enabled: payload?.enabled === true,
      encryptedContact: payload?.removeCredential === true ? '' : contact
        ? safeStorage.encryptString(contact).toString('base64') : current.providers['sec-edgar'].encryptedContact,
      verification: null,
    };
  } else if (providerId === 'cn-stock') {
    providers['cn-stock'] = {
      enabled: payload?.enabled === true,
      encryptedApiKey: payload?.removeCredential === true ? '' : apiKey
        ? safeStorage.encryptString(apiKey).toString('base64') : current.providers['cn-stock'].encryptedApiKey,
      verification: null,
    };
  } else {
    providers[providerId] = { enabled: payload?.enabled !== false, verification: null };
  }
  if (!writeJsonFile(getJsonSettingsPath(FINANCE_SETTINGS_FILE), { schemaVersion: 2, refreshSeconds: current.refreshSeconds, providers })) return { ok: false, error: 'save_failed' };
  getFinanceService().clearCache({ includeQuotaProtected: true });
  financeBackgroundService.invalidate();
  return publicFinanceSettings();
}

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

function workspaceRoot() {
  const settings = readJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE));
  const configured = String(settings.path || '').trim();
  return configured && path.isAbsolute(configured) ? configured : app.getPath('userData');
}

function workspacePath(name) {
  return path.join(workspaceRoot(), name);
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

function copyWorkspaceAssets(sourceRoot, targetRoot) {
  if (!sourceRoot || !targetRoot || path.resolve(sourceRoot) === path.resolve(targetRoot)) return;
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME, NOTE_IMAGES_DIR_NAME]) {
    const source = path.join(sourceRoot, directory);
    const target = path.join(targetRoot, directory);
    try {
      if (!fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) continue;
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
    } catch (error) {}
  }
  for (const filename of [WORKSPACE_DATA_FILE]) {
    const source = path.join(sourceRoot, filename);
    const target = path.join(targetRoot, filename);
    try {
      if (fs.existsSync(source) && fs.lstatSync(source).isFile() && !fs.existsSync(target)) {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {}
  }
}

async function chooseWorkspaceFolder() {
  if (captureService?.busy()) {
    await dialog.showMessageBox({ type: 'info', message: '请先结束录音或屏幕采集并等待保存，再更换数据文件夹。' });
    return false;
  }
  const result = await showOwnedOpenDialog({
    title: '选择 Dynamic Panel 数据文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  const selected = !result.canceled && result.filePaths && result.filePaths[0];
  if (!selected) return false;
  if (captureService?.busy()) return false;
  const previousRoot = workspaceRoot();
  try { copyCaptures(previousRoot, selected); }
  catch (error) {
    await dialog.showMessageBox({ type: 'error', message: '截图与录屏资料复制失败，数据文件夹未切换。', detail: '请检查目标目录权限、剩余空间及是否存在冲突文件。' });
    return false;
  }
  copyWorkspaceAssets(previousRoot, selected);
  if (!writeJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE), { path: selected })) return false;
  aiContextGeneration += 1;
  aiModelService?.cancelAll();
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME, NOTE_IMAGES_DIR_NAME]) {
    try { fs.mkdirSync(path.join(selected, directory), { recursive: true }); } catch (error) {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed', { path: selected });
  captureService?.refresh();
  refreshTrayMenu();
  return true;
}

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

function registeredShortcutConflict(action, shortcut) {
  return shortcutAssignmentConflict({
    panel: configuredShortcut,
    launcher: configuredLauncherShortcut,
    screenshot: configuredActionShortcuts.screenshot,
    screenRecording: configuredActionShortcuts.screenRecording,
    audioRecording: configuredActionShortcuts.audioRecording,
  }, action, shortcut);
}

function registerShortcut(accelerator, callback) {
  try { return globalShortcut.register(accelerator, callback) === true; }
  catch (error) { return false; }
}

function panelShortcutCallback() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hideWhenCollapsed = false;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('shortcut:toggle-panel');
}

function setPanelShortcut(shortcut) {
  if (!isValidPanelShortcut(shortcut) || registeredShortcutConflict('panel', shortcut)) return false;
  if (shortcut === configuredShortcut) return true;
  const previousShortcut = configuredShortcut;
  stopHoverSpaceShortcut();
  if (previousShortcut && previousShortcut !== 'Space') globalShortcut.unregister(previousShortcut);
  if (shortcut === 'Space') {
    configuredShortcut = shortcut;
    startHoverSpaceShortcut();
    return true;
  }
  if (registerShortcut(shortcut, panelShortcutCallback)) {
    configuredShortcut = shortcut;
    return true;
  }
  configuredShortcut = previousShortcut;
  if (previousShortcut === 'Space') startHoverSpaceShortcut();
  else if (previousShortcut && !registerShortcut(previousShortcut, panelShortcutCallback)) configuredShortcut = '';
  return false;
}

function launcherConfig() {
  const file=path.join(app.getPath('userData'),'launcher-settings.json');
  let candidate={}; try { if(fs.statSync(file).size<=65536) candidate=readJsonFile(file,{}); } catch {}
  const stored=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate:{};
  const defaults={apps:true,workspace:true,clipboard:false,extensions:true};
  const sources=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,typeof stored.sources?.[key]==='boolean'?stored.sources[key]:value]));
  return { executeTimeoutMs: Math.max(500, Math.min(10000, Number(stored.executeTimeoutMs) || 5000)), queryTimeoutMs: Math.max(300, Math.min(5000, Number(stored.queryTimeoutMs) || 800)), shortcut: typeof stored.shortcut === 'string' && stored.shortcut.length <= 100 ? stored.shortcut : 'CommandOrControl+Space', sources };
}
function launcherShortcutCallback() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  launcherFocus.capture({ keepWhenOwned: currentMode === 'launcher' });
  hideWhenCollapsed = false;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('shortcut:toggle-launcher');
}

function setLauncherShortcut(shortcut = launcherConfig().shortcut) {
  if (!isValidOptionalShortcut(shortcut) || registeredShortcutConflict('launcher', shortcut)) return false;
  if (shortcut === configuredLauncherShortcut) return true;
  const previousShortcut = configuredLauncherShortcut;
  if (previousShortcut) globalShortcut.unregister(previousShortcut);
  if (!shortcut || registerShortcut(shortcut, launcherShortcutCallback)) {
    configuredLauncherShortcut = shortcut;
    return true;
  }
  configuredLauncherShortcut = previousShortcut;
  if (previousShortcut && !registerShortcut(previousShortcut, launcherShortcutCallback)) configuredLauncherShortcut = '';
  return false;
}

function runConfiguredShortcutAction(action) {
  if (['screenshot', 'screenRecording'].includes(action)) {
    if (!captureService || captureService.busy()) return;
    const request = action === 'screenRecording' ? { mode: 'video', region: true } : 'screenshot';
    void captureService.open(request).catch(() => {});
    return;
  }
  if (action === 'audioRecording') openRendererPanel('shortcut:audio-recording');
}

function setActionShortcut(action, shortcut) {
  if (!Object.hasOwn(configuredActionShortcuts, action)
    || !isValidOptionalShortcut(shortcut)
    || registeredShortcutConflict(action, shortcut)) return false;
  if (shortcut === configuredActionShortcuts[action]) return true;
  const previousShortcut = configuredActionShortcuts[action];
  if (previousShortcut) globalShortcut.unregister(previousShortcut);
  const callback = () => runConfiguredShortcutAction(action);
  if (!shortcut || registerShortcut(shortcut, callback)) {
    configuredActionShortcuts = { ...configuredActionShortcuts, [action]: shortcut };
    return true;
  }
  configuredActionShortcuts = { ...configuredActionShortcuts, [action]: previousShortcut };
  if (previousShortcut && !registerShortcut(previousShortcut, callback)) {
    configuredActionShortcuts = { ...configuredActionShortcuts, [action]: '' };
  }
  return false;
}

function getLauncherService() {
  if (!launcherService) launcherService = createLauncherService({ dataRoot: app.getPath('userData'), executable: process.execPath, getSettings: launcherConfig, readShortcut: (file) => shell.readShortcutLink(file) });
  return launcherService;
}
function launcherHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return { ok: false, error: 'invalid_sender' };
    try { return await handler(payload); } catch (error) { return { ok: false, error: error.message || 'launcher_failed' }; }
  });
}
launcherHandler('launcher:focus', (payload) => ({ok:true, restored: payload?.restore === true ? launcherFocus.restore() : (launcherFocus.discard(),false)}));
launcherHandler('launcher:settings', () => ({ ok: true, ...launcherConfig(), registered: Boolean(configuredLauncherShortcut) }));
launcherHandler('launcher:save-settings', (payload) => {
  if (!payload || typeof payload.shortcut !== 'string' || !payload.sources || typeof payload.sources !== 'object') throw Error('invalid_settings');
  const executeTimeoutMs = payload.executeTimeoutMs ?? 5000;
  if (!Number.isInteger(executeTimeoutMs) || executeTimeoutMs < 500 || executeTimeoutMs > 10000) throw Error('invalid_settings');
  const queryTimeoutMs = payload.queryTimeoutMs ?? 800;
  if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 300 || queryTimeoutMs > 5000) throw Error('invalid_settings');
  if (!setLauncherShortcut(payload.shortcut)) throw Error('shortcut_occupied');
  const sources = Object.fromEntries(['apps', 'workspace', 'clipboard', 'extensions'].map((key) => [key, payload.sources[key] === true]));
  if (!writeJsonFile(path.join(app.getPath('userData'), 'launcher-settings.json'), { shortcut: payload.shortcut, sources, queryTimeoutMs, executeTimeoutMs })) { setLauncherShortcut(launcherConfig().shortcut); throw Error('save_failed'); }
  return { ok: true };
});
launcherHandler('launcher:query', async (payload) => {
  if (typeof payload?.query !== 'string' || payload.query.length > 1000 || payload.regexMode !== undefined && typeof payload.regexMode !== 'boolean') throw Error('invalid_query');
  const owner = mainWindow;
  return { ok: true, items: await getLauncherService().query(payload.regexMode === true ? '' : payload.query, launcherConfig().sources, (items, progress) => {
    if (Number.isSafeInteger(payload.requestId) && owner && !owner.isDestroyed()) owner.webContents.send('launcher:partial', { requestId: payload.requestId, items, pending: progress?.pending || [] });
  }) };
});
const launcherIconCache = new Map();
launcherHandler('launcher:icon', async (payload) => {
  if (typeof payload?.id !== 'string') throw Error('invalid_target');
  const target = getLauncherService().target(payload.id);
  if (target?.type !== 'open-app') throw Error('invalid_target');
  if (!launcherIconCache.has(target.path)) {
    if (launcherIconCache.size >= 256) launcherIconCache.delete(launcherIconCache.keys().next().value);
    launcherIconCache.set(target.path, (async () => {
      let iconPath=target.path;
      if(process.platform==='win32'&&/\.lnk$/i.test(iconPath)) {
        const shortcut=shell.readShortcutLink(iconPath);
        iconPath=shortcut.icon&&/\.ico$/i.test(shortcut.icon)?shortcut.icon:shortcut.target;
        iconPath=iconPath.replace(/%([^%]+)%/g,(token,key)=>process.env[key]||token);
        if(!path.isAbsolute(iconPath)||iconPath.startsWith('\\\\'))return '';
      }
      return (await app.getFileIcon(iconPath,{size:'normal'})).toDataURL();
    })().catch(() => ''));
  }
  return { ok: true, icon: await launcherIconCache.get(target.path) };
});
launcherHandler('launcher:cancel', async () => { await getLauncherService().cancel(); return { ok: true }; });
launcherHandler('launcher:extension-data', async (payload) => {
  if (launcherManaging || typeof payload?.id !== 'string' || !['export','import'].includes(payload.operation)) throw Error('invalid_action');
  const extension = (await getLauncherService().list()).find(item=>item.id===payload.id);
  if(!extension)throw Error('extension_not_found');
  launcherManaging=true;
  try {
    if(payload.operation==='export') {
      const choice=await dialog.showSaveDialog(mainWindow,{title:'导出扩展数据',defaultPath:`${extension.id}.launcher-data.json`,filters:[{name:'扩展数据',extensions:['json']}]});
      if(choice.canceled||!choice.filePath)return {ok:false,error:'cancelled'};
      const archive=await getLauncherService().exportData(extension.id);
      await fs.promises.writeFile(choice.filePath,JSON.stringify(archive));
    } else {
      const choice=await dialog.showOpenDialog(mainWindow,{title:'导入扩展数据',properties:['openFile'],filters:[{name:'扩展数据',extensions:['json']}]});
      if(choice.canceled||!choice.filePaths[0])return {ok:false,error:'cancelled'};
      if((await fs.promises.stat(choice.filePaths[0])).size>30*1024*1024)throw Error('extension_data_too_large');
      const archive=JSON.parse(await fs.promises.readFile(choice.filePaths[0],'utf8'));
      require('./launcher/data-transfer').validateArchive(archive,extension.id);
      const confirm=await dialog.showMessageBox(mainWindow,{type:'warning',title:'替换扩展数据',message:`替换“${extension.name}”的专属数据？`,detail:'只替换所选扩展的数据。不会导入代码、权限授权或日志。建议先导出现有数据。',buttons:['取消','替换'],defaultId:0,cancelId:0});
      if(confirm.response!==1)return {ok:false,error:'cancelled'};
      await getLauncherService().importData(extension.id,archive);
    }
    return {ok:true};
  } finally {launcherManaging=false;}
});
launcherHandler('launcher:extensions', async () => ({ ok: true, items: await getLauncherService().list() }));
launcherHandler('launcher:extension-toggle', async (payload) => { if (typeof payload?.id !== 'string' || typeof payload.enabled !== 'boolean') throw Error('invalid_extension'); await getLauncherService().change(payload.id, payload.enabled); return { ok: true }; });
launcherHandler('launcher:extension-install', async () => {
  if (launcherManaging) throw Error('busy');
  launcherManaging = true;
  let staged;
  try {
    const chosen = await dialog.showOpenDialog(mainWindow, { title: '选择含 manifest.json 的扩展目录', properties: ['openDirectory'] });
    if (chosen.canceled) return { ok: false, error: 'cancelled' };
    staged = await getLauncherService().stage(chosen.filePaths[0]);
    const m = staged.manifest;
    const response = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['取消', '安装并启用'], defaultId: 0, cancelId: 0, message: `安装 ${m.name} ${m.version}？`, detail: `作者：${m.author}\n命令：${m.commands.map((c) => c.title).join('、')}\n声明权限：${m.permissions.join('、') || '无'}\n入口：${m.runtime?.entry || '声明式命令，无代码入口'}\n${m.runtime ? '此扩展会运行 JavaScript：直接文件访问仅限自身代码和专属数据目录，禁止派生进程、原生插件和 Worker。网络没有系统级隔离，请仅安装信任的代码。' : '此扩展仅包含声明式命令，由宿主执行。'}` });
    if (response.response !== 1) return { ok: false, error: 'cancelled' };
    await getLauncherService().install(staged); return { ok: true };
  } finally {
    try { if (staged) await fs.promises.rm(staged.temporary, { recursive: true, force: true }); }
    finally { launcherManaging = false; }
  }
});
launcherHandler('launcher:extension-remove', async (payload) => {
  if (launcherManaging) throw Error('busy');
  if (typeof payload?.id !== 'string') throw Error('invalid_extension');
  launcherManaging = true;
  try {
    const response = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0, message: '卸载此扩展并删除其本机数据？' });
    if (response.response !== 1) return { ok: false, error: 'cancelled' };
    await getLauncherService().uninstall(payload.id); return { ok: true };
  } finally { launcherManaging = false; }
});
launcherHandler('launcher:run', async (payload) => {
  if (typeof payload?.id !== 'string') throw Error('invalid_action');
  let target = getLauncherService().target(payload.id);
  if (!target) throw Error('stale_result');
  const mode=payload.mode===undefined?'default':payload.mode;
  if(!['default','admin','new','focus'].includes(mode)||mode!=='default'&&target.type!=='open-app')throw Error('invalid_action');
  if(mode!=='default') {
    transientSystemInteractionRequests++;
    try {return await getLauncherService().perform(target,action=>launcherApplications.run(action.path,mode));}
    finally {transientSystemInteractionRequests--;}
  }
  if (target.confirmation === 'confirm') {
    if (launcherManaging) throw Error('busy');
    launcherManaging = true;
    try {
      const result = await dialog.showMessageBox(mainWindow, { type:'warning', title:'确认扩展动作', message:`执行“${target.title}”？`, detail:'此命令声明了写文件或 Shell 权限。运行时仍会限制文件访问，并禁止派生进程。', buttons:['取消','执行'], defaultId:0, cancelId:0 });
      if(result.response !== 1) return {ok:false,error:'cancelled'};
    } finally { launcherManaging=false; }
  }
  return getLauncherService().perform(target, performLauncherAction);
});
launcherHandler('launcher:navigation-result', (payload) => {
  if (typeof payload?.token !== 'string' || payload.token.length > 100 || typeof payload.ok !== 'boolean') throw Error('invalid_action');
  return getLauncherService().completeNavigation(payload.token, payload.ok);
});
async function performLauncherAction(target) {
  if (target.type === 'search') return { ok: true, query: target.query };
  if (target.type === 'navigate') return { ok: true, navigationToken: require('node:crypto').randomUUID(), navigation: { tab: target.tab, ...(target.id ? { id: target.id } : {}) } };
  if (target.type === 'copy-text') await clipboard.writeText(target.text);
  else if (target.type === 'open-app' || target.type === 'open-path') {
    let launchPath = target.path;
    if (target.type === 'open-path') {
      const resolved = await resolveLaunchPath(target.path);
      if (!resolved) throw Error('invalid_path');
      launchPath = resolved.path;
    }
    const error = await shell.openPath(launchPath); if (error) throw Error('app_open_failed');
  }
  else if (target.type === 'open-url') { const url = await validatePublicHttpUrl(target.url); if (!url) throw Error('invalid_url'); await shell.openExternal(url.toString()); }
  else throw Error('invalid_action');
  return { ok: true };
}
launcherHandler('launcher:open-url', async (payload) => { const url = await validatePublicHttpUrl(payload?.url); if (!url) throw Error('invalid_url'); await shell.openExternal(url.toString()); return { ok: true }; });

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
  for (const action of Object.keys(configuredActionShortcuts)) {
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
  tray = new Tray(createNotchTrayIcon());
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

ipcMain.handle('window:set-mode', async (event, mode) => {
  if (mode === 'expanded') await rememberPasteTarget();
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  applyMode(mode === 'launcher' ? 'launcher' : mode === 'expanded' ? 'expanded' : 'collapsed', mode === 'launcher' ? getTargetDisplay() : undefined);
});

ipcMain.handle('window:begin-collapse', () => {
  beginNativeCollapse();
});

ipcMain.on('window:set-collapsed-hover', (event, hovering) => {
  if (
    process.platform !== 'win32'
    || !mainWindow
    || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents
    || currentMode !== 'collapsed'
  ) return;
  const next = hovering === true;
  if (next === windowsCollapsedHovering) return;
  windowsCollapsedHovering = next;
  applyWindowGeometry('collapsed');
});

ipcMain.handle('settings:get', () => publicAppSettings());
ipcMain.handle('settings:set-feature', (event, payload) => {
  const current = readAppSettings();
  const features = updateFeaturePreference(current.features, payload && payload.featureId, payload && payload.enabled);
  if (!features) return { ok: false, error: 'invalid_feature' };
  const next = { ...current, features };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  refreshTrayMenu();
  return { ok: true, settings: publicAppSettings() };
});
ipcMain.handle('settings:set-default-tab', (event, defaultTab) => {
  const next = updateDefaultTabPreference(readAppSettings(), defaultTab);
  if (!next) return { ok: false, error: 'invalid_default_tab' };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  return { ok: true, settings: publicAppSettings() };
});
ipcMain.handle('settings:set-theme', (event, theme) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return { ok: false, error: 'invalid_sender' };
  if (!['dark', 'light'].includes(theme)) return { ok: false, error: 'invalid_theme' };
  const next = { ...readAppSettings(), theme };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  return { ok: true, settings: publicAppSettings() };
});
ipcMain.handle('settings:set-auto-launch', (event, enabled) => {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
  if (!setAutoLaunch(enabled)) return { ok: false, error: 'save_failed', autoLaunch: isAutoLaunchEnabled() };
  const settings = publicAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  return { ok: true, autoLaunch: settings.autoLaunch };
});
ipcMain.handle('settings:set-shortcut', (event, payload) => {
  const action = typeof payload === 'string' ? 'panel' : payload?.action;
  const accelerator = typeof payload === 'string' ? payload : payload?.accelerator;
  if (!['panel', 'launcher', 'screenshot', 'screenRecording', 'audioRecording'].includes(action)
    || typeof accelerator !== 'string'
    || (action === 'panel' ? !isValidPanelShortcut(accelerator) : !isValidOptionalShortcut(accelerator))) {
    return { ok: false, error: 'invalid' };
  }
  if (action === 'launcher') {
    const previous = launcherConfig();
    if (!setLauncherShortcut(accelerator)) return { ok: false, error: 'occupied' };
    const next = { ...previous, shortcut: accelerator };
    if (!writeJsonFile(path.join(app.getPath('userData'), 'launcher-settings.json'), next)) {
      setLauncherShortcut(previous.shortcut);
      return { ok: false, error: 'save_failed' };
    }
  } else {
    const next = readAppSettings();
    const previous = action === 'panel' ? next.shortcut : next.shortcuts[action];
    const registered = action === 'panel'
      ? setPanelShortcut(accelerator)
      : setActionShortcut(action, accelerator);
    if (!registered) return { ok: false, error: 'occupied' };
    if (action === 'panel') next.shortcut = accelerator;
    else next.shortcuts[action] = accelerator;
    if (!saveAppSettings(next)) {
      if (action === 'panel') setPanelShortcut(previous);
      else setActionShortcut(action, previous);
      return { ok: false, error: 'save_failed' };
    }
  }
  const settings = publicAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  return { ok: true, action, shortcut: accelerator, settings };
});
ipcMain.handle('workspace:get', () => ({ path: workspaceRoot(), portable: workspaceRoot() !== app.getPath('userData') }));
ipcMain.handle('workspace:load-data', () => {
  const payload = readJsonFile(workspacePath(WORKSPACE_DATA_FILE), {});
  return payload && payload.localStorage && typeof payload.localStorage === 'object'
    ? payload.localStorage
    : {};
});

function normalizePortableStorage(storage) {
  const portable = { ...storage };
  const normalizers = [
    ['notch-recordings', 'audioPath', RECORDINGS_DIR_NAME],
    ['notch-clip-history', 'imagePath', CLIP_IMAGES_DIR_NAME],
  ];
  for (const [storageKey, property, directory] of normalizers) {
    try {
      const rows = JSON.parse(portable[storageKey]);
      if (!Array.isArray(rows)) continue;
      portable[storageKey] = JSON.stringify(rows.map((row) => {
        if (!row || typeof row !== 'object' || !row[property]) return row;
        return { ...row, [property]: platformPolicy.portableMediaPath(directory, row[property]) };
      }));
    } catch (error) {}
  }
  return portable;
}

ipcMain.handle('workspace:save-data', (event, storage) => {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return false;
  const portableStorage = normalizePortableStorage(storage);
  const serialized = JSON.stringify(portableStorage);
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) return false;
  const destination = workspacePath(WORKSPACE_DATA_FILE);
  if (!workspacePersistenceGate.shouldWrite(portableStorage, destination)) return true;
  const written = writeJsonFile(destination, {
    version: 1,
    updatedAt: Date.now(),
    localStorage: portableStorage,
  });
  if (written) workspacePersistenceGate.markWritten(portableStorage, destination);
  return written;
});
ipcMain.handle('workspace:open', () => shell.openPath(workspaceRoot()));
ipcMain.handle('workspace:choose', () => chooseWorkspaceFolder());

function getLayoutMetrics(display) {
  const d = display || getWindowDisplay();
  return {
    stripHeight: getCollapsedHeight(d), // 折叠黑条总高（= 菜单栏高 = 物理刘海高，不含唇边）
    menuBarHeight: getMenuBarHeight(d), // 折叠态菜单栏带高（折叠条上半部分被其拦截）
    chromeY: EXPANDED_CHROME_Y,
    tabSizes: TAB_SIZES,
  };
}

ipcMain.handle('window:metrics', () => {
  return getLayoutMetrics();
});

// Tab 仅改变内容；固定展开尺寸下不再触发原生窗口 resize。
ipcMain.on('window:keep-open', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  cancelPanelBlurCollapse();
  if (currentMode === 'expanded' && !mainWindow.isFocused()) mainWindow.focus();
});

ipcMain.handle('window:set-tab', (event, tab) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  cancelPanelBlurCollapse();
  currentTab = Object.prototype.hasOwnProperty.call(TAB_SIZES, tab) ? tab : 'home';
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

// macOS 渲染层 getUserMedia 不会自动弹 TCC 授权，必须由主进程申请麦克风权限。
ipcMain.handle('media:microphone', () => requestMacMediaAccess('microphone'));

ipcMain.handle('tasks:recent', () => taskNotificationQueue.history());

// 快捷链接：URL 走外部浏览器（仅 http/https），本地路径走系统打开（仅绝对路径）
ipcMain.handle('shell:openExternal', async (event, value) => {
  const url = await validatePublicHttpUrl(value);
  if (!url) return false;
  await shell.openExternal(url.toString());
  return true;
});

ipcMain.handle('shell:openPath', (event, p) => {
  if (typeof p === 'string' && path.isAbsolute(p)) {
    return shell.openPath(p);
  }
});

// 只放行固定的几个隐私面板，渲染层传来的值只能当作枚举的键来查，
// 绝不能拼进 URL：x-apple.systempreferences: 能打开任意设置面板。
const PRIVACY_SETTINGS_PANES = process.platform === 'win32' ? {
  microphone: 'ms-settings:privacy-microphone',
} : {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

ipcMain.handle('shell:open-privacy-settings', (event, pane) => {
  const target = PRIVACY_SETTINGS_PANES[String(pane || '')];
  if (!target) return false;
  shell.openExternal(target);
  return true;
});

// ============ 启动时的权限自检 ============
// DMG 装的是全新二进制，TCC 授权不会从开发版继承，而这几项缺失时的表现都是「静默失效」：
// 缺「屏幕录制」→ CGWindowList 照样返回窗口但标题全空，当前窗口看起来像真的没窗口；
// 缺「辅助功能」→ 枚举、聚焦窗口和汽水音乐发按键全部无效。
// 系统对前者根本不弹提示，所以只能由应用自己说，否则用户完全无从下手。
const PERMISSION_PROMPT_SKIP_FILE = 'permission-prompt-skipped';

// 先尊重系统的明确状态，尤其不能在 not-determined 时调用 desktopCapturer，
// 否则启动自检本身就会抢先弹出系统录屏框。只有系统报告 granted 时才通过
// 无缩略图的窗口标题做二次确认；未知状态 fail-open，等用户实际使用时再申请。
async function hasScreenRecordingAccess() {
  const policy = screenRecordingProbePolicy(systemPreferences.getMediaAccessStatus('screen'));
  if (!policy.inspectWindowTitles) return policy.hasAccess;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (sources.length === 0) return true; // 拿不到源无法判定，不误报
    return sources.some((source) => String(source.name || '').trim().length > 0);
  } catch (error) {
    return true; // 探测本身失败时不打扰用户
  }
}

async function promptForMissingPermissions() {
  if (process.platform !== 'darwin') return;
  const skipFlag = path.join(app.getPath('userData'), PERMISSION_PROMPT_SKIP_FILE);
  if (fs.existsSync(skipFlag)) return;

  const missing = [];
  // 传 false 只查询不弹系统框：先把缺失项攒齐一次性告知，避免连弹两个系统对话框。
  if (!systemPreferences.isTrustedAccessibilityClient(false)) missing.push('accessibility');
  if (!await hasScreenRecordingAccess()) missing.push('screen-recording');
  if (missing.length === 0) return;

  const names = missing.map((key) => (key === 'accessibility' ? '辅助功能' : '屏幕录制'));
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'info',
    message: `Dynamic Panel 需要「${names.join('」和「')}」权限`,
    detail: [
      '缺少这些权限时，「当前窗口」会读不到任何窗口，汽水音乐的播放控制也不会生效。',
      '',
      '授权后需要重新启动 Dynamic Panel 才会生效。',
      'ad-hoc 签名的应用每次重新打包都要重新授权一次，这是没有开发者账号分发的固有限制。',
    ].join('\n'),
    buttons: ['打开系统设置', '以后再说'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '不再提示',
    checkboxChecked: false,
  });

  if (checkboxChecked) {
    try { fs.writeFileSync(skipFlag, new Date().toISOString()); } catch (error) {}
  }
  if (response !== 0) return;

  // 顺带用 true 触发一次系统的辅助功能提示：这一步会把应用登记进系统设置的列表里，
  // 否则用户打开设置面板可能找不到 Dynamic Panel 这一项、只能手动拖进去。
  if (missing.includes('accessibility')) systemPreferences.isTrustedAccessibilityClient(true);
  shell.openExternal(PRIVACY_SETTINGS_PANES[missing[0]]);
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

async function requestFinanceJson(value, options = {}) {
  let url;
  try { url = new URL(value); } catch (error) { throw Object.assign(new Error('invalid_endpoint'), { code: 'invalid_endpoint' }); }
  if (!FINANCE_ALLOWED_ORIGINS.has(url.origin) || url.username || url.password) {
    throw Object.assign(new Error('unsafe_endpoint'), { code: 'unsafe_endpoint' });
  }
  const method = options.method === 'POST' ? 'POST' : 'GET';
  if (options.method && !['GET', 'POST'].includes(options.method)) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
  const body = method === 'POST' ? String(options.body || '') : '';
  if (Buffer.byteLength(body, 'utf8') > FINANCE_FETCH_MAX_REQUEST_BYTES) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
  if (options.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
  const endpoint = await resolvePinnedAIEndpoint(url.toString());
  if (options.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
  if (!endpoint) throw Object.assign(new Error('unsafe_endpoint'), { code: 'unsafe_endpoint' });
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (options.signal?.aborted) onExternalAbort();
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FINANCE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchPinnedAIEndpoint(endpoint, {
      method,
      headers: options.headers,
      body: body || undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      let retryAfterMs = null;
      try {
        const bodyText = await readResponseText(response);
        const body = JSON.parse(bodyText);
        retryAfterMs = Number.isFinite(Number(body?.retry_after_ms)) ? Number(body.retry_after_ms) : null;
      } catch (error) {}
      throw Object.assign(new Error(`http_${response.status}`), { code: `http_${response.status}`, retryAfterMs });
    }
    const responseType = options.responseType === 'text' ? 'text' : 'json';
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (responseType === 'json' && contentType && !contentType.includes('application/json')) {
      try { await response.body?.cancel(); } catch (error) {}
      throw Object.assign(new Error('invalid_response_type'), { code: 'invalid_response' });
    }
    const reader = response.body?.getReader();
    if (!reader) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > FINANCE_FETCH_MAX_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error('response_too_large'), { code: 'response_too_large' });
      }
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (responseType === 'text') {
      try { return new TextDecoder(options.encoding || 'utf-8').decode(bytes); }
      catch (error) { throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' }); }
    }
    try { return JSON.parse(bytes.toString('utf8')); }
    catch (error) { throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' }); }
  } catch (error) {
    if (options.signal?.aborted && !timedOut) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    if (error?.name === 'AbortError' || timedOut) throw Object.assign(new Error('timeout'), { code: 'timeout' });
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function readResponseText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LINK_FETCH_MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

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

ipcMain.handle('links:inspect', (event, url) => inspectLink(url, event.sender.id));

registerFinanceIpc({
  ipcMain,
  getFinanceService,
  publicFinanceSettings,
  updateFinanceProvider,
  updateFinanceRefreshInterval,
  setFinanceBackgroundActivity,
  readFinanceSettings,
  writeFinanceSettings: (settings) => writeJsonFile(getJsonSettingsPath(FINANCE_SETTINGS_FILE), settings),
  isMainWindowSender: (sender) => Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents),
});

ipcMain.handle('smart:organize-material', async (event, payload) => {
  const text = String(payload && payload.text || '').trim();
  const kind = payload && payload.kind === 'note' ? 'note' : 'recording';
  const sourceId = String(payload && payload.sourceId || '').trim().slice(0, 100);
  const sourceRevision = crypto.createHash('sha256').update(`${kind}\0${sourceId}\0${text}`).digest('hex');
  if (!text) return { ok: false, error: 'empty_text' };
  if (text.length > 12000) return { ok: false, error: 'input_too_long', limit: 12000 };
  if (!aiModelService) return { ok: false, error: 'not_configured' };
  return aiModelService.run(event.sender.id, {
    requestId: `legacy-${crypto.randomUUID()}`,
    action: kind === 'note' ? 'nameNote' : 'nameRecording',
    context: { sourceType: kind, sourceId: sourceId || sourceRevision, sourceRevision, text },
    referenceTime: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    categories: {},
  });
});

const WINDOWS_LIST_JXA = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run() {
  const rows = [];
  let candidates = 0;
  let titled = 0;
  const options = $.kCGWindowListOptionAll | $.kCGWindowListExcludeDesktopElements;
  const windowList = ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)
  );
  const appPaths = {};
  for (let index = 0; index < Number(windowList.count); index++) {
    const info = windowList.objectAtIndex(index);
    const get = (key) => ObjC.unwrap(info.objectForKey($(key)));
    const layer = Number(get('kCGWindowLayer'));
    const pid = Number(get('kCGWindowOwnerPID'));
    const appName = String(get('kCGWindowOwnerName') || '').trim();
    const title = String(get('kCGWindowName') || '').replace(/\\s+/g, ' ').trim();
    const windowNumber = Number(get('kCGWindowNumber'));
    // 没有「屏幕录制」权限时 CGWindowList 仍会返回别的应用的窗口，只是 kCGWindowName
    // 一律为空，系统不报任何错。于是下面这句会把所有行丢掉、列表看起来像「真的没窗口」。
    // 统计候选数与其中有标题的条数，好让主进程区分这两种情况。
    if (layer === 0 && pid && appName && windowNumber) {
      candidates += 1;
      if (title) titled += 1;
    }
    if (layer !== 0 || !pid || !appName || !title || !windowNumber) continue;
    if (!Object.prototype.hasOwnProperty.call(appPaths, pid)) {
      const meta = { appPath: '', policy: -1 };
      try {
        const runningApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
        if (runningApp && !runningApp.isNil()) {
          meta.policy = Number(runningApp.activationPolicy);
          if (runningApp.bundleURL && !runningApp.bundleURL.isNil()) {
            meta.appPath = String(ObjC.unwrap(runningApp.bundleURL.path) || '');
          }
        }
      } catch (error) {}
      appPaths[pid] = meta;
    }
    const appMeta = appPaths[pid];
    // activationPolicy 2 = NSApplicationActivationPolicyProhibited：XPC 与系统辅助进程
    // （如 AuthenticationServicesHelper，bundle 是 .xpc 不是 .app）。它们在系统层面就
    // 不能被激活，列出来点了也不会有任何反应，属于纯粹的假窗口。
    // 注意不能用 kCGWindowIsOnscreen 过滤：真实窗口在其他 Space 或被遮挡时该字段也是
    // nil，实测微信 / Arc / Chrome / 飞书都会被误删。
    if (appMeta.policy === 2) continue;
    rows.push({ pid, appName, appPath: appMeta.appPath, title, windowIndex: index, windowNumber });
  }
  // candidates 是本可列出的窗口数，titled 是其中拿到标题的数量。
  // candidates > 0 而 titled === 0 时几乎一定是缺「屏幕录制」权限，不是真的没窗口。
  return JSON.stringify({ rows: rows, candidates: candidates, titled: titled });
}`;

const WINDOW_FOCUS_JXA = `
function run(argv) {
  const pid = Number(argv[0]);
  const wantedTitle = String(argv[1] || '');
  const fallbackIndex = Number(argv[2] || 0);
  const se = Application('System Events');
  const matches = se.applicationProcesses.whose({ unixId: pid })();
  if (!matches.length) return 'false';
  const process = matches[0];
  process.frontmost = true;
  delay(0.08);
  const windows = process.windows();
  let target = windows[fallbackIndex];
  for (let i = 0; i < windows.length; i++) {
    try {
      if (String(windows[i].name()) === wantedTitle) { target = windows[i]; break; }
    } catch (error) {}
  }
  if (target) {
    try { target.actions.byName('AXRaise').perform(); } catch (error) {}
  }
  try {
    const menuBarItems = process.menuBars[0].menuBarItems();
    let windowMenu = null;
    for (let i = 0; i < menuBarItems.length; i++) {
      const name = String(menuBarItems[i].name());
      if (name === 'Window' || name === '窗口') { windowMenu = menuBarItems[i]; break; }
    }
    if (windowMenu) {
      const items = windowMenu.menus[0].menuItems();
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].name()) === wantedTitle) {
          items[i].click();
          break;
        }
      }
    }
  } catch (error) {}
  return 'true';
}`;

function runJxa(script, args = []) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script, '--', ...args.map(String)],
      { timeout: 6000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(String(stdout || '').trim())
    );
  });
}

async function scanCurrentWindows() {
  if (process.platform !== 'darwin') return { items: [], error: 'unsupported' };
  try {
    const raw = await runJxa(WINDOWS_LIST_JXA);
    const parsed = JSON.parse(raw || '{}');
    // 兼容旧格式（裸数组），新格式是 { rows, candidates, titled }。
    const payload = Array.isArray(parsed)
      ? { rows: parsed, candidates: parsed.length, titled: parsed.length }
      : parsed;
    const rows = normalizeWindowRows(payload.rows || []).filter((item) => item.pid !== process.pid);
    // 有候选窗口却一个标题都读不到 = 缺「屏幕录制」权限。macOS 10.15 起读取其他应用的
    // 窗口标题需要该权限，系统不会报错也不会弹提示，只是静默返回空标题，
    // 结果界面上只剩一句「没有读取到可切换窗口」，把权限问题伪装成了「真的没窗口」。
    if (rows.length === 0 && Number(payload.candidates) > 0 && Number(payload.titled) === 0) {
      windowScanCache = new Map();
      return { items: [], error: 'screen_recording_permission_required' };
    }
    const appPaths = [...new Set(rows.map((item) => item.appPath).filter(Boolean))];
    await Promise.all(appPaths.map(async (appPath) => {
      if (windowIconCache.has(appPath)) return;
      const icon = await withTimeout(readWindowAppIcon(appPath), 3500, null);
      windowIconCache.set(appPath, icon);
    }));
    rows.forEach((item) => {
      item.icon = item.appPath ? windowIconCache.get(item.appPath) || null : null;
    });
    windowScanCache = new Map(rows.map((item) => [item.id, item]));
    return { items: rows, error: null };
  } catch (error) {
    windowScanCache = new Map();
    return { items: [], error: 'accessibility_permission_required' };
  }
}

ipcMain.handle('windows:list', async () => {
  return scanCurrentWindows();
});

ipcMain.handle('windows:focus', async (event, windowId) => {
  const target = windowScanCache.get(windowId);
  if (!target || process.platform !== 'darwin') return false;
  try {
    return (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true';
  } catch (error) {
    return false;
  }
});

function taskWindowMatchScore(notification, target) {
  const project = String(notification && notification.project || '').trim().toLocaleLowerCase();
  const title = String(target && target.title || '').trim().toLocaleLowerCase();
  const appName = String(target && target.appName || '').trim().toLocaleLowerCase();
  if (!project || !title) return 0;
  if (title === project) return 100;
  if (title.startsWith(`${project} `) || title.startsWith(`${project} —`) || title.startsWith(`${project} -`)) return 90;
  if (title.includes(project)) return 75;
  if (project.includes(appName) && appName) return 25;
  return 0;
}

async function activateActiveTaskNotification(eventId = null) {
  const notification = taskNotificationWindowState.active();  if (!notification || (eventId && notification.eventId !== eventId) || notification.source === 'todo') return false;
  const result = await scanCurrentWindows();
  const target = (result.items || [])
    .map((item) => ({ item, score: taskWindowMatchScore(notification, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
  if (!target) return false;
  try {
    const focused = (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true';
    if (focused) beginTaskNotificationDismiss();
    return focused;
  } catch (error) {
    return false;
  }
}

ipcMain.handle('task-notification:activate', async (event, eventId) => {
  if (!notificationWindow || notificationWindow.isDestroyed() || event.sender !== notificationWindow.webContents) return false;
  return activateActiveTaskNotification(eventId);
});

// 当前窗口模块仍需要安全读取本机应用图标。
// 优先直接从 .icns 提取内嵌 PNG；失败时通过独立 JXA 进程向 NSWorkspace 取系统图标。
// 不直接调用 app.getFileIcon：它曾在部分 .app 上触发 Electron 内部 FATAL Check，
// 独立进程即使失败也不会带崩主进程。
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// icns 内 PNG 块按"贴近 48px 网格展示"优先：128 → 256 → 64@2x …
const ICNS_PREF = ['ic07', 'ic12', 'ic08', 'ic11', 'ic13', 'ic09', 'ic14', 'ic05', 'ic04'];

function extractPngFromIcns(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'icns') return null;
  const candidates = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const type = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32BE(off + 4);
    if (len < 8 || off + len > buf.length) break;
    const data = buf.subarray(off + 8, off + len);
    if (data.length > 8 && data.subarray(0, 4).equals(PNG_SIG)) {
      candidates.push({ type, data });
    }
    off += len;
  }
  if (!candidates.length) return null; // 老式 RLE 图标 → 交给渲染层首字母兜底
  candidates.sort((a, b) => {
    const ia = ICNS_PREF.indexOf(a.type);
    const ib = ICNS_PREF.indexOf(b.type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return candidates[0].data;
}

async function readEmbeddedAppIcon(appPath) {
  try {
    const resDir = path.join(appPath, 'Contents', 'Resources');
    const files = await fs.promises.readdir(resDir);
    const icns = files.filter((f) => f.toLowerCase().endsWith('.icns'));
    if (!icns.length) return null;
    // 优先 AppIcon.icns，其次名字含 app/icon 的，避免选中文档类型图标
    const score = (n) => {
      const s = n.toLowerCase();
      if (s === 'appicon.icns') return 0;
      if (s.includes('app')) return 1;
      if (s.includes('icon')) return 2;
      return 3;
    };
    icns.sort((a, b) => score(a) - score(b) || a.length - b.length);
    const buf = await fs.promises.readFile(path.join(resDir, icns[0]));
    const png = extractPngFromIcns(buf);
    return png ? `data:image/png;base64,${png.toString('base64')}` : null;
  } catch (e) {
    return null; // 单个应用读不到图标不影响整体
  }
}

const SYSTEM_ICON_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const size = 96;
  const source = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  image.lockFocus;
  source.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSZeroRect,
    $.NSCompositingOperationSourceOver,
    1
  );
  image.unlockFocus;
  const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  return ObjC.unwrap(data.base64EncodedStringWithOptions(0));
}`;

function readSystemAppIconNow(appPath) {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', SYSTEM_ICON_JXA, appPath],
      { timeout: 4000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        const base64 = typeof stdout === 'string' ? stdout.trim() : '';
        if (error || !base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
          resolve(null);
          return;
        }
        resolve(`data:image/png;base64,${base64}`);
      }
    );
  });
}

const SYSTEM_ICON_CONCURRENCY = 2;
const SYSTEM_ICON_QUEUE_TIMEOUT_MS = 10000;
let systemIconActive = 0;
const systemIconQueue = [];

function pumpSystemIconQueue() {
  while (systemIconActive < SYSTEM_ICON_CONCURRENCY && systemIconQueue.length) {
    const job = systemIconQueue.shift();
    if (job.cancelled) continue;
    systemIconActive++;
    readSystemAppIconNow(job.appPath)
      .then(job.finish, () => job.finish(null))
      .finally(() => {
        systemIconActive--;
        pumpSystemIconQueue();
      });
  }
}

function readSystemAppIcon(appPath) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    const job = {
      appPath,
      cancelled: false,
      settled: false,
      timer: null,
      finish(value) {
        if (job.settled) return;
        job.settled = true;
        if (job.timer) clearTimeout(job.timer);
        resolve(value);
      },
    };
    job.timer = setTimeout(() => {
      job.cancelled = true;
      job.finish(null);
    }, SYSTEM_ICON_QUEUE_TIMEOUT_MS);
    systemIconQueue.push(job);
    pumpSystemIconQueue();
  });
}

async function readWindowAppIcon(appPath) {
  const systemIcon = await withTimeout(readSystemAppIcon(appPath), 2800, null);
  return systemIcon || readEmbeddedAppIcon(appPath);
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const FRONTMOST_APP_JXA = `
ObjC.import('AppKit');
function run() {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app) return '{}';
  return JSON.stringify({
    name: ObjC.unwrap(app.localizedName) || '',
    bundleId: ObjC.unwrap(app.bundleIdentifier) || '',
    path: app.bundleURL ? (ObjC.unwrap(app.bundleURL.path) || '') : ''
  });
}`;

const PASTE_TO_APP_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const bundleId = String(argv[0] || '');
  if (!bundleId) return 'missing';
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleId);
  if (!apps || apps.count === 0) return 'missing';
  apps.objectAtIndex(0).activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
  delay(0.18);
  Application('System Events').keystroke('v', { using: 'command down' });
  return 'ok';
}`;

function readFrontmostApp() {
  if (!PLATFORM_CAPABILITIES.automaticPaste) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONTMOST_APP_JXA], { timeout: 2200 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const value = JSON.parse(String(stdout || '').trim());
        resolve(value && value.path ? value : null);
      } catch (parseError) {
        resolve(null);
      }
    });
  });
}

async function rememberPasteTarget() {
  const current = await readFrontmostApp();
  if (current && !['com.github.Electron', 'com.vibecoding.notch-todo', 'com.dynamicpanel.app'].includes(current.bundleId)) {
    previousPasteTarget = current;
  }
  return previousPasteTarget;
}

function getCredentialsVaultPath() {
  return path.join(app.getPath('userData'), CREDENTIALS_VAULT_FILE);
}

function readCredentialsVault() {
  if (!safeStorage.isEncryptionAvailable()) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(getCredentialsVaultPath(), 'utf8'));
    const decoded = safeStorage.decryptString(Buffer.from(String(envelope.payload || ''), 'base64'));
    const rows = JSON.parse(decoded);
    return Array.isArray(rows) ? rows.map((item) => normalizeCredentialInput(item, item && item.id, item && item.createdAt)).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function writeCredentialsVault(rows) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const payload = safeStorage.encryptString(JSON.stringify(rows)).toString('base64');
  const vaultPath = getCredentialsVaultPath();
  const temporaryPath = `${vaultPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, payload }), { mode: 0o600 });
    fs.renameSync(temporaryPath, vaultPath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
    return false;
  }
}

function publicCredential(item) {
  return {
    id: item.id,
    service: item.service,
    account: item.account,
    passwordMask: '**********',
    createdAt: item.createdAt,
  };
}

ipcMain.handle('credentials:list', () => ({
  ok: safeStorage.isEncryptionAvailable(),
  secureStorage: safeStorage.isEncryptionAvailable(),
  items: readCredentialsVault().map(publicCredential),
}));

ipcMain.handle('credentials:get', (event, id) => {
  const item = readCredentialsVault().find((row) => row.id === String(id || ''));
  return item ? { ok: true, item: { ...item } } : { ok: false, error: 'not_found' };
});

ipcMain.handle('credentials:save', (event, payload) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'secure_storage_unavailable' };
  const rows = readCredentialsVault();
  const existing = payload && payload.id ? rows.find((item) => item.id === payload.id) : null;
  const normalized = normalizeCredentialInput(
    existing && !String(payload && payload.password || '') ? { ...payload, password: existing.password } : payload,
    existing ? existing.id : crypto.randomUUID(),
    existing ? existing.createdAt : Date.now()
  );
  if (!normalized) return { ok: false, error: 'invalid_credential' };
  const next = existing
    ? rows.map((item) => item.id === existing.id ? normalized : item)
    : [normalized, ...rows];
  return writeCredentialsVault(next)
    ? { ok: true, item: publicCredential(normalized) }
    : { ok: false, error: 'save_failed' };
});

ipcMain.handle('credentials:delete-many', (event, ids) => {
  const targets = new Set(Array.isArray(ids) ? ids.map(String) : []);
  if (!targets.size) return { ok: true, deleted: 0 };
  const rows = readCredentialsVault();
  const next = rows.filter((item) => !targets.has(item.id));
  if (!writeCredentialsVault(next)) return { ok: false, error: 'save_failed' };
  return { ok: true, deleted: rows.length - next.length };
});

ipcMain.handle('credentials:copy', async (event, payload) => {
  const id = String(payload && payload.id || '');
  const field = payload && payload.field === 'password' ? 'password' : payload && payload.field === 'account' ? 'account' : '';
  if (!id || !field) return false;
  const item = readCredentialsVault().find((row) => row.id === id);
  if (!item) return false;
  const value = item[field];
  await clipboard.writeText(value);
  if (field === 'password') {
    setTimeout(() => {
      void clipboard.readText()
        .then((currentValue) => {
          if (currentValue === value) return clipboard.clear();
          return undefined;
        })
        .catch(() => {});
    }, 60_000).unref?.();
  }
  return true;
});

const homeWeather = require('./home-services').createWeatherService();
const homeMusic = require('./home-media').createMusicLibrary({ filePath: getJsonSettingsPath('music-library.json') });
ipcMain.handle('home:weather-search', (event, query) => homeWeather.search(query));
ipcMain.handle('home:weather', (event, location) => homeWeather.weather(location));
ipcMain.handle('home:music-library', () => homeMusic.list());
ipcMain.handle('home:music-mode', (event, mode) => homeMusic.setMode(mode));
ipcMain.handle('home:music-select-playlist', (event, payload) => homeMusic.selectPlaylist(payload));
ipcMain.handle('home:music-refresh-source', (event, sourceId) => homeMusic.refreshSource(sourceId));
ipcMain.handle('home:music-add-source', (event, payload) => homeMusic.addCatalogSource(payload));
ipcMain.handle('home:music-remove-source', (event, sourceId) => homeMusic.removeCatalogSource(sourceId));
ipcMain.handle('home:music-browse-categories', (event, payload) => homeMusic.browseOnlineCategories(payload));
ipcMain.handle('home:music-search-playlists', (event, payload) => homeMusic.browseOnlineSearch(payload));
ipcMain.handle('home:music-browse-category', (event, payload) => homeMusic.browseOnlineCategory(payload));
ipcMain.handle('home:music-browse-recommend', (event, payload) => homeMusic.browseOnlineRecommend(payload));
ipcMain.handle('home:music-browse-user-playlists', (event, payload) => homeMusic.browseOnlineUserPlaylists(payload));
ipcMain.handle('home:music-select-online-playlist', (event, payload) => homeMusic.browseOnlinePlaylist(payload));
ipcMain.handle('home:music-choose-files', async () => {
  const choice = await showOwnedOpenDialog({
    title: '添加本地音乐', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '音频文件', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'webm'] }],
  });
  if (choice.canceled || !choice.filePaths.length) return { ok: false, error: 'cancelled' };
  return homeMusic.addLocal(choice.filePaths);
});
ipcMain.handle('home:music-choose-folder', async () => {
  const choice = await showOwnedOpenDialog({ title: '添加音乐文件夹', properties: ['openDirectory'] });
  if (choice.canceled || !choice.filePaths.length) return { ok: false, error: 'cancelled' };
  return homeMusic.addFolder(choice.filePaths[0]);
});
ipcMain.handle('home:music-add-network', (event, payload) => homeMusic.addNetwork(payload));
ipcMain.handle('home:music-remove', (event, trackId) => homeMusic.remove(trackId));
ipcMain.handle('home:music-load', (event, trackId) => homeMusic.load(trackId));
ipcMain.handle('home:music-cover', (event, trackId) => homeMusic.loadCover(trackId));

// ============ 百炼实时语音转写 ============
function getTranscriptionSettingsPath() {
  return path.join(app.getPath('userData'), TRANSCRIPTION_SETTINGS_FILE);
}

function readStoredTranscriptionSettings() {
  const currentPath = getTranscriptionSettingsPath();
  const legacyPath = path.join(app.getPath('appData'), 'notch-todo', TRANSCRIPTION_SETTINGS_FILE);
  const readSettings = (settingsPath) => {
    try {
      const value = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  };
  const current = readSettings(currentPath);
  const legacy = currentPath === legacyPath ? {} : readSettings(legacyPath);
  const selected = selectTranscriptionSettings(current, legacy);
  if (!Object.keys(current).length && Object.keys(selected).length && currentPath !== legacyPath) {
    try {
      fs.mkdirSync(path.dirname(currentPath), { recursive: true });
      fs.writeFileSync(currentPath, JSON.stringify(selected), { mode: 0o600 });
    } catch (error) {
      // 迁移失败时仍从旧目录读取，避免已有密钥突然失效。
    }
  }
  return selected;
}

function writeTranscriptionSettings(settings) {
  const settingsPath = getTranscriptionSettingsPath();
  const temporaryPath = `${settingsPath}.tmp`;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(temporaryPath, JSON.stringify(settings), { mode: 0o600 });
  fs.renameSync(temporaryPath, settingsPath);
}

function getAIDiagnosticsPath() {
  return path.join(app.getPath('userData'), AI_DIAGNOSTICS_FILE);
}

function readAIDiagnostics() {
  try {
    const value = JSON.parse(fs.readFileSync(getAIDiagnosticsPath(), 'utf8'));
    return Array.isArray(value) ? value.slice(-50) : [];
  } catch (error) { return []; }
}

function appendAIDiagnostic(entry) {
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
  try { fs.writeFileSync(getAIDiagnosticsPath(), JSON.stringify([...readAIDiagnostics(), diagnostic].slice(-50)), { mode: 0o600 }); }
  catch (error) {}
}

function decryptStoredApiKey(settings) {
  const environmentKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (environmentKey) return environmentKey;
  return decryptStoredSecret(settings.encryptedApiKey).trim();
}

function decryptStoredSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
  } catch (error) {
    return '';
  }
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
  const environmentKey = useEnvironment ? String(process.env.NOTCH_LLM_API_KEY || '').trim() : '';
  return {
    ...profile,
    model: profile.activeModel,
    encryptedApiKey,
    apiKey: environmentKey || decryptStoredSecret(encryptedApiKey).trim(),
    credentialSource: environmentKey ? 'environment' : encryptedApiKey ? 'stored' : 'none',
  };
}

function resolveLlmConfig() {
  const settings = readStoredTranscriptionSettings();
  const content = normalizeContentProfiles(settings);
  return resolveContentProfile(settings, content.activeProviderId, true);
}

function resolveTranscriptionConfig() {
  const settings = readStoredTranscriptionSettings();
  const stored = normalizeTranscriptionService(settings, TRANSCRIPTION_MODEL);
  const environmentWorkspace = String(process.env.DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE || '').trim();
  const environmentRegion = String(process.env.DASHSCOPE_REGION || '').trim().toLowerCase();
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

function publicTranscriptionConfig() {
  const config = resolveTranscriptionConfig();
  const llmConfig = resolveLlmConfig();
  const settings = readStoredTranscriptionSettings();
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
    asrCredentialSource: process.env.DASHSCOPE_API_KEY ? 'environment' : config.apiKey ? 'stored' : 'none',
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
  return `wss://${host}/api-ws/v1/realtime?model=${encodeURIComponent(config.model || TRANSCRIPTION_MODEL)}&heartbeat=true`;
}

function transcriptionEventId() {
  return `event_${crypto.randomUUID().replace(/-/g, '')}`;
}

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

ipcMain.handle('ai:run', (event, payload) => aiModelService.run(event.sender.id, payload));
ipcMain.handle('ai:cancel', (event, requestId) => aiModelService.cancel(event.sender.id, requestId));

function persistProviderVerification(slot, result, capabilities = null, expectedRevision = '') {
  const settings = readStoredTranscriptionSettings();
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
  writeTranscriptionSettings({
    ...settings,
    schemaVersion: 3,
    verification,
  });
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

ipcMain.handle('ai:test-provider', async (event, payload) => {
  const slot = payload?.slot === 'transcription' ? 'transcription' : 'content';
  if (slot === 'transcription') {
    const expectedRevision = providerVerificationRevision(slot, resolveTranscriptionConfig());
    const result = await testTranscriptionProvider();
    try {
      if (!persistProviderVerification(slot, result, result.capabilities, expectedRevision)) return { ok: false, error: 'stale_context' };
    } catch (error) {}
    return result;
  }
  const expectedRevision = providerVerificationRevision(slot, resolveLlmConfig());
  const referenceTime = new Date().toISOString();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const textResult = await aiModelService.run(event.sender.id, {
    requestId: `connection-text-${crypto.randomUUID()}`,
    action: 'summarize',
    context: { sourceType: 'manual', sourceId: '', sourceRevision: '', text: '连接测试：请只回复“已连接”。' },
    referenceTime,
    timeZone,
    categories: {},
  });
  if (!textResult.ok) {
    try {
      if (!persistProviderVerification(slot, textResult, null, expectedRevision)) return { ok: false, error: 'stale_context' };
    } catch (error) {}
    return textResult;
  }
  const structuredResult = await aiModelService.run(event.sender.id, {
    requestId: `connection-json-${crypto.randomUUID()}`,
    action: 'nameLink',
    context: { sourceType: 'link', sourceId: 'connection-test', sourceRevision: '', text: 'URL: https://example.com\n网页标题: Example' },
    referenceTime,
    timeZone,
    categories: {},
  });
  const result = structuredResult.ok
    ? { ok: true, capabilities: { text: true, stream: true, structuredJson: true }, promptVersion: structuredResult.promptVersion }
    : { ...structuredResult, error: 'structured_output_unsupported', providerError: structuredResult.error };
  try {
    if (!persistProviderVerification(slot, result, result.capabilities, expectedRevision)) return { ok: false, error: 'stale_context' };
  } catch (error) {}
  return result;
});

ipcMain.handle('ai:get-diagnostics', () => ({ ok: true, items: readAIDiagnostics() }));
ipcMain.handle('ai:clear-diagnostics', () => {
  try { fs.rmSync(getAIDiagnosticsPath(), { force: true }); return { ok: true }; }
  catch (error) { return { ok: false, error: 'clear_failed' }; }
});
ipcMain.handle('ai:ack-migration', () => {
  try { writeTranscriptionSettings({ ...readStoredTranscriptionSettings(), schemaVersion: 3, aiSettingsVersion: 2 }); return { ok: true, ...publicTranscriptionConfig() }; }
  catch (error) { return { ok: false, error: 'save_failed' }; }
});

ipcMain.handle('transcription:get-config', () => publicTranscriptionConfig());

ipcMain.handle('transcription:set-config', (event, payload) => {
  const previous = readStoredTranscriptionSettings();
  const previousContentState = normalizeContentProfiles(previous);
  const previousActiveContent = resolveLlmConfig();
  const region = payload?.region === 'singapore' ? 'singapore' : 'beijing';
  const workspaceId = String(payload?.workspaceId || '').trim();
  const apiKey = String(payload?.apiKey || '').trim();
  const llmApiKey = String(payload?.llmApiKey || '').trim();
  const removeAsr = payload?.removeAsr === true;
  const removeContent = payload?.removeContent === true;
  const llmProviderId = String(payload?.llmProviderId || previousContentState.activeProviderId);
  if (!PROVIDERS[llmProviderId]) return { ok: false, error: 'invalid_provider' };
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
  const contentConfigured = Boolean(process.env.NOTCH_LLM_API_KEY || decryptStoredSecret(selectedEncryptedLlmKey));
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
    ? Object.keys(contentProfiles).find((providerId) => PROVIDERS[providerId]) || llmProviderId
    : removeContent ? previousContentState.activeProviderId : llmProviderId;
  if (!PROVIDERS[activeProviderId]) activeProviderId = 'deepseek';
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
    model: TRANSCRIPTION_MODEL,
    region,
    workspaceId,
  };
  const verification = { ...(previous.verification || {}) };
  const previousTranscription = resolveTranscriptionConfig();
  const transcriptionChanged = apiKey || removeAsr || transcriptionConfigRevision(previousTranscription) !== transcriptionConfigRevision(transcriptionConfig);
  if (transcriptionChanged) delete verification.transcription;
  const activeContentChanged = llmApiKey || removeContent
    || contentConfigRevision(previousActiveContent) !== contentConfigRevision({ ...activeProfile, model: activeProfile.activeModel });
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
    writeTranscriptionSettings(next);
    aiContextGeneration += 1;
    aiModelService?.cancelAll();
    if (transcriptionChanged) {
      transcriptionService.closeAll();
    }
    return { ok: true, ...publicTranscriptionConfig() };
  } catch (error) {
    return { ok: false, error: 'save_failed' };
  }
});

ipcMain.handle('transcription:start', (event) => transcriptionService.start(event.sender.id, event.sender));
ipcMain.on('transcription:audio', (event, bytes) => transcriptionService.sendAudio(event.sender.id, bytes));
ipcMain.handle('transcription:finish', (event) => transcriptionService.finish(event.sender.id));

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

ipcMain.handle('recordings:save', (event, payload) => saveRecording(payload));
ipcMain.handle('recordings:read', (event, audioPath) => readRecording(audioPath));
ipcMain.handle('recordings:delete', (event, audioPath) => deleteRecording(audioPath));

ipcMain.handle('recordings:reveal', (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  shell.showItemInFolder(safePath);
  return true;
});

// ============ 笔记图片 ============

ipcMain.handle('notes:save-image', async (event, payload) => (
  persistNoteImage(payload && payload.noteId, payload && payload.bytes)
));

ipcMain.handle('notes:choose-images', async (event, noteId) => {
  if (!validNoteId(noteId)) return { ok: false, error: 'invalid_note', images: [] };
  const result = await showOwnedOpenDialog({
    title: '添加图片到笔记',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (result.canceled) return { ok: true, canceled: true, images: [] };
  const images = [];
  for (const filePath of (result.filePaths || []).slice(0, 12)) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > NOTE_IMAGE_MAX_BYTES) continue;
      const saved = await persistNoteImage(noteId, await fs.promises.readFile(filePath));
      if (saved.ok) images.push({ ...saved, name: path.parse(filePath).name.slice(0, 80) });
    } catch (error) {}
  }
  return images.length
    ? { ok: true, canceled: false, images }
    : { ok: false, error: 'no_valid_images', images: [] };
});

ipcMain.handle('notes:read-image', async (event, imagePath) => {
  const safePath = getSafeNoteImagePath(imagePath);
  if (!safePath) return null;
  try {
    const stat = await fs.promises.stat(safePath);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return null;
    const buffer = await fs.promises.readFile(safePath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    return null;
  }
});

ipcMain.handle('notes:delete-images', async (event, noteId) => {
  const directory = getNoteImageDirectory(noteId);
  if (!directory) return false;
  try {
    const root = path.resolve(getNoteImagesDir());
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== root) return false;
    const rootStat = await fs.promises.lstat(root);
    const stat = await fs.promises.lstat(resolved);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()
      || stat.isSymbolicLink() || !stat.isDirectory()) return false;
    await fs.promises.rm(resolved, { recursive: true, force: true });
    return true;
  } catch (error) {
    return error && error.code === 'ENOENT';
  }
});

// ============ 剪贴板历史 ============

function setHoverSpaceShortcut(enabled) {
  if (enabled === spaceShortcutRegistered) return;
  if (!enabled) {
    if (globalShortcut.isRegistered('Space')) globalShortcut.unregister('Space');
    spaceShortcutRegistered = false;
    return;
  }
  try {
    const ok = globalShortcut.register('Space', async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // 展开动作后的极短窗口内，全局 Space 还未来得及注销；这时也要把第二次
      // Space 作为收起处理，避免快速连按被吞掉。
      if (currentMode === 'expanded') {
        mainWindow.webContents.send('shortcut:toggle-panel');
        return;
      }
      await rememberPasteTarget();
      hideWhenCollapsed = false;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('shortcut:toggle-panel');
    });
    spaceShortcutRegistered = ok && globalShortcut.isRegistered('Space');
  } catch (error) {
    spaceShortcutRegistered = false;
  }
}

function startHoverSpaceShortcut() {
  const policy = hoverSpacePollingPolicy({
    shortcut: configuredShortcut,
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    mode: currentMode,
  });
  if (!policy.enabled) return;
  if (spaceShortcutTimer) return;
  spaceShortcutTimer = setInterval(() => {
    const currentPolicy = hoverSpacePollingPolicy({
      shortcut: configuredShortcut,
      visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
      mode: currentMode,
    });
    if (!currentPolicy.enabled) {
      stopHoverSpaceShortcut();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const bounds = getBoundsForMode('collapsed');
    const hovering = point.x >= bounds.x && point.x < bounds.x + bounds.width
      && point.y >= bounds.y && point.y < bounds.y + bounds.height;
    setHoverSpaceShortcut(hovering);
  }, policy.intervalMs);
}

function stopHoverSpaceShortcut() {
  if (spaceShortcutTimer) clearInterval(spaceShortcutTimer);
  spaceShortcutTimer = null;
  setHoverSpaceShortcut(false);
}

function syncHoverSpacePolling() {
  const policy = hoverSpacePollingPolicy({
    shortcut: configuredShortcut,
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    mode: currentMode,
  });
  if (policy.enabled) startHoverSpaceShortcut();
  else stopHoverSpaceShortcut();
}

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

ipcMain.handle('shortcut:hover-space-status', () => ({
  registered: spaceShortcutRegistered && globalShortcut.isRegistered('Space'),
  mode: currentMode,
  cursor: screen.getCursorScreenPoint(),
  bounds: mainWindow && !mainWindow.isDestroyed() ? getBoundsForMode(currentMode) : null,
}));

// 渲染层请求把图片文件读成 dataURL 回显（contextIsolation 下 file:// 受限，走 IPC 读盘）
ipcMain.handle('clipboard:readImage', async (event, imagePath) => {
  const safePath = getSafeClipImagePath(imagePath);
  if (!safePath) return null; // 只允许读自己的图片目录
  try {
    const buf = await fs.promises.readFile(safePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

// FIFO 淘汰 / 删除 / 清空时，连带删除本地图片文件（文件 I/O 归主进程）
ipcMain.handle('clipboard:deleteImages', async (event, paths) => {
  if (!Array.isArray(paths)) return;
  for (const p of paths) {
    const safePath = getSafeClipImagePath(p);
    if (safePath) {
      try {
        await fs.promises.unlink(safePath);
      } catch (e) {
        // 文件已不存在等，静默
      }
    }
  }
});

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

function pasteToPreviousApp(target) {
  return new Promise((resolve) => {
    const bundleId = String(target?.bundleId || '');
    if (!bundleId) return resolve(false);
    execFile('/usr/bin/osascript', [
      '-l', 'JavaScript', '-e', PASTE_TO_APP_JXA, bundleId,
    ], { timeout: 3000 }, (error, stdout) => {
      resolve(!error && String(stdout || '').trim() === 'ok');
    });
  });
}

ipcMain.handle('clipboard:write', (event, entry) => writeClipboardEntry(entry));

// 点击历史项后先收起灵动岛，再回到打开面板前的应用执行粘贴。
// 若系统尚未授予辅助功能权限，内容仍保留在系统剪贴板作为可靠降级。
ipcMain.handle('clipboard:paste', async (event, entry) => {
  if (!await writeClipboardEntry(entry)) return { ok: false, pasted: false };
  if (!PLATFORM_CAPABILITIES.automaticPaste) return { ok: true, pasted: false };
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
    return { ok: true, pasted: false, permissionRequired: true };
  }
  const target = previousPasteTarget;
  requestRendererCollapse();
  await waitForCollapsedPanel();
  const pasted = await pasteToPreviousApp(target);
  return { ok: true, pasted };
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
        notificationWindow.setBounds(getTaskNotificationBounds());
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
  clearFinanceBackgroundTimer();
  isQuitting = true;
  hideWhenCollapsed = false;
});

app.on('will-quit', () => {
  cancelCollapseWatchdog();
  clearTodoReminderTimer();
  stopHoverSpaceShortcut();
  stopDisplayFollowPolling();
  clearTaskNotificationTimers();
  stopTaskNotificationServer();
  closeAllTranscriptionSessions();
  globalShortcut.unregisterAll();
  stopClipboardPolling();
});
