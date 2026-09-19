function createCurrentWindowService(host = {}) {
  const { execFile, platform, processId, normalizeWindowRows, withTimeout, readWindowAppIcon } = host;
  let windowScanCache = new Map();
  const windowIconCache = new Map();

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
  if (platform !== 'darwin') return { items: [], error: 'unsupported' };
  try {
    const raw = await runJxa(WINDOWS_LIST_JXA);
    const parsed = JSON.parse(raw || '{}');
    // 兼容旧格式（裸数组），新格式是 { rows, candidates, titled }。
    const payload = Array.isArray(parsed)
      ? { rows: parsed, candidates: parsed.length, titled: parsed.length }
      : parsed;
    const rows = normalizeWindowRows(payload.rows || []).filter((item) => item.pid !== processId);
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


  return Object.freeze({
    list: scanCurrentWindows,
    focus: async (windowId) => {
      const target = windowScanCache.get(windowId);
      if (!target || platform !== 'darwin') return false;
      try {
        return (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true';
      } catch (error) { return false; }
    },
    focusTarget: async (target) => {
      if (!target || platform !== 'darwin') return false;
      try { return (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true'; }
      catch (error) { return false; }
    },
  });
}

module.exports = { createCurrentWindowService };
