let api;

function getApi() {
  if (api) return api;
  const ffi = require('koffi');
  const POINT = ffi.struct('CapturePoint', { x: 'int32_t', y: 'int32_t' });
  const user = ffi.load('user32.dll');
  const gdi = ffi.load('gdi32.dll');
  api = {
    POINT,
    getCursorPos: user.func('int __stdcall GetCursorPos(_Out_ CapturePoint *)'),
    monitorFromPoint: user.func('void * __stdcall MonitorFromPoint(CapturePoint, uint32_t)'),
    getMonitorInfo: user.func('int __stdcall GetMonitorInfoW(void *, _Inout_ void *)'),
    getDc: user.func('void * __stdcall GetDC(void *)'),
    releaseDc: user.func('int __stdcall ReleaseDC(void *, void *)'),
    createDc: gdi.func('void * __stdcall CreateCompatibleDC(void *)'),
    deleteDc: gdi.func('int __stdcall DeleteDC(void *)'),
    createBitmap: gdi.func('void * __stdcall CreateCompatibleBitmap(void *, int32_t, int32_t)'),
    deleteObject: gdi.func('int __stdcall DeleteObject(void *)'),
    selectObject: gdi.func('void * __stdcall SelectObject(void *, void *)'),
    bitBlt: gdi.func('int __stdcall BitBlt(void *, int32_t, int32_t, int32_t, int32_t, void *, int32_t, int32_t, uint32_t)'),
    getDibits: gdi.func('int __stdcall GetDIBits(void *, void *, uint32_t, uint32_t, _Out_ void *, _Inout_ void *, uint32_t)'),
  };
  return api;
}

function captureCursorDisplayBitmap() {
  if (process.platform !== 'win32') throw new Error('unsupported_platform');
  const native = getApi();
  const point = { x: 0, y: 0 };
  if (!native.getCursorPos(point)) throw new Error('cursor_unavailable');
  const monitor = native.monitorFromPoint(point, 2 /* MONITOR_DEFAULTTONEAREST */);
  if (!monitor) throw new Error('monitor_unavailable');
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  if (!native.getMonitorInfo(monitor, info)) throw new Error('monitor_unavailable');
  const left = info.readInt32LE(4), top = info.readInt32LE(8);
  const right = info.readInt32LE(12), bottom = info.readInt32LE(16);
  const width = right - left, height = bottom - top;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 1 || height <= 1
    || width > 32768 || height > 32768 || width * height > 64 * 1024 * 1024) throw new Error('invalid_dimensions');

  const screenDc = native.getDc(null);
  if (!screenDc) throw new Error('capture_failed');
  let memoryDc = null, bitmap = null, previous = null;
  try {
    memoryDc = native.createDc(screenDc);
    bitmap = memoryDc && native.createBitmap(screenDc, width, height);
    if (!memoryDc || !bitmap) throw new Error('capture_failed');
    previous = native.selectObject(memoryDc, bitmap);
    if (!previous || !native.bitBlt(memoryDc, 0, 0, width, height, screenDc, left, top, 0x40cc0020 /* SRCCOPY | CAPTUREBLT */)) throw new Error('capture_failed');
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(width, 4);
    header.writeInt32LE(-height, 8); // Top-down rows match Electron's bitmap layout.
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    const pixels = Buffer.allocUnsafe(width * height * 4);
    if (native.getDibits(memoryDc, bitmap, 0, height, pixels, header, 0) !== height) throw new Error('capture_failed');
    for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
    return { pixels, width, height };
  } finally {
    if (memoryDc && previous) native.selectObject(memoryDc, previous);
    if (bitmap) native.deleteObject(bitmap);
    if (memoryDc) native.deleteDc(memoryDc);
    native.releaseDc(null, screenDc);
  }
}

module.exports = { captureCursorDisplayBitmap };
