#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client
} from '@aws-sdk/client-s3';
import { IdentityService } from '../auth/identity-service.js';
import { BackupService } from '../backup/service.js';
import { ExportSource } from '../backup/export.js';
import { PostgresBackupRepository } from '../backup/postgres-repository.js';
import { RestoreService } from '../backup/restore.js';
import { FilesystemBackupTarget, S3BackupTarget } from '../backup/targets.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/postgres.js';
import { PostgresIdentityStore } from '../db/identity-store.js';
import { FilesystemObjectStorage, S3CompatibleObjectStorage } from '../objects/storage.js';
import { OperationsService } from './operations.js';
import { PostgresOperationsRepository } from './postgres-repository.js';
import { runCli, HELP } from './run.js';

function configurationError(message) { return Object.assign(new Error(message), { code: 'CONFIGURATION_ERROR' }); }
function enabled(value) { return /^(1|true|yes)$/i.test(value ?? ''); }
async function secret(env, name) {
  const file = env[`${name}_FILE`];
  if (!file) return env[name];
  const info = await stat(file);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw configurationError(`${name}_FILE must not be accessible by group or other users`);
  return (await readFile(file, 'utf8')).replace(/[\r\n]+$/, '');
}
export async function masterKey(env) {
  const encoded = await secret(env, 'DP_BACKUP_MASTER_KEY');
  if (!encoded) throw configurationError('DP_BACKUP_MASTER_KEY or DP_BACKUP_MASTER_KEY_FILE is required');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw configurationError('DP_BACKUP_MASTER_KEY must be a base64-encoded 32-byte key');
  return key;
}
function awsBackend(client) {
  return {
    putObject: (input) => client.send(new PutObjectCommand(input)),
    getObject: (input) => client.send(new GetObjectCommand(input)),
    headObject: (input) => client.send(new HeadObjectCommand(input)),
    deleteObject: (input) => client.send(new DeleteObjectCommand(input)),
    listObjectsV2: (input) => client.send(new ListObjectsV2Command(input))
  };
}
function s3Client(env, namespace, factory) {
  const endpoint = env[`${namespace}_ENDPOINT`];
  return factory({ region: env[`${namespace}_REGION`] ?? 'us-east-1', ...(endpoint ? { endpoint, forcePathStyle: enabled(env[`${namespace}_PATH_STYLE`] ?? 'true') } : {}) });
}
export async function backupTarget(env, config, factories) {
  const kind = env.DP_BACKUP_TARGET ?? (config.env === 'production' ? undefined : 'filesystem');
  if (kind === 'filesystem') {
    const root = env.DP_BACKUP_PATH;
    if (!root) throw configurationError('DP_BACKUP_PATH is required for filesystem backups');
    return new FilesystemBackupTarget(root, { production: config.env === 'production', independentMedia: enabled(env.DP_BACKUP_INDEPENDENT_MEDIA), onlineDataRoot: env.DP_OBJECT_PATH });
  }
  if (kind === 's3') {
    if (!env.DP_BACKUP_S3_BUCKET) throw configurationError('DP_BACKUP_S3_BUCKET is required');
    const client = s3Client(env, 'DP_BACKUP_S3', factories.createS3Client);
    return new S3BackupTarget({ client: awsBackend(client), bucket: env.DP_BACKUP_S3_BUCKET, prefix: env.DP_BACKUP_S3_PREFIX, endpoint: env.DP_BACKUP_S3_ENDPOINT, onlineBucket: env.DP_OBJECT_S3_BUCKET });
  }
  throw configurationError('DP_BACKUP_TARGET must be filesystem or s3');
}
export function objectStorage(env, factories) {
  const kind = env.DP_OBJECT_TARGET ?? (env.DP_OBJECT_PATH ? 'filesystem' : undefined);
  if (!kind) return undefined;
  if (kind === 'filesystem') {
    if (!env.DP_OBJECT_PATH) throw configurationError('DP_OBJECT_PATH is required for filesystem object storage');
    return new FilesystemObjectStorage({ root: env.DP_OBJECT_PATH });
  }
  if (kind === 's3') {
    if (!env.DP_OBJECT_S3_BUCKET) throw configurationError('DP_OBJECT_S3_BUCKET is required');
    const client = s3Client(env, 'DP_OBJECT_S3', factories.createS3Client);
    return new S3CompatibleObjectStorage({ backend: awsBackend(client), bucket: env.DP_OBJECT_S3_BUCKET, prefix: env.DP_OBJECT_S3_PREFIX });
  }
  throw configurationError('DP_OBJECT_TARGET must be filesystem or s3');
}

export async function composeOperationalServices(env, { config, pool, factories }) {
  const target = await backupTarget(env, config, factories);
  const objects = objectStorage(env, factories);
  const repository = new PostgresOperationsRepository(pool);
  const source = new PostgresBackupRepository(pool, { objectSource: objects, objectSink: objects });
  const backupOptions = { target, masterKey: await masterKey(env), keyId: env.DP_BACKUP_KEY_ID ?? 'primary', production: config.env === 'production' };
  const backup = new BackupService({ source, ...backupOptions });
  const exporter = new BackupService({ source: new ExportSource(source), ...backupOptions });
  const restore = new RestoreService({ backup, repository: source });
  const importer = new RestoreService({ backup: exporter, repository: source });
  const identity = new IdentityService({ store: new PostgresIdentityStore(pool), config });
  const operations = new OperationsService({ identity, repository, backup, restore, migrate: ({ dryRun } = {}) => dryRun ? repository.migrationStatus() : migrate(pool) });
  return { operations, repository, backup, restore, exporter, importer, objects };
}

export async function composeCli(env = process.env, overrides = {}) {
  const factories = {
    createPool: overrides.createPool ?? createPool,
    createS3Client: overrides.createS3Client ?? ((options) => new S3Client(options))
  };
  const config = (overrides.loadConfig ?? loadConfig)(env);
  if (!config.databaseUrl) throw Object.assign(new Error('DATABASE_URL is required for the admin CLI'), { code: 'DATABASE_UNAVAILABLE' });
  const pool = factories.createPool(config.databaseUrl);
  try {
    const cli = await composeOperationalServices(env, { config, pool, factories });
    return { pool, cli };
  } catch (error) {
    await pool.end?.();
    throw error;
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, overrides = {}) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    (overrides.stdout ?? ((value) => process.stdout.write(value)))(HELP);
    return 0;
  }
  let composed;
  try {
    composed = await composeCli(env, overrides);
    return await runCli(argv, { ...composed.cli, env, stdout: overrides.stdout ?? ((value) => process.stdout.write(value)), stderr: overrides.stderr ?? ((value) => process.stderr.write(value)) });
  } catch (error) {
    const stderr = overrides.stderr ?? ((value) => process.stderr.write(value));
    stderr(`${JSON.stringify({ ok: false, code: error.code ?? 'CONFIGURATION_ERROR', error: { code: error.code ?? 'CONFIGURATION_ERROR', message: String(error.message).slice(0, 512) } })}\n`);
    return 4;
  } finally { await composed?.pool?.end?.(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
