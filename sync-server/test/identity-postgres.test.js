import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';

const connectionString = process.env.SYNC_TEST_DATABASE_URL;

test('PostgreSQL migration installs forced RLS identity policies', { skip: !connectionString }, async () => {
  const admin = new pg.Pool({ connectionString });
  const schema = `identity_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
  try {
    await migrate(pool);
    const result = await pool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.policyname)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
      WHERE n.nspname = $1 AND c.relname = ANY($2::text[])
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname
    `, [schema, ['account_sessions', 'spaces', 'clients', 'client_key_generations', 'audit_events']]);
    assert.equal(result.rowCount, 5);
    for (const row of result.rows) {
      assert.equal(row.relrowsecurity, true, row.relname);
      assert.equal(row.relforcerowsecurity, true, row.relname);
      assert.ok(row.policies >= 1, row.relname);
    }
    const migrations = await pool.query('SELECT version FROM schema_migrations');
    assert.deepEqual(migrations.rows, [{ version: '0001_identity_core' }]);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
