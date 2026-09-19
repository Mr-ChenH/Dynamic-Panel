const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystemAppIconService } = require('../main/system-app-icon-service');

function icnsWithPngEntries(entries) {
  const chunks = entries.map(({ type, bytes }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(bytes.length + 8, 4);
    return Buffer.concat([header, bytes]);
  });
  const output = Buffer.alloc(8);
  output.write('icns', 0, 4, 'ascii');
  output.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([output, ...chunks]);
}

test('system app icon service prefers the configured ICNS PNG representation', () => {
  const service = createSystemAppIconService({ platform: 'win32' });
  const preferred = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
  const fallback = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6, 5]);
  const result = service.extractPngFromIcns(icnsWithPngEntries([
    { type: 'ic04', bytes: fallback },
    { type: 'ic07', bytes: preferred },
  ]));
  assert.deepEqual(result, preferred);
  assert.equal(service.extractPngFromIcns(Buffer.from('not-an-icns')), null);
});

test('system app icon service does not spawn macOS icon helpers on unsupported platforms', async () => {
  let calls = 0;
  const service = createSystemAppIconService({
    platform: 'win32',
    execFile: () => { calls += 1; },
  });
  assert.equal(await service.readSystemAppIcon('/Applications/Example.app'), null);
  assert.equal(calls, 0);
});

test('system app icon service falls back to an embedded AppIcon resource', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
  const files = ['Other.icns', 'AppIcon.icns'];
  const fs = {
    promises: {
      readdir: async () => files,
      readFile: async (file) => file.endsWith('AppIcon.icns')
        ? icnsWithPngEntries([{ type: 'ic07', bytes: png }])
        : icnsWithPngEntries([{ type: 'ic04', bytes: Buffer.from('wrong') }]),
    },
  };
  const service = createSystemAppIconService({
    platform: 'win32',
    fs,
    path: require('node:path'),
  });
  assert.equal(await service.readEmbeddedAppIcon('C:/Example.app'), `data:image/png;base64,${png.toString('base64')}`);
});
