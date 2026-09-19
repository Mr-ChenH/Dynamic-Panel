const INTERNAL_BUNDLE_IDS = new Set([
  'com.github.Electron',
  'com.vibecoding.notch-todo',
  'com.dynamicpanel.app',
]);

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

function createPasteTargetService(options = {}) {
  const execFile = options.execFile || require('child_process').execFile;
  const automaticPaste = options.automaticPaste === true;
  const excludedBundleIds = new Set(options.excludedBundleIds || INTERNAL_BUNDLE_IDS);
  const frontmostTimeoutMs = Number.isFinite(options.frontmostTimeoutMs)
    ? Math.max(1, options.frontmostTimeoutMs)
    : 2200;
  const pasteTimeoutMs = Number.isFinite(options.pasteTimeoutMs)
    ? Math.max(1, options.pasteTimeoutMs)
    : 3000;
  let previousTarget = null;

  function readFrontmostApp() {
    if (!automaticPaste) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONTMOST_APP_JXA], { timeout: frontmostTimeoutMs }, (error, stdout) => {
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

  async function remember() {
    const current = await readFrontmostApp();
    if (current && !excludedBundleIds.has(current.bundleId)) previousTarget = current;
    return previousTarget;
  }

  function getPreviousTarget() {
    return previousTarget;
  }

  function pasteToPreviousApp(target) {
    return new Promise((resolve) => {
      const bundleId = String(target?.bundleId || '');
      if (!bundleId || excludedBundleIds.has(bundleId) || !automaticPaste) return resolve(false);
      execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', PASTE_TO_APP_JXA, bundleId],
        { timeout: pasteTimeoutMs },
        (error, stdout) => resolve(!error && String(stdout || '').trim() === 'ok')
      );
    });
  }

  return {
    readFrontmostApp,
    remember,
    getPreviousTarget,
    pasteToPreviousApp,
  };
}

module.exports = { createPasteTargetService };
