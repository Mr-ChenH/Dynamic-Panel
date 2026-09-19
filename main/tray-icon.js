const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) {
    const offset = row * (1 + width * 4);
    pixels.copy(scanlines, offset + 1, row * width * 4, (row + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeNotchPng(scale) {
  const size = 16 * scale;
  const pixels = Buffer.alloc(size * size * 4);
  const width = 10 * scale;
  const height = 5 * scale;
  const radius = 2 * scale;
  const left = (size - width) / 2;
  const top = 3.5 * scale;

  function isInside(x, y) {
    if (x < left || x > left + width || y < top || y > top + height) return false;
    const bottom = top + height - radius;
    if (y < bottom) return true;
    const leftCorner = left + radius;
    const rightCorner = left + width - radius;
    if (x >= leftCorner && x <= rightCorner) return true;
    const dx = x < leftCorner ? leftCorner - x : x - rightCorner;
    const dy = y - bottom;
    return dx * dx + dy * dy <= radius * radius;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let count = 0;
      for (let subY = 0; subY < 4; subY++) {
        for (let subX = 0; subX < 4; subX++) {
          if (isInside(x + (subX + 0.5) / 4, y + (subY + 0.5) / 4)) count++;
        }
      }
      pixels[(y * size + x) * 4 + 3] = Math.round((count / 16) * 255);
    }
  }
  return encodePng(size, size, pixels);
}

function createNotchTrayIcon(options = {}) {
  const platform = options.platform || process.platform;
  const nativeImage = options.nativeImage;
  const path = options.path || require('path');
  if (!nativeImage) throw new Error('nativeImage is required');
  if (platform === 'win32') {
    return nativeImage.createFromPath(path.join(options.resourcesRoot || __dirname, 'build', 'to-do-panel-icon.png'))
      .resize({ width: 32, height: 32 });
  }
  const icon = nativeImage.createFromBuffer(makeNotchPng(2), { scaleFactor: 2 });
  icon.setTemplateImage(true);
  return icon;
}

module.exports = { crc32, encodePng, makeNotchPng, createNotchTrayIcon };
