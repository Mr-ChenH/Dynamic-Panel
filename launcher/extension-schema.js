'use strict';
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const PERMISSIONS = ['network', 'readFiles', 'writeFiles', 'shell', 'clipboard'];
function text(value, max = 200) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function relativeFile(value) { return text(value, 240) && !value.includes('\\') && !value.includes(':') && !value.startsWith('/') && value.split('/').every((p) => p && p !== '.' && p !== '..'); }
function action(value, permissions = []) {
  if (!value || typeof value !== 'object') throw Error('invalid_action');
  if (value.type === 'execute') return { type: 'execute' };
  if (value.type === 'open-path' && permissions.includes('readFiles') && text(value.path, 4096) && !/[\u0000\r\n]/.test(value.path)) return { type: 'open-path', path: value.path };
  if (value.type === 'navigate' && ['home', 'notes', 'todo', 'links'].includes(value.tab) && (value.id == null || text(value.id, 160))) return { type: 'navigate', tab: value.tab, ...(value.id ? { id: value.id } : {}) };
  if (value.type === 'copy-text' && permissions.includes('clipboard') && text(value.text, 16000)) return { type: value.type, text: value.text };
  if (value.type === 'open-url' && text(value.url, 2048)) {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('invalid_url');
    return { type: value.type, url: url.href };
  }
  throw Error('invalid_action');
}
function manifest(value) {
  if (!value || value.schemaVersion !== 1 || !ID.test(value.id) || !text(value.name, 100) || !text(value.description, 1000) || !text(value.author, 100) || !/^\d+\.\d+\.\d+$/.test(value.version)) throw Error('invalid_manifest');
  if (!Array.isArray(value.permissions) || value.permissions.some((p) => !PERMISSIONS.includes(p))) throw Error('invalid_permissions');
  if (!Array.isArray(value.commands) || !value.commands.length || value.commands.length > 30) throw Error('invalid_commands');
  const seen = new Set();
  const commands = value.commands.map((c) => {
    if (!c || !ID.test(c.id) || seen.has(c.id) || !text(c.title) || !text(c.description, 1000) || !['declarative', 'process'].includes(c.mode)) throw Error('invalid_command');
    seen.add(c.id);
    if (c.mode === 'declarative' && c.action?.type === 'execute') throw Error('invalid_action');
    return { id: c.id, title: c.title, description: c.description, mode: c.mode, keywords: Array.isArray(c.keywords) ? c.keywords.filter((k) => text(k, 80)).slice(0, 10) : [], ...(c.mode === 'declarative' ? { action: action(c.action, value.permissions) } : {}) };
  });
  let runtime;
  if (commands.some((c) => c.mode === 'process')) {
    if (value.runtime?.type !== 'node' || !relativeFile(value.runtime.entry) || !value.runtime.entry.endsWith('.js')) throw Error('invalid_entry');
    runtime = { type: 'node', entry: value.runtime.entry };
  }
  return { schemaVersion: 1, id: value.id, name: value.name, version: value.version, description: value.description, author: value.author, permissions: [...new Set(value.permissions)], commands, ...(runtime ? { runtime } : {}) };
}
function items(value, permissions) {
  if (!Array.isArray(value) || value.length > 100) throw Error('invalid_results');
  const seen = new Set();
  return value.map((item) => {
    if (!item || !ID.test(item.id) || seen.has(item.id) || !text(item.title) || (item.subtitle != null && !text(item.subtitle, 500))) throw Error('invalid_result');
    seen.add(item.id);
    return { id: item.id, title: item.title, subtitle: item.subtitle || '', action: action(item.action, permissions) };
  });
}
module.exports = { manifest, items, action, relativeFile, PERMISSIONS };
