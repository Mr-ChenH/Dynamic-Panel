const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranscriptionService } = require('../main/transcription-service');

test('transcription service reports missing configuration without opening a socket', () => {
  let opened = false;
  class FakeWebSocket { constructor() { opened = true; } }
  const service = createTranscriptionService({
    WebSocket: FakeWebSocket,
    getConfig: () => ({ apiKey: '' }),
    sampleRate: 16000,
    finishTimeoutMs: 100,
    eventId: () => 'event-1',
    urlFor: () => 'wss://example.invalid',
  });
  assert.deepEqual(service.start(1, { isDestroyed: () => false }), { ok: false, error: 'not_configured' });
  assert.equal(opened, false);
});
