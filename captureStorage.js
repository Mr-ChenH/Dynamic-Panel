const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LIMITS = Object.freeze({ chunk: 4 * 1024 * 1024, queue: 32 * 1024 * 1024, image: 32 * 1024 * 1024, video: 4 * 1024 ** 3, duration: 60 * 60 * 1000, items: 5000, pixels: 64 * 1024 * 1024 });
const ID = /^[a-f0-9-]{36}$/;
const VIDEO_MIME = /^video\/webm(?:;codecs=(?:vp8|vp9)(?:,opus)?)?$/;

function check(condition, code) { if (!condition) throw new Error(code); }
function dimensions(width, height) {
  check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 32768 && height <= 32768 && width * height <= LIMITS.pixels, 'invalid_dimensions');
  return { width, height };
}
function bytes(value, limit) {
  check(value instanceof ArrayBuffer || ArrayBuffer.isView(value), 'invalid_bytes');
  const size = value.byteLength;
  check(size > 0 && size <= limit, 'size_limit');
  return value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end, partial: true } : null;
}

// Chromium emits streaming WebM without Duration. Reserve it in the first Info
// element, then patch only these eight bytes after recording, without rereading video.
function reserveWebmDuration(buffer) {
  function element(offset) {
    if (offset >= buffer.length) return null;
    let idLength = 1;
    while (idLength <= 4 && !(buffer[offset] & (0x80 >> (idLength - 1)))) idLength++;
    if (idLength > 4 || offset + idLength >= buffer.length) return null;
    const id = buffer.subarray(offset, offset + idLength).toString('hex');
    const sizeOffset = offset + idLength;
    let sizeLength = 1;
    while (sizeLength <= 8 && !(buffer[sizeOffset] & (0x80 >> (sizeLength - 1)))) sizeLength++;
    if (sizeLength > 8 || sizeOffset + sizeLength > buffer.length) return null;
    let size = buffer[sizeOffset] & ((0x80 >> (sizeLength - 1)) - 1);
    for (let index = 1; index < sizeLength; index++) size = size * 256 + buffer[sizeOffset + index];
    return { id, size, sizeOffset, sizeLength, data: sizeOffset + sizeLength };
  }
  const header = element(0);
  if (header?.id !== '1a45dfa3') return { buffer, offset: null };
  const segment = element(header.data + header.size);
  if (segment?.id !== '18538067') return { buffer, offset: null };
  const unknownSize = (buffer[segment.sizeOffset] & ((0x80 >> (segment.sizeLength - 1)) - 1)) === ((0x80 >> (segment.sizeLength - 1)) - 1)
    && buffer.subarray(segment.sizeOffset + 1, segment.data).every((value) => value === 255);
  if (!unknownSize) return { buffer, offset: null };
  let position = segment.data;
  while (position < Math.min(buffer.length, 65536)) {
    const entry = element(position);
    if (!entry || !Number.isSafeInteger(entry.size) || entry.data + entry.size > buffer.length) break;
    if (entry.id === '114d9b74') break; // Do not shift precomputed SeekHead offsets.
    if (entry.id === '1549a966') {
      // Chromium uses a one-byte Info size and the default millisecond timecode.
      if (entry.sizeLength !== 1 || entry.size + 11 >= 127) break;
      let scale = 1000000;
      for (let p = entry.data; p < entry.data + entry.size;) {
        const child = element(p);
        if (!child || child.data + child.size > entry.data + entry.size) return { buffer, offset: null };
        if (child.id === '4489' && child.size === 8) return { buffer, offset: child.data };
        if (child.id === '2ad7b1') { scale = 0; for (let j = 0; j < child.size; j++) scale = scale * 256 + buffer[child.data + j]; }
        p = child.data + child.size;
      }
      if (scale !== 1000000) break;
      const duration = Buffer.alloc(11); duration[0] = 0x44; duration[1] = 0x89; duration[2] = 0x88;
      const result = Buffer.concat([buffer.subarray(0, entry.data + entry.size), duration, buffer.subarray(entry.data + entry.size)]);
      result[entry.sizeOffset] = 0x80 | (entry.size + 11);
      return { buffer: result, offset: entry.data + entry.size + 3 };
    }
    position = entry.data + entry.size;
  }
  return { buffer, offset: null };
}

class CaptureStorage {
  constructor(root) { this.root = path.resolve(root); this.active = null; }
  safe(relative, createParent = false) {
    check(/^captures\/(?:index\.json|(?:screenshots|videos)\/[a-f0-9-]{36}\.(?:png|webm|partial))$/.test(relative), 'invalid_path');
    const parts = relative.split('/');
    let target = this.root;
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index]);
      if (index < parts.length - 1 && createParent && !fs.existsSync(target)) fs.mkdirSync(target);
      try {
        const stat = fs.lstatSync(target);
        check(!stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()), 'unsafe_path');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  readIndex() {
    const file = this.safe('captures/index.json');
    if (!fs.existsSync(file)) return [];
    check(fs.statSync(file).size <= 4 * 1024 * 1024, 'index_too_large');
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    check(index?.version === 1 && Array.isArray(index.items) && index.items.length <= LIMITS.items, 'invalid_index');
    check(index.items.every((row) => ID.test(row.id) && ['screenshot', 'video'].includes(row.kind)
      && ['complete', 'incomplete'].includes(row.status) && typeof row.title === 'string' && row.title.length <= 120
      && row.path === `captures/${row.kind === 'screenshot' ? 'screenshots' : 'videos'}/${row.id}.${row.kind === 'screenshot' ? 'png' : row.status === 'complete' ? 'webm' : 'partial'}`), 'invalid_index');
    return index.items;
  }
  writeIndex(items) {
    check(items.length <= LIMITS.items, 'library_full');
    const file = this.safe('captures/index.json', true);
    const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, items }), { flag: 'wx' });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  list() {
    return this.readIndex().map((row) => {
      let file = this.safe(row.path);
      // A crash between the final rename and index commit leaves an incomplete entry.
      if (!fs.existsSync(file) && row.status === 'incomplete') file = this.safe(`captures/videos/${row.id}.webm`);
      return { ...row, bytes: fs.existsSync(file) ? fs.statSync(file).size : 0, missing: !fs.existsSync(file) };
    });
  }
  resolve(id, completeOnly = false) {
    check(ID.test(id), 'invalid_id');
    const item = this.readIndex().find((row) => row.id === id);
    check(item && (!completeOnly || item.status === 'complete'), 'not_found');
    let file = this.safe(item.path);
    if (!fs.existsSync(file) && item.status === 'incomplete') file = this.safe(`captures/videos/${id}.webm`);
    check(fs.existsSync(file), 'file_missing');
    return { item, file };
  }
  async saveImage(value) {
    const buffer = bytes(value, LIMITS.image);
    check(buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && buffer.toString('ascii', 12, 16) === 'IHDR', 'invalid_png');
    const size = dimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
    const items = this.readIndex();
    check(items.length < LIMITS.items, 'library_full');
    const id = randomUUID();
    const item = { id, kind: 'screenshot', title: '截图', createdAt: Date.now(), path: `captures/screenshots/${id}.png`, mimeType: 'image/png', status: 'complete', bytes: buffer.length, ...size };
    const file = this.safe(item.path, true);
    await fs.promises.writeFile(file, buffer, { flag: 'wx' });
    try { this.writeIndex([item, ...this.readIndex()]); }
    catch (error) { await fs.promises.unlink(file); throw error; }
    return item;
  }
  async begin(meta) {
    check(!this.active, 'busy');
    const size = dimensions(meta.width, meta.height);
    check(VIDEO_MIME.test(meta.mimeType) && ['none', 'microphone'].includes(meta.audio), 'invalid_format');
    const items = this.readIndex();
    check(items.length < LIMITS.items, 'library_full');
    const id = randomUUID();
    const item = { id, kind: 'video', title: '录屏', createdAt: Date.now(), path: `captures/videos/${id}.partial`, mimeType: meta.mimeType, audio: meta.audio, status: 'incomplete', ...size };
    const task = { item, handle: null, sequence: 0, bytes: 0, writing: false, failed: false, durationOffset: null, pending: Promise.resolve() };
    this.active = task;
    try {
      task.handle = await fs.promises.open(this.safe(item.path, true), 'wx');
      this.writeIndex([item, ...items]);
    } catch (error) {
      if (task.handle) {
        await task.handle.close();
        await fs.promises.unlink(this.safe(item.path)).catch(() => {});
      }
      this.active = null; throw error;
    }
    return id;
  }
  async append(sequence, value) {
    const task = this.active;
    check(task && !task.failed && !task.writing, 'writer_unavailable');
    check(sequence === task.sequence, 'invalid_sequence');
    let buffer = bytes(value, LIMITS.chunk);
    if (task.sequence === 0) {
      const reserved = reserveWebmDuration(buffer);
      buffer = reserved.buffer; task.durationOffset = reserved.offset;
    }
    check(task.bytes + buffer.length <= LIMITS.video, 'video_limit');
    task.writing = true;
    task.pending = (async () => {
      try {
        let offset = 0;
        while (offset < buffer.length) {
          const result = await task.handle.write(buffer, offset, buffer.length - offset);
          check(result.bytesWritten > 0, 'write_failed');
          offset += result.bytesWritten;
        }
        task.bytes += buffer.length;
        task.sequence++;
      } catch (error) { task.failed = true; task.failedWrite = true; throw error; }
      finally { task.writing = false; }
    })();
    await task.pending;
    return { bytes: task.bytes };
  }
  async finish(durationMs) {
    const task = this.active;
    check(task && !task.failed && !task.writing && task.bytes > 0, 'writer_unavailable');
    check(Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= LIMITS.duration + 10000, 'invalid_duration');
    task.failed = true; // Reject all later writes while closing/committing.
    if (task.durationOffset !== null) {
      const duration = Buffer.alloc(8); duration.writeDoubleBE(durationMs);
      let offset = 0;
      while (offset < duration.length) {
        const result = await task.handle.write(duration, offset, duration.length - offset, task.durationOffset + offset);
        check(result.bytesWritten > 0, 'write_failed'); offset += result.bytesWritten;
      }
    }
    await task.handle.sync();
    await task.handle.close();
    task.handle = null;
    const item = { ...task.item, status: 'complete', durationMs: Math.round(durationMs), bytes: task.bytes, path: `captures/videos/${task.item.id}.webm` };
    await fs.promises.rename(this.safe(task.item.path), this.safe(item.path));
    this.writeIndex(this.readIndex().map((row) => row.id === item.id ? item : row));
    this.active = null;
    return item;
  }
  async abort() {
    const task = this.active;
    if (!task) return;
    task.failed = true;
    await task.pending.catch(() => {});
    await task.handle?.close().catch(() => {});
    this.active = null;
    if (task.bytes === 0 && !task.failedWrite) {
      const item = this.readIndex().find((row) => row.id === task.item.id);
      const file = this.safe(task.item.path);
      if (item && fs.existsSync(file) && fs.statSync(file).size === 0) this.remove(task.item.id);
    }
  }
  rename(id, title) {
    check(typeof title === 'string' && title.trim().length > 0 && title.trim().length <= 120, 'invalid_title');
    const items = this.readIndex();
    check(items.some((row) => row.id === id), 'not_found');
    this.writeIndex(items.map((row) => row.id === id ? { ...row, title: title.trim() } : row));
  }
  remove(id) {
    check(this.active?.item.id !== id, 'busy');
    const items = this.readIndex();
    const item = items.find((row) => row.id === id);
    check(item, 'not_found');
    let file = this.safe(item.path);
    if (!fs.existsSync(file) && item.status === 'incomplete') file = this.safe(`captures/videos/${id}.webm`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    this.writeIndex(items.filter((row) => row.id !== id));
  }
}

// Merge the index without overwriting an existing destination library or following links.
function copyCaptures(sourceRoot, targetRoot) {
  if (path.resolve(sourceRoot) === path.resolve(targetRoot)) return;
  const source = new CaptureStorage(sourceRoot), target = new CaptureStorage(targetRoot);
  const from = source.readIndex();
  if (!from.length) return;
  const into = target.readIndex();
  const existing = new Set(into.map((item) => item.id));
  const added = from.filter((item) => !existing.has(item.id));
  check(into.length + added.length <= LIMITS.items, 'library_full');
  const created = [];
  try {
    for (const item of added) {
      const resolved = source.resolve(item.id);
      const destination = target.safe(item.path, true);
      if (fs.existsSync(destination)) throw new Error('destination_conflict');
      fs.copyFileSync(resolved.file, destination, fs.constants.COPYFILE_EXCL);
      created.push(destination);
    }
    target.writeIndex([...added, ...into]);
  } catch (error) {
    for (const file of created) { try { fs.unlinkSync(file); } catch {} }
    throw error;
  }
}

module.exports = { CaptureStorage, copyCaptures, LIMITS, parseRange, dimensions, reserveWebmDuration };
