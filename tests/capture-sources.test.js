const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaptureSources, sourceOptions, inspectWindowsSource } = require('../captureSources');

test('Windows preflight loads native APIs and rejects a null HWND without capture', { skip: process.platform !== 'win32' }, () => {
  assert.equal(inspectWindowsSource({ id: 'window:0:0' }), null);
});

test('Windows window enumeration and revalidation never request WGC thumbnails', async () => {
  const calls = [];
  const source = { id: 'window:123:0', name: 'Example' };
  const provider = createCaptureSources({ platform: 'win32', getSources: async (options) => { calls.push(options); return [source]; }, inspectWindow: () => ({ pid: 99, width: 800, height: 600 }) });
  const entries = await provider.list('window');
  assert.equal(entries.length, 1);
  assert.ok(await provider.revalidate(entries[0]));
  for (const call of calls) assert.deepEqual(call, { types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  assert.deepEqual(sourceOptions('screen', 'win32').thumbnailSize, { width: 240, height: 150 });
  assert.deepEqual(sourceOptions('window', 'darwin').thumbnailSize, { width: 240, height: 150 });
});

test('picker excludes own process, minimized/protected/invalid windows before selection', async () => {
  const rows = ['window:10:1', 'window:20:0', 'window:30:0', 'window:40:0', 'window:50:0'].map((id) => ({ id }));
  const inspected = [];
  const provider = createCaptureSources({ platform: 'win32', getSources: async () => rows, inspectWindow: (source) => {
    inspected.push(source.id);
    return source.id === 'window:50:0' ? { pid: 123 } : null;
  } });
  assert.deepEqual((await provider.list('window')).map((entry) => entry.source.id), ['window:50:0']);
  assert.equal(inspected.includes('window:10:1'), false);
});

test('closed, minimized and recycled window handles are rejected on revalidation', async () => {
  let rows = [{ id: 'window:123:0' }], identity = { pid: 55 };
  const provider = createCaptureSources({ platform: 'win32', getSources: async () => rows, inspectWindow: () => identity });
  const [entry] = await provider.list('window');
  identity = null;
  assert.equal(await provider.revalidate(entry), null);
  identity = { pid: 88 };
  assert.equal(await provider.revalidate(entry), null);
  rows = [];
  assert.equal(await provider.revalidate(entry), null);
});

test('native preflight failure does not silently permit an unchecked window', async () => {
  const provider = createCaptureSources({ platform: 'win32', getSources: async () => [{ id: 'window:123:0' }], inspectWindow: () => { throw new Error('native unavailable'); } });
  assert.deepEqual(await provider.list('window'), []);
});
