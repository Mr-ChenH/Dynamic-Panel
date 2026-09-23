'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createController } = require('../renderer/sync/controller');

const root = path.join(__dirname, '..');

test('sync preload namespace is frozen while flat compatibility methods remain', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(preload, /getSyncStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('sync:get-status'\)/);
  assert.match(preload, /api\.sync\s*=\s*Object\.freeze\(/);
  assert.match(preload, /onStatus:\s*api\.onSyncStatus/);
  assert.doesNotMatch(preload, /sync[^\n]*clientKey[^\n]*=>/i);
});

test('sync settings expose privacy, one clipboard switch, first-sync and accessible status controls', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.equal((html.match(/data-sync-category="clipboard"/g) || []).length, 1);
  assert.match(html, /id="sync-status-label"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /服务器可读取你选择同步的业务数据；这不是端到端加密/);
  assert.match(html, /不同步：密钥、录音与转写、录屏、音乐、本地扩展/);
  assert.match(html, /id="sync-first-sync-cancel"/);
  assert.match(html, /value="local-wins"/);
  assert.match(html, /value="server-wins"/);
  const settings = fs.readFileSync(path.join(root, 'renderer', 'settings.js'), 'utf8');
  assert.match(settings, /id:'sync'.*selector:'\.sync-settings'/);
  assert.ok(html.indexOf('sync/view.js') < html.indexOf('workspace-app-settings.js'));
  assert.ok(html.indexOf('sync/controller.js') < html.indexOf('workspace-app-settings.js'));
});

test('sync controller resolves the API dynamically for each request', async () => {
  let current = { getStatus: async () => ({ state: 'disconnected' }) };
  const rendered = [];
  const controller = createController({ document: { getElementById: () => null, querySelectorAll: () => [] }, view: { render: (value) => rendered.push(value) }, getApi: () => current });
  assert.equal((await controller.refresh()).state, 'disconnected');
  current = { getStatus: async () => ({ state: 'online', identity: { spaceName: 'Work' } }) };
  assert.equal((await controller.refresh()).state, 'online');
  assert.deepEqual(rendered.map((row) => row.state), ['disconnected', 'online']);
});
