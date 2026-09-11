'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const schema = require('./extension-schema');
const { queryExtension } = require('./extension-host');
const { resolveLaunchPath } = require('./paths');
const transfer = require('./data-transfer');
const storageSchema = require('./storage-schema');

function createLauncherService({ dataRoot, executable, platform = process.platform, getSettings = () => ({ queryTimeoutMs: 800 }), applicationRoots }) {
  const root = path.join(dataRoot, 'launcher');
  const packages = path.join(root, 'extensions');
  let registry = {}, loaded = false, controller, apps = [], appsPromise, lastScan = 0;
  const targets = new Map();
  const active = new Set();
  const pendingNavigation = new Map();
  function recordOutcome(record, operation, started, result) {
    recordRun(record, operation, started);
    if (result?.navigationToken) {
      record.history.at(-1).status = 'pending-navigation';
      if (pendingNavigation.size >= 100) pendingNavigation.delete(pendingNavigation.keys().next().value);
      pendingNavigation.set(result.navigationToken, { record, entry: record.history.at(-1), started });
    }
  }
  function completeNavigation(token, ok) {
    return serial(async () => {
      const pending = pendingNavigation.get(token);
      if (!pending) throw Error('stale_result');
      pendingNavigation.delete(token);
      const { record, entry, started } = pending;
      if (!Object.values(registry).includes(record)) throw Error('extension_not_found');
      entry.status = ok ? 'success' : 'navigation_failed'; entry.durationMs = Date.now() - started;
      record.error = ok ? '' : 'navigation_failed';
      await save(); return { ok: true };
    });
  }
  let queue = Promise.resolve(), queryEpoch = 0;
  function serial(task) { const next = queue.then(task); queue = next.catch(() => {}); return next; }
  function track(task) { active.add(task); task.then(() => active.delete(task), () => active.delete(task)); return task; }
  async function load() {
    if (loaded) return;
    try { const file=path.join(root,'registry.json'); if((await fs.stat(file)).size>storageSchema.MAX_RAW)throw Error('registry_too_large'); registry = JSON.parse(await fs.readFile(file, 'utf8')); } catch { registry = {}; }
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) registry = {};
    registry = Object.fromEntries(Object.entries(registry).flatMap(([id, record]) => {
      try { const validated = schema.manifest(record.manifest); return validated.id === id ? [[id, { manifest: validated, enabled: record.enabled === true, error: typeof record.error === 'string' ? record.error.slice(0, 100) : '', lastRunAt: Number.isSafeInteger(record.lastRunAt) && record.lastRunAt >= 0 ? record.lastRunAt : 0, history: storageSchema.history(record.history) }]] : []; } catch { return []; }
    }));
    loaded = true;
  }
  async function save() {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'registry.tmp'), JSON.stringify(registry));
    await fs.rename(path.join(root, 'registry.tmp'), path.join(root, 'registry.json'));
  }
  async function list() { await load(); return Object.values(registry).map(({ manifest, enabled, error, lastRunAt, history }) => ({ ...manifest, enabled, error, lastRunAt: lastRunAt || 0, history: history || [] })); }
  function recordRun(record, operation, started, error) {
    record.lastRunAt = Date.now();
    record.error = error && error !== 'cancelled' ? error : '';
    record.history = [...(record.history || []), { at: record.lastRunAt, operation, durationMs: Date.now() - started, status: error || 'success' }].slice(-20);
  }
  async function copyTree(source, target, budget = { bytes: 0, files: 0 }, depth = 0) {
    if (depth > 12) throw Error('extension_too_large');
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw Error('extension_symlink');
    if (stat.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      for (const entry of await fs.readdir(source)) {
        if (['.git', 'node_modules'].includes(entry)) continue;
        await copyTree(path.join(source, entry), path.join(target, entry), budget, depth + 1);
      }
    } else if (stat.isFile()) {
      budget.bytes += stat.size; budget.files++;
      if (budget.bytes > 20 * 1024 * 1024 || budget.files > 500) throw Error('extension_too_large');
      await fs.copyFile(source, target);
    } else throw Error('invalid_extension_file');
  }
  async function stage(source) {
    await fs.mkdir(packages, { recursive: true });
    const temporary = path.join(packages, `.pending-${crypto.randomUUID()}`);
    try {
      await copyTree(source, temporary);
      const manifest = schema.manifest(JSON.parse(await fs.readFile(path.join(temporary, 'manifest.json'), 'utf8')));
      if (manifest.runtime && !(await fs.stat(path.join(temporary, manifest.runtime.entry))).isFile()) throw Error('invalid_entry');
      return { manifest, temporary };
    } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
  }
  async function install(staged) {
    await load();
    if (Object.hasOwn(registry, staged.manifest.id)) throw Error('extension_already_installed');
    const directory = path.join(packages, staged.manifest.id);
    await fs.rename(staged.temporary, directory);
    registry[staged.manifest.id] = { manifest: staged.manifest, enabled: true, error: '' };
    try { await save(); } catch (error) { delete registry[staged.manifest.id]; await fs.rm(directory, { recursive: true, force: true }); throw error; }
  }
  async function change(id, enabled) {
    await load(); if (!Object.hasOwn(registry, id)) throw Error('extension_not_found');
    await cancel(); const previous = registry[id].enabled; registry[id].enabled = enabled === true;
    try { await save(); } catch (error) { registry[id].enabled = previous; throw error; }
  }
  async function uninstall(id) {
    await load(); if (!Object.hasOwn(registry, id) || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)) throw Error('extension_not_found');
    await cancel();
    const record = registry[id];
    record.enabled = false; await save();
    await fs.rm(path.join(packages, id), { recursive: true, force: true });
    delete registry[id];
    try { await save(); } catch (error) { registry[id] = record; throw error; }
  }
  function cancel() { queryEpoch++; return cancelActive(); }
  async function cancelActive() {
    controller?.abort(); controller = null; targets.clear();
    const results = await Promise.allSettled([...active]);
    if (results.some((r) => r.status === 'rejected' && r.reason?.message === 'extension_cleanup_failed')) throw Error('extension_cleanup_failed');
  }
  async function discoverApps() {
    if (appsPromise) return appsPromise;
    if (Date.now() - lastScan < 60000) return apps;
    appsPromise = (async () => {
      const found = [];
      const roots = applicationRoots || (platform === 'darwin' ? ['/Applications', '/System/Applications', path.join(require('node:os').homedir(), 'Applications')] : [
        path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs'),
        path.join(process.env.ProgramData || 'C:/ProgramData', 'Microsoft/Windows/Start Menu/Programs'),
        path.join(require('node:os').homedir(), 'Desktop'),
      ]);
      async function scan(directory, depth = 0) {
        if (depth > 6 || found.length >= 2000) return;
        let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (found.length >= 2000) break;
          if (entry.isSymbolicLink()) continue;
          const full = path.join(directory, entry.name);
          if ((platform === 'darwin' && entry.isDirectory() && entry.name.toLowerCase().endsWith('.app')) || (platform === 'win32' && entry.isFile() && entry.name.toLowerCase().endsWith('.lnk'))) {
            const id = 'app:' + crypto.createHash('sha256').update(full).digest('hex').slice(0, 24);
            found.push({ id, title: entry.name.replace(/\.(app|lnk)$/i, ''), subtitle: '应用', kind: 'app', platform, appModes: platform==='win32'?['admin','new','focus']:['new','focus'], path: full });
          } else if (entry.isDirectory()) await scan(full, depth + 1);
        }
      }
      for (const directory of roots) await scan(directory);
      apps = found; lastScan = Date.now(); return apps;
    })().finally(() => { appsPromise = null; });
    return appsPromise;
  }
  async function query(queryText, sources = {}, epoch, onPartial) {
    if (epoch !== queryEpoch) return [];
    await load(); await cancelActive();
    if (epoch !== queryEpoch) return [];
    const current = new AbortController(); controller = current;
    const result = [];
    const publish = (row, target) => {
      const confirmation = (row.permissions || []).some(p => ['shell','writeFiles'].includes(p)) && target.type !== 'search' ? 'confirm' : 'none';
      targets.set(row.id, { ...target, confirmation, title: row.title });
      result.push({ ...row, confirmation, ...(target.path ? { copyTarget: target.path } : {}) });
    };
    if (sources.apps !== false) {
      for (const { path: appPath, ...row } of await discoverApps()) {
        if (current.signal.aborted) return [];
        publish(row, { type: 'open-app', path: appPath });
      }
    }
    const file = await resolveLaunchPath(queryText, platform);
    if (current.signal.aborted) return [];
    if (file) publish({ id: 'path:' + crypto.createHash('sha256').update(file.path).digest('hex').slice(0, 24), title: file.name, subtitle: file.path, keywords: [queryText], kind: 'path', source: { id: 'paths', label: '文件与目录' } }, { type: 'open-path', path: file.path });
    if (sources.extensions === false) return result;
    const dynamic = [];
    for (const record of Object.values(registry)) {
      if (!record.enabled) continue;
      const m = record.manifest;
      for (const command of m.commands) {
        const prefix = `extension:${m.id}:${command.id}`;
        const row = { id: prefix, title: command.title, subtitle: `${m.name} · ${command.description}`, kind: 'extension', keywords: command.keywords, source: { id: m.id, label: m.name }, permissions: m.permissions, risk: m.runtime ? 'local-code' : 'safe' };
        if (command.mode === 'declarative') publish(row, { ...command.action, extensionId: m.id });
        else {
          publish({ ...row, kind: 'extension-query' }, { type: 'search', query: `${command.title} ` });
          // Dynamic extensions run only when explicitly addressed by command title/id.
          const trimmed = queryText.trimStart();
          const token = [command.title, command.id].find((name) => trimmed.toLowerCase().startsWith(name.toLowerCase() + ' '));
          if (token) dynamic.push({ m, command, prefix, record, query: trimmed.slice(token.length + 1) });
        }
      }
    }
    if (!current.signal.aborted) onPartial?.([...result], { pending: dynamic.slice(0,3).map(({m,command})=>({id:`${m.id}:${command.id}`,title:command.title})) });
    await Promise.all(dynamic.slice(0, 3).map(async ({ m, command, prefix, record, query }) => {
      const started = Date.now();
      try {
        const storagePath = path.join(root, 'storage', m.id); await fs.mkdir(storagePath, { recursive: true });
        if (current.signal.aborted) return;
        const items = await track(queryExtension(path.join(packages, m.id), m, command.id, query, current.signal, executable, { queryTimeoutMs: getSettings().queryTimeoutMs, storagePath }));
        if (current.signal.aborted) return;
        recordRun(record, 'query', started);
        items.forEach((item) => publish({ id: `${prefix}:${item.id}`, title: item.title, subtitle: `${m.name} · ${item.subtitle}`, kind: 'extension', persistable: false, keywords: [queryText], source: { id: m.id, label: m.name }, permissions: m.permissions, risk: 'local-code' }, item.action.type === 'execute' ? { type: 'execute', extensionId: m.id, commandId: command.id, itemId: item.id, query } : { ...item.action, extensionId: m.id }));
      } catch (error) {
        if (current.signal.aborted) return;
        recordRun(record, 'query', started, error.message);
        result.push({ id: `${prefix}:error`, title: `${m.name} 暂时不可用`, subtitle: error.message, kind: 'error', keywords: [queryText] });
      }
    }));
    if (dynamic.length) await save();
    return current.signal.aborted ? [] : result;
  }
  async function execute(target, perform) {
    const record = registry[target.extensionId];
    if (!record?.enabled) throw Error('extension_disabled');
    const signal = controller?.signal;
    const started = Date.now();
    try {
      const storagePath = path.join(root, 'storage', target.extensionId); await fs.mkdir(storagePath, { recursive: true });
      if (signal?.aborted) throw Error('cancelled');
      const result = await track(queryExtension(path.join(packages, target.extensionId), record.manifest, target.commandId, target.query, signal, executable, { type: 'execute', itemId: target.itemId, storagePath, executeTimeoutMs: getSettings().executeTimeoutMs }));
      if (signal?.aborted) throw Error('cancelled');
      if (result.length !== 1 || result[0].action.type === 'execute') throw Error('invalid_execution_result');
      const outcome = perform ? await perform(result[0].action) : result[0].action;
      recordOutcome(record, 'execute', started, outcome); await save();
      return outcome;
    } catch (error) { recordRun(record, 'execute', started, error.message); await save(); throw error; }
  }
  function perform(target, handler) {
    const epoch = queryEpoch;
    return serial(async () => {
      if (epoch !== queryEpoch || !controller || controller.signal.aborted || ![...targets.values()].includes(target)) throw Error('cancelled');
      if (target.type === 'execute') return execute(target, handler);
      const record = registry[target.extensionId], started = Date.now();
      try {
        const result = await handler(target);
        if (record) { recordOutcome(record, 'host-action', started, result); await save(); }
        return result;
      } catch (error) { if (record) { recordRun(record, 'host-action', started, error.message); await save(); } throw error; }
    });
  }
  function transferData(id, archive) {
    queryEpoch++; controller?.abort();
    return serial(async () => {
      await load(); await cancelActive();
      if (!Object.hasOwn(registry, id)) throw Error('extension_not_found');
      const directory=path.join(root,'storage',id);
      return archive === undefined ? transfer.exportData(directory,id) : transfer.importData(directory,id,archive);
    });
  }
  return { list, stage, perform, completeNavigation, warmApplications: discoverApps, exportData: id => transferData(id), importData: (id, archive) => transferData(id, archive), install: (value) => serial(() => install(value)), change: (id, enabled) => { queryEpoch++; controller?.abort(); return serial(() => change(id, enabled)); }, uninstall: (id) => { queryEpoch++; controller?.abort(); return serial(() => uninstall(id)); }, query: (text, sources, onPartial) => { const epoch = ++queryEpoch; controller?.abort(); return serial(() => query(text, sources, epoch, onPartial)); }, cancel, execute: (target, perform) => {
    const epoch = queryEpoch;
    return serial(() => {
      if (epoch !== queryEpoch || !controller || controller.signal.aborted || ![...targets.values()].includes(target)) throw Error('cancelled');
      return execute(target, perform);
    });
  }, target: (id) => targets.get(id) };
}
module.exports = { createLauncherService };
