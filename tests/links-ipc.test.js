const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerLinksIpc } = require('../main/ipc/links');

function createHarness({ aiAvailable = true } = {}) {
  const handlers = new Map();
  const calls = [];
  const aiModelService = aiAvailable ? {
    run: async (ownerId, payload) => { calls.push({ ownerId, payload }); return { ok: true, payload }; },
  } : null;
  registerLinksIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    inspectLink: (url, ownerId) => ({ url, ownerId }),
    getAIModelService: () => aiModelService,
    crypto: { createHash: crypto.createHash, randomUUID: () => 'request-id' },
    now: () => '2026-09-18T00:00:00.000Z',
    timeZone: () => 'Asia/Shanghai',
  });
  return { handlers, calls };
}

test('links IPC scopes inspection to the sender and preserves smart material identity', async () => {
  const { handlers, calls } = createHarness();
  const event = { sender: { id: 17 } };
  assert.deepEqual(await handlers.get('links:inspect')(event, 'https://example.com'), {
    url: 'https://example.com', ownerId: 17,
  });
  const result = await handlers.get('smart:organize-material')(event, {
    kind: 'note', sourceId: ' note-1 ', text: '  Project notes  ',
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].ownerId, 17);
  assert.equal(calls[0].payload.action, 'nameNote');
  assert.equal(calls[0].payload.requestId, 'legacy-request-id');
  assert.deepEqual(calls[0].payload.context, {
    sourceType: 'note',
    sourceId: 'note-1',
    sourceRevision: crypto.createHash('sha256').update('note\0note-1\0Project notes').digest('hex'),
    text: 'Project notes',
  });
  assert.equal(calls[0].payload.referenceTime, '2026-09-18T00:00:00.000Z');
  assert.equal(calls[0].payload.timeZone, 'Asia/Shanghai');
});

test('smart material IPC validates input before invoking AI', async () => {
  const { handlers, calls } = createHarness({ aiAvailable: false });
  const event = { sender: { id: 1 } };
  assert.deepEqual(await handlers.get('smart:organize-material')(event, { text: '   ' }), { ok: false, error: 'empty_text' });
  assert.deepEqual(await handlers.get('smart:organize-material')(event, { text: 'x'.repeat(12_001) }), {
    ok: false, error: 'input_too_long', limit: 12_000,
  });
  assert.deepEqual(await handlers.get('smart:organize-material')(event, { text: 'valid' }), { ok: false, error: 'not_configured' });
  assert.equal(calls.length, 0);
});
