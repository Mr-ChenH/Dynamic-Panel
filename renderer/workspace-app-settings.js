(function exposeWorkspaceAppSettings() {
  function createController(host) {
    const {
      Domain,
      getAIConfig,
      acceptAIConfig,
      isRecordingActive,
      updateRecordingUi,
      showToast,
    } = host;
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
    const settingsNotchHeight = document.getElementById('settings-notch-height');
    const settingsNotchHeightCustomWrap = document.getElementById('settings-notch-height-custom-wrap');
    const settingsNotchHeightCustom = document.getElementById('settings-notch-height-custom');
    const settingsNotchHeightNote = document.getElementById('settings-notch-height-note');
    const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
    const settingsWorkspacePath = document.getElementById('settings-workspace-path');
    const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
    const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
    const settingsAutoLaunch = document.getElementById('settings-auto-launch');
    const settingsInlineNote = document.getElementById('settings-inline-note');
    let appSettings = null;
    let workspace = null;

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

    function setNote(message, error = false) {
      if (!settingsInlineNote) return;
      settingsInlineNote.textContent = message || '';
      settingsInlineNote.classList.toggle('error', error);
    }

    function render() {
      const summary = Domain.settingsSummary({
        appSettings,
        workspace,
        transcription: getAIConfig(),
      });
      if (settingsShortcutValue) settingsShortcutValue.textContent = shortcutLabel(summary.shortcut);
      if (settingsLauncherShortcutValue) settingsLauncherShortcutValue.textContent = shortcutLabel(appSettings?.shortcuts?.launcher);
      if (settingsScreenshotShortcutValue) settingsScreenshotShortcutValue.textContent = shortcutLabel(appSettings?.shortcuts?.screenshot);
      if (settingsVideoShortcutValue) settingsVideoShortcutValue.textContent = shortcutLabel(appSettings?.shortcuts?.screenRecording);
      if (settingsAudioShortcutValue) settingsAudioShortcutValue.textContent = shortcutLabel(appSettings?.shortcuts?.audioRecording);
      if (settingsTheme) {
        const theme = appSettings?.theme === 'light' ? 'light' : 'dark';
        settingsTheme.querySelectorAll('[data-theme-value]').forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset.themeValue === theme));
        });
      }
      if (settingsNotchHeight) {
        const platform = window.notchAPI?.platform === 'win32' ? 'win32' : 'darwin';
        const limits = platform === 'win32' ? { min: 8, max: 38 } : { min: 24, max: 64 };
        const preference = appSettings?.notchHeight || { mode: 'small', custom: limits.min };
        const mode = ['small', 'medium', 'large', 'custom'].includes(preference.mode) ? preference.mode : 'small';
        settingsNotchHeight.value = mode;
        if (settingsNotchHeightCustom) {
          settingsNotchHeightCustom.min = String(limits.min);
          settingsNotchHeightCustom.max = String(limits.max);
          settingsNotchHeightCustom.value = String(Math.min(limits.max, Math.max(limits.min, Number(preference.custom) || limits.min)));
        }
        settingsNotchHeightCustomWrap?.toggleAttribute('hidden', mode !== 'custom');
        if (settingsNotchHeightNote) {
          settingsNotchHeightNote.textContent = platform === 'win32'
            ? `小：当前紧凑高度 · 中/大：在默认高度上增加 8/16 px · 自定义：${limits.min}–${limits.max} px`
            : `小：当前屏幕默认高度 · 中/大：在默认高度上增加 8/16 px · 自定义：${limits.min}–${limits.max} px`;
        }
      }
      if (settingsDefaultTab) {
        const visibleTabs = new Set(Domain.visiblePanelTabs(
          ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'],
          appSettings?.features
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
        input.checked = appSettings?.features?.[input.dataset.settingsFeature] !== false;
      });
      renderHomeModules();
    }

    function renderHomeModules() {
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

    async function refresh() {
      if (!window.notchAPI) return;
      const [nextAppSettings, nextWorkspace, config] = await Promise.all([
        window.notchAPI.getAppSettings?.().catch(() => null),
        window.notchAPI.getWorkspace?.().catch(() => null),
        window.notchAPI.getTranscriptionConfig?.().catch(() => null),
      ]);
      if (nextAppSettings) appSettings = nextAppSettings;
      if (nextWorkspace) workspace = nextWorkspace;
      if (config) {
        acceptAIConfig(config);
        updateRecordingUi();
      }
      render();
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
        setNote('功能显示设置保存失败，请重试。', true);
        return;
      }
      appSettings = result.settings || appSettings;
      render();
      setNote('显示功能已更新。');
    });

    settingsHomeModuleList?.addEventListener('change', async (event) => {
      const input = event.target.closest('input[data-settings-home-module]');
      if (!input || !window.NotchHome?.setModuleVisible) return;
      input.disabled = true;
      const result = await window.NotchHome.setModuleVisible(input.dataset.settingsHomeModule, input.checked);
      renderHomeModules();
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
        showToast(message);
        return;
      }
      if (result.changed === false) return;
      const message = result.persisted === false
        ? '布局已更新，仅当前会话生效，设置未能保存'
        : input.checked ? '首页组件已恢复' : '首页组件已隐藏';
      showToast(message);
    });

    const shortcutControls = [
      [settingsShortcutChange, 'panel', () => appSettings?.shortcut || 'Space'],
      [settingsLauncherShortcutChange, 'launcher', () => appSettings?.shortcuts?.launcher || ''],
      [settingsScreenshotShortcutChange, 'screenshot', () => appSettings?.shortcuts?.screenshot || ''],
      [settingsVideoShortcutChange, 'screenRecording', () => appSettings?.shortcuts?.screenRecording || ''],
      [settingsAudioShortcutChange, 'audioRecording', () => appSettings?.shortcuts?.audioRecording || ''],
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
        render();
        setNote('主题设置保存失败，请重试。', true);
        return;
      }
      appSettings = result.settings || appSettings;
      render();
      setNote(theme === 'light' ? '已切换为亮色主题。' : '已切换为深色主题。');
    });

    settingsNotchHeight?.addEventListener('change', async () => {
      if (!window.notchAPI?.setNotchHeight) return;
      const mode = settingsNotchHeight.value;
      const custom = Number(settingsNotchHeightCustom?.value);
      const min = Number(settingsNotchHeightCustom?.min || 24);
      const max = Number(settingsNotchHeightCustom?.max || 64);
      if (mode === 'custom' && (!Number.isInteger(custom) || custom < min || custom > max)) {
        setNote(`自定义高度必须是 ${min}–${max} px 的整数。`, true);
        render();
        return;
      }
      settingsNotchHeight.disabled = true;
      if (settingsNotchHeightCustom) settingsNotchHeightCustom.disabled = true;
      const result = await window.notchAPI.setNotchHeight({ mode, custom }).catch(() => ({ ok: false }));
      settingsNotchHeight.disabled = false;
      if (settingsNotchHeightCustom) settingsNotchHeightCustom.disabled = false;
      if (!result?.ok) {
        render();
        setNote(result?.error === 'invalid_notch_height' ? `自定义高度必须是 ${min}–${max} px 的整数。` : '刘海高度保存失败，请重试。', true);
        return;
      }
      appSettings = result.settings || appSettings;
      render();
      setNote('刘海高度已更新。');
    });

    settingsNotchHeightCustom?.addEventListener('change', () => {
      if (settingsNotchHeight?.value === 'custom') settingsNotchHeight.dispatchEvent(new Event('change'));
    });

    settingsDefaultTab?.addEventListener('change', async () => {
      if (!window.notchAPI?.setDefaultTab) return;
      const previous = appSettings?.defaultTab || 'home';
      settingsDefaultTab.disabled = true;
      const result = await window.notchAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
      settingsDefaultTab.disabled = false;
      if (!result?.ok) {
        settingsDefaultTab.value = previous;
        setNote('默认展开页保存失败，请重试。', true);
        return;
      }
      appSettings = result.settings || appSettings;
      render();
      setNote(`下次唤出将默认显示${settingsDefaultTab.selectedOptions[0]?.textContent || '所选页面'}。`);
    });

    settingsWorkspaceOpen?.addEventListener('click', () => {
      window.notchAPI?.openWorkspace?.().catch(() => setNote('无法打开数据文件夹。', true));
    });
    settingsWorkspaceChoose?.addEventListener('click', async () => {
      const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
      if (!changed) return;
      workspace = await window.notchAPI?.getWorkspace?.().catch(() => workspace);
      render();
      setNote('数据文件夹已更新。');
    });
    settingsAutoLaunch?.addEventListener('change', async () => {
      if (!window.notchAPI?.setAutoLaunch) return;
      settingsAutoLaunch.disabled = true;
      const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
      settingsAutoLaunch.disabled = false;
      if (!result?.ok) {
        settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
        setNote('开机启动设置失败。', true);
        return;
      }
      settingsAutoLaunch.checked = result.autoLaunch === true;
      if (appSettings) appSettings.autoLaunch = result.autoLaunch === true;
      setNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
    });
    window.notchAPI?.onAppSettingsChanged?.((settings) => {
      appSettings = settings;
      render();
    });
    window.notchAPI?.onWorkspaceChanged?.(() => refresh());

    const syncController = window.NotchSyncController?.createController?.();
    syncController?.bind?.();

    return Object.freeze({
      refresh,
      render,
      renderHomeModules,
      setNote,
      sync: syncController,
    });
  }

  window.NotchWorkspaceAppSettings = Object.freeze({ createController });
})();
