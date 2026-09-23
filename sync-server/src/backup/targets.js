import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function safeKey(key) {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Invalid backup object key');
  }
  return key;
}

export class FilesystemBackupTarget {
  constructor(root, { production = false, independentMedia = false, onlineDataRoot } = {}) {
    this.root = path.resolve(root);
    this.production = production;
    this.independentMedia = independentMedia;
    this.onlineDataRoot = onlineDataRoot ? path.resolve(onlineDataRoot) : undefined;
    this.kind = 'filesystem';
  }

  resolve(key) { return path.join(this.root, ...safeKey(key).split('/')); }
  async put(key, body) { const file = this.resolve(key); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, body); }
  async get(key) { return readFile(this.resolve(key)); }
  async delete(key) { await rm(this.resolve(key), { force: true }); }
  async move(from, to) { const target = this.resolve(to); await mkdir(path.dirname(target), { recursive: true }); await rename(this.resolve(from), target); }
  async exists(key) { try { await stat(this.resolve(key)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

  async list(prefix = '') {
    const start = prefix ? this.resolve(prefix.replace(/\/$/, '')) : this.root;
    const output = [];
    const walk = async (directory) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) output.push(path.relative(this.root, file).split(path.sep).join('/'));
      }
    };
    await walk(start);
    return output.sort();
  }

  warnings() {
    const sameTree = this.onlineDataRoot && (this.root === this.onlineDataRoot || this.root.startsWith(`${this.onlineDataRoot}${path.sep}`) || this.onlineDataRoot.startsWith(`${this.root}${path.sep}`));
    return this.production && (!this.independentMedia || sameTree)
      ? [{ code: 'backup_same_fault_domain', message: 'Filesystem backup is not confirmed on independent media.' }]
      : [];
  }
}

export class S3BackupTarget {
  constructor({ client, bucket, prefix = '', endpoint, onlineBucket }) {
    if (!client || !bucket) throw new TypeError('S3 client and bucket are required');
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix.replace(/^\/+|\/+$/g, '');
    this.endpoint = endpoint;
    this.onlineBucket = onlineBucket;
    this.kind = 's3';
  }
  objectKey(key) { return [this.prefix, safeKey(key)].filter(Boolean).join('/'); }
  async put(key, body) { await this.client.putObject({ Bucket: this.bucket, Key: this.objectKey(key), Body: body }); }
  async get(key) {
    const result = await this.client.getObject({ Bucket: this.bucket, Key: this.objectKey(key) });
    if (Buffer.isBuffer(result.Body)) return result.Body;
    if (result.Body?.transformToByteArray) return Buffer.from(await result.Body.transformToByteArray());
    const chunks = []; for await (const chunk of result.Body) chunks.push(chunk); return Buffer.concat(chunks);
  }
  async delete(key) { await this.client.deleteObject({ Bucket: this.bucket, Key: this.objectKey(key) }); }
  async move(from, to) { const body = await this.get(from); await this.put(to, body); await this.delete(from); }
  async exists(key) { try { await this.client.headObject({ Bucket: this.bucket, Key: this.objectKey(key) }); return true; } catch (error) { if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return false; throw error; } }
  async list(prefix = '') {
    const root = [this.prefix, prefix].filter(Boolean).join('/');
    const keys = []; let ContinuationToken;
    do {
      const page = await this.client.listObjectsV2({ Bucket: this.bucket, Prefix: root, ContinuationToken });
      keys.push(...(page.Contents ?? []).map((item) => this.prefix ? item.Key.slice(this.prefix.length + 1) : item.Key));
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return keys.sort();
  }
  warnings() { return this.onlineBucket === this.bucket ? [{ code: 'backup_same_fault_domain', message: 'Backup and online objects use the same bucket.' }] : []; }
}
