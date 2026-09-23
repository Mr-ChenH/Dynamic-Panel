import { withAccountTx, withAdminTx } from '../db/postgres.js';

export class PostgresOperationsRepository {
  constructor(pool) { this.pool = pool; }
  async getLimits(accountId) {
    const row = (await this.pool.query('SELECT active_spaces,active_clients_per_space FROM structural_limits WHERE account_id=$1', [accountId])).rows[0];
    return { accountId, activeSpaces: row?.active_spaces ?? 10, activeClientsPerSpace: row?.active_clients_per_space ?? 10 };
  }
  async setLimits(accountId, { activeSpaces, activeClientsPerSpace }) {
    if (!Number.isInteger(activeSpaces) || activeSpaces < 1 || activeSpaces > 10 || !Number.isInteger(activeClientsPerSpace) || activeClientsPerSpace < 1 || activeClientsPerSpace > 10) {
      throw Object.assign(new Error('Limits must be integers from 1 through 10'), { code: 'INVALID_ARGUMENT' });
    }
    const result = await this.pool.query(`INSERT INTO structural_limits(account_id,active_spaces,active_clients_per_space) VALUES($1,$2,$3)
      ON CONFLICT(account_id) DO UPDATE SET active_spaces=excluded.active_spaces,active_clients_per_space=excluded.active_clients_per_space
      RETURNING active_spaces,active_clients_per_space`, [accountId, activeSpaces, activeClientsPerSpace]);
    return { accountId, activeSpaces: result.rows[0].active_spaces, activeClientsPerSpace: result.rows[0].active_clients_per_space };
  }
  async usage(accountId, spaceId) {
    const values = [accountId ?? null, spaceId ?? null];
    const result = await withAdminTx(this.pool, { actorType: 'admin', actorId: 'operations' }, (client) => client.query(`SELECT s.account_id,s.space_id,s.name,
      (SELECT count(*) FROM records r WHERE r.account_id=s.account_id AND r.space_id=s.space_id) AS records,
      (SELECT count(*) FROM space_objects o WHERE o.account_id=s.account_id AND o.space_id=s.space_id) AS objects,
      (SELECT coalesce(sum(bytes),0) FROM space_objects o WHERE o.account_id=s.account_id AND o.space_id=s.space_id) AS object_bytes
      FROM spaces s WHERE ($1::uuid IS NULL OR s.account_id=$1) AND ($2::uuid IS NULL OR s.space_id=$2) ORDER BY s.account_id,s.space_id`, values));
    return result.rows.map((row) => ({ accountId: row.account_id, spaceId: row.space_id, name: row.name, records: Number(row.records), objects: Number(row.objects), objectBytes: Number(row.object_bytes) }));
  }
  async audit(accountId, filters = {}) {
    const result = await withAdminTx(this.pool, { actorType: 'admin', actorId: 'operations' }, (client) => client.query(`SELECT event_id,account_id,space_id,actor_type,action,target_type,target_id_prefix,result,error_code,request_id,occurred_at
      FROM audit_events WHERE account_id=$1 AND ($2::uuid IS NULL OR space_id=$2) AND ($3::text IS NULL OR action=$3) ORDER BY occurred_at DESC LIMIT 1000`, [accountId, filters.spaceId ?? null, filters.action ?? null]));
    return result.rows;
  }
  async saveExportJob(job) {
    return withAccountTx(this.pool, { accountId: job.accountId }, async (client) => {
      const row = (await client.query(`INSERT INTO export_jobs(job_id,account_id,space_id,state,result,error_code,created_at,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,result=excluded.result,error_code=excluded.error_code,completed_at=excluded.completed_at
        RETURNING *`, [job.jobId,job.accountId,job.spaceId,job.state,job.result ? JSON.stringify(job.result) : null,job.errorCode ?? null,job.createdAt,job.completedAt ?? null])).rows[0];
      return { jobId: row.job_id, accountId: row.account_id, spaceId: row.space_id, state: row.state, result: row.result, errorCode: row.error_code, createdAt: row.created_at.toISOString(), completedAt: row.completed_at?.toISOString() ?? null };
    });
  }
  async getExportJob(accountId, jobId) {
    return withAccountTx(this.pool, { accountId }, async (client) => {
      const row = (await client.query('SELECT * FROM export_jobs WHERE account_id=$1 AND job_id=$2', [accountId,jobId])).rows[0];
      return row ? { jobId: row.job_id, accountId: row.account_id, spaceId: row.space_id, state: row.state, result: row.result, errorCode: row.error_code, createdAt: row.created_at.toISOString(), completedAt: row.completed_at?.toISOString() ?? null } : undefined;
    });
  }
  async migrationStatus() {
    const rows = (await this.pool.query('SELECT version,applied_at FROM schema_migrations ORDER BY version')).rows;
    return { applied: rows };
  }
  async health() {
    try { await this.pool.query('SELECT 1'); return [{ name: 'database', status: 'ok' }]; }
    catch { return [{ name: 'database', status: 'unavailable' }]; }
  }
}
