import { randomBytes } from 'node:crypto';

export const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_PARTS = 10_000;
export const MAX_TRANSFERS_PER_CLIENT = 4;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const PNG_MIME = 'image/png';
export const PURPOSES = Object.freeze(['note-image', 'clipboard-image', 'screenshot']);
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function opaqueId(prefix) {
  return `${prefix}_${randomBytes(18).toString('base64url')}`;
}

export function storageKey(kind) {
  const token = randomBytes(24).toString('base64url');
  return `${kind}/v1/${token.slice(0, 2)}/${token}`;
}

export function normalizeDigest(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(lower)) return lower;
  const match = /^sha-256=:(.+):$/i.exec(value);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[1], 'base64');
    return bytes.length === 32 ? `sha256:${bytes.toString('hex')}` : null;
  } catch {
    return null;
  }
}

export function publicDigestHeader(digest) {
  return `sha-256=:${Buffer.from(digest.slice(7), 'hex').toString('base64')}:`;
}

export function scopeKey(scope) {
  return `${scope.accountId}\u0000${scope.spaceId}`;
}

export function clientScopeKey(scope) {
  return `${scopeKey(scope)}\u0000${scope.clientId}`;
}

export function sameScope(left, right, includeClient = false) {
  return left?.accountId === right.accountId && left?.spaceId === right.spaceId && (!includeClient || left?.clientId === right.clientId);
}
