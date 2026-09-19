const PERMISSION_PROMPT_SKIP_FILE = 'permission-prompt-skipped';

function createPermissionService(options = {}) {
  const platform = options.platform || 'darwin';
  const systemPreferences = options.systemPreferences;
  const desktopCapturer = options.desktopCapturer;
  const screenRecordingProbePolicy = options.screenRecordingProbePolicy;
  const app = options.app;
  const path = options.path;
  const fs = options.fs;
  const dialog = options.dialog;
  const shell = options.shell;
  const privacySettingsPanes = options.privacySettingsPanes || {};

  async function hasScreenRecordingAccess() {
    const status = systemPreferences.getMediaAccessStatus('screen');
    const policy = screenRecordingProbePolicy(status);
    if (!policy.inspectWindowTitles) return policy.hasAccess;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      if (sources.length === 0) return true;
      return sources.some((source) => String(source.name || '').trim().length > 0);
    } catch (error) {
      return true;
    }
  }

  async function promptForMissingPermissions() {
    if (platform !== 'darwin') return;
    const skipFlag = path.join(app.getPath('userData'), PERMISSION_PROMPT_SKIP_FILE);
    if (fs.existsSync(skipFlag)) return;

    const missing = [];
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

    if (missing.includes('accessibility')) systemPreferences.isTrustedAccessibilityClient(true);
    shell.openExternal(privacySettingsPanes[missing[0]]);
  }

  return Object.freeze({ hasScreenRecordingAccess, promptForMissingPermissions });
}

module.exports = { createPermissionService, PERMISSION_PROMPT_SKIP_FILE };
