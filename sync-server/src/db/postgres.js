import pg from 'pg';

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 20, application_name: 'dynamic-panel-sync' });
}

async function scopedTx(pool, settings, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [name, value] of Object.entries(settings)) {
      await client.query('SELECT set_config($1, $2, true)', [`app.${name}`, value ?? '']);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function withLookupTx(pool, setting, value, fn) {
  if (!['session_fingerprint', 'key_fingerprint'].includes(setting)) throw new Error('invalid lookup setting');
  return scopedTx(pool, { [setting]: value }, fn);
}
export function withAccountTx(pool, context, fn) { return scopedTx(pool, { account_id: context.accountId }, fn); }
export function withSpaceTx(pool, context, fn) {
  return scopedTx(pool, { account_id: context.accountId, space_id: context.spaceId, client_id: context.clientId }, fn);
}
export function withAdminTx(pool, context, fn) {
  if (context.actorType !== 'admin') throw new Error('admin context required');
  return scopedTx(pool, { admin_actor_id: context.actorId }, fn);
}
