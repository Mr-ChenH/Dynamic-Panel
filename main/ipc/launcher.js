const { randomUUID } = require('node:crypto');
const { validateArchive } = require('../../launcher/data-transfer');

function registerLauncherIpc({
  ipcMain,
  getMainWindow,
  getLauncherService,
  launcherFocus,
  launcherConfig,
  getShortcutState,
  setLauncherShortcut,
  writeLauncherSettings,
  getLauncherSettingsPath,
  app,
  path,
  fs,
  dialog,
  shell,
  validatePublicHttpUrl,
  launcherApplications,
  resolveLaunchPath,
  clipboard,
  getLauncherManaging,
  setLauncherManaging,
  adjustTransientSystemInteractionRequests,
}) {
  const launcherIconCache = new Map();
  const launcherHandler = (channel, handler) => {
    ipcMain.handle(channel, async (event, payload) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
        return { ok: false, error: 'invalid_sender' };
      }
      try {
        return await handler(payload);
      } catch (error) {
        return { ok: false, error: error.message || 'launcher_failed' };
      }
    });
  };

  launcherHandler('launcher:focus', (payload) => ({
    ok: true,
    restored: payload?.restore === true ? launcherFocus.restore() : (launcherFocus.discard(), false),
  }));
  launcherHandler('launcher:settings', () => ({
    ok: true,
    ...launcherConfig(),
    registered: Boolean(getShortcutState().launcher),
  }));
  launcherHandler('launcher:save-settings', (payload) => {
    if (!payload || typeof payload.shortcut !== 'string' || !payload.sources || typeof payload.sources !== 'object') {
      throw Error('invalid_settings');
    }
    const executeTimeoutMs = payload.executeTimeoutMs ?? 5000;
    if (!Number.isInteger(executeTimeoutMs) || executeTimeoutMs < 500 || executeTimeoutMs > 10000) throw Error('invalid_settings');
    const queryTimeoutMs = payload.queryTimeoutMs ?? 800;
    if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 300 || queryTimeoutMs > 5000) throw Error('invalid_settings');
    if (!setLauncherShortcut(payload.shortcut)) throw Error('shortcut_occupied');
    const sources = Object.fromEntries(['apps', 'workspace', 'clipboard', 'extensions'].map((key) => [key, payload.sources[key] === true]));
    if (!writeLauncherSettings({ shortcut: payload.shortcut, sources, queryTimeoutMs, executeTimeoutMs })) {
      setLauncherShortcut(launcherConfig().shortcut);
      throw Error('save_failed');
    }
    return { ok: true };
  });
  launcherHandler('launcher:query', async (payload) => {
    if (typeof payload?.query !== 'string' || payload.query.length > 1000 || payload.regexMode !== undefined && typeof payload.regexMode !== 'boolean') {
      throw Error('invalid_query');
    }
    const owner = getMainWindow();
    return {
      ok: true,
      items: await getLauncherService().query(
        payload.regexMode === true ? '' : payload.query,
        launcherConfig().sources,
        (items, progress) => {
          if (Number.isSafeInteger(payload.requestId) && owner && !owner.isDestroyed()) {
            owner.webContents.send('launcher:partial', { requestId: payload.requestId, items, pending: progress?.pending || [] });
          }
        }
      ),
    };
  });
  launcherHandler('launcher:icon', async (payload) => {
    if (typeof payload?.id !== 'string') throw Error('invalid_target');
    const target = getLauncherService().target(payload.id);
    if (target?.type !== 'open-app') throw Error('invalid_target');
    if (!launcherIconCache.has(target.path)) {
      if (launcherIconCache.size >= 256) launcherIconCache.delete(launcherIconCache.keys().next().value);
      launcherIconCache.set(target.path, (async () => {
        let iconPath = target.path;
        if (process.platform === 'win32' && /\.lnk$/i.test(iconPath)) {
          const shortcut = shell.readShortcutLink(iconPath);
          iconPath = shortcut.icon && /\.ico$/i.test(shortcut.icon) ? shortcut.icon : shortcut.target;
          iconPath = iconPath.replace(/%([^%]+)%/g, (token, key) => process.env[key] || token);
          if (!path.isAbsolute(iconPath) || iconPath.startsWith('\\\\')) return '';
        }
        return (await app.getFileIcon(iconPath, { size: 'normal' })).toDataURL();
      })().catch(() => ''));
    }
    return { ok: true, icon: await launcherIconCache.get(target.path) };
  });
  launcherHandler('launcher:cancel', async () => { await getLauncherService().cancel(); return { ok: true }; });
  launcherHandler('launcher:extension-data', async (payload) => {
    if (getLauncherManaging() || typeof payload?.id !== 'string' || !['export', 'import'].includes(payload.operation)) throw Error('invalid_action');
    const extension = (await getLauncherService().list()).find((item) => item.id === payload.id);
    if (!extension) throw Error('extension_not_found');
    setLauncherManaging(true);
    try {
      if (payload.operation === 'export') {
        const choice = await dialog.showSaveDialog(getMainWindow(), { title: '导出扩展数据', defaultPath: `${extension.id}.launcher-data.json`, filters: [{ name: '扩展数据', extensions: ['json'] }] });
        if (choice.canceled || !choice.filePath) return { ok: false, error: 'cancelled' };
        const archive = await getLauncherService().exportData(extension.id);
        await fs.promises.writeFile(choice.filePath, JSON.stringify(archive));
      } else {
        const choice = await dialog.showOpenDialog(getMainWindow(), { title: '导入扩展数据', properties: ['openFile'], filters: [{ name: '扩展数据', extensions: ['json'] }] });
        if (choice.canceled || !choice.filePaths[0]) return { ok: false, error: 'cancelled' };
        if ((await fs.promises.stat(choice.filePaths[0])).size > 30 * 1024 * 1024) throw Error('extension_data_too_large');
        const archive = JSON.parse(await fs.promises.readFile(choice.filePaths[0], 'utf8'));
        validateArchive(archive, extension.id);
        const confirm = await dialog.showMessageBox(getMainWindow(), { type: 'warning', title: '替换扩展数据', message: `替换“${extension.name}”的专属数据？`, detail: '只替换所选扩展的数据。不会导入代码、权限授权或日志。建议先导出现有数据。', buttons: ['取消', '替换'], defaultId: 0, cancelId: 0 });
        if (confirm.response !== 1) return { ok: false, error: 'cancelled' };
        await getLauncherService().importData(extension.id, archive);
      }
      return { ok: true };
    } finally {
      setLauncherManaging(false);
    }
  });
  launcherHandler('launcher:extensions', async () => ({ ok: true, items: await getLauncherService().list() }));
  launcherHandler('launcher:extension-toggle', async (payload) => {
    if (typeof payload?.id !== 'string' || typeof payload.enabled !== 'boolean') throw Error('invalid_extension');
    await getLauncherService().change(payload.id, payload.enabled);
    return { ok: true };
  });
  launcherHandler('launcher:extension-install', async () => {
    if (getLauncherManaging()) throw Error('busy');
    setLauncherManaging(true);
    let staged;
    try {
      const chosen = await dialog.showOpenDialog(getMainWindow(), { title: '选择含 manifest.json 的扩展目录', properties: ['openDirectory'] });
      if (chosen.canceled) return { ok: false, error: 'cancelled' };
      staged = await getLauncherService().stage(chosen.filePaths[0]);
      const m = staged.manifest;
      const response = await dialog.showMessageBox(getMainWindow(), { type: 'warning', buttons: ['取消', '安装并启用'], defaultId: 0, cancelId: 0, message: `安装 ${m.name} ${m.version}？`, detail: `作者：${m.author}\n命令：${m.commands.map((c) => c.title).join('、')}\n声明权限：${m.permissions.join('、') || '无'}\n入口：${m.runtime?.entry || '声明式命令，无代码入口'}\n${m.runtime ? '此扩展会运行 JavaScript：直接文件访问仅限自身代码和专属数据目录，禁止派生进程、原生插件和 Worker。网络没有系统级隔离，请仅安装信任的代码。' : '此扩展仅包含声明式命令，由宿主执行。'}` });
      if (response.response !== 1) return { ok: false, error: 'cancelled' };
      await getLauncherService().install(staged);
      return { ok: true };
    } finally {
      try { if (staged) await fs.promises.rm(staged.temporary, { recursive: true, force: true }); }
      finally { setLauncherManaging(false); }
    }
  });
  launcherHandler('launcher:extension-remove', async (payload) => {
    if (getLauncherManaging()) throw Error('busy');
    if (typeof payload?.id !== 'string') throw Error('invalid_extension');
    setLauncherManaging(true);
    try {
      const response = await dialog.showMessageBox(getMainWindow(), { type: 'question', buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0, message: '卸载此扩展并删除其本机数据？' });
      if (response.response !== 1) return { ok: false, error: 'cancelled' };
      await getLauncherService().uninstall(payload.id);
      return { ok: true };
    } finally { setLauncherManaging(false); }
  });
  launcherHandler('launcher:run', async (payload) => {
    if (typeof payload?.id !== 'string') throw Error('invalid_action');
    const target = getLauncherService().target(payload.id);
    if (!target) throw Error('stale_result');
    const mode = payload.mode === undefined ? 'default' : payload.mode;
    if (!['default', 'admin', 'new', 'focus'].includes(mode) || mode !== 'default' && target.type !== 'open-app') throw Error('invalid_action');
    if (mode !== 'default') {
      adjustTransientSystemInteractionRequests(1);
      try { return await getLauncherService().perform(target, (action) => launcherApplications.run(action.path, mode)); }
      finally { adjustTransientSystemInteractionRequests(-1); }
    }
    if (target.confirmation === 'confirm') {
      if (getLauncherManaging()) throw Error('busy');
      setLauncherManaging(true);
      try {
        const result = await dialog.showMessageBox(getMainWindow(), { type: 'warning', title: '确认扩展动作', message: `执行“${target.title}”？`, detail: '此命令声明了写文件或 Shell 权限。运行时仍会限制文件访问，并禁止派生进程。', buttons: ['取消', '执行'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) return { ok: false, error: 'cancelled' };
      } finally { setLauncherManaging(false); }
    }
    return getLauncherService().perform(target, (item) => performLauncherAction(item));
  });
  launcherHandler('launcher:navigation-result', (payload) => {
    if (typeof payload?.token !== 'string' || payload.token.length > 100 || typeof payload.ok !== 'boolean') throw Error('invalid_action');
    return getLauncherService().completeNavigation(payload.token, payload.ok);
  });
  launcherHandler('launcher:open-url', async (payload) => {
    const url = await validatePublicHttpUrl(payload?.url);
    if (!url) throw Error('invalid_url');
    await shell.openExternal(url.toString());
    return { ok: true };
  });

  async function performLauncherAction(target) {
    if (target.type === 'search') return { ok: true, query: target.query };
    if (target.type === 'navigate') return { ok: true, navigationToken: randomUUID(), navigation: { tab: target.tab, ...(target.id ? { id: target.id } : {}) } };
    if (target.type === 'copy-text') await clipboard.writeText(target.text);
    else if (target.type === 'open-app' || target.type === 'open-path') {
      let launchPath = target.path;
      if (target.type === 'open-path') {
        const resolved = await resolveLaunchPath(target.path);
        if (!resolved) throw Error('invalid_path');
        launchPath = resolved.path;
      }
      const error = await shell.openPath(launchPath);
      if (error) throw Error('app_open_failed');
    } else if (target.type === 'open-url') {
      const url = await validatePublicHttpUrl(target.url);
      if (!url) throw Error('invalid_url');
      await shell.openExternal(url.toString());
    } else throw Error('invalid_action');
    return { ok: true };
  }
}

module.exports = { registerLauncherIpc };
