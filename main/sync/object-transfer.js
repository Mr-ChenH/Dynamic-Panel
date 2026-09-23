'use strict';

const crypto = require('crypto');

const ALLOWED_PURPOSES = new Set(['note-image', 'clipboard-image', 'screenshot']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

function digestBytes(bytes) { return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`; }
function validateDescriptor(value) {
  if (!value || !ALLOWED_PURPOSES.has(value.purpose) || value.mimeType !== 'image/png') throw new TypeError('unsupported_sync_object');
  if (!Number.isInteger(value.bytes) || value.bytes < PNG_SIGNATURE.length) throw new TypeError('invalid_object_bytes');
  if (!/^sha256:[a-f0-9]{64}$/i.test(value.digest || '')) throw new TypeError('invalid_object_digest');
  return value;
}
function assertPng(bytes) { if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new TypeError('invalid_png'); }
function unwrap(result) { return result && Object.hasOwn(result, 'data') ? result.data : result; }

function createObjectTransferManager({ fsModule, pathModule, request, store, randomUUID = crypto.randomUUID, maxBytes = 512 * 1024 * 1024 } = {}) {
  if (!fsModule || !pathModule || typeof request !== 'function') throw new TypeError('object_transfer_dependencies_required');
  const cancelled = new Set();
  const checkpoint = (value) => store?.saveTransfer?.(value);

  async function upload({ sourcePath, descriptor, isCurrent = () => true }) {
    validateDescriptor(descriptor);
    const stat = await fsModule.promises.stat(sourcePath);
    if (!stat.isFile() || stat.size !== descriptor.bytes || stat.size > maxBytes) throw new TypeError('object_size_mismatch');
    const bytes = await fsModule.promises.readFile(sourcePath);
    assertPng(bytes);
    if (digestBytes(bytes) !== descriptor.digest.toLowerCase()) throw new TypeError('object_digest_mismatch');
    const transferId = `upload:${descriptor.digest}`;
    let row = store?.transfers?.().find((item) => item.transferId === transferId);
    let uploadId = row?.uploadId;
    let completedParts = new Set(row?.completedParts || []);
    let chunkBytes = row?.chunkBytes || DEFAULT_CHUNK_BYTES;
    if (uploadId) {
      try {
        const remote = unwrap(await request(`/objects/uploads/${encodeURIComponent(uploadId)}`));
        completedParts = new Set(remote.completedParts || []);
        chunkBytes = remote.chunkBytes || chunkBytes;
      } catch (error) { uploadId = null; completedParts.clear(); }
    }
    if (!uploadId) {
      const created = unwrap(await request('/objects/uploads', { method: 'POST', body: descriptor }));
      uploadId = created.uploadId; chunkBytes = created.chunkBytes || chunkBytes;
      completedParts = new Set(created.completedParts || []);
    }
    row = { transferId, direction: 'upload', uploadId, descriptor, chunkBytes, completedParts: [...completedParts] };
    checkpoint(row);
    for (let offset = 0, partNumber = 1; offset < bytes.length; offset += chunkBytes, partNumber += 1) {
      if (cancelled.has(transferId) || !isCurrent()) throw Object.assign(new Error('transfer_cancelled'), { code: 'transfer_cancelled' });
      if (completedParts.has(partNumber)) continue;
      const part = bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes));
      await request(`/objects/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}`, { method: 'PUT', bytes: part, headers: { 'content-type': 'application/octet-stream', 'content-digest': digestBytes(part) } });
      completedParts.add(partNumber); row.completedParts = [...completedParts]; checkpoint(row);
    }
    if (!isCurrent()) throw Object.assign(new Error('transfer_cancelled'), { code: 'transfer_cancelled' });
    const result = unwrap(await request(`/objects/uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST', body: {} }));
    store?.removeTransfer?.(transferId); cancelled.delete(transferId);
    return Object.freeze({ transferId, object: result });
  }

  async function download({ objectId, destinationPath, descriptor, isCurrent = () => true }) {
    validateDescriptor(descriptor);
    if (!/^obj_[A-Za-z0-9_-]{24}$/.test(objectId || '')) throw new TypeError('invalid_object_id');
    const transferId = `download:${objectId}`;
    const temporaryPath = `${destinationPath}.sync-part`;
    await fsModule.promises.mkdir(pathModule.dirname(destinationPath), { recursive: true });
    let offset = 0;
    try { offset = Math.min((await fsModule.promises.stat(temporaryPath)).size, descriptor.bytes); } catch (error) {}
    checkpoint({ transferId, direction: 'download', objectId, destinationPath, temporaryPath, descriptor, offset });
    const response = await request(`/objects/${encodeURIComponent(objectId)}`, { raw: true, headers: offset ? { range: `bytes=${offset}-` } : {} });
    if (offset && response.status !== 206) { await fsModule.promises.rm(temporaryPath, { force: true }); offset = 0; }
    const incoming = Buffer.isBuffer(response.body) ? response.body : Buffer.from(await response.arrayBuffer());
    if (cancelled.has(transferId) || !isCurrent()) throw Object.assign(new Error('transfer_cancelled'), { code: 'transfer_cancelled' });
    await fsModule.promises.writeFile(temporaryPath, incoming, { flag: offset ? 'a' : 'w', mode: 0o600 });
    const complete = await fsModule.promises.readFile(temporaryPath);
    assertPng(complete);
    if (complete.length !== descriptor.bytes || digestBytes(complete) !== descriptor.digest.toLowerCase()) throw new TypeError('object_verification_failed');
    if (!isCurrent()) throw Object.assign(new Error('transfer_cancelled'), { code: 'transfer_cancelled' });
    await fsModule.promises.rename(temporaryPath, destinationPath);
    store?.removeTransfer?.(transferId); cancelled.delete(transferId);
    return Object.freeze({ transferId, objectId, bytes: complete.length });
  }

  async function cancel(transferId) {
    cancelled.add(String(transferId));
    const row = store?.transfers?.().find((item) => item.transferId === transferId);
    if (row?.uploadId) await request(`/objects/uploads/${encodeURIComponent(row.uploadId)}`, { method: 'DELETE' }).catch(() => {});
    return Object.freeze({ ok: true, transferId: String(transferId) });
  }

  return Object.freeze({ upload, download, cancel, validateDescriptor, digestBytes });
}

module.exports = { ALLOWED_PURPOSES, PNG_SIGNATURE, validateDescriptor, digestBytes, createObjectTransferManager };
