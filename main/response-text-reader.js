'use strict';

function createBoundedResponseTextReader({ maxBytes, BufferImpl = Buffer } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes is required');
  return async function readResponseText(response) {
    if (!response?.body || typeof response.body.getReader !== 'function') return '';
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : BufferImpl.from(value);
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(BufferImpl.from(chunk));
    }
    return BufferImpl.concat(chunks).toString('utf8');
  };
}

module.exports = { createBoundedResponseTextReader };
