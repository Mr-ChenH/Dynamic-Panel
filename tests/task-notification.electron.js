const assert = require('node:assert/strict');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');

const profile = process.env.TODO_TEST_USER_DATA;
if (!profile) throw new Error('TODO_TEST_USER_DATA is required');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');

const errors = [];
const deadline = setTimeout(() => {
  console.error('Task notification lifecycle test timed out', errors);
  app.exit(1);
}, 30000);

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
});

require('../main.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function postNotification(payload) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: 43821,
      path: '/notify/codex',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify(payload));
  });
}

async function main() {
  await app.whenReady();

  await waitFor(async () => {
    try {
      const response = await new Promise((resolve, reject) => {
        const request = http.get('http://127.0.0.1:43821/health', resolve);
        request.on('error', reject);
      });
      response.resume();
      return response.statusCode === 200;
    } catch (error) {
      return false;
    }
  }, 'notification server');

  const accepted = await postNotification({
    title: 'Electron notification lifecycle',
    project: 'P0 verification',
    task_id: 'electron-notification-lifecycle',
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.ok, true);

  const notificationWindow = await waitFor(
    () => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Dynamic Panel 提醒'),
    'notification BrowserWindow'
  );
  await waitFor(
    () => notificationWindow.webContents.executeJavaScript(`!document.getElementById('notification-root').hidden && document.getElementById('notification-title').textContent === 'Electron notification lifecycle'`),
    'notification renderer projection'
  );
  assert.equal(notificationWindow.isFocused(), false);
  assert.equal(notificationWindow.isAlwaysOnTop(), true);

  await notificationWindow.webContents.executeJavaScript("document.getElementById('notification-shell').click()");
  await waitFor(
    () => notificationWindow.isDestroyed() || !BrowserWindow.getAllWindows().includes(notificationWindow),
    'notification window disposal'
  );
  assert.deepEqual(errors, []);
  console.log('Task notification Electron lifecycle passed');
  clearTimeout(deadline);
  app.quit();
}

main().catch((error) => {
  console.error('Task notification lifecycle failed', error);
  clearTimeout(deadline);
  app.exit(1);
});
