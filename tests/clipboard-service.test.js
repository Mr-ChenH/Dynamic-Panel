const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createClipboardService } = require('../main/clipboard-service');
const { reduceClipboardObservation, createClipboardImageFingerprint } = require('../main-services');

test('clipboard service writes text through the injected clipboard and accepts repeated lifecycle stops', async () => {
  const writes = [];
  const service = createClipboardService({
    clipboard: {
      async read() { return []; },
      async writeText(value) { writes.push(value); },
      async write() {},
    },
    nativeImage: { createFromBuffer() { throw new Error('not used'); } },
    ClipboardItem: class ClipboardItem {},
    fs: { readFileSync() {}, promises: {} },
    path,
    workspaceFiles: {
      getSafeClipImagePath() { return null; },
      ensureClipImagesDir() {},
      getClipImagesDir() { return ''; },
    },
    readClipboardObservation: async () => ({ concealed: false, text: '', image: null }),
    prepareClipboardImagePayload: () => null,
    reduceClipboardObservation,
    createClipboardImageFingerprint,
    getMainWindow: () => null,
    portableImagePath: () => '',
    pollIntervalMs: 500,
    imagePollIntervalMs: 2000,
    imageDirectoryName: 'clipboard-images',
  });

  assert.equal(await service.writeEntry({ type: 'text', text: 'hello' }), true);
  assert.deepEqual(writes, ['hello']);
  service.stop();
  service.stop();
});
