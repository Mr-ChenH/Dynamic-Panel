import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadConfig } from './config.js';
import { errors, installErrorHandler } from './errors.js';
import { loggingOptions } from './logging.js';
import { IdentityService } from './auth/identity-service.js';
import { MemoryIdentityStore } from './auth/memory-store.js';
import { composeOperationalServices } from './cli/index.js';
import { createPool } from './db/postgres.js';
import { PostgresIdentityStore } from './db/identity-store.js';
import { MemoryRecordRepository } from './records/memory-repository.js';
import { PostgresRecordRepository } from './records/postgres-repository.js';
import { RecordReplicationService } from './records/service.js';
import { InvalidationRegistry } from './realtime/registry.js';
import { MemoryObjectRepository, PostgresObjectRepository } from './objects/repository.js';
import { ObjectService } from './objects/service.js';
import { FilesystemObjectStorage, MemoryObjectStorage, S3CompatibleObjectStorage } from './objects/storage.js';
import { accountRoutes } from './routes/account.js';
import { clientRoutes } from './routes/clients.js';
import { consoleRoutes } from './routes/console.js';
import { discoveryRoutes } from './routes/discovery.js';
import { healthRoutes } from './routes/health.js';
import { objectRoutes } from './routes/objects.js';
import { operationalRoutes } from './routes/operations.js';
import { realtimeRoutes } from './routes/realtime.js';
import { spaceRoutes } from './routes/spaces.js';
import { syncRoutes } from './routes/sync.js';
import { syncSessionRoutes } from './routes/sync-session.js';

function s3Storage(config, factory) {
  const client = factory({ region: config.region, ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}) });
  return new S3CompatibleObjectStorage({
    bucket: config.bucket,
    prefix: config.prefix,
    backend: {
      putObject: (input) => client.send(new PutObjectCommand(input)),
      getObject: (input) => client.send(new GetObjectCommand(input)),
      headObject: (input) => client.send(new HeadObjectCommand(input)),
      deleteObject: (input) => client.send(new DeleteObjectCommand(input))
    }
  });
}

function objectStorage(config, options) {
  if (options.objectStorage) return options.objectStorage;
  if (config.objectStorage.target === 'filesystem') return new FilesystemObjectStorage({ root: config.objectStorage.path });
  if (config.objectStorage.target === 's3') return s3Storage(config.objectStorage, options.createS3Client ?? ((settings) => new S3Client(settings)));
  return new MemoryObjectStorage();
}

async function httpsOptions(config) {
  if (!config.tlsCertFile) return undefined;
  const [cert, key] = await Promise.all([readFile(config.tlsCertFile), readFile(config.tlsKeyFile)]);
  return { cert, key };
}

async function instanceId(pool, options) {
  if (options.instanceId) return options.instanceId;
  if (!pool) return 'development-instance';
  const row = (await pool.query('SELECT instance_id FROM server_instance WHERE singleton=true')).rows[0];
  if (!row?.instance_id) throw new Error('Server instance is not initialized; run migrations');
  return String(row.instance_id);
}

export async function buildServer(options = {}) {
  const config = options.config ?? loadConfig(options.env);
  const app = Fastify({
    logger: options.logger === undefined ? loggingOptions(config.env !== 'test') : options.logger,
    bodyLimit: config.limits.jsonBytes,
    requestTimeout: 30_000,
    trustProxy: config.trustProxy,
    https: await httpsOptions(config),
    routerOptions: { maxParamLength: 256 },
    ajv: { customOptions: { removeAdditional: false } },
    requestIdHeader: false
  });
  const pool = options.pool ?? (!options.store && config.databaseUrl ? (options.createPool ?? createPool)(config.databaseUrl) : null);
  const store = options.store ?? (pool ? new PostgresIdentityStore(pool) : new MemoryIdentityStore());
  const invalidations = options.invalidations ?? new InvalidationRegistry();
  const identity = options.identity ?? new IdentityService({ store, config, clock: options.clock, connections: options.connections ?? invalidations });
  const recordRepository = options.recordRepository ?? (pool ? new PostgresRecordRepository(pool) : new MemoryRecordRepository());
  const records = options.records ?? new RecordReplicationService({ repository: recordRepository, cursorSecret: config.cursorSecret, instanceId: await instanceId(pool, options), clock: options.clock, invalidations });
  const storage = objectStorage(config, options);
  const objectRepository = options.objectRepository ?? (pool ? new PostgresObjectRepository(pool) : new MemoryObjectRepository());
  const objectService = options.objectService ?? new ObjectService({ storage, repository: objectRepository, clock: options.clock });
  let operational = null;
  if (!options.operations && pool && ((options.env ?? process.env).DP_BACKUP_TARGET || config.env === 'production')) {
    operational = await composeOperationalServices(options.env ?? process.env, {
      config,
      pool,
      factories: { createS3Client: options.createS3Client ?? ((settings) => new S3Client(settings)) }
    });
  }
  const routeOperations = {
    listConflicts: async (input) => (await records.listConflictsForAccount(input, { status: input.status })).items,
    resolveConflict: (input) => records.resolveConflictForAccount(input, input),
    ...(operational ? {
      createSyncRecovery: ({ accountId, spaceId }) => operational.backup.create({ scope: { type: 'space', accountId, spaceId }, reason: 'first-sync-destructive' }),
      verifySyncRecovery: async ({ accountId, spaceId, recoveryPointId }) => {
        const verified = await operational.backup.verify(recoveryPointId);
        const scope = verified.manifest?.scope;
        return { verified: verified.status === 'verified' && scope?.type === 'space' && scope.accountId === accountId && scope.spaceId === spaceId, recoveryPointId, createdAt: verified.manifest?.createdAt ?? null };
      },
      createExport: (input) => operational.exporter.create(input),
      downloadExport: async (point) => {
        const prefix = `points/${point.manifestId}/`;
        const keys = await operational.exporter.target.list(prefix);
        const files = await Promise.all(keys.map(async (key) => ({ key: key.slice(prefix.length), body: (await operational.exporter.target.get(key)).toString('base64') })));
        return { contentType: 'application/json', filename: `dynamic-panel-${point.manifestId}.export.json`, body: JSON.stringify({ format: 'dynamic-panel-export-v1', manifestId: point.manifestId, files }) };
      },
      saveExportJob: (job) => operational.repository.saveExportJob(job),
      getExportJob: (accountId, jobId) => operational.repository.getExportJob(accountId, jobId)
    } : {}),
    ...(options.operations ?? {})
  };

  app.decorate('config', config);
  app.decorate('identity', identity);
  app.decorate('records', records);
  app.decorate('recordRepository', recordRepository);
  app.decorate('invalidations', invalidations);
  app.decorate('objectService', objectService);
  app.decorate('operations', routeOperations);
  app.decorate('errors', errors);
  app.decorate('readiness', options.readiness ?? {
    database: async () => {
      if (!pool) return config.env === 'production' ? 'down' : 'ok';
      try { await pool.query('SELECT 1'); return 'ok'; } catch { return 'down'; }
    },
    objects: async () => {
      try { await storage.ready; return 'ok'; } catch { return 'down'; }
    }
  });
  if (pool) app.addHook('onClose', async () => pool.end());

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"] } },
    referrerPolicy: { policy: 'no-referrer' }
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.addHook('onRequest', async (request, reply) => {
    const localHealth = request.url.startsWith('/api/v1/health/') && ['127.0.0.1', '::1'].includes(request.ip);
    if (config.env === 'production' && request.protocol !== 'https' && !localHealth) return reply.code(400).send({ error: { code: 'tls_required', message: 'HTTPS is required.', retryable: false }, requestId: request.id });
  });
  app.addHook('onSend', async (request, reply, payload) => { reply.header('x-request-id', request.id); return payload; });
  installErrorHandler(app);

  await app.register(discoveryRoutes);
  await app.register(healthRoutes);
  await app.register(consoleRoutes);
  await app.register(accountRoutes);
  await app.register(spaceRoutes);
  await app.register(clientRoutes);
  await app.register(syncSessionRoutes);
  await app.register(syncRoutes, { records });
  await app.register(objectRoutes, { service: objectService });
  await app.register(realtimeRoutes, { registry: invalidations });
  await app.register(operationalRoutes, { operations: routeOperations });
  return app;
}

export async function startServer(options = {}) {
  const app = await buildServer(options);
  const signals = options.signals ?? ['SIGINT', 'SIGTERM'];
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    for (const signal of signals) process.off(signal, shutdown);
    await app.close();
  };
  for (const signal of signals) process.once(signal, shutdown);
  try {
    await app.listen({ host: app.config.host, port: app.config.port });
    return { app, shutdown };
  } catch (error) {
    for (const signal of signals) process.off(signal, shutdown);
    await app.close().catch(() => {});
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startServer();
