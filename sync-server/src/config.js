import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(43822),
  DATABASE_URL: z.string().optional(),
  CONSOLE_ORIGIN: z.string().url().default('http://127.0.0.1:43822'),
  TRUST_PROXY: z.string().optional(),
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
  DP_OBJECT_TARGET: z.enum(['memory', 'filesystem', 's3']).optional(),
  DP_OBJECT_PATH: z.string().optional(),
  DP_OBJECT_S3_BUCKET: z.string().optional(),
  DP_OBJECT_S3_PREFIX: z.string().optional(),
  DP_OBJECT_S3_ENDPOINT: z.string().url().optional(),
  DP_OBJECT_S3_REGION: z.string().default('us-east-1'),
  COOKIE_SECRET: z.string().min(32),
  KEY_LOOKUP_SECRET: z.string().min(32),
  CURSOR_SECRET: z.string().min(32).optional(),
  SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(300).max(86400).default(43200),
  SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).max(43200).default(1800),
  RECENT_AUTH_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).max(128).default(12)
});

export function loadConfig(env = process.env) {
  const developmentSecret = 'development-only-secret-change-me-32';
  const parsed = schema.parse({
    ...env,
    COOKIE_SECRET: env.COOKIE_SECRET ?? (env.NODE_ENV === 'production' ? undefined : developmentSecret),
    KEY_LOOKUP_SECRET: env.KEY_LOOKUP_SECRET ?? (env.NODE_ENV === 'production' ? undefined : developmentSecret),
    CURSOR_SECRET: env.CURSOR_SECRET ?? (env.NODE_ENV === 'production' ? undefined : `${developmentSecret}-cursor`)
  });
  const origin = new URL(parsed.CONSOLE_ORIGIN);
  const loopbackNames = new Set(['127.0.0.1', '[::1]', 'localhost']);
  if (origin.protocol !== 'https:' && !(parsed.NODE_ENV !== 'production' && origin.protocol === 'http:' && loopbackNames.has(origin.hostname))) {
    throw new Error('CONSOLE_ORIGIN must use HTTPS, except for loopback development');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.CURSOR_SECRET) throw new Error('CURSOR_SECRET is required in production');
  if (Boolean(parsed.TLS_CERT_FILE) !== Boolean(parsed.TLS_KEY_FILE)) throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together');
  if (parsed.NODE_ENV === 'production' && !parsed.TLS_CERT_FILE && !parsed.TRUST_PROXY) throw new Error('Production requires direct TLS or an explicitly trusted TLS proxy');
  const objectTarget = parsed.DP_OBJECT_TARGET ?? (parsed.DP_OBJECT_PATH ? 'filesystem' : 'memory');
  if (objectTarget === 'filesystem' && !parsed.DP_OBJECT_PATH) throw new Error('DP_OBJECT_PATH is required for filesystem object storage');
  if (objectTarget === 's3' && !parsed.DP_OBJECT_S3_BUCKET) throw new Error('DP_OBJECT_S3_BUCKET is required for S3 object storage');
  if (parsed.NODE_ENV === 'production' && objectTarget === 'memory') throw new Error('Persistent object storage is required in production');
  if (parsed.NODE_ENV === 'production' && !env.DP_BACKUP_TARGET) throw new Error('DP_BACKUP_TARGET is required in production');
  if (parsed.NODE_ENV === 'production' && !env.DP_BACKUP_MASTER_KEY && !env.DP_BACKUP_MASTER_KEY_FILE) throw new Error('A protected backup master key is required in production');
  if (env.DP_BACKUP_TARGET === 'filesystem' && !env.DP_BACKUP_PATH) throw new Error('DP_BACKUP_PATH is required for filesystem backups');
  if (env.DP_BACKUP_TARGET === 's3' && !env.DP_BACKUP_S3_BUCKET) throw new Error('DP_BACKUP_S3_BUCKET is required for S3 backups');
  if (env.DP_BACKUP_TARGET === 'filesystem' && parsed.DP_OBJECT_PATH && env.DP_BACKUP_PATH === parsed.DP_OBJECT_PATH) throw new Error('Object and backup directories must be separate');
  return {
    env: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    trustProxy: parsed.TRUST_PROXY || false,
    tlsCertFile: parsed.TLS_CERT_FILE,
    tlsKeyFile: parsed.TLS_KEY_FILE,
    objectStorage: Object.freeze({ target: objectTarget, path: parsed.DP_OBJECT_PATH, bucket: parsed.DP_OBJECT_S3_BUCKET, prefix: parsed.DP_OBJECT_S3_PREFIX, endpoint: parsed.DP_OBJECT_S3_ENDPOINT, region: parsed.DP_OBJECT_S3_REGION }),
    consoleOrigin: origin.origin,
    cookieSecret: parsed.COOKIE_SECRET,
    keyLookupSecret: parsed.KEY_LOOKUP_SECRET,
    cursorSecret: parsed.CURSOR_SECRET ?? `${developmentSecret}-cursor`,
    sessionAbsoluteMs: parsed.SESSION_ABSOLUTE_SECONDS * 1000,
    sessionIdleMs: parsed.SESSION_IDLE_SECONDS * 1000,
    recentAuthMs: parsed.RECENT_AUTH_SECONDS * 1000,
    passwordMinLength: parsed.PASSWORD_MIN_LENGTH,
    secureCookies: origin.protocol === 'https:',
    limits: Object.freeze({
      jsonBytes: 1_048_576,
      operationsPerPush: 100,
      changesPerPull: 500,
      chunkBytes: 8_388_608,
      clientObjectTransfers: 4,
      chunksPerUpload: 10_000,
      headerBytes: 32_768
    })
  };
}
