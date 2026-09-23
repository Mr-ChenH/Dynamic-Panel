import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  return value;
}

export function canonicalJson(value) { return JSON.stringify(normalize(value)); }
export function requestHash(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

export class CursorCodec {
  constructor({ secret, instanceId = 'dynamic-panel-sync', clock = () => new Date() }) {
    if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('cursor secret must be at least 32 characters');
    this.secret = secret; this.instanceId = instanceId; this.clock = clock;
  }

  seal(value) {
    const body = Buffer.from(canonicalJson(value)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  open(token) {
    if (typeof token !== 'string' || token.length > 2048) throw new CursorError('invalid_cursor');
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) throw new CursorError('invalid_cursor');
    const expected = createHmac('sha256', this.secret).update(body).digest();
    let actual;
    try { actual = Buffer.from(signature, 'base64url'); } catch { throw new CursorError('invalid_cursor'); }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new CursorError('invalid_cursor');
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new CursorError('invalid_cursor'); }
  }

  encode({ spaceId, epoch, sequence, upper = sequence, filterHash }) {
    return this.seal({ v: 1, instanceId: this.instanceId, spaceId, epoch, sequence, upper, filterHash, issuedAt: this.clock().toISOString() });
  }

  decode(token, { spaceId, epoch, filterHash }) {
    const value = this.open(token);
    if (value.v !== 1 || value.instanceId !== this.instanceId || value.spaceId !== spaceId || value.filterHash !== filterHash || !Number.isSafeInteger(value.sequence) || !Number.isSafeInteger(value.upper) || value.sequence < 0 || value.upper < value.sequence) throw new CursorError('invalid_cursor');
    if (value.epoch !== epoch) throw new CursorError('restore_epoch_changed');
    return value;
  }
}

export class CursorError extends Error {
  constructor(code) { super(code); this.name = 'CursorError'; this.code = code; }
}
