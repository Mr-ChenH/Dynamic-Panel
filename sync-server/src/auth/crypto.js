import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export function opaqueToken(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
export function sessionFingerprint(token) { return createHash('sha256').update(token).digest('hex'); }
export function keyedFingerprint(value, secret) { return createHmac('sha256', secret).update(value).digest('hex'); }
export function safeEqual(left, right) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function uuid() {
  const bytes = randomBytes(16);
  const timestamp = Date.now();
  bytes.writeUIntBE(timestamp, 0, 6);
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function clientKey() { return `dpk_v1_${opaqueToken(32)}`; }
export async function hashSecret(value) { return argon2.hash(value, { type: argon2.argon2id }); }
export async function verifySecret(hash, value) {
  try { return await argon2.verify(hash, value); } catch { return false; }
}
export function normalizeName(value) {
  const displayName = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return { displayName, normalizedName: displayName.toLocaleLowerCase('und') };
}
export function shortId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
