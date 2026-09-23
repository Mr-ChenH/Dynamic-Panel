import { errors } from '../errors.js';
import { withAccountTx, withLookupTx, withSpaceTx } from './postgres.js';

const COLUMN_NAMES = {
  instance_id: 'instanceId', protocol_min: 'protocolMin', protocol_max: 'protocolMax', record_schema_min: 'recordSchemaMin', record_schema_max: 'recordSchemaMax',
  account_id: 'accountId', normalized_username: 'normalizedUsername', password_hash: 'passwordHash', must_change_password: 'mustChangePassword', auth_epoch: 'authEpoch',
  session_id: 'sessionId', token_fingerprint: 'tokenFingerprint', csrf_fingerprint: 'csrfFingerprint', last_seen_at: 'lastSeenAt', absolute_expires_at: 'absoluteExpiresAt', idle_expires_at: 'idleExpiresAt', recent_auth_at: 'recentAuthAt', revoked_at: 'revokedAt', ip_prefix: 'ipPrefix', user_agent: 'userAgent',
  space_id: 'spaceId', normalized_name: 'normalizedName', restore_epoch: 'restoreEpoch', next_sequence: 'nextSequence', recoverable_until: 'recoverableUntil', deleted_at: 'deletedAt',
  client_id: 'clientId', short_id: 'shortId', installation_id: 'installationId', first_connected_at: 'firstConnectedAt', app_version: 'appVersion',
  generation_id: 'generationId', lookup_fingerprint: 'lookupFingerprint', expires_at: 'expiresAt',
  event_id: 'eventId', actor_type: 'actorType', actor_id: 'actorId', target_type: 'targetType', target_id_prefix: 'targetIdPrefix', error_code: 'errorCode', request_id: 'requestId', occurred_at: 'occurredAt',
  created_at: 'createdAt', updated_at: 'updatedAt'
};

function mapRow(row) {
  if (!row) return undefined;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const mapped = COLUMN_NAMES[key] ?? key;
    if (value instanceof Date) value = value.toISOString();
    if (['authEpoch', 'restoreEpoch', 'nextSequence'].includes(mapped) && typeof value === 'string') value = Number(value);
    return [mapped, value];
  }));
}

function mapDatabaseError(error, current, limit) {
  if (error.constraint === 'active_space_limit') throw errors.spaceLimit(current, limit);
  if (error.constraint === 'active_client_limit') throw errors.clientLimit(current, limit);
  if (error.code === '23505') throw errors.nameConflict();
  throw error;
}

export class PostgresIdentityStore {
  constructor(pool) {
    this.pool = pool;
    this.sessionAccounts = new Map();
    this.generationScopes = new Map();
  }

  async getInstance() { return mapRow((await this.pool.query('SELECT * FROM server_instance WHERE singleton')).rows[0]); }

  async createAccount(data) {
    try {
      const result = await this.pool.query(`INSERT INTO accounts(username, normalized_username, password_hash, must_change_password)
        VALUES ($1,$2,$3,$4) RETURNING *`, [data.username, data.normalizedUsername, data.passwordHash, data.mustChangePassword]);
      return mapRow(result.rows[0]);
    } catch (error) { mapDatabaseError(error); }
  }

  async findAccountByUsername(value) { return mapRow((await this.pool.query('SELECT * FROM accounts WHERE normalized_username=$1', [value])).rows[0]); }
  async getAccount(id) { return mapRow((await this.pool.query('SELECT * FROM accounts WHERE account_id=$1', [id])).rows[0]); }
  async listAccounts() { return (await this.pool.query('SELECT * FROM accounts ORDER BY created_at')).rows.map(mapRow); }

  async updateAccount(id, patch) {
    const columns = { status: 'status', passwordHash: 'password_hash', mustChangePassword: 'must_change_password', authEpoch: 'auth_epoch' };
    const entries = Object.entries(patch).filter(([key]) => columns[key]);
    if (!entries.length) return this.getAccount(id);
    const values = entries.map(([, value]) => value);
    const sets = entries.map(([key], index) => `${columns[key]}=$${index + 2}`);
    const result = await this.pool.query(`UPDATE accounts SET ${sets.join(',')}, updated_at=now() WHERE account_id=$1 RETURNING *`, [id, ...values]);
    if (!result.rowCount) throw errors.notFound();
    return mapRow(result.rows[0]);
  }

  async createSession(data) {
    return withAccountTx(this.pool, data, async (client) => {
      const result = await client.query(`INSERT INTO account_sessions(account_id,token_fingerprint,csrf_fingerprint,auth_epoch,created_at,last_seen_at,absolute_expires_at,idle_expires_at,ip_prefix,user_agent)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [data.accountId,data.tokenFingerprint,data.csrfFingerprint,data.authEpoch,data.createdAt,data.lastSeenAt,data.absoluteExpiresAt,data.idleExpiresAt,data.ipPrefix,data.userAgent]);
      const row = mapRow(result.rows[0]); this.sessionAccounts.set(row.sessionId, row.accountId); return row;
    });
  }

  async findSessionByFingerprint(value) {
    return withLookupTx(this.pool, 'session_fingerprint', value, async (client) => {
      const row = mapRow((await client.query('SELECT * FROM account_sessions WHERE token_fingerprint=$1', [value])).rows[0]);
      if (row) this.sessionAccounts.set(row.sessionId, row.accountId);
      return row;
    });
  }

  async updateSession(id, patch) {
    const accountId = this.sessionAccounts.get(id);
    if (!accountId) return undefined;
    const columns = { lastSeenAt: 'last_seen_at', idleExpiresAt: 'idle_expires_at', recentAuthAt: 'recent_auth_at', revokedAt: 'revoked_at' };
    const entries = Object.entries(patch).filter(([key]) => columns[key]);
    return withAccountTx(this.pool, { accountId }, async (client) => {
      const values = entries.map(([, value]) => value);
      const result = await client.query(`UPDATE account_sessions SET ${entries.map(([key], index) => `${columns[key]}=$${index + 2}`).join(',')} WHERE session_id=$1 RETURNING *`, [id, ...values]);
      return mapRow(result.rows[0]);
    });
  }

  async listSessions(accountId) {
    return withAccountTx(this.pool, { accountId }, async (client) => {
      const rows = (await client.query('SELECT * FROM account_sessions WHERE account_id=$1 ORDER BY created_at DESC', [accountId])).rows.map(mapRow);
      for (const row of rows) this.sessionAccounts.set(row.sessionId, accountId);
      return rows;
    });
  }

  async revokeOtherSessions(accountId, currentSessionId, revokedAt) {
    return withAccountTx(this.pool, { accountId }, (client) => client.query('UPDATE account_sessions SET revoked_at=$3 WHERE account_id=$1 AND session_id<>$2 AND revoked_at IS NULL', [accountId,currentSessionId,revokedAt]));
  }
  async revokeAccountSessions(accountId, exceptSessionId, revokedAt) {
    return withAccountTx(this.pool, { accountId }, (client) => client.query('UPDATE account_sessions SET revoked_at=$3 WHERE account_id=$1 AND ($2::uuid IS NULL OR session_id<>$2) AND revoked_at IS NULL', [accountId,exceptSessionId,revokedAt]));
  }

  async listSpaces(accountId) { return withAccountTx(this.pool, { accountId }, async (client) => (await client.query("SELECT * FROM spaces WHERE account_id=$1 AND status<>'purged' ORDER BY created_at", [accountId])).rows.map(mapRow)); }
  async getSpace(accountId, spaceId) { return withAccountTx(this.pool, { accountId }, async (client) => mapRow((await client.query("SELECT * FROM spaces WHERE account_id=$1 AND space_id=$2 AND status<>'purged'", [accountId,spaceId])).rows[0])); }

  async createSpace(accountId, data, limit) {
    return withAccountTx(this.pool, { accountId }, async (client) => {
      const current = Number((await client.query("SELECT count(*) FROM spaces WHERE account_id=$1 AND status='active'", [accountId])).rows[0].count);
      try { return mapRow((await client.query('INSERT INTO spaces(account_id,name,normalized_name) VALUES($1,$2,$3) RETURNING *', [accountId,data.name,data.normalizedName])).rows[0]); }
      catch (error) { mapDatabaseError(error, current, limit); }
    });
  }

  async updateSpace(accountId, spaceId, patch, limit) {
    return withAccountTx(this.pool, { accountId }, async (client) => {
      const columns = { name: 'name', normalizedName: 'normalized_name', status: 'status', deletedAt: 'deleted_at', recoverableUntil: 'recoverable_until', restoreEpoch: 'restore_epoch' };
      const entries = Object.entries(patch).filter(([key]) => columns[key]);
      const current = Number((await client.query("SELECT count(*) FROM spaces WHERE account_id=$1 AND status='active'", [accountId])).rows[0].count);
      try {
        const result = await client.query(`UPDATE spaces SET ${entries.map(([key], index) => `${columns[key]}=$${index + 3}`).join(',')},updated_at=now() WHERE account_id=$1 AND space_id=$2 RETURNING *`, [accountId,spaceId,...entries.map(([, value]) => value)]);
        if (!result.rowCount) throw errors.notFound();
        return mapRow(result.rows[0]);
      } catch (error) { if (error.statusCode) throw error; mapDatabaseError(error, current, limit); }
    });
  }

  async listClients(accountId, spaceId) { return withSpaceTx(this.pool, { accountId, spaceId }, async (client) => (await client.query('SELECT * FROM clients WHERE account_id=$1 AND space_id=$2 ORDER BY created_at', [accountId,spaceId])).rows.map(mapRow)); }
  async getClient(accountId, spaceId, clientId) { return withSpaceTx(this.pool, { accountId, spaceId }, async (client) => mapRow((await client.query('SELECT * FROM clients WHERE account_id=$1 AND space_id=$2 AND client_id=$3', [accountId,spaceId,clientId])).rows[0])); }

  async createClient(accountId, spaceId, data, generation, limit) {
    return withSpaceTx(this.pool, { accountId, spaceId }, async (client) => {
      const current = Number((await client.query("SELECT count(*) FROM clients WHERE account_id=$1 AND space_id=$2 AND status='active'", [accountId,spaceId])).rows[0].count);
      try {
        const result = await client.query('INSERT INTO clients(account_id,space_id,name,normalized_name,short_id) VALUES($1,$2,$3,$4,$5) RETURNING *', [accountId,spaceId,data.name,data.normalizedName,data.shortId]);
        const row = mapRow(result.rows[0]);
        const key = await client.query('INSERT INTO client_key_generations(account_id,space_id,client_id,lookup_fingerprint,verifier,auth_epoch) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [accountId,spaceId,row.clientId,generation.lookupFingerprint,generation.verifier,generation.authEpoch]);
        this.generationScopes.set(key.rows[0].generation_id, { accountId, spaceId });
        return row;
      } catch (error) { mapDatabaseError(error, current, limit); }
    });
  }

  async updateClient(accountId, spaceId, clientId, patch) {
    return withSpaceTx(this.pool, { accountId, spaceId }, async (client) => {
      const columns = { name:'name', normalizedName:'normalized_name', status:'status', revokedAt:'revoked_at', installationId:'installation_id', firstConnectedAt:'first_connected_at', lastSeenAt:'last_seen_at', platform:'platform', appVersion:'app_version' };
      const entries = Object.entries(patch).filter(([key]) => columns[key]);
      const result = await client.query(`UPDATE clients SET ${entries.map(([key], index) => `${columns[key]}=$${index + 4}`).join(',')} WHERE account_id=$1 AND space_id=$2 AND client_id=$3 RETURNING *`, [accountId,spaceId,clientId,...entries.map(([,value]) => value)]);
      if (!result.rowCount) throw errors.notFound();
      return mapRow(result.rows[0]);
    });
  }

  async addKeyGeneration(data) {
    return withSpaceTx(this.pool, data, async (client) => {
      const row = mapRow((await client.query('INSERT INTO client_key_generations(account_id,space_id,client_id,lookup_fingerprint,verifier,auth_epoch,expires_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [data.accountId,data.spaceId,data.clientId,data.lookupFingerprint,data.verifier,data.authEpoch,data.expiresAt ?? null,data.revokedAt ?? null])).rows[0]);
      this.generationScopes.set(row.generationId, { accountId: data.accountId, spaceId: data.spaceId }); return row;
    });
  }

  async findKeyByFingerprint(value) {
    return withLookupTx(this.pool, 'key_fingerprint', value, async (client) => {
      const row = mapRow((await client.query('SELECT * FROM client_key_generations WHERE lookup_fingerprint=$1', [value])).rows[0]);
      if (row) this.generationScopes.set(row.generationId, { accountId: row.accountId, spaceId: row.spaceId }); return row;
    });
  }

  async listKeyGenerations(accountId, spaceId, clientId) {
    return withSpaceTx(this.pool, { accountId, spaceId }, async (client) => {
      const rows = (await client.query('SELECT * FROM client_key_generations WHERE account_id=$1 AND space_id=$2 AND client_id=$3 ORDER BY created_at,generation_id', [accountId,spaceId,clientId])).rows.map(mapRow);
      for (const row of rows) this.generationScopes.set(row.generationId, { accountId, spaceId }); return rows;
    });
  }

  async updateKeyGeneration(id, patch) {
    const scope = this.generationScopes.get(id); if (!scope) return undefined;
    return withSpaceTx(this.pool, scope, async (client) => {
      const entries = Object.entries(patch).filter(([key]) => ['expiresAt','revokedAt'].includes(key));
      const names = { expiresAt:'expires_at', revokedAt:'revoked_at' };
      return mapRow((await client.query(`UPDATE client_key_generations SET ${entries.map(([key],index)=>`${names[key]}=$${index+2}`).join(',')} WHERE generation_id=$1 RETURNING *`, [id,...entries.map(([,value])=>value)])).rows[0]);
    });
  }

  async replaceClientKey(accountId, spaceId, clientId, { retirements = [], generation, clientPatch } = {}) {
    const result = await withSpaceTx(this.pool, { accountId, spaceId, clientId }, async (client) => {
      const current = (await client.query('SELECT * FROM clients WHERE account_id=$1 AND space_id=$2 AND client_id=$3 FOR UPDATE', [accountId, spaceId, clientId])).rows[0];
      if (!current) throw errors.notFound();
      await client.query('SELECT generation_id FROM client_key_generations WHERE account_id=$1 AND space_id=$2 AND client_id=$3 FOR UPDATE', [accountId, spaceId, clientId]);
      for (const retirement of retirements) {
        const entries = Object.entries(retirement.patch || {}).filter(([key]) => ['expiresAt', 'revokedAt'].includes(key));
        const names = { expiresAt: 'expires_at', revokedAt: 'revoked_at' };
        if (!entries.length) continue;
        const updated = await client.query(`UPDATE client_key_generations SET ${entries.map(([key], index) => `${names[key]}=$${index + 5}`).join(',')} WHERE account_id=$1 AND space_id=$2 AND client_id=$3 AND generation_id=$4 RETURNING generation_id`, [accountId, spaceId, clientId, retirement.generationId, ...entries.map(([, value]) => value)]);
        if (!updated.rowCount) throw errors.notFound();
      }
      const inserted = mapRow((await client.query('INSERT INTO client_key_generations(account_id,space_id,client_id,lookup_fingerprint,verifier,auth_epoch,expires_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [accountId, spaceId, clientId, generation.lookupFingerprint, generation.verifier, generation.authEpoch, generation.expiresAt ?? null, generation.revokedAt ?? null])).rows[0]);
      let updatedClient = mapRow(current);
      if (clientPatch) {
        const columns = { name:'name', normalizedName:'normalized_name', status:'status', revokedAt:'revoked_at', installationId:'installation_id', firstConnectedAt:'first_connected_at', lastSeenAt:'last_seen_at', platform:'platform', appVersion:'app_version' };
        const entries = Object.entries(clientPatch).filter(([key]) => columns[key]);
        if (entries.length) updatedClient = mapRow((await client.query(`UPDATE clients SET ${entries.map(([key], index) => `${columns[key]}=$${index + 4}`).join(',')} WHERE account_id=$1 AND space_id=$2 AND client_id=$3 RETURNING *`, [accountId, spaceId, clientId, ...entries.map(([, value]) => value)])).rows[0]);
      }
      return { client: updatedClient, generation: inserted };
    });
    this.generationScopes.set(result.generation.generationId, { accountId, spaceId });
    return result;
  }

  async bindClient(accountId, spaceId, clientId, installationId, metadata, now) {
    return withSpaceTx(this.pool, { accountId, spaceId, clientId }, async (client) => {
      const row = (await client.query('SELECT * FROM clients WHERE account_id=$1 AND space_id=$2 AND client_id=$3 FOR UPDATE', [accountId,spaceId,clientId])).rows[0];
      if (!row || row.status !== 'active') return { status:'failed' };
      if (row.installation_id && row.installation_id !== installationId) return { status:'mismatch' };
      const updated = await client.query(`UPDATE clients SET installation_id=COALESCE(installation_id,$4),first_connected_at=COALESCE(first_connected_at,$5),last_seen_at=$5,platform=$6,app_version=$7 WHERE account_id=$1 AND space_id=$2 AND client_id=$3 RETURNING *`, [accountId,spaceId,clientId,installationId,now,metadata.platform,metadata.appVersion]);
      return { status:'ok', client:mapRow(updated.rows[0]) };
    });
  }

  async audit(data) {
    return withAccountTx(this.pool, data, async (client) => mapRow((await client.query(`INSERT INTO audit_events(account_id,space_id,client_id,actor_type,actor_id,action,target_type,target_id_prefix,result,error_code,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [data.accountId,data.spaceId??null,data.clientId??null,data.actorType,data.actorId??null,data.action,data.targetType,data.targetIdPrefix,data.result,data.errorCode??null,data.requestId])).rows[0]));
  }
  async listAudit(accountId, filters={}) { return withAccountTx(this.pool,{accountId},async(client)=>(await client.query('SELECT * FROM audit_events WHERE account_id=$1 AND ($2::uuid IS NULL OR space_id=$2) AND ($3::text IS NULL OR action=$3) ORDER BY occurred_at DESC',[accountId,filters.spaceId??null,filters.action??null])).rows.map(mapRow)); }
}
