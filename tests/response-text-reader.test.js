const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedResponseTextReader } = require('../main/response-text-reader');

function responseFromChunks(chunks) {
  let index = 0;
  let cancelled = false;
  return {
    cancelled: () => cancelled,
    body: {
      getReader: () => ({
        read: async () => index >= chunks.length ? { done: true } : { done: false, value: chunks[index++] },
        cancel: async () => { cancelled = true; },
      }),
    },
  };
}

test('bounded response text reader joins UTF-8 chunks and handles missing bodies', async () => {
  const readResponseText = createBoundedResponseTextReader({ maxBytes: 32 });
  const response = responseFromChunks([Buffer.from('hello '), new Uint8Array(Buffer.from('world'))]);
  assert.equal(await readResponseText(response), 'hello world');
  assert.equal(await readResponseText({}), '');
});

test('bounded response text reader cancels before retaining an oversized chunk', async () => {
  const readResponseText = createBoundedResponseTextReader({ maxBytes: 5 });
  const response = responseFromChunks([Buffer.from('hello'), Buffer.from('!')]);
  assert.equal(await readResponseText(response), 'hello');
  assert.equal(response.cancelled(), true);
});

test('bounded response text reader validates its byte limit', () => {
  assert.throws(() => createBoundedResponseTextReader({ maxBytes: -1 }), /maxBytes is required/);
  assert.throws(() => createBoundedResponseTextReader({}), /maxBytes is required/);
});
