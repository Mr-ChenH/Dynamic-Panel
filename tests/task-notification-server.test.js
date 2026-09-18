const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createTaskNotificationServer } = require('../main/task-notification-server');

function request(port, method, pathname, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers: contentType ? { 'Content-Type': contentType } : {},
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

test('task notification server validates routes and delegates accepted payloads', async () => {
  let resolveListening;
  const listening = new Promise((resolve) => { resolveListening = resolve; });
  const received = [];
  const server = createTaskNotificationServer({
    http,
    host: '127.0.0.1',
    port: 0,
    sources: new Set(['codex']),
    bodyLimit: 128,
    normalize: (payload, source) => ({ payload, source }),
    enqueue: (value) => { received.push(value); return 'queued'; },
    onAvailabilityChange: (available) => { if (available) resolveListening(); },
    logger: { warn() {} },
  });
  server.start();
  await listening;
  const port = server.address().port;

  assert.deepEqual(await request(port, 'GET', '/health'), { status: 200, body: { ok: true } });
  assert.equal((await request(port, 'POST', '/notify/unknown', '{}')).status, 404);
  assert.equal((await request(port, 'POST', '/notify/codex', '{}', 'text/plain')).status, 415);
  assert.deepEqual(await request(port, 'POST', '/notify/codex', JSON.stringify({ title: 'Done' })), { status: 202, body: { ok: true, result: 'queued' } });
  assert.deepEqual(received, [{ payload: { title: 'Done' }, source: 'codex' }]);

  server.stop();
  assert.equal(server.isAvailable(), false);
});
