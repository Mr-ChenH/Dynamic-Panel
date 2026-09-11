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
const { resolveLaunchPath } = require('./launcher/paths');
const launcherFocus = require('./launcher/focus').createFocusService();
const launcherApplications = require('./launcher/application-actions').createApplicationActions({readShortcut:file=>shell.readShortcutLink(file),owner:()=>mainWindow&&!mainWindow.isDestroyed()?mainWindow.getNativeWindowHandle().readBigUInt64LE(0):null});
const PLATFORM_CAPABILITIES = platformPolicy.capabilities(process.platform);
const {
  validNoteId,
  parseNoteImageReference,
  isPrivateAddress,
  extractPageTitle,
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
  controlSodaMusic,
  sodaShortcutSpec,
  selectTranscriptionSettings,
  createWorkspacePersistenceGate,
  hoverSpacePollingPolicy,
  collapsedDisplayFollowPolicy,
  reduceClipboardObservation,
  normalizeDefaultTabPreference,
  updateDefaultTabPreference,
  createForegroundMediaPermissionCoordinator,
} = require('./main-services');

// Keep the historical data directory so upgrading users retain notes, links,
// recordings and encrypted settings after the public product rename.
const LEGACY_USER_DATA_PATH = path.join(app.getPath('appData'), 'Dynamic Panel');
app.setName('TO-DO Panel');
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
const CREDENTIALS_VAULT_FILE = 'credentials.vault.json';
const APP_SETTINGS_FILE = 'app-settings.json';
const WORKSPACE_SETTINGS_FILE = 'workspace-settings.json';
const WORKSPACE_DATA_FILE = 'workspace.json';
const workspacePersistenceGate = createWorkspacePersistenceGate();
const SODA_MUSIC_APP = '/Applications/汽水音乐.app';
const TRANSCRIPTION_MODEL = 'qwen3-asr-flash-realtime';
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const TRANSCRIPTION_FINISH_TIMEOUT_MS = 7000;
const RECORDING_MAX_BYTES = 200 * 1024 * 1024;
const LINK_FETCH_TIMEOUT_MS = 8000;
const LINK_FETCH_MAX_BYTES = 512 * 1024;
const LINK_FETCH_MAX_REDIRECTS = 3;

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
let sodaMusicPlaying = false;
const mediaPermissionCoordinator = createForegroundMediaPermissionCoordinator();

let notificationWindow = null;
let notificationWindowReady = false;
let notificationServer = null;
let notificationServerAvailable = false;
let activeTaskNotification = null;
let taskNotificationLeaving = false;
let taskNotificationTimer = null;
let taskNotificationFallbackTimer = null;
let taskNotificationTimerStartedAt = 0;
let taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
let taskNotificationPaused = false;
const taskNotificationQueue = [];
const recentTaskNotifications = new Map();
const taskCompletionHistory = [];
let todoReminderTimer = null;
let scheduledTodoReminders = [];

let clipPollTimer = null;
let clipBaselineTimer = null;
let clipPollingEnabled = false;
let clipPolling = false; // 互斥锁：大图 toPNG 同步耗时，防止上一轮未完成又进入
let clipObservationState = { textFingerprint: null, imageFingerprint: null };
let lastClipImageProbeAt = 0;
let clipPollingGeneration = 0;
let spaceShortcutTimer = null;
let spaceShortcutRegistered = false;
let windowsCollapsedHovering = false;
let displayFollowTimer = null;
let configuredShortcut = '';
let configuredLauncherShortcut = '';
let launcherService;
let launcherManaging = false;
let previousPasteTarget = null;
let windowScanCache = new Map();
const windowIconCache = new Map();
const transcriptionSessions = new Map();
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

// 多屏适配：定位到"鼠标当前所在屏"的物理顶端居中
// 这样接上外接屏后，无论副屏在主屏的左/右/上/下，刘海都跟着用户视线走
function getTargetDisplay() {
  try {
    const cursor = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursor);
  } catch (e) {
    return screen.getPrimaryDisplay();
  }
}

// 窗口当前所在屏：模式切换 / Tab 变形必须锚定在这块屏上。
// 若跟随光标（getTargetDisplay），失焦收起瞬间会把刘海"瞬移"到光标所在的另一块屏。
function getWindowDisplay() {
  try {
    if (mainWindow) return screen.getDisplayMatching(mainWindow.getBounds());
  } catch (e) {
    // fallthrough
  }
  return getTargetDisplay();
}

function getCenteredBounds(width, height, display) {
  const d = display || getTargetDisplay();
  const area = process.platform === 'win32' ? d.workArea : d.bounds;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y,
    width,
    height,
  };
}

// macOS 菜单栏会拦截其高度带内的所有鼠标点击（即使窗口绘制在其上方），
// 刘海屏机型菜单栏高约 37pt，等于物理刘海高度。
function getMenuBarHeight(display) {
  return Math.max(0, display.workArea.y - display.bounds.y);
}

function getCollapsedHeight(display) {
  if (process.platform === 'win32') return COLLAPSED_MIN_HEIGHT;
  const mb = getMenuBarHeight(display);
  // 折叠条高度恰好等于菜单栏带（≈物理刘海高），一个像素都不超出物理刘海。
  // 无刘海的外接屏 menuBarHeight 仍是真实菜单栏高，能正常露头；
  // 异常取到 0 才回退兜底（COLLAPSED_MIN_HEIGHT = 38px）。
  return mb > 0 ? mb : COLLAPSED_MIN_HEIGHT;
}

// 展开尺寸按当前 Tab 取值；宽度超出屏幕时 clamp 到工作区内。
// 窗口从屏幕最顶垂下（y=0），内容直接顶到最上沿，高度不含菜单栏带。
function getExpandedSize(display) {
  const size = TAB_SIZES[currentTab] || TAB_SIZES.home;
  return {
    width: Math.min(size.width, display.workArea.width - SCREEN_MARGIN),
    height: Math.min(
      EXPANDED_CHROME_Y + size.panelHeight,
      Math.max(getCollapsedHeight(display), display.bounds.height - SCREEN_MARGIN)
    ),
  };
}

// display 不传时锚定窗口当前所在屏；只有"召唤"类动作（启动/重新居中/显示）才传光标屏。
// 一律瞬时 setBounds：系统动画 resize 会持续重绘 web 内容（卡顿）。
// 原生窗口只提供透明画布，用户可见的岛体形变交给渲染层 CSS。
function getBoundsForMode(mode, display) {
  const d = display || getWindowDisplay();
  if (mode === 'launcher') {
    const area = process.platform === 'win32' ? d.workArea : d.bounds;
    const canvas = process.platform === 'win32' ? platformPolicy.panelBounds('win32', d, true) : { width: area.width - 24, height: area.height - 24 };
    const width = Math.max(1, Math.min(640, canvas.width));
    return { x: Math.round(area.x + (area.width - width) / 2), y: area.y, width, height: Math.max(1, Math.min(520, canvas.height)) };
  }
  if (process.platform === 'win32') return platformPolicy.panelBounds(process.platform, d, mode === 'expanded');
  if (mode === 'expanded') {
    const { width, height } = getExpandedSize(d);
    return getCenteredBounds(width, height, d);
  }
  return getCenteredBounds(COLLAPSED_WIDTH, getCollapsedHeight(d), d);
}

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
function repositionWindow(display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  applyWindowGeometry(currentMode, display);
}

function applyWindowGeometry(mode, display) {
  if (process.platform !== 'win32') {
    mainWindow.setBounds(getBoundsForMode(mode, display));
    return;
  }
  const layout = platformPolicy.windowsPanelLayout(
    display || getWindowDisplay(),
    mode === 'expanded',
    mode === 'collapsed' && windowsCollapsedHovering
  );
  const current = mainWindow.getBounds();
  if (['x', 'y', 'width', 'height'].some((key) => current[key] !== layout.bounds[key])) {
    mainWindow.setBounds(layout.bounds, false);
  }
  if (mode === 'launcher') {
    const launcherBounds = getBoundsForMode('launcher', display);
    mainWindow.setShape([{ x: Math.round((layout.bounds.width - launcherBounds.width) / 2), y: 0, width: launcherBounds.width, height: launcherBounds.height }]);
  } else mainWindow.setShape(layout.shape);
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

function pickTaskNotificationValue(payload, keys) {
  for (const key of keys) {
    const value = payload[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value);
    }
  }
  return '';
}

function cleanTaskNotificationText(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const firstLine = String(value)
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  const cleaned = firstLine
    .replace(/^[#>*`_~\-\s]+/, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(cleaned);
  return characters.length > maxLength ? characters.slice(0, maxLength).join('') : cleaned;
}

function isSubagentNotification(payload) {
  const agentType = pickTaskNotificationValue(payload, [
    'agent_type',
    'agent-type',
    'agentType',
  ]).toLowerCase();
  const hookEvent = pickTaskNotificationValue(payload, [
    'hook_event_name',
    'hook-event-name',
    'hookEventName',
  ]).toLowerCase();
  // Claude Code 的 agent_type 存的是子代理名（Explore / security-reviewer 等），
  // 不含 subagent 字样，只有身处子代理时才带 agent_id，故以该字段存在为准。
  const agentId = pickTaskNotificationValue(payload, ['agent_id', 'agent-id', 'agentId']);
  return Boolean(agentId)
    || hookEvent.includes('subagent')
    || agentType.includes('subagent')
    || payload.is_subagent === true
    || payload.isSubagent === true;
}

function normalizeTaskNotification(payload, source) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (isSubagentNotification(payload)) return null;
  const identity = taskNotificationIdentity(payload, source);

  const taskId = cleanTaskNotificationText(
    pickTaskNotificationValue(payload, [
      'turn_id',
      'turn-id',
      'turnId',
      'thread_id',
      'thread-id',
      'threadId',
      'session_id',
      'session-id',
      'sessionId',
      'task_id',
      'task-id',
      'taskId',
      'id',
    ]),
    160
  );

  const completedAtValue = Number(
    pickTaskNotificationValue(payload, ['completed_at', 'completed-at', 'completedAt'])
  );
  const completedAt = Number.isFinite(completedAtValue) && completedAtValue > 0
    ? completedAtValue
    : Date.now();

  return {
    eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    source,
    taskId,
    title: identity.title,
    project: identity.project,
    completedAt,
  };
}

function getPendingTaskNotificationCount() {
  return taskNotificationQueue.reduce(
    (total, item) => total + (item.summaryCount || 1),
    0
  );
}

function sendTaskNotificationQueueCount() {
  if (
    !notificationWindow ||
    notificationWindow.isDestroyed() ||
    !notificationWindowReady ||
    !activeTaskNotification
  ) {
    return;
  }
  notificationWindow.webContents.send(
    'task-notification:queue',
    getPendingTaskNotificationCount()
  );
}

function enqueueTaskNotification(notification) {
  if (!notification) return 'ignored';
  const now = Date.now();
  for (const [key, seenAt] of recentTaskNotifications) {
    if (now - seenAt > TASK_NOTIFICATION_DEDUPE_MS) recentTaskNotifications.delete(key);
  }

  const identity = notification.taskId || `${notification.title}:${notification.project}`;
  const dedupeKey = `${notification.source}:${identity}`;
  const lastSeenAt = recentTaskNotifications.get(dedupeKey);
  if (lastSeenAt && now - lastSeenAt <= TASK_NOTIFICATION_DEDUPE_MS) return 'duplicate';
  recentTaskNotifications.set(dedupeKey, now);

  if (notification.source !== 'todo') {
    taskCompletionHistory.unshift(notification);
    if (taskCompletionHistory.length > 20) taskCompletionHistory.length = 20;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completion:new', notification);
    }
  }

  if (taskNotificationQueue.length < TASK_NOTIFICATION_MAX_QUEUE) {
    taskNotificationQueue.push(notification);
  } else {
    const lastIndex = taskNotificationQueue.length - 1;
    const previous = taskNotificationQueue[lastIndex];
    const summaryCount = previous.isSummary ? previous.summaryCount + 1 : 2;
    taskNotificationQueue[lastIndex] = {
      ...notification,
      source: 'task',
      taskId: '',
      title: `另有 ${summaryCount} 个任务已完成`,
      project: '',
      isSummary: true,
      summaryCount,
    };
  }

  if (activeTaskNotification) {
    sendTaskNotificationQueueCount();
  } else {
    showNextTaskNotification();
  }
  return 'queued';
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

function recoverClosedTaskNotificationWindow(targetWindow) {
  if (notificationWindow !== targetWindow) return;
  const interruptedNotification = activeTaskNotification;
  clearTaskNotificationTimers();
  notificationWindow = null;
  notificationWindowReady = false;
  activeTaskNotification = null;
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  if (!isQuitting && interruptedNotification) {
    taskNotificationQueue.unshift(interruptedNotification);
  }
  if (!isQuitting) setTimeout(showNextTaskNotification, 80);
}

function createTaskNotificationWindow() {
  if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow;
  const bounds = getTaskNotificationBounds();
  notificationWindowReady = false;
  notificationWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
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
      backgroundThrottling: false,
    },
  });

  installLocalWebContentsGuards(notificationWindow.webContents);

  const targetWindow = notificationWindow;
  notificationWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  if (process.platform === 'darwin') notificationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notificationWindow.setIgnoreMouseEvents(false);
  notificationWindow.loadFile(path.join(__dirname, 'renderer', 'notification.html'));

  targetWindow.webContents.once('did-finish-load', () => {
    if (notificationWindow !== targetWindow || targetWindow.isDestroyed()) return;
    notificationWindowReady = true;
    showNextTaskNotification();
  });

  targetWindow.webContents.on('render-process-gone', () => {
    if (!targetWindow.isDestroyed()) targetWindow.destroy();
  });
  targetWindow.on('closed', () => {
    recoverClosedTaskNotificationWindow(targetWindow);
  });
  return notificationWindow;
}

function clearTaskNotificationTimers() {
  if (taskNotificationTimer) {
    clearTimeout(taskNotificationTimer);
    taskNotificationTimer = null;
  }
  if (taskNotificationFallbackTimer) {
    clearTimeout(taskNotificationFallbackTimer);
    taskNotificationFallbackTimer = null;
  }
}

function scheduleTaskNotificationDismiss() {
  if (!activeTaskNotification || taskNotificationLeaving || taskNotificationPaused) return;
  if (taskNotificationTimer) clearTimeout(taskNotificationTimer);
  taskNotificationTimerStartedAt = Date.now();
  taskNotificationTimer = setTimeout(
    beginTaskNotificationDismiss,
    Math.max(0, taskNotificationRemainingMs)
  );
}

function setTaskNotificationPaused(paused) {
  if (!activeTaskNotification || taskNotificationLeaving || taskNotificationPaused === paused) return;
  taskNotificationPaused = paused;
  if (paused) {
    if (taskNotificationTimer) {
      taskNotificationRemainingMs = Math.max(
        0,
        taskNotificationRemainingMs - (Date.now() - taskNotificationTimerStartedAt)
      );
      clearTimeout(taskNotificationTimer);
      taskNotificationTimer = null;
    }
  } else {
    scheduleTaskNotificationDismiss();
  }
}

function showNextTaskNotification() {
  if (activeTaskNotification || taskNotificationQueue.length === 0 || isQuitting) return;
  const targetWindow = createTaskNotificationWindow();
  if (!notificationWindowReady || !targetWindow || targetWindow.isDestroyed()) return;

  activeTaskNotification = taskNotificationQueue.shift();
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  targetWindow.setBounds(getTaskNotificationBounds(getTargetDisplay()));
  targetWindow.showInactive();
  targetWindow.webContents.send('task-notification:show', {
    ...activeTaskNotification,
    pendingCount: getPendingTaskNotificationCount(),
    visibleMs: TASK_NOTIFICATION_VISIBLE_MS,
  });
  scheduleTaskNotificationDismiss();
}

function beginTaskNotificationDismiss() {
  if (!activeTaskNotification || taskNotificationLeaving) return;
  taskNotificationLeaving = true;
  clearTaskNotificationTimers();
  const eventId = activeTaskNotification.eventId;
  if (notificationWindow && !notificationWindow.isDestroyed() && notificationWindowReady) {
    notificationWindow.webContents.send('task-notification:hide', eventId);
  }
  taskNotificationFallbackTimer = setTimeout(
    () => finishTaskNotification(eventId),
    TASK_NOTIFICATION_LEAVE_MS + 120
  );
}

function finishTaskNotification(eventId) {
  if (!activeTaskNotification || activeTaskNotification.eventId !== eventId) return;
  clearTaskNotificationTimers();
  const completedWindow = notificationWindow;
  if (completedWindow && !completedWindow.isDestroyed()) completedWindow.hide();
  activeTaskNotification = null;
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  setTimeout(() => {
    showNextTaskNotification();
    const policy = taskNotificationWindowPolicy({
      active: Boolean(activeTaskNotification),
      queueLength: taskNotificationQueue.length,
    });
    if (
      policy === 'dispose'
      && notificationWindow === completedWindow
      && completedWindow
      && !completedWindow.isDestroyed()
    ) {
      completedWindow.destroy();
    }
  }, 80);
}

function sendTaskNotificationResponse(response, statusCode, body) {
  if (response.headersSent) return;
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  response.end(json);
}

function startTaskNotificationServer() {
  if (notificationServer) return;
  const server = http.createServer((request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url || '/', `http://${TASK_NOTIFICATION_HOST}`);
    } catch (error) {
      sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_url' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendTaskNotificationResponse(response, 200, { ok: true });
      return;
    }

    const sourceMatch = /^\/notify\/([a-z0-9-]{1,32})$/i.exec(requestUrl.pathname);
    const requestedSource = sourceMatch ? sourceMatch[1].toLowerCase() : '';
    const source = TASK_NOTIFICATION_SOURCES.has(requestedSource) ? requestedSource : null;
    if (request.method !== 'POST' || !source) {
      sendTaskNotificationResponse(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    const contentType = String(request.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      sendTaskNotificationResponse(response, 415, {
        ok: false,
        error: 'application_json_required',
      });
      return;
    }

    const chunks = [];
    let bodyLength = 0;
    let bodyTooLarge = false;
    request.on('data', (chunk) => {
      bodyLength += chunk.length;
      if (bodyLength > TASK_NOTIFICATION_BODY_LIMIT) {
        bodyTooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!bodyTooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (bodyTooLarge) {
        sendTaskNotificationResponse(response, 413, { ok: false, error: 'body_too_large' });
        return;
      }
      let payload;
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (error) {
        sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_json' });
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_payload' });
        return;
      }
      const result = enqueueTaskNotification(normalizeTaskNotification(payload, source));
      sendTaskNotificationResponse(response, 202, { ok: true, result });
    });
    request.on('error', () => {
      if (!response.headersSent) sendTaskNotificationResponse(response, 400, { ok: false });
    });
  });
  notificationServer = server;

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.once('listening', () => {
    if (notificationServer !== server) return;
    notificationServerAvailable = true;
    refreshTrayMenu();
  });
  server.on('error', (error) => {
    if (notificationServer === server) notificationServer = null;
    notificationServerAvailable = false;
    refreshTrayMenu();
    console.warn(`Task notification server unavailable: ${error.message}`);
  });
  server.listen(TASK_NOTIFICATION_PORT, TASK_NOTIFICATION_HOST);
}

function stopTaskNotificationServer() {
  const server = notificationServer;
  notificationServer = null;
  notificationServerAvailable = false;
  if (server) server.close();
}

ipcMain.on('task-notification:hover', (event, paused) => {
  if (
    notificationWindow &&
    !notificationWindow.isDestroyed() &&
    event.sender === notificationWindow.webContents
  ) {
    setTaskNotificationPaused(paused === true);
  }
});

ipcMain.on('task-notification:dismissed', (event, eventId) => {
  if (
    notificationWindow &&
    !notificationWindow.isDestroyed() &&
    event.sender === notificationWindow.webContents &&
    typeof eventId === 'string'
  ) {
    finishTaskNotification(eventId);
  }
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

  // 失焦时让渲染层走完整退场动画，再由渲染层请求缩小原生窗口。
  mainWindow.on('blur', () => {
    if (mediaPermissionRequests > 0 || transientSystemInteractionRequests > 0 || launcherManaging) return;
    if (currentMode === 'launcher') { mainWindow.webContents.send('launcher:close'); return; }
    requestRendererCollapse();
  });

  mainWindow.on('show', () => {
    syncHoverSpacePolling();
    syncDisplayFollowPolling();
  });
  mainWindow.on('hide', () => {
    syncHoverSpacePolling();
    syncDisplayFollowPolling();
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    applyMode('collapsed');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    cancelCollapseWatchdog();
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
  return {
    features,
    shortcut: isValidPanelShortcut(stored.shortcut) ? stored.shortcut : 'Space',
    defaultTab: normalizeDefaultTabPreference(stored.defaultTab, features),
  };
}

function publicAppSettings() {
  return { ...readAppSettings(), autoLaunch: isAutoLaunchEnabled() };
}

function saveAppSettings(settings) {
  return writeJsonFile(getJsonSettingsPath(APP_SETTINGS_FILE), settings);
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
  const result = await showOwnedOpenDialog({
    title: '选择 TO-DO Panel 数据文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  const selected = !result.canceled && result.filePaths && result.filePaths[0];
  if (!selected) return false;
  const previousRoot = workspaceRoot();
  copyWorkspaceAssets(previousRoot, selected);
  if (!writeJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE), { path: selected })) return false;
  aiContextGeneration += 1;
  aiModelService?.cancelAll();
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME, NOTE_IMAGES_DIR_NAME]) {
    try { fs.mkdirSync(path.join(selected, directory), { recursive: true }); } catch (error) {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed', { path: selected });
  refreshTrayMenu();
  return true;
}

function applyFeatureServices(features) {
  const policy = clipboardServicePolicy(features);
  if (policy.recordHistory) startClipboardPolling();
  else stopClipboardPolling();
}

function isValidPanelShortcut(shortcut) {
  if (shortcut === 'Space') return true;
  if (typeof shortcut !== 'string' || shortcut.length > 80) return false;
  const tokens = shortcut.split('+');
  if (tokens.length < 2) return false;
  const key = tokens.pop();
  const modifiers = new Set(['CommandOrControl', 'Command', 'Control', 'Alt', 'Option', 'Shift']);
  return tokens.length > 0
    && tokens.every((token) => modifiers.has(token))
    && /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key);
}

function setPanelShortcut(shortcut) {
  if (!isValidPanelShortcut(shortcut)) return false;
  const previousShortcut = configuredShortcut || 'Space';
  stopHoverSpaceShortcut();
  if (configuredShortcut && configuredShortcut !== 'Space' && globalShortcut.isRegistered(configuredShortcut)) {
    globalShortcut.unregister(configuredShortcut);
  }
  if (shortcut === 'Space') {
    configuredShortcut = shortcut;
    startHoverSpaceShortcut();
    return true;
  }
  let registered = false;
  try {
    registered = globalShortcut.register(shortcut, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      hideWhenCollapsed = false;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('shortcut:toggle-panel');
    });
  } catch (error) {}
  if (registered) {
    configuredShortcut = shortcut;
    return true;
  }
  configuredShortcut = previousShortcut;
  startHoverSpaceShortcut();
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
function setLauncherShortcut(shortcut = launcherConfig().shortcut) {
  if (shortcut === configuredLauncherShortcut) return true;
  if (shortcut && (!isValidPanelShortcut(shortcut) || shortcut === 'Space')) return false;
  if (shortcut) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcut, () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        launcherFocus.capture({keepWhenOwned:currentMode==='launcher'});
        hideWhenCollapsed = false;
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('shortcut:toggle-launcher');
      });
    } catch {}
    if (!registered) return false;
  }
  if (configuredLauncherShortcut) globalShortcut.unregister(configuredLauncherShortcut);
  configuredLauncherShortcut = shortcut;
  return true;
}
function getLauncherService() {
  if (!launcherService) launcherService = createLauncherService({ dataRoot: app.getPath('userData'), executable: process.execPath, getSettings: launcherConfig });
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
  if (!setPanelShortcut(settings.shortcut)) {
    settings.shortcut = 'Space';
    saveAppSettings(settings);
    setPanelShortcut('Space');
  }
  setLauncherShortcut();
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
  const featureLabels = { todo: '待办', notes: '笔记', links: '链接', recordings: '录制', credentials: '密钥', clip: '剪贴板' };
  const menu = Menu.buildFromTemplate([
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
          title: '关于 TO-DO Panel',
          message: 'TO-DO Panel',
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
  tray.setToolTip('TO-DO Panel');
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
ipcMain.handle('settings:set-auto-launch', (event, enabled) => {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
  if (!setAutoLaunch(enabled)) return { ok: false, error: 'save_failed', autoLaunch: isAutoLaunchEnabled() };
  const settings = publicAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  return { ok: true, autoLaunch: settings.autoLaunch };
});
ipcMain.handle('settings:set-shortcut', (event, accelerator) => {
  if (!isValidPanelShortcut(accelerator)) return { ok: false, error: 'invalid' };
  if (!setPanelShortcut(accelerator)) return { ok: false, error: 'occupied' };
  const next = readAppSettings();
  next.shortcut = accelerator;
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
  refreshTrayMenu();
  return { ok: true, shortcut: accelerator };
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
ipcMain.handle('window:set-tab', (event, tab) => {
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

ipcMain.handle('tasks:recent', () => taskCompletionHistory);

// 快捷链接：URL 走外部浏览器（仅 http/https），本地路径走系统打开（仅绝对路径）
ipcMain.handle('shell:openExternal', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
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
    message: `TO-DO Panel 需要「${names.join('」和「')}」权限`,
    detail: [
      '缺少这些权限时，「当前窗口」会读不到任何窗口，汽水音乐的播放控制也不会生效。',
      '',
      '授权后需要重新启动 TO-DO Panel 才会生效。',
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
  // 否则用户打开设置面板可能找不到 TO-DO Panel 这一项、只能手动拖进去。
  if (missing.includes('accessibility')) systemPreferences.isTrustedAccessibilityClient(true);
  shell.openExternal(PRIVACY_SETTINGS_PANES[missing[0]]);
}

async function validatePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return null;
  }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) return null;
  return url;
}

async function resolvePinnedAIEndpoint(value) {
  let url;
  try { url = new URL(value); } catch (error) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
  let addresses;
  try { addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true }); }
  catch (error) { return null; }
  const publicAddresses = addresses.filter((item) => !isPrivateAddress(item.address));
  if (!publicAddresses.length || publicAddresses.length !== addresses.length) return null;
  return { url: url.toString(), address: publicAddresses[0].address, family: publicAddresses[0].family };
}

function fetchPinnedAIEndpoint(endpoint, options = {}) {
  if (!endpoint || typeof endpoint !== 'object' || !endpoint.url || !endpoint.address) return fetch(String(endpoint || ''), options);
  const url = new URL(endpoint.url);
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers,
      servername: url.hostname,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address: endpoint.address, family: endpoint.family }]);
        else callback(null, endpoint.address, endpoint.family);
      },
    }, (response) => {
      const headers = { get: (name) => response.headers[String(name || '').toLowerCase()] || null };
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 0, headers, body: Readable.toWeb(response) });
    });
    request.once('error', reject);
    const onAbort = () => request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (options.signal) {
      if (options.signal.aborted) { onAbort(); return; }
      options.signal.addEventListener('abort', onAbort, { once: true });
      request.once('close', () => options.signal.removeEventListener('abort', onAbort));
    }
    if (options.body) request.write(options.body);
    request.end();
  });
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

async function fetchFaviconDataUrl(pageUrl, html) {
  let candidate;
  try {
    const href = extractFaviconHref(html) || '/favicon.ico';
    candidate = await validatePublicHttpUrl(new URL(href, pageUrl).toString());
  } catch (error) {
    candidate = null;
  }
  if (!candidate) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(candidate, { signal: controller.signal, redirect: 'error' });
    const type = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 160 * 1024) return '';
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch (error) {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichLinkMetadata(url, title, ownerId = 'link-metadata') {
  const settings = readStoredTranscriptionSettings();
  const config = resolveLlmConfig();
  if (settings.autoOrganizeLinks !== true || !config.apiKey || !config.model || !aiModelService) return { title, category: '' };
  const sourceText = `URL: ${url}\n网页标题: ${title}`;
  const result = await aiModelService.run(ownerId, {
    requestId: `link-${crypto.randomUUID()}`,
    action: 'nameLink',
    context: { sourceType: 'link', sourceId: url, sourceRevision: crypto.createHash('sha256').update(`link\0${url}\0${sourceText}`).digest('hex'), sourceTitle: title, text: sourceText },
    referenceTime: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    categories: {},
  });
  return result?.ok ? { title: result.title || title, category: result.category || '' } : { title, category: '' };
}

async function inspectLink(rawUrl, ownerId) {
  let current = await validatePublicHttpUrl(rawUrl);
  if (!current) return { ok: false, error: 'invalid_or_private_url' };
  for (let redirectCount = 0; redirectCount <= LINK_FETCH_MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
          'User-Agent': 'DynamicPanel/0.3 (+local bookmark metadata)',
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      // URL 已经过公网与协议校验；正文不可读不应阻止收藏，仍尝试抓站点根图标。
      const icon = await fetchFaviconDataUrl(current.toString(), '');
      return {
        ok: true,
        url: current.toString(),
        title: '未命名',
        category: '',
        icon,
        warning: error && error.name === 'AbortError' ? 'timeout' : 'fetch_failed',
      };
    }
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount >= LINK_FETCH_MAX_REDIRECTS) {
        return { ok: false, error: 'too_many_redirects' };
      }
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      if (!current) return { ok: false, error: 'unsafe_redirect' };
      continue;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const fallback = current.hostname.replace(/^www\./, '');
    if (!response.ok || (!contentType.includes('text/html') && !contentType.includes('xhtml'))) {
      const [smart, icon] = await Promise.all([
        enrichLinkMetadata(current.toString(), fallback, ownerId),
        fetchFaviconDataUrl(current.toString(), ''),
      ]);
      return { ok: true, url: current.toString(), title: smart.title || '未命名', category: smart.category, icon };
    }
    const html = await readResponseText(response);
    const pageTitle = extractPageTitle(html, fallback);
    const [smart, icon] = await Promise.all([
      enrichLinkMetadata(current.toString(), pageTitle, ownerId),
      fetchFaviconDataUrl(current.toString(), html),
    ]);
    return { ok: true, url: current.toString(), title: smart.title, category: smart.category, icon };
  }
  return { ok: false, error: 'too_many_redirects' };
}

ipcMain.handle('links:inspect', (event, url) => inspectLink(url, event.sender.id));

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
  const notification = activeTaskNotification;
  if (!notification || (eventId && notification.eventId !== eventId) || notification.source === 'todo') return false;
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

function sodaMusicRunning() {
  return new Promise((resolve) => {
    execFile('/usr/bin/pgrep', ['-f', '^/Applications/汽水音乐\\.app/Contents/MacOS/汽水音乐$'], { timeout: 1500 }, (error) => resolve(!error));
  });
}

function launchSodaMusic() {
  return new Promise((resolve) => {
    const cleanEnvironment = { ...process.env };
    delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
    cleanEnvironment.XPC_SERVICE_NAME = '0';
    execFile(
      '/usr/bin/open',
      [SODA_MUSIC_APP],
      { timeout: 4000, env: cleanEnvironment },
      (error) => resolve(!error)
    );
  });
}

const SODA_SHORTCUT_JXA = `
function run(argv) {
  const keyCode = Number(argv[0]);
  const usesCommand = String(argv[1] || '') === '1';
  const dismissOverlays = String(argv[2] || '') === '1';
  const processes = Application('System Events').applicationProcesses.whose({ bundleIdentifier: 'com.soda.music' })();
  if (!processes.length) return 'missing';
  processes[0].frontmost = true;
  delay(0.35);
  const systemEvents = Application('System Events');
  if (!Number.isFinite(keyCode)) return 'invalid';
  if (dismissOverlays) {
    systemEvents.keyCode(53);
    delay(0.15);
  }
  if (usesCommand) systemEvents.keyCode(keyCode, { using: 'command down' });
  else systemEvents.keyCode(keyCode);
  return 'ok';
}`;

async function sendSodaShortcut(action) {
  if (process.platform !== 'darwin') return { ok: false, error: 'unsupported' };
  if (!systemPreferences.isTrustedAccessibilityClient(true)) {
    return { ok: false, error: 'accessibility_permission_required' };
  }
  const shortcut = sodaShortcutSpec(action);
  if (!shortcut) return { ok: false, error: 'invalid_action' };
  try {
    const result = await runJxa(SODA_SHORTCUT_JXA, [
      shortcut.keyCode,
      shortcut.command ? '1' : '0',
      shortcut.dismissOverlays ? '1' : '0',
    ]);
    return result === 'ok' ? { ok: true } : { ok: false, error: 'soda_control_failed' };
  } catch (error) {
    console.warn('[music] failed to send Soda Music shortcut', error && error.message || error);
    return { ok: false, error: 'soda_control_failed' };
  }
}

ipcMain.handle('music:status', async () => {
  const installed = fs.existsSync(SODA_MUSIC_APP);
  const running = installed ? await sodaMusicRunning() : false;
  if (!running) sodaMusicPlaying = false;
  return {
    installed,
    running,
    sessionActive: running,
    playing: running && sodaMusicPlaying,
    title: '',
    artist: '',
    icon: installed ? await readSystemAppIconNow(SODA_MUSIC_APP) : null,
  };
});

ipcMain.handle('music:control', async (event, action) => {
  if (process.platform !== 'darwin') return { ok: false, error: 'unsupported' };
  if (!fs.existsSync(SODA_MUSIC_APP)) return { ok: false, error: 'not_installed' };
  const result = await controlSodaMusic(action, {
    isRunning: sodaMusicRunning,
    launch: launchSodaMusic,
    sendShortcut: sendSodaShortcut,
  }, sodaMusicPlaying);
  if (result && result.ok) sodaMusicPlaying = result.playing;
  if (result && result.ok && mainWindow && !mainWindow.isDestroyed() && currentMode === 'expanded') {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  return result;
});

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
  fs.mkdirSync(path.dirname(getTranscriptionSettingsPath()), { recursive: true });
  fs.writeFileSync(getTranscriptionSettingsPath(), JSON.stringify(settings), { mode: 0o600 });
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
  let provider = 'unknown';
  try { provider = new URL(config.baseUrl).hostname; } catch (error) {}
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

function resolveLlmConfig() {
  const settings = readStoredTranscriptionSettings();
  return {
    apiKey: String(process.env.NOTCH_LLM_API_KEY || decryptStoredSecret(settings.encryptedLlmApiKey)).trim(),
    baseUrl: String(settings.llmBaseUrl || 'https://api.deepseek.com').trim(),
    model: String(settings.llmModel || 'deepseek-v4-flash').trim(),
    timeoutMs: Math.max(10000, Math.min(60000, Number(settings.llmTimeoutMs) || 30000)),
    kind: (() => {
      try { return new URL(String(settings.llmBaseUrl || 'https://api.deepseek.com')).hostname === 'api.deepseek.com' ? 'deepseek' : 'compatible'; }
      catch (error) { return 'compatible'; }
    })(),
  };
}

function resolveTranscriptionConfig() {
  const settings = readStoredTranscriptionSettings();
  const environmentWorkspace = String(process.env.DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE || '').trim();
  const environmentRegion = String(process.env.DASHSCOPE_REGION || '').trim().toLowerCase();
  const region = ['beijing', 'singapore'].includes(environmentRegion)
    ? environmentRegion
    : ['beijing', 'singapore'].includes(settings.region) ? settings.region : 'beijing';
  const workspaceId = (environmentWorkspace || String(settings.workspaceId || '').trim()).slice(0, 128);
  return {
    apiKey: decryptStoredApiKey(settings),
    workspaceId: /^[A-Za-z0-9_-]{0,128}$/.test(workspaceId) ? workspaceId : '',
    region,
  };
}

function publicTranscriptionConfig() {
  const config = resolveTranscriptionConfig();
  const llmConfig = resolveLlmConfig();
  const settings = readStoredTranscriptionSettings();
  return {
    configured: Boolean(config.apiKey),
    asrNeedsReentry: Boolean(settings.encryptedApiKey && !config.apiKey),
    workspaceId: config.workspaceId,
    region: config.region,
    provider: 'qwen3-asr-flash-realtime',
    secureStorage: safeStorage.isEncryptionAvailable(),
    llmConfigured: Boolean(llmConfig.apiKey),
    llmNeedsReentry: Boolean(settings.encryptedLlmApiKey && !llmConfig.apiKey),
    llmBaseUrl: String(settings.llmBaseUrl || 'https://api.deepseek.com'),
    llmModel: String(settings.llmModel || 'deepseek-v4-flash'),
    llmTimeoutMs: Math.max(10000, Math.min(60000, Number(settings.llmTimeoutMs) || 30000)),
    autoNameNotes: settings.autoNameNotes === true,
    autoNameRecordings: settings.autoNameRecordings === true,
    autoOrganizeLinks: settings.autoOrganizeLinks === true,
    aiMigrationNoticePending: Object.keys(settings).length > 0 && settings.aiSettingsVersion !== 1,
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
  return `wss://${host}/api-ws/v1/realtime?model=${TRANSCRIPTION_MODEL}&heartbeat=true`;
}

function transcriptionEventId() {
  return `event_${crypto.randomUUID().replace(/-/g, '')}`;
}

function emitTranscription(session, payload) {
  if (session.sender && !session.sender.isDestroyed()) {
    session.sender.send('transcription:event', payload);
  }
}

function sessionTranscript(session) {
  return [...session.finalSegments, session.interim].filter(Boolean).join(' ').trim();
}

function closeTranscriptionSession(session, result = {}) {
  if (!session || session.closed) return;
  session.closed = true;
  clearTimeout(session.connectTimer);
  clearTimeout(session.finishTimer);
  transcriptionSessions.delete(session.senderId);
  try { session.socket.close(); } catch (error) {}
  if (session.finishResolve) {
    session.finishResolve({
      ok: result.ok !== false,
      transcript: sessionTranscript(session),
      error: result.error || null,
    });
    session.finishResolve = null;
  }
}

function handleTranscriptionMessage(session, raw) {
  let message;
  try { message = JSON.parse(String(raw)); } catch (error) { return; }
  if (message.type === 'session.created' || message.type === 'session.updated') {
    emitTranscription(session, { type: 'status', status: 'connected' });
    return;
  }
  if (message.type === 'conversation.item.input_audio_transcription.text') {
    session.interim = `${String(message.text || '').trim()}${String(message.stash || '').trim()}`;
    emitTranscription(session, {
      type: 'transcript',
      final: session.finalSegments.join(' ').trim(),
      interim: session.interim,
    });
    return;
  }
  if (message.type === 'conversation.item.input_audio_transcription.completed') {
    const transcript = String(message.transcript || '').trim();
    if (transcript && session.finalSegments[session.finalSegments.length - 1] !== transcript) {
      session.finalSegments.push(transcript);
    }
    session.interim = '';
    emitTranscription(session, {
      type: 'transcript',
      final: session.finalSegments.join(' ').trim(),
      interim: '',
    });
    return;
  }
  if (message.type === 'error' || message.type === 'conversation.item.input_audio_transcription.failed') {
    const details = message.error && message.error.message || '实时转写服务返回错误';
    emitTranscription(session, { type: 'error', message: details });
    session.lastError = details;
    return;
  }
  if (message.type === 'session.finished') {
    closeTranscriptionSession(session, { ok: !session.lastError, error: session.lastError });
  }
}

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
ipcMain.handle('ai:test-provider', async (event) => {
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
  if (!textResult.ok) return textResult;
  const structuredResult = await aiModelService.run(event.sender.id, {
    requestId: `connection-json-${crypto.randomUUID()}`,
    action: 'nameLink',
    context: { sourceType: 'link', sourceId: 'connection-test', sourceRevision: '', text: 'URL: https://example.com\n网页标题: Example' },
    referenceTime,
    timeZone,
    categories: {},
  });
  if (!structuredResult.ok) return { ...structuredResult, error: 'structured_output_unsupported', providerError: structuredResult.error };
  return { ok: true, capabilities: { text: true, structuredJson: true }, promptVersion: structuredResult.promptVersion };
});

ipcMain.handle('ai:get-diagnostics', () => ({ ok: true, items: readAIDiagnostics() }));
ipcMain.handle('ai:clear-diagnostics', () => {
  try { fs.rmSync(getAIDiagnosticsPath(), { force: true }); return { ok: true }; }
  catch (error) { return { ok: false, error: 'clear_failed' }; }
});
ipcMain.handle('ai:ack-migration', () => {
  try { writeTranscriptionSettings({ ...readStoredTranscriptionSettings(), aiSettingsVersion: 1 }); return { ok: true, ...publicTranscriptionConfig() }; }
  catch (error) { return { ok: false, error: 'save_failed' }; }
});

ipcMain.handle('transcription:get-config', () => publicTranscriptionConfig());

ipcMain.handle('transcription:set-config', (event, payload) => {
  const previous = readStoredTranscriptionSettings();
  const region = payload && payload.region === 'singapore' ? 'singapore' : 'beijing';
  const workspaceId = String(payload && payload.workspaceId || '').trim();
  const apiKey = String(payload && payload.apiKey || '').trim();
  const llmApiKey = String(payload && payload.llmApiKey || '').trim();
  const llmBaseUrl = String(payload && payload.llmBaseUrl || previous.llmBaseUrl || 'https://api.deepseek.com').trim();
  const llmModel = String(payload && payload.llmModel || previous.llmModel || 'deepseek-v4-flash').replace(/\s+/g, ' ').trim().slice(0, 120);
  const llmTimeoutMs = Math.max(10000, Math.min(60000, Number(payload && payload.llmTimeoutMs) || Number(previous.llmTimeoutMs) || 30000));
  if (workspaceId && !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) {
    return { ok: false, error: 'invalid_workspace' };
  }
  let parsedLlmUrl;
  try { parsedLlmUrl = new URL(llmBaseUrl); } catch (error) { parsedLlmUrl = null; }
  if (!parsedLlmUrl || parsedLlmUrl.protocol !== 'https:' || parsedLlmUrl.username || parsedLlmUrl.password) {
    return { ok: false, error: 'invalid_llm_url' };
  }
  if ((apiKey || llmApiKey) && !safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'secure_storage_unavailable' };
  }
  const next = {
    ...previous,
    region,
    workspaceId,
    encryptedApiKey: apiKey
      ? safeStorage.encryptString(apiKey).toString('base64')
      : String(previous.encryptedApiKey || ''),
    llmBaseUrl: parsedLlmUrl.toString().replace(/\/$/, ''),
    llmModel,
    llmTimeoutMs,
    autoNameNotes: payload && payload.autoNameNotes === true,
    autoNameRecordings: payload && payload.autoNameRecordings === true,
    autoOrganizeLinks: payload && payload.autoOrganizeLinks === true,
    aiSettingsVersion: 1,
    encryptedLlmApiKey: llmApiKey
      ? safeStorage.encryptString(llmApiKey).toString('base64')
      : String(previous.encryptedLlmApiKey || ''),
  };
  try {
    writeTranscriptionSettings(next);
    aiContextGeneration += 1;
    aiModelService?.cancelAll();
    return { ok: true, ...publicTranscriptionConfig() };
  } catch (error) {
    return { ok: false, error: 'save_failed' };
  }
});

ipcMain.handle('transcription:start', (event) => {
  const config = resolveTranscriptionConfig();
  if (!config.apiKey) return { ok: false, error: 'not_configured' };
  const existing = transcriptionSessions.get(event.sender.id);
  if (existing) closeTranscriptionSession(existing, { ok: false, error: 'replaced' });
  return new Promise((resolve) => {
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
      'User-Agent': 'DynamicPanel/0.3',
    };
    if (config.workspaceId) headers['X-DashScope-WorkSpace'] = config.workspaceId;
    const socket = new WebSocket(transcriptionUrl(config), { headers });
    const session = {
      sender: event.sender,
      senderId: event.sender.id,
      socket,
      finalSegments: [],
      interim: '',
      ready: false,
      closed: false,
      startSettled: false,
      finishResolve: null,
      connectTimer: null,
      finishTimer: null,
      lastError: '',
    };
    transcriptionSessions.set(event.sender.id, session);
    const settleStart = (result) => {
      if (session.startSettled) return;
      session.startSettled = true;
      clearTimeout(session.connectTimer);
      resolve(result);
    };
    session.connectTimer = setTimeout(() => {
      settleStart({ ok: false, error: 'connect_timeout' });
      closeTranscriptionSession(session, { ok: false, error: 'connect_timeout' });
    }, 8000);
    socket.on('open', () => {
      session.ready = true;
      socket.send(JSON.stringify({
        event_id: transcriptionEventId(),
        type: 'session.update',
        session: {
          input_audio_format: 'pcm',
          sample_rate: TRANSCRIPTION_SAMPLE_RATE,
          input_audio_transcription: { language: 'zh' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0,
            silence_duration_ms: 400,
          },
        },
      }));
      settleStart({ ok: true });
    });
    socket.on('message', (data) => handleTranscriptionMessage(session, data));
    socket.on('error', (error) => {
      const message = String(error && error.message || 'connection_failed');
      emitTranscription(session, { type: 'error', message });
      settleStart({ ok: false, error: 'connection_failed' });
      closeTranscriptionSession(session, { ok: false, error: message });
    });
    socket.on('close', () => {
      settleStart({ ok: false, error: 'connection_closed' });
      closeTranscriptionSession(session, { ok: !session.lastError, error: session.lastError || null });
    });
  });
});

ipcMain.on('transcription:audio', (event, bytes) => {
  const session = transcriptionSessions.get(event.sender.id);
  if (!session || !session.ready || session.closed || session.socket.readyState !== WebSocket.OPEN) return;
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
  if (!buffer.length || buffer.length > 512 * 1024) return;
  session.socket.send(JSON.stringify({
    event_id: transcriptionEventId(),
    type: 'input_audio_buffer.append',
    audio: buffer.toString('base64'),
  }));
});

ipcMain.handle('transcription:finish', (event) => {
  const session = transcriptionSessions.get(event.sender.id);
  if (!session || session.closed) return { ok: false, error: 'not_active', transcript: '' };
  if (session.finishResolve) return { ok: false, error: 'already_finishing', transcript: sessionTranscript(session) };
  return new Promise((resolve) => {
    session.finishResolve = resolve;
    session.finishTimer = setTimeout(() => {
      closeTranscriptionSession(session, { ok: false, error: 'finish_timeout' });
    }, TRANSCRIPTION_FINISH_TIMEOUT_MS);
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ event_id: transcriptionEventId(), type: 'session.finish' }));
    } else {
      closeTranscriptionSession(session, { ok: false, error: 'connection_closed' });
    }
  });
});

function closeAllTranscriptionSessions() {
  for (const session of transcriptionSessions.values()) {
    closeTranscriptionSession(session, { ok: false, error: 'app_quit' });
  }
}

// ============ 录音资料库 ============
function getRecordingsDir() {
  return workspacePath(RECORDINGS_DIR_NAME);
}

function ensureRecordingsDir() {
  try {
    fs.mkdirSync(getRecordingsDir(), { recursive: true });
  } catch (error) {
    // 目录不可用时由保存 IPC 返回失败。
  }
}

function getSafeRecordingPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const directory = path.resolve(getRecordingsDir());
  const resolvedPath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot(), value);
  if (path.dirname(resolvedPath) !== directory) return null;
  if (!/^recording-[a-z0-9-]+\.(webm|m4a|ogg|wav)$/i.test(path.basename(resolvedPath))) {
    return null;
  }
  try {
    const directoryStat = fs.lstatSync(directory);
    const fileStat = fs.lstatSync(resolvedPath);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolvedPath;
  } catch (error) {
    return null;
  }
}

ipcMain.handle('recordings:save', async (event, payload) => {
  if (!payload || !payload.bytes) return { ok: false, error: 'empty_audio' };
  let buffer;
  try {
    buffer = Buffer.from(payload.bytes);
  } catch (error) {
    return { ok: false, error: 'invalid_audio' };
  }
  if (!buffer.length || buffer.length > RECORDING_MAX_BYTES) {
    return { ok: false, error: buffer.length ? 'audio_too_large' : 'empty_audio' };
  }
  ensureRecordingsDir();
  const mimeType = String(payload.mimeType || 'audio/webm').slice(0, 80);
  const extension = recordingExtension(mimeType);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const audioPath = path.join(getRecordingsDir(), `recording-${id}.${extension}`);
  try {
    await fs.promises.writeFile(audioPath, buffer, { flag: 'wx' });
    return { ok: true, audioPath: platformPolicy.portableMediaPath(RECORDINGS_DIR_NAME, audioPath), mimeType };
  } catch (error) {
    return { ok: false, error: 'write_failed' };
  }
});

ipcMain.handle('recordings:read', async (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return null;
  try {
    const bytes = await fs.promises.readFile(safePath);
    const extension = path.extname(safePath).slice(1).toLowerCase();
    const mimeType = extension === 'm4a' ? 'audio/mp4' : `audio/${extension || 'webm'}`;
    return { bytes, mimeType };
  } catch (error) {
    return null;
  }
});

ipcMain.handle('recordings:delete', async (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  try {
    await fs.promises.unlink(safePath);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('recordings:reveal', (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  shell.showItemInFolder(safePath);
  return true;
});

// ============ 笔记图片 ============

function getNoteImagesDir() {
  return workspacePath(NOTE_IMAGES_DIR_NAME);
}

function getNoteImageDirectory(noteId) {
  return validNoteId(noteId) ? path.join(getNoteImagesDir(), String(noteId)) : null;
}

function portableNoteImagePath(filePath) {
  return path.relative(workspaceRoot(), filePath).split(path.sep).join('/');
}

function getSafeNoteImagePath(imagePath) {
  if (typeof imagePath !== 'string' || path.isAbsolute(imagePath)) return null;
  const reference = parseNoteImageReference(imagePath);
  if (!reference) return null;
  const root = path.resolve(getNoteImagesDir());
  const resolved = path.resolve(workspaceRoot(), reference.relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  try {
    const rootStat = fs.lstatSync(root);
    const noteDirStat = fs.lstatSync(path.dirname(resolved));
    const fileStat = fs.lstatSync(resolved);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    if (noteDirStat.isSymbolicLink() || !noteDirStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolved;
  } catch (error) {
    return null;
  }
}

async function persistNoteImage(noteId, bytes) {
  if (!validNoteId(noteId)) return { ok: false, error: 'invalid_note' };
  let buffer;
  try {
    buffer = Buffer.from(bytes || []);
  } catch (error) {
    return { ok: false, error: 'invalid_image' };
  }
  if (!buffer.length || buffer.length > NOTE_IMAGE_MAX_BYTES) return { ok: false, error: 'invalid_image' };
  const source = nativeImage.createFromBuffer(buffer);
  if (source.isEmpty()) return { ok: false, error: 'invalid_image' };
  const size = source.getSize();
  if (!size.width || !size.height || size.width * size.height > 80_000_000) {
    return { ok: false, error: 'image_too_large' };
  }
  const scale = Math.min(1, NOTE_IMAGE_MAX_EDGE / Math.max(size.width, size.height));
  const output = scale < 1
    ? source.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best',
    }).toPNG()
    : source.toPNG();
  if (!output.length) return { ok: false, error: 'invalid_image' };
  const directory = getNoteImageDirectory(noteId);
  const filePath = path.join(directory, `image-${crypto.randomUUID()}.png`);
  try {
    await fs.promises.mkdir(directory, { recursive: true });
    const rootStat = await fs.promises.lstat(getNoteImagesDir());
    const directoryStat = await fs.promises.lstat(directory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()
      || directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      return { ok: false, error: 'unsafe_directory' };
    }
    await fs.promises.writeFile(filePath, output, { flag: 'wx' });
    return {
      ok: true,
      imagePath: portableNoteImagePath(filePath),
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    };
  } catch (error) {
    return { ok: false, error: 'save_failed' };
  }
}

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

function getClipImagesDir() {
  return workspacePath(CLIP_IMAGES_DIR_NAME);
}

// 图片记录使用扁平目录和固定文件名。拒绝子目录、符号链接和非普通文件，
// 避免 localStorage 被篡改后通过 ../ 或 symlink 读写目录外文件。
function getSafeClipImagePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  const dir = path.resolve(getClipImagesDir());
  const resolvedPath = path.isAbsolute(p)
    ? path.resolve(p)
    : path.resolve(workspaceRoot(), p);
  if (path.dirname(resolvedPath) !== dir) return null;
  if (!/^clip-[a-z0-9]+\.png$/i.test(path.basename(resolvedPath))) return null;
  try {
    const dirStat = fs.lstatSync(dir);
    const fileStat = fs.lstatSync(resolvedPath);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolvedPath;
  } catch (e) {
    return null;
  }
}

function ensureClipImagesDir() {
  try {
    fs.mkdirSync(getClipImagesDir(), { recursive: true });
  } catch (e) {
    // 目录已存在或无权限，静默
  }
}

async function readSystemClipboard(includeImage = false) {
  try {
    const items = await clipboard.read();
    const observation = await readClipboardObservation(items, { includeImage });
    let image = null;
    if (observation.image?.buffer) {
      const native = nativeImage.createFromBuffer(observation.image.buffer);
      if (!native.isEmpty()) {
        const size = native.getSize();
        image = prepareClipboardImagePayload(
          observation.image.mimeType,
          observation.image.buffer,
          size
        );
      }
    }
    return { concealed: observation.concealed, text: observation.text, image };
  } catch (error) {
    return { concealed: false, text: '', image: null };
  }
}

async function baselineCurrentClipboard(generation) {
  try {
    const observation = await readSystemClipboard(true);
    if (!clipPollingEnabled || generation !== clipPollingGeneration) return;
    if (observation.concealed) {
      clipObservationState = reduceClipboardObservation(
        {},
        { concealed: true },
        { baseline: true }
      ).state;
      return;
    }
    clipObservationState = reduceClipboardObservation(
      {},
      { text: observation.text, imageFingerprint: observation.image?.fingerprint || null },
      { baseline: true }
    ).state;
    lastClipImageProbeAt = Date.now();
  } catch (error) {
    clipObservationState = { textFingerprint: null, imageFingerprint: null };
  }
}

async function pollClipboard() {
  if (!clipPollingEnabled || !mainWindow) return;
  if (clipPolling) return;
  clipPolling = true;
  try {
    const now = Date.now();
    const includeImage = now - lastClipImageProbeAt >= CLIP_IMAGE_POLL_INTERVAL_MS;
    const observation = await readSystemClipboard(includeImage);
    if (!clipPollingEnabled) return;
    // 密码管理器写入的敏感内容：跳过不记录、不更新指纹
    if (observation.concealed) return;

    // 优先读文字
    const text = observation.text;
    if (text) {
      const decision = reduceClipboardObservation(clipObservationState, { text });
      clipObservationState = decision.state;
      if (decision.record && clipPollingEnabled) {
        const type = /^https?:\/\//i.test(text.trim()) ? 'url' : 'text';
        mainWindow.webContents.send('clipboard:new-entry', { type, text, imagePath: null });
      }
      return;
    }

    // 文字为空再读图片
    if (!text && includeImage) {
      lastClipImageProbeAt = now;
      const result = observation.image;
      const decision = reduceClipboardObservation(clipObservationState, {
        text: '',
        imageFingerprint: result?.fingerprint || null,
      });
      clipObservationState = decision.state;
      if (result && decision.record && clipPollingEnabled) {
        const pngBuf = result.pngBuffer
          || nativeImage.createFromBuffer(result.sourceBuffer).toPNG();
        if (!pngBuf.length) return;
        ensureClipImagesDir();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const fileName = 'clip-' + id + '.png';
        const imagePath = path.join(getClipImagesDir(), fileName);
        try {
          await fs.promises.writeFile(imagePath, pngBuf);
        } catch (e) {
          return; // 写盘失败不记录
        }
        if (!clipPollingEnabled) {
          try { await fs.promises.unlink(imagePath); } catch (error) {}
          return;
        }
        mainWindow.webContents.send('clipboard:new-entry', {
          type: 'image',
          text: null,
          imagePath: platformPolicy.portableMediaPath(CLIP_IMAGES_DIR_NAME, imagePath),
        });
      }
    }
  } catch (e) {
    // 轮询任何异常不能崩主进程，静默
  } finally {
    clipPolling = false;
  }
}

function startClipboardPolling() {
  // Electron 没有 NSPasteboard.changeCount，只能内容轮询：靠文本本身与
  // 图片 PNG 内容哈希指纹去重（见 pollClipboard）。
  if (clipPollingEnabled) return;
  clipPollingEnabled = true;
  const generation = ++clipPollingGeneration;
  // 首次开启只建立当前系统剪贴板基线，不把开启前的内容写入历史。
  clipBaselineTimer = setTimeout(() => {
    clipBaselineTimer = null;
    if (!clipPollingEnabled) return;
    void baselineCurrentClipboard(generation).finally(() => {
      if (clipPollingEnabled && generation === clipPollingGeneration && !clipPollTimer) {
        clipPollTimer = setInterval(pollClipboard, CLIP_POLL_INTERVAL_MS);
      }
    });
  }, 0);
}

function stopClipboardPolling() {
  clipPollingEnabled = false;
  clipPollingGeneration += 1;
  if (clipBaselineTimer) {
    clearTimeout(clipBaselineTimer);
    clipBaselineTimer = null;
  }
  if (clipPollTimer) {
    clearInterval(clipPollTimer);
    clipPollTimer = null;
  }
  clipObservationState = { textFingerprint: null, imageFingerprint: null };
  lastClipImageProbeAt = 0;
}

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

async function writeClipboardEntry(entry) {
  if (!entry) return false;
  try {
    const safeImagePath =
      entry.type === 'image' ? getSafeClipImagePath(entry.imagePath) : null;
    if (safeImagePath) {
      const buf = fs.readFileSync(safeImagePath);
      const image = nativeImage.createFromBuffer(buf);
      if (image.isEmpty()) return false;
      const pngBuf = image.toPNG();
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([pngBuf], { type: 'image/png' }),
        }),
      ]);
      const size = image.getSize();
      const fingerprint = createClipboardImageFingerprint(size.width, size.height, pngBuf);
      if (fingerprint) {
        clipObservationState = reduceClipboardObservation(
          clipObservationState,
          { imageFingerprint: fingerprint },
          { baseline: true }
        ).state;
      }
    } else if (entry.text) {
      await clipboard.writeText(entry.text);
      clipObservationState = reduceClipboardObservation(
        clipObservationState,
        { text: entry.text },
        { baseline: true }
      ).state;
    } else {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
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

app.on('before-quit', () => {
  launcherService?.cancel().catch(() => {});
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
