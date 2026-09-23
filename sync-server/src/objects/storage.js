import { randomBytes } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const KEY_PATTERN = /^(?:parts|objects)\/v1\/[A-Za-z0-9_-]{2}\/[A-Za-z0-9_-]{32}$/;

function assertKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new TypeError('Invalid server object key');
  return key;
}

async function chunks(source) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return [source];
  return source;
}

export class FilesystemObjectStorage {
  constructor({ root }) {
    if (!root) throw new TypeError('A storage root is required');
    this.root = path.resolve(root);
    this.ready = this.#initialize();
  }

  async #initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Object storage root must be a real directory');
    // Canonicalize Windows 8.3 aliases before containment checks. A symlink at
    // the configured root itself has already been rejected by lstat above.
    this.root = await realpath(this.root);
  }

  async #path(key, createParent = false) {
    await this.ready;
    assertKey(key);
    const target = path.resolve(this.root, ...key.split('/'));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('Object key escaped storage root');
    const parent = path.dirname(target);
    if (createParent) await mkdir(parent, { recursive: true, mode: 0o700 });
    const relative = path.relative(this.root, parent).split(path.sep).filter(Boolean);
    let cursor = this.root;
    for (const segment of relative) {
      cursor = path.join(cursor, segment);
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Symlinked object storage path rejected');
    }
    return target;
  }

  async put(key, source) {
    const target = await this.#path(key, true);
    const temporary = `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    try {
      for await (const chunk of await chunks(source)) await handle.write(chunk);
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async open(key) {
    const target = await this.#path(key);
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Stored object is not a regular file');
    return createReadStream(target, { flags: fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW });
  }

  async stat(key) { return stat(await this.#path(key)); }
  async delete(key) { await rm(await this.#path(key), { force: true }); }
}

export class MemoryObjectStorage {
  constructor() { this.objects = new Map(); this.failWrites = null; }
  async put(key, source) {
    assertKey(key);
    if (this.failWrites) throw this.failWrites;
    const values = [];
    for await (const chunk of await chunks(source)) values.push(Buffer.from(chunk));
    this.objects.set(key, Buffer.concat(values));
  }
  async open(key) {
    assertKey(key);
    const value = this.objects.get(key);
    if (!value) { const error = new Error('Object missing'); error.code = 'ENOENT'; throw error; }
    return Readable.from(value);
  }
  async stat(key) {
    const value = this.objects.get(assertKey(key));
    if (!value) { const error = new Error('Object missing'); error.code = 'ENOENT'; throw error; }
    return { size: value.length };
  }
  async delete(key) { this.objects.delete(assertKey(key)); }
}

// The backend is deliberately AWS-SDK-neutral. Production composition can adapt
// AWS SDK v3, MinIO, or another S3 client to these four conventional operations.
export class S3CompatibleObjectStorage {
  constructor({ backend, bucket, prefix = '' }) {
    if (!backend || !bucket) throw new TypeError('S3 backend and bucket are required');
    this.backend = backend;
    this.bucket = bucket;
    this.prefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  }
  #request(key) { return { Bucket: this.bucket, Key: `${this.prefix}${assertKey(key)}` }; }
  async put(key, source) { await this.backend.putObject({ ...this.#request(key), Body: source }); }
  async open(key, range) { return (await this.backend.getObject({ ...this.#request(key), ...(range ? { Range: range } : {}) })).Body; }
  async stat(key) { const row = await this.backend.headObject(this.#request(key)); return { size: Number(row.ContentLength) }; }
  async delete(key) { await this.backend.deleteObject(this.#request(key)); }
}
