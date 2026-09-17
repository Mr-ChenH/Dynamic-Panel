// Do not capture every Windows window merely to populate a source picker.
// WGC CreateForWindow can reject shell, minimized, protected or stale HWNDs.
let nativeInspector;
function inspectWindowsSource(source) {
  if (!nativeInspector) {
    const ffi = require('koffi');
    const user = ffi.load('user32.dll'), dwm = ffi.load('dwmapi.dll');
    const exists = user.func('int __stdcall IsWindow(void *)');
    const visible = user.func('int __stdcall IsWindowVisible(void *)');
    const minimized = user.func('int __stdcall IsIconic(void *)');
    const processFor = user.func('uint32_t __stdcall GetWindowThreadProcessId(void *, void *)');
    const rectFor = user.func('int __stdcall GetWindowRect(void *, void *)');
    const affinityFor = user.func('int __stdcall GetWindowDisplayAffinity(void *, void *)');
    const attribute = dwm.func('int32_t __stdcall DwmGetWindowAttribute(void *, uint32_t, void *, uint32_t)');
    nativeInspector = (id) => {
      const match = /^window:(\d+):[01]$/.exec(id);
      if (!match) return null;
      const handle = BigInt(match[1]);
      if (!handle || !exists(handle) || !visible(handle) || minimized(handle)) return null;
      const pid = Buffer.alloc(4), rect = Buffer.alloc(16), cloaked = Buffer.alloc(4), affinity = Buffer.alloc(4);
      if (!processFor(handle, pid) || !pid.readUInt32LE() || pid.readUInt32LE() === process.pid || !rectFor(handle, rect)) return null;
      const width = rect.readInt32LE(8) - rect.readInt32LE(0), height = rect.readInt32LE(12) - rect.readInt32LE(4);
      if (width <= 0 || height <= 0) return null;
      if (attribute(handle, 14 /* DWMWA_CLOAKED */, cloaked, 4) === 0 && cloaked.readUInt32LE()) return null;
      if (affinityFor(handle, affinity) && affinity.readUInt32LE()) return null;
      return { pid: pid.readUInt32LE(), width, height };
    };
  }
  return nativeInspector(source.id);
}

function sourceOptions(type, platform, metadataOnly = false) {
  const preview = !metadataOnly && !(platform === 'win32' && type === 'window');
  return { types: [type], thumbnailSize: preview ? { width: 240, height: 150 } : { width: 0, height: 0 }, fetchWindowIcons: false };
}

function createCaptureSources({ getSources, platform = process.platform, inspectWindow = inspectWindowsSource }) {
  function inspect(source, type) {
    if (!source || !source.id.startsWith(`${type}:`) || (type === 'window' && source.id.endsWith(':1'))) return null;
    if (platform !== 'win32' || type !== 'window') return {};
    // If the native preflight cannot run, do not guess that the HWND is safe.
    try { return inspectWindow(source); } catch { return null; }
  }
  return {
    async list(type) {
      const sources = await getSources(sourceOptions(type, platform));
      return sources.flatMap((source) => { const identity = inspect(source, type); return identity ? [{ source, identity, type }] : []; }).slice(0, 120);
    },
    async revalidate(entry) {
      const sources = await getSources(sourceOptions(entry.type, platform, true));
      const source = sources.find((candidate) => candidate.id === entry.source.id);
      const identity = inspect(source, entry.type);
      // Also reject HWND reuse by another process between selection and start.
      if (!identity || (entry.identity.pid && entry.identity.pid !== identity.pid)) return null;
      return { ...entry, source, identity };
    },
  };
}

module.exports = { createCaptureSources, sourceOptions, inspectWindowsSource };
