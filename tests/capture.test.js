const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CaptureStorage, copyCaptures, LIMITS, parseRange } = require('../captureStorage');
const { cropRect, videoSize, validRegion, normalizeRegion, matchingRegion } = require('../renderer/captureDomain');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-capture-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new CaptureStorage(root);
}
test('fixed regions validate integer pixel bounds and exact display/frame identity', () => {
  const region = { displayId: '42', displayWidth: 1280, displayHeight: 720, scaleFactor: 1.5, rotation: 0,
    frameWidth: 1920, frameHeight: 1080, x: 200, y: 100, width: 800, height: 600 };
  const display = { id: 42, size: { width: 1280, height: 720 }, scaleFactor: 1.5, rotation: 0, bounds: { x: -1280, y: 0 } };
  const frame = { width: 1920, height: 1080 };
  assert.deepEqual(normalizeRegion({ ...region, unwanted: 'ignored' }), region);
  assert.deepEqual(matchingRegion(region, display, frame), region);
  assert.deepEqual(matchingRegion(region, { ...display, bounds: { x: 3000, y: -500 } }, frame), region);
  for (const patch of [{ x: -1 }, { y: NaN }, { width: 1 }, { height: 2.5 }, { x: 1900 }, { frameWidth: Infinity }, { scaleFactor: 0 }, { rotation: 45 }, { displayId: '../42' }]) {
    assert.equal(normalizeRegion({ ...region, ...patch }), null, JSON.stringify(patch));
  }
  for (const patch of [{ id: 43 }, { scaleFactor: 2 }, { rotation: 90 }, { size: { width: 1920, height: 1080 } }]) {
    assert.equal(matchingRegion(region, { ...display, ...patch }, frame), null);
  }
  assert.equal(matchingRegion(region, display, { width: 1280, height: 720 }), null);
  assert.equal(validRegion({ x: 1918, y: 1078, width: 2, height: 2 }, 1920, 1080), true);
  assert.deepEqual(videoSize(321, 181, 'native'), { width: 320, height: 180 });
});
const meta = { width: 1280, height: 720, mimeType: 'video/webm;codecs=vp8', audio: 'none' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');

test('video writer commits ordered bytes only after finish; paths are portable', async (t) => {
  const storage = fixture(t);
  const id = await storage.begin(meta);
  assert.equal(storage.list()[0].status, 'incomplete');
  await assert.rejects(storage.append(1, Buffer.from('bad')), /invalid_sequence/);
  await storage.append(0, Buffer.from('first'));
  await assert.rejects(storage.append(0, Buffer.from('duplicate')), /invalid_sequence/);
  await storage.append(1, Buffer.from('last'));
  await assert.rejects(storage.append(2, Buffer.alloc(LIMITS.chunk + 1)), /size_limit/);
  const item = await storage.finish(5000);
  assert.equal(item.id, id); assert.equal(item.status, 'complete'); assert.equal(item.bytes, 9);
  assert.equal(item.path, `captures/videos/${id}.webm`);
  assert.equal(fs.readFileSync(storage.resolve(id, true).file, 'utf8'), 'firstlast');
  assert.equal(fs.existsSync(path.join(storage.root, 'captures/videos', `${id}.partial`)), false);
  await assert.rejects(storage.append(2, Buffer.from('late')), /writer_unavailable/);
});

test('abort retains incomplete data, excludes preview, and allows explicit deletion', async (t) => {
  const storage = fixture(t), id = await storage.begin(meta);
  await storage.append(0, Buffer.from('partial'));
  assert.throws(() => storage.remove(id), /busy/);
  await storage.abort();
  assert.equal(storage.list()[0].status, 'incomplete');
  assert.throws(() => storage.resolve(id, true), /not_found/);
  assert.equal(fs.readFileSync(storage.resolve(id).file, 'utf8'), 'partial');
  storage.remove(id); assert.deepEqual(storage.list(), []);
});

test('reject concurrent writes and finish before acknowledgement', async (t) => {
  const storage = fixture(t); await storage.begin(meta);
  const pending = storage.append(0, Buffer.alloc(1024));
  await assert.rejects(storage.append(1, Buffer.alloc(8)), /writer_unavailable/);
  await assert.rejects(storage.finish(10), /writer_unavailable/);
  await pending; await storage.finish(10);
});

test('disk failure never commits a complete video', async (t) => {
  const storage = fixture(t); await storage.begin(meta);
  const handle = storage.active.handle;
  handle.write = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  await assert.rejects(storage.append(0, Buffer.from('video')), /disk full/);
  await assert.rejects(storage.finish(100), /writer_unavailable/);
  await storage.abort(); assert.equal(storage.list()[0].status, 'incomplete');
});

test('cancelling before the first video chunk removes only the empty draft', async (t) => {
  const storage = fixture(t); await storage.begin(meta);
  await storage.abort(); assert.deepEqual(storage.list(), []);
});

test('image metadata comes from PNG bytes; invalid bytes and dimensions rejected', async (t) => {
  const storage = fixture(t), row = await storage.saveImage(png);
  assert.equal(row.width, 1); assert.equal(row.height, 1); assert.equal(row.mimeType, 'image/png');
  await assert.rejects(storage.saveImage(Buffer.from('not png')), /invalid_png/);
  const malicious = Buffer.from(png); malicious.writeUInt32BE(1000000, 16);
  await assert.rejects(storage.saveImage(malicious), /invalid_dimensions/);
  assert.throws(() => storage.safe('captures/../private'), /invalid_path/);
  storage.rename(row.id, 'Example'); assert.equal(storage.list()[0].title, 'Example');
  assert.throws(() => storage.rename(row.id, ' '), /invalid_title/);
});

test('symbolic link directories cannot be read or written', async (t) => {
  const storage = fixture(t), outside = fixture(t);
  fs.symlinkSync(outside.root, path.join(storage.root, 'captures'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => storage.list(), /unsafe_path/);
  await assert.rejects(storage.saveImage(png), /unsafe_path/);
});

test('workspace migration merges both libraries without replacing media', async (t) => {
  const source = fixture(t), target = fixture(t);
  const original = await source.saveImage(png), retained = await target.saveImage(png);
  copyCaptures(source.root, target.root);
  copyCaptures(source.root, target.root);
  assert.deepEqual(new Set(target.list().map((row) => row.id)), new Set([original.id, retained.id]));
  assert.deepEqual(fs.readFileSync(target.resolve(original.id).file), png);
  assert.equal(source.list().length, 1);
});

test('Range parsing handles seek, suffix, and invalid multipart requests', () => {
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199, partial: true });
  assert.deepEqual(parseRange('bytes=-50', 1000), { start: 950, end: 999, partial: true });
  assert.deepEqual(parseRange('bytes=990-', 1000), { start: 990, end: 999, partial: true });
  assert.deepEqual(parseRange(null, 1000), { start: 0, end: 999, partial: false });
  for (const header of ['bytes=9999-', 'bytes=10-5', 'bytes=0-2,4-6', 'bytes=-0', 'bytes=-', 'bytes=NaN-']) assert.equal(parseRange(header, 1000), null);
});

test('region conversion uses actual frame ratios, clamps edges, handles reversed drag', () => {
  const rect = { left: -1800, top: 200, width: 1000, height: 500 };
  assert.deepEqual(cropRect({ x: -1600, y: 300 }, { x: -1200, y: 500 }, rect, 1500, 1000), { x: 300, y: 200, width: 600, height: 400 });
  assert.deepEqual(cropRect({ x: -1200, y: 500 }, { x: -1600, y: 300 }, rect, 1500, 1000), { x: 300, y: 200, width: 600, height: 400 });
  assert.deepEqual(cropRect({ x: -2000, y: 100 }, { x: 0, y: 900 }, rect, 1500, 1000), { x: 0, y: 0, width: 1500, height: 1000 });
  assert.equal(cropRect({ x: 1, y: 1 }, { x: 1, y: 1 }, rect, 1500, 1000), null);
  assert.deepEqual(videoSize(3840, 2160, '1080'), { width: 1920, height: 1080 });
  assert.deepEqual(videoSize(640, 480, '1080'), { width: 640, height: 480 });
});
