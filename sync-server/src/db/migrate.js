import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPool } from './postgres.js';
import { loadConfig } from '../config.js';

const MIGRATION_LOCK = 0x44505359;

export async function migrate(pool, directory = fileURLToPath(new URL('../../migrations', import.meta.url))) {
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const supported = new Set(files.map((file) => file.replace(/\.sql$/, '')));
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const unknown = applied.rows.find((row) => !supported.has(row.version));
    if (unknown) {
      const error = new Error(`Database schema version ${unknown.version} is not supported by this server`);
      error.code = 'MIGRATION_INCOMPATIBLE';
      throw error;
    }
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.rows.some((row) => row.version === version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(await readFile(path.join(directory, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]); } finally { client.release(); }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.end();
}
