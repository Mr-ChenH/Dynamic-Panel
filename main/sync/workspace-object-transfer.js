'use strict';

const { CaptureStorage, dimensions } = require('../../captureStorage');
const { createObjectTransferManager, digestBytes } = require('./object-transfer');
const { ensureSafePath } = require('./media-path');

function unwrap(value) { return value && Object.hasOwn(value, 'data') ? value.data : value; }

function createWorkspaceObjectTransfers({ fsModule, pathModule, getWorkspaceRoot, request, store } = {}) {
  if (!fsModule || !pathModule || typeof getWorkspaceRoot !== 'function' || typeof request !== 'function') throw new TypeError('workspace_object_transfer_dependencies_required');
  const manager = createObjectTransferManager({ fsModule, pathModule, request, store });

  async function upload(input = {}) {
    const purpose = String(input.purpose || '');
    const workspaceRoot = pathModule.resolve(getWorkspaceRoot());
    const isCurrent = () => pathModule.resolve(getWorkspaceRoot()) === workspaceRoot;
    const resolved = await ensureSafePath({ fsModule, pathModule, rootPath: workspaceRoot, relativePath: input.relativePath, purpose });
    const stat = await fsModule.promises.stat(resolved.path);
    if (!stat.isFile() || stat.size < 8 || stat.size > 512 * 1024 * 1024) throw new TypeError('invalid_object_bytes');
    const bytes = await fsModule.promises.readFile(resolved.path);
    const descriptor = { purpose, mimeType: 'image/png', bytes: bytes.length, digest: digestBytes(bytes) };
    const result = await manager.upload({ sourcePath: resolved.path, descriptor, isCurrent });
    return Object.freeze({ ...result, relativePath: resolved.relativePath, descriptor, objectId: result.object?.objectId });
  }

  async function download(input = {}) {
    const objectId = String(input.objectId || '');
    const workspaceRoot = pathModule.resolve(getWorkspaceRoot());
    const isCurrent = () => pathModule.resolve(getWorkspaceRoot()) === workspaceRoot;
    const metadata = unwrap(await request(`/objects/${encodeURIComponent(objectId)}/metadata`));
    const purpose = String(input.purpose || metadata?.purpose || '');
    if (metadata?.objectId !== objectId || metadata?.purpose !== purpose) throw new TypeError('object_metadata_mismatch');
    if (!isCurrent()) throw Object.assign(new Error('transfer_cancelled'), { code: 'transfer_cancelled' });
    const resolved = await ensureSafePath({ fsModule, pathModule, rootPath: workspaceRoot, relativePath: input.relativePath, purpose, forWrite: true });
    const descriptor = { purpose, mimeType: metadata.mimeType, bytes: metadata.bytes, digest: metadata.digest };
    const result = await manager.download({ objectId, destinationPath: resolved.path, descriptor, isCurrent });
    if (purpose === 'screenshot') {
      const screenshot = input.screenshot;
      if (!screenshot || !/^[0-9a-f-]{36}$/i.test(screenshot.entityId || '') || resolved.relativePath !== `captures/screenshots/${screenshot.entityId}.png`) throw new TypeError('invalid_screenshot_projection');
      const size = dimensions(Number(screenshot.width), Number(screenshot.height));
      const storage = new CaptureStorage(workspaceRoot);
      const item = { id: screenshot.entityId, kind: 'screenshot', title: String(screenshot.title || '截图').slice(0, 120), createdAt: Number(screenshot.createdAt) || Date.now(), path: resolved.relativePath, mimeType: 'image/png', status: 'complete', bytes: descriptor.bytes, ...size };
      const rows = storage.readIndex().filter((row) => row.id !== item.id);
      storage.writeIndex([item, ...rows]);
    }
    return Object.freeze({ ...result, relativePath: resolved.relativePath, descriptor });
  }

  return Object.freeze({ upload, download, cancel: manager.cancel });
}

module.exports = { createWorkspaceObjectTransfers };
