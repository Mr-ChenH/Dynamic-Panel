(function attachShortcutRecorderController(global) {
  function createController(options = {}) {
    const documentRef = options.document || document;
    const windowRef = options.window || window;
    const api = options.notchAPI || windowRef.notchAPI;
    const platform = options.platform || api?.platform || 'darwin';
    const setMode = typeof options.setMode === 'function' ? options.setMode : (() => {});
    const showStatusToast = typeof options.showStatusToast === 'function' ? options.showStatusToast : (() => {});
    const recorder = documentRef.getElementById('shortcut-recorder');
    const title = documentRef.getElementById('shortcut-recorder-title');
    const value = documentRef.getElementById('shortcut-recorder-value');
    const hint = documentRef.getElementById('shortcut-recorder-hint');
    const disable = documentRef.getElementById('shortcut-recorder-disable');
    const cancel = documentRef.getElementById('shortcut-recorder-cancel');
    let active = false;
    let action = 'panel';

    function close() {
      active = false;
      if (recorder) recorder.hidden = true;
    }

    function label(accelerator) {
      if (!accelerator) return '未设置';
      const mac = platform === 'darwin';
      return String(accelerator).split('+').map((part) => ({
        CommandOrControl: mac ? 'Cmd' : 'Ctrl',
        Command: 'Cmd',
        Control: 'Ctrl',
        Option: 'Option',
        Alt: mac ? 'Option' : 'Alt',
      })[part] || part).join(' + ');
    }

    function keyEventToAccelerator(event) {
      const keyAliases = {
        ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape',
        ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
      };
      let key = keyAliases[event.key] || event.key;
      if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
      if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key)) return '';
      const parts = [];
      if (event.metaKey) parts.push('Command');
      if (event.ctrlKey) parts.push('Control');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      parts.push(key);
      return parts.join('+');
    }

    async function save(accelerator) {
      const setter = api?.setShortcut;
      const result = typeof setter === 'function'
        ? await setter(action, accelerator).catch(() => ({ ok: false }))
        : await api?.setPanelShortcut?.(accelerator).catch(() => ({ ok: false }));
      if (!result?.ok) {
        if (value) value.textContent = result?.error === 'occupied' ? '该快捷键已被占用' : '无法使用该快捷键';
        return false;
      }
      showStatusToast(accelerator ? `快捷键已设为 ${label(accelerator)}` : '快捷键已禁用');
      setTimeout(close, 420);
      return true;
    }

    function open(input = {}) {
      const detail = input?.detail && typeof input.detail === 'object' ? input.detail : input;
      const allowedActions = ['panel', 'launcher', 'screenshot', 'screenRecording', 'audioRecording'];
      action = allowedActions.includes(detail?.action) ? detail.action : 'panel';
      const labels = {
        panel: '展开或收起面板',
        launcher: '搜索与启动器',
        screenshot: '区域截图',
        screenRecording: '区域录屏',
        audioRecording: '开始或停止录音',
      };
      void setMode(true);
      active = true;
      if (!recorder) return;
      recorder.hidden = false;
      title.textContent = `设置：${labels[action]}`;
      value.textContent = detail?.current ? label(detail.current) : '等待输入…';
      hint.textContent = action === 'panel'
        ? '可直接使用空格；其他按键请搭配修饰键'
        : '请使用包含修饰键的组合键，也可禁用';
      disable.hidden = action === 'panel';
      windowRef.requestAnimationFrame(() => recorder.focus({ preventScroll: true }));
    }

    recorder?.addEventListener('keydown', async (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        close();
        return;
      }
      const accelerator = keyEventToAccelerator(event);
      if (!accelerator) {
        if (value) value.textContent = '请按下完整按键组合';
        return;
      }
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
      if ((!hasModifier && accelerator !== 'Space') || (action !== 'panel' && accelerator === 'Space')) {
        if (value) value.textContent = action === 'panel' ? '单键仅支持空格' : '请使用包含修饰键的组合键';
        return;
      }
      if (value) value.textContent = label(accelerator);
      await save(accelerator);
    });
    disable?.addEventListener('click', () => { void save(''); });
    cancel?.addEventListener('click', close);
    api?.onRecordShortcut?.(() => open({ action: 'panel' }));
    documentRef.addEventListener('notch:record-shortcut', open);

    return Object.freeze({ close, open, isActive: () => active, label });
  }

  global.NotchShortcutRecorder = Object.freeze({ createController });
})(window);
