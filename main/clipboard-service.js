function createClipboardService({
  clipboard,
  nativeImage,
  ClipboardItem,
  fs,
  path,
  workspaceFiles,
  readClipboardObservation,
  prepareClipboardImagePayload,
  reduceClipboardObservation,
  createClipboardImageFingerprint,
  getMainWindow,
  portableImagePath,
  pollIntervalMs,
  imagePollIntervalMs,
  imageDirectoryName,
}) {
  let pollTimer = null;
  let baselineTimer = null;
  let enabled = false;
  let polling = false;
  let observationState = { textFingerprint: null, imageFingerprint: null };
  let lastImageProbeAt = 0;
  let generation = 0;

  async function readSystemClipboard(includeImage = false) {
    try {
      const items = await clipboard.read();
      const observation = await readClipboardObservation(items, { includeImage });
      let image = null;
      if (observation.image?.buffer) {
        const native = nativeImage.createFromBuffer(observation.image.buffer);
        if (!native.isEmpty()) {
          const size = native.getSize();
          image = prepareClipboardImagePayload(observation.image.mimeType, observation.image.buffer, size);
        }
      }
      return { concealed: observation.concealed, text: observation.text, image };
    } catch (error) {
      return { concealed: false, text: '', image: null };
    }
  }

  async function baselineCurrentClipboard(expectedGeneration) {
    try {
      const observation = await readSystemClipboard(true);
      if (!enabled || expectedGeneration !== generation) return;
      if (observation.concealed) {
        observationState = reduceClipboardObservation({}, { concealed: true }, { baseline: true }).state;
        return;
      }
      observationState = reduceClipboardObservation(
        {},
        { text: observation.text, imageFingerprint: observation.image?.fingerprint || null },
        { baseline: true }
      ).state;
      lastImageProbeAt = Date.now();
    } catch (error) {
      observationState = { textFingerprint: null, imageFingerprint: null };
    }
  }

  async function poll() {
    const mainWindow = getMainWindow();
    if (!enabled || !mainWindow || mainWindow.isDestroyed() || polling) return;
    polling = true;
    try {
      const now = Date.now();
      const includeImage = now - lastImageProbeAt >= imagePollIntervalMs;
      const observation = await readSystemClipboard(includeImage);
      if (!enabled) return;
      if (observation.concealed) return;

      const text = observation.text;
      if (text) {
        const decision = reduceClipboardObservation(observationState, { text });
        observationState = decision.state;
        if (decision.record && enabled) {
          const type = /^https?:\/\//i.test(text.trim()) ? 'url' : 'text';
          mainWindow.webContents.send('clipboard:new-entry', { type, text, imagePath: null });
        }
        return;
      }

      if (includeImage) {
        lastImageProbeAt = now;
        const result = observation.image;
        const decision = reduceClipboardObservation(observationState, { text: '', imageFingerprint: result?.fingerprint || null });
        observationState = decision.state;
        if (!result || !decision.record || !enabled) return;
        const pngBuffer = result.pngBuffer || nativeImage.createFromBuffer(result.sourceBuffer).toPNG();
        if (!pngBuffer.length) return;
        workspaceFiles.ensureClipImagesDir();
        const fileName = `clip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.png`;
        const imagePath = path.join(workspaceFiles.getClipImagesDir(), fileName);
        try {
          await fs.promises.writeFile(imagePath, pngBuffer);
        } catch (error) {
          return;
        }
        if (!enabled) {
          try { await fs.promises.unlink(imagePath); } catch (error) {}
          return;
        }
        mainWindow.webContents.send('clipboard:new-entry', {
          type: 'image',
          text: null,
          imagePath: portableImagePath(imageDirectoryName, imagePath),
        });
      }
    } catch (error) {
      // Polling errors must not terminate the main process.
    } finally {
      polling = false;
    }
  }

  function start() {
    if (enabled) return;
    enabled = true;
    const expectedGeneration = ++generation;
    baselineTimer = setTimeout(() => {
      baselineTimer = null;
      if (!enabled) return;
      void baselineCurrentClipboard(expectedGeneration).finally(() => {
        if (enabled && expectedGeneration === generation && !pollTimer) {
          pollTimer = setInterval(poll, pollIntervalMs);
        }
      });
    }, 0);
  }

  function stop() {
    enabled = false;
    generation += 1;
    if (baselineTimer) clearTimeout(baselineTimer);
    baselineTimer = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    observationState = { textFingerprint: null, imageFingerprint: null };
    lastImageProbeAt = 0;
  }

  async function writeEntry(entry) {
    if (!entry) return false;
    try {
      const safeImagePath = entry.type === 'image'
        ? workspaceFiles.getSafeClipImagePath(entry.imagePath)
        : null;
      if (safeImagePath) {
        const buffer = fs.readFileSync(safeImagePath);
        const image = nativeImage.createFromBuffer(buffer);
        if (image.isEmpty()) return false;
        const pngBuffer = image.toPNG();
        await clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([pngBuffer], { type: 'image/png' }) }),
        ]);
        const size = image.getSize();
        const fingerprint = createClipboardImageFingerprint(size.width, size.height, pngBuffer);
        if (fingerprint) observationState = reduceClipboardObservation(observationState, { imageFingerprint: fingerprint }, { baseline: true }).state;
      } else if (entry.text) {
        await clipboard.writeText(entry.text);
        observationState = reduceClipboardObservation(observationState, { text: entry.text }, { baseline: true }).state;
      } else {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  return { start, stop, writeEntry, readSystemClipboard, poll };
}

module.exports = { createClipboardService };
