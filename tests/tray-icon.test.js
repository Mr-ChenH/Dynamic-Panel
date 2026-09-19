const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotchTrayIcon, makeNotchPng } = require('../main/tray-icon');

test('tray icon generator emits a valid transparent PNG buffer', () => {
  const png = makeNotchPng(2);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND');
});

test('tray icon factory uses the legacy Windows icon resource', () => {
  const calls = [];
  const nativeImage = {
    createFromPath(filePath) {
      calls.push(filePath);
      return { resize: (size) => ({ size }) };
    },
  };
  const icon = createNotchTrayIcon({
    platform: 'win32',
    nativeImage,
    path: require('node:path'),
    resourcesRoot: 'C:/DynamicPanel',
  });
  assert.equal(calls[0], require('node:path').join('C:/DynamicPanel', 'build', 'to-do-panel-icon.png'));
  assert.deepEqual(icon, { size: { width: 32, height: 32 } });
});

test('tray icon factory marks the generated macOS icon as a template image', () => {
  let template = false;
  const nativeImage = {
    createFromBuffer(buffer, options) {
      assert.equal(buffer[0], 0x89);
      assert.deepEqual(options, { scaleFactor: 2 });
      return { setTemplateImage: (value) => { template = value; } };
    },
  };
  createNotchTrayIcon({ platform: 'darwin', nativeImage });
  assert.equal(template, true);
});
