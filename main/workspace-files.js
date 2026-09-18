function createWorkspaceFiles({
  fs,
  path,
  crypto,
  nativeImage,
  workspaceRoot,
  workspacePath,
  platformPolicy,
  validNoteId,
  parseNoteImageReference,
  recordingExtension,
  recordingsDirName,
  noteImagesDirName,
  clipImagesDirName,
  recordingMaxBytes,
  noteImageMaxBytes,
  noteImageMaxEdge,
}) {
  function getRecordingsDir() { return workspacePath(recordingsDirName); }

  function ensureRecordingsDir() {
    try { fs.mkdirSync(getRecordingsDir(), { recursive: true }); } catch (error) {}
  }

  function getSafeRecordingPath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const directory = path.resolve(getRecordingsDir());
    const resolvedPath = path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(workspaceRoot(), value);
    if (path.dirname(resolvedPath) !== directory) return null;
    if (!/^recording-[a-z0-9-]+\.(webm|m4a|ogg|wav)$/i.test(path.basename(resolvedPath))) return null;
    try {
      const directoryStat = fs.lstatSync(directory);
      const fileStat = fs.lstatSync(resolvedPath);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return null;
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
      return resolvedPath;
    } catch (error) {
      return null;
    }
  }

  async function saveRecording(payload) {
    if (!payload || !payload.bytes) return { ok: false, error: 'empty_audio' };
    let buffer;
    try { buffer = Buffer.from(payload.bytes); } catch (error) { return { ok: false, error: 'invalid_audio' }; }
    if (!buffer.length || buffer.length > recordingMaxBytes) {
      return { ok: false, error: buffer.length ? 'audio_too_large' : 'empty_audio' };
    }
    ensureRecordingsDir();
    const mimeType = String(payload.mimeType || 'audio/webm').slice(0, 80);
    const extension = recordingExtension(mimeType);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const audioPath = path.join(getRecordingsDir(), `recording-${id}.${extension}`);
    try {
      await fs.promises.writeFile(audioPath, buffer, { flag: 'wx' });
      return { ok: true, audioPath: platformPolicy.portableMediaPath(recordingsDirName, audioPath), mimeType };
    } catch (error) {
      return { ok: false, error: 'write_failed' };
    }
  }

  async function readRecording(audioPath) {
    const safePath = getSafeRecordingPath(audioPath);
    if (!safePath) return null;
    try {
      const bytes = await fs.promises.readFile(safePath);
      const extension = path.extname(safePath).slice(1).toLowerCase();
      return { bytes, mimeType: extension === 'm4a' ? 'audio/mp4' : `audio/${extension || 'webm'}` };
    } catch (error) {
      return null;
    }
  }

  async function deleteRecording(audioPath) {
    const safePath = getSafeRecordingPath(audioPath);
    if (!safePath) return false;
    try { await fs.promises.unlink(safePath); return true; } catch (error) { return false; }
  }

  function getNoteImagesDir() { return workspacePath(noteImagesDirName); }
  function getNoteImageDirectory(noteId) {
    return validNoteId(noteId) ? path.join(getNoteImagesDir(), String(noteId)) : null;
  }
  function portableNoteImagePath(filePath) {
    return path.relative(workspaceRoot(), filePath).split(path.sep).join('/');
  }

  function getSafeNoteImagePath(imagePath) {
    if (typeof imagePath !== 'string' || path.isAbsolute(imagePath)) return null;
    const reference = parseNoteImageReference(imagePath);
    if (!reference) return null;
    const root = path.resolve(getNoteImagesDir());
    const resolved = path.resolve(workspaceRoot(), reference.relativePath);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    try {
      const rootStat = fs.lstatSync(root);
      const noteDirStat = fs.lstatSync(path.dirname(resolved));
      const fileStat = fs.lstatSync(resolved);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
      if (noteDirStat.isSymbolicLink() || !noteDirStat.isDirectory()) return null;
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
      return resolved;
    } catch (error) {
      return null;
    }
  }

  async function persistNoteImage(noteId, bytes) {
    if (!validNoteId(noteId)) return { ok: false, error: 'invalid_note' };
    let buffer;
    try { buffer = Buffer.from(bytes || []); } catch (error) { return { ok: false, error: 'invalid_image' }; }
    if (!buffer.length || buffer.length > noteImageMaxBytes) return { ok: false, error: 'invalid_image' };
    const source = nativeImage.createFromBuffer(buffer);
    if (source.isEmpty()) return { ok: false, error: 'invalid_image' };
    const size = source.getSize();
    if (!size.width || !size.height || size.width * size.height > 80_000_000) return { ok: false, error: 'image_too_large' };
    const scale = Math.min(1, noteImageMaxEdge / Math.max(size.width, size.height));
    const output = scale < 1
      ? source.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' }).toPNG()
      : source.toPNG();
    if (!output.length) return { ok: false, error: 'invalid_image' };
    const directory = getNoteImageDirectory(noteId);
    const filePath = path.join(directory, `image-${crypto.randomUUID()}.png`);
    try {
      await fs.promises.mkdir(directory, { recursive: true });
      const rootStat = await fs.promises.lstat(getNoteImagesDir());
      const directoryStat = await fs.promises.lstat(directory);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        return { ok: false, error: 'unsafe_directory' };
      }
      await fs.promises.writeFile(filePath, output, { flag: 'wx' });
      return { ok: true, imagePath: portableNoteImagePath(filePath), width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
    } catch (error) {
      return { ok: false, error: 'save_failed' };
    }
  }

  async function deleteNoteImages(noteId) {
    const directory = getNoteImageDirectory(noteId);
    if (!directory) return false;
    try {
      const root = path.resolve(getNoteImagesDir());
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== root) return false;
      const rootStat = await fs.promises.lstat(root);
      const stat = await fs.promises.lstat(resolved);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || stat.isSymbolicLink() || !stat.isDirectory()) return false;
      await fs.promises.rm(resolved, { recursive: true, force: true });
      return true;
    } catch (error) {
      return error && error.code === 'ENOENT';
    }
  }

  function getClipImagesDir() { return workspacePath(clipImagesDirName); }
  function getSafeClipImagePath(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const dir = path.resolve(getClipImagesDir());
    const resolvedPath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot(), value);
    if (path.dirname(resolvedPath) !== dir) return null;
    if (!/^clip-[a-z0-9]+\.png$/i.test(path.basename(resolvedPath))) return null;
    try {
      const dirStat = fs.lstatSync(dir);
      const fileStat = fs.lstatSync(resolvedPath);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
      return resolvedPath;
    } catch (error) {
      return null;
    }
  }
  function ensureClipImagesDir() {
    try { fs.mkdirSync(getClipImagesDir(), { recursive: true }); } catch (error) {}
  }

  return {
    getRecordingsDir, ensureRecordingsDir, getSafeRecordingPath, saveRecording, readRecording, deleteRecording,
    getNoteImagesDir, getNoteImageDirectory, portableNoteImagePath, getSafeNoteImagePath, persistNoteImage, deleteNoteImages,
    getClipImagesDir, getSafeClipImagePath, ensureClipImagesDir,
  };
}

module.exports = { createWorkspaceFiles };
