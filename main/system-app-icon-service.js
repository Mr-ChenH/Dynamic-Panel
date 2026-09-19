const DEFAULT_ICON_QUEUE_TIMEOUT_MS = 10000;
const DEFAULT_ICON_CONCURRENCY = 2;
const DEFAULT_JXA_TIMEOUT_MS = 4000;
const DEFAULT_READ_TIMEOUT_MS = 2800;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const ICNS_PREFERENCE = ['ic07', 'ic12', 'ic08', 'ic11', 'ic13', 'ic09', 'ic14', 'ic05', 'ic04'];

const SYSTEM_ICON_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const size = 96;
  const source = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  image.lockFocus;
  source.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSZeroRect,
    $.NSCompositingOperationSourceOver,
    1
  );
  image.unlockFocus;
  const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  return ObjC.unwrap(data.base64EncodedStringWithOptions(0));
}`;

function createSystemAppIconService(options = {}) {
  const fs = options.fs || require('fs');
  const path = options.path || require('path');
  const execFile = options.execFile || require('child_process').execFile;
  const platform = options.platform || process.platform;
  const iconConcurrency = Number.isInteger(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : DEFAULT_ICON_CONCURRENCY;
  const queueTimeoutMs = Number.isFinite(options.queueTimeoutMs)
    ? Math.max(1, options.queueTimeoutMs)
    : DEFAULT_ICON_QUEUE_TIMEOUT_MS;
  const jxaTimeoutMs = Number.isFinite(options.jxaTimeoutMs)
    ? Math.max(1, options.jxaTimeoutMs)
    : DEFAULT_JXA_TIMEOUT_MS;
  const readTimeoutMs = Number.isFinite(options.readTimeoutMs)
    ? Math.max(1, options.readTimeoutMs)
    : DEFAULT_READ_TIMEOUT_MS;
  let active = 0;
  const queue = [];

  function extractPngFromIcns(buffer) {
    if (!buffer || buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'icns') return null;
    const candidates = [];
    let offset = 8;
    while (offset + 8 <= buffer.length) {
      const type = buffer.toString('ascii', offset, offset + 4);
      const length = buffer.readUInt32BE(offset + 4);
      if (length < 8 || offset + length > buffer.length) break;
      const data = buffer.subarray(offset + 8, offset + length);
      if (data.length > 8 && data.subarray(0, 4).equals(PNG_SIGNATURE)) {
        candidates.push({ type, data });
      }
      offset += length;
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ia = ICNS_PREFERENCE.indexOf(a.type);
      const ib = ICNS_PREFERENCE.indexOf(b.type);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return candidates[0].data;
  }

  async function readEmbeddedAppIcon(appPath) {
    try {
      const resourcesPath = path.join(appPath, 'Contents', 'Resources');
      const files = await fs.promises.readdir(resourcesPath);
      const icnsFiles = files.filter((file) => file.toLowerCase().endsWith('.icns'));
      if (!icnsFiles.length) return null;
      const score = (name) => {
        const lower = name.toLowerCase();
        if (lower === 'appicon.icns') return 0;
        if (lower.includes('app')) return 1;
        if (lower.includes('icon')) return 2;
        return 3;
      };
      icnsFiles.sort((a, b) => score(a) - score(b) || a.length - b.length);
      const buffer = await fs.promises.readFile(path.join(resourcesPath, icnsFiles[0]));
      const png = extractPngFromIcns(buffer);
      return png ? `data:image/png;base64,${png.toString('base64')}` : null;
    } catch (error) {
      return null;
    }
  }

  function readSystemAppIconNow(appPath) {
    return new Promise((resolve) => {
      execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', SYSTEM_ICON_JXA, appPath],
        { timeout: jxaTimeoutMs, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => {
          const base64 = typeof stdout === 'string' ? stdout.trim() : '';
          if (error || !base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
            resolve(null);
            return;
          }
          resolve(`data:image/png;base64,${base64}`);
        }
      );
    });
  }

  function pumpQueue() {
    while (active < iconConcurrency && queue.length) {
      const job = queue.shift();
      if (job.cancelled) continue;
      active++;
      readSystemAppIconNow(job.appPath)
        .then(job.finish, () => job.finish(null))
        .finally(() => {
          active--;
          pumpQueue();
        });
    }
  }

  function readSystemAppIcon(appPath) {
    if (platform !== 'darwin') return Promise.resolve(null);
    return new Promise((resolve) => {
      const job = {
        appPath,
        cancelled: false,
        settled: false,
        timer: null,
        finish(value) {
          if (job.settled) return;
          job.settled = true;
          if (job.timer) clearTimeout(job.timer);
          resolve(value);
        },
      };
      job.timer = setTimeout(() => {
        job.cancelled = true;
        job.finish(null);
      }, queueTimeoutMs);
      queue.push(job);
      pumpQueue();
    });
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  async function readWindowAppIcon(appPath) {
    const systemIcon = await withTimeout(readSystemAppIcon(appPath), readTimeoutMs, null);
    return systemIcon || readEmbeddedAppIcon(appPath);
  }

  return {
    extractPngFromIcns,
    readEmbeddedAppIcon,
    readSystemAppIcon,
    readWindowAppIcon,
    withTimeout,
  };
}

module.exports = { createSystemAppIconService };
