const SNAPSHOT_TABLES = Object.freeze([
  'accounts', 'structural_limits', 'spaces', 'clients', 'records', 'record_versions', 'operations',
  'conflicts', 'changes', 'space_stream_floors', 'category_state', 'physical_objects', 'space_objects',
  'object_refs', 'object_usage_rollups'
]);
const SPACE_TABLES = Object.freeze([
  'clients', 'records', 'record_versions', 'operations', 'conflicts', 'changes', 'space_stream_floors',
  'category_state', 'space_objects', 'object_refs', 'object_usage_rollups'
]);
const INSERT_ORDER = Object.freeze([
  'clients', 'records', 'record_versions', 'operations', 'conflicts', 'changes', 'space_stream_floors',
  'category_state', 'physical_objects', 'space_objects', 'object_refs', 'object_usage_rollups'
]);

function selected(row, scope) {
  if (!scope || scope.type === 'server') return true;
  if (row.account_id !== scope.accountId) return false;
  return scope.type !== 'space' || row.space_id === scope.spaceId;
}
function scopedRows(rows, scope) { return rows.filter((row) => selected(row, scope)); }
function safeStageId(stageId) {
  if (typeof stageId !== 'string' || !/^[0-9a-f-]{16,64}$/i.test(stageId)) throw Object.assign(new Error('Invalid restore stage ID'), { code: 'RESTORE_STAGE_NOT_FOUND' });
  return stageId;
}
function serialize(value) {
  return JSON.stringify(value, (_, child) => typeof child === 'bigint' ? child.toString() : child);
}
async function insertRows(client, table, rows, { onConflict = '' } = {}) {
  if (!rows?.length) return;
  await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json) ${onConflict}`, [serialize(rows)]);
}

export class PostgresBackupRepository {
  constructor(pool, { objectSource, objectSink = objectSource } = {}) {
    if (!pool) throw new TypeError('PostgreSQL pool is required');
    this.pool = pool;
    this.objectSource = objectSource;
    this.objectSink = objectSink;
  }

  async snapshot({ scope = { type: 'server' } } = {}) {
    const client = await this.pool.connect();
    let released = false;
    const release = async (commit = true) => {
      if (released) return;
      released = true;
      try { await client.query(commit ? 'COMMIT' : 'ROLLBACK'); } finally { client.release(); }
    };
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SELECT set_config('app.admin_actor_id','backup',true)");
      const tables = {};
      for (const table of SNAPSHOT_TABLES) {
        const rows = (await client.query(`SELECT * FROM ${table}`)).rows;
        tables[table] = table === 'physical_objects' ? rows : scopedRows(rows, scope);
      }
      if (scope.type !== 'server') tables.physical_objects = tables.physical_objects.filter((physical) => tables.space_objects.some((object) => object.physical_object_id === physical.physical_object_id));
      const instance = (await client.query('SELECT instance_id,protocol_max FROM server_instance WHERE singleton=true')).rows[0];
      const schema = (await client.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')).rows[0]?.version ?? 'unknown';
      const objectEntries = tables.space_objects.map((object) => {
        const physical = tables.physical_objects.find((row) => row.physical_object_id === object.physical_object_id);
        return {
          accountId: object.account_id, spaceId: object.space_id, objectId: object.object_id,
          physicalObjectId: object.physical_object_id, storageKey: physical?.storage_key,
          digest: object.digest, bytes: Number(object.bytes), mimeType: object.mime_type, purpose: object.purpose
        };
      });
      if (objectEntries.length && !this.objectSource) throw Object.assign(new Error('Object source is not configured'), { code: 'OBJECT_STORAGE_UNAVAILABLE' });
      return {
        databaseSchema: 1, schemaMigration: schema, instanceId: instance?.instance_id ?? null,
        protocol: instance?.protocol_max ?? 1,
        spaces: tables.spaces.map((row) => ({ accountId: row.account_id, spaceId: row.space_id, restoreEpoch: Number(row.restore_epoch) })),
        data: { tables }, objectEntries,
        objectSource: this.objectSource ? { openObject: (entry) => this.objectSource.open(entry.storageKey) } : undefined,
        release
      };
    } catch (error) {
      await release(false);
      throw error;
    }
  }

  async validateSnapshot(data, manifest, objects = []) {
    const tables = data?.tables;
    if (!tables || !Array.isArray(tables.accounts) || !Array.isArray(tables.spaces)) throw Object.assign(new Error('Logical snapshot tables are invalid'), { code: 'BACKUP_VERIFICATION_FAILED' });
    if (manifest.databaseSchema !== 1) throw Object.assign(new Error('Unsupported logical snapshot schema'), { code: 'BACKUP_VERIFICATION_FAILED' });
    if (objects.length !== (manifest.objects?.count ?? 0)) throw Object.assign(new Error('Object inventory is incomplete'), { code: 'BACKUP_VERIFICATION_FAILED' });
  }

  async inspectStage(data, manifest, objects = []) {
    const errors = [];
    const tables = data?.tables;
    if (!tables || !SNAPSHOT_TABLES.every((table) => Array.isArray(tables[table]))) errors.push({ code: 'invalid_logical_tables' });
    if (manifest.databaseSchema !== 1) errors.push({ code: 'incompatible_database_schema' });
    const accountIds = new Set((tables?.accounts ?? []).map((row) => row.account_id));
    for (const space of tables?.spaces ?? []) if (!accountIds.has(space.account_id)) errors.push({ code: 'orphan_space', spaceId: space.space_id });
    const expectedObjects = manifest.objects ?? { count: 0, bytes: 0 };
    const actualBytes = objects.reduce((sum, object) => sum + object.bytes.length, 0);
    if (objects.length !== expectedObjects.count || actualBytes !== expectedObjects.bytes) errors.push({ code: 'object_inventory_mismatch' });
    return { compatible: !errors.some((item) => item.code.startsWith('incompatible_')), accounts: tables?.accounts?.length ?? 0, spaces: tables?.spaces?.length ?? 0, errors, missingObjects: [], corruptObjects: [] };
  }

  async saveStage(stageId, data, report, objects = []) {
    safeStageId(stageId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO restore_stages(stage_id,manifest_id,status,staging_locator,report,verified_at)
        VALUES($1,$2,'ready',$3,$4,now())`, [stageId, report.manifestId, `postgres:restore_stage_payloads/${stageId}`, serialize({ ...report, manifest: undefined })]);
      await client.query('INSERT INTO restore_stage_payloads(stage_id,payload) VALUES($1,$2)', [stageId, serialize(data)]);
      for (let index = 0; index < objects.length; index += 1) {
        await client.query('INSERT INTO restore_stage_objects(stage_id,artifact_index,metadata,body) VALUES($1,$2,$3,$4)', [stageId, index, serialize(objects[index].metadata), objects[index].bytes]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async getStage(stageId) {
    safeStageId(stageId);
    const row = (await this.pool.query(`SELECT s.report,p.payload FROM restore_stages s JOIN restore_stage_payloads p USING(stage_id)
      WHERE s.stage_id=$1 AND s.status='ready'`, [stageId])).rows[0];
    return row ? { data: row.payload, report: row.report } : null;
  }

  async activateStage(stageId, scope) {
    safeStageId(stageId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.admin_actor_id','restore',true)");
      const stage = (await client.query(`SELECT p.payload FROM restore_stages s JOIN restore_stage_payloads p USING(stage_id)
        WHERE s.stage_id=$1 AND s.status='ready' FOR UPDATE`, [stageId])).rows[0];
      if (!stage) throw Object.assign(new Error('Stage not found or not ready'), { code: 'RESTORE_STAGE_NOT_READY' });
      const tables = stage.payload.tables;
      const stagedSpaces = scopedRows(tables.spaces, scope);
      if (!stagedSpaces.length) throw Object.assign(new Error('Restore scope is absent from stage'), { code: 'RESTORE_SCOPE_NOT_FOUND' });
      const epochs = new Map();
      for (const space of stagedSpaces) {
        const current = (await client.query('SELECT restore_epoch FROM spaces WHERE account_id=$1 AND space_id=$2 FOR UPDATE', [space.account_id, space.space_id])).rows[0];
        epochs.set(space.space_id, Number(current?.restore_epoch ?? space.restore_epoch ?? 0) + 1);
      }
      if (this.objectSink) {
        const artifacts = (await client.query('SELECT metadata,body FROM restore_stage_objects WHERE stage_id=$1 ORDER BY artifact_index', [stageId])).rows;
        for (const artifact of artifacts) await this.objectSink.put(artifact.metadata.storageKey, artifact.body);
      } else if ((await client.query('SELECT count(*) AS count FROM restore_stage_objects WHERE stage_id=$1', [stageId])).rows[0].count !== '0') {
        throw Object.assign(new Error('Object destination is not configured'), { code: 'OBJECT_STORAGE_UNAVAILABLE' });
      }
      for (const space of stagedSpaces) await client.query('DELETE FROM spaces WHERE account_id=$1 AND space_id=$2', [space.account_id, space.space_id]);
      await insertRows(client, 'spaces', stagedSpaces.map((space) => ({ ...space, restore_epoch: epochs.get(space.space_id), next_sequence: 0 })));
      for (const table of INSERT_ORDER) {
        let rows = scopedRows(tables[table] ?? [], scope);
        if (table === 'physical_objects') {
          const ids = new Set(scopedRows(tables.space_objects ?? [], scope).map((row) => row.physical_object_id));
          rows = rows.filter((row) => ids.has(row.physical_object_id));
          if (rows.length) await client.query('DELETE FROM physical_objects WHERE physical_object_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM space_objects WHERE space_objects.physical_object_id=physical_objects.physical_object_id)', [rows.map((row) => row.physical_object_id)]);
        }
        if (table === 'space_stream_floors') rows = rows.map((row) => ({ ...row, restore_epoch: epochs.get(row.space_id), minimum_sequence: 1 }));
        await insertRows(client, table, rows, table === 'physical_objects' ? { onConflict: 'ON CONFLICT (physical_object_id) DO NOTHING' } : undefined);
      }
      if (scope.type === 'account' && tables.structural_limits?.length) {
        await client.query('DELETE FROM structural_limits WHERE account_id=$1', [scope.accountId]);
        await insertRows(client, 'structural_limits', tables.structural_limits.filter((row) => row.account_id === scope.accountId));
      }
      await client.query("UPDATE restore_stages SET status='applied',applied_at=now() WHERE stage_id=$1", [stageId]);
      await client.query('COMMIT');
      return { spaces: stagedSpaces.map((space) => ({ accountId: space.account_id, spaceId: space.space_id, restoreEpoch: epochs.get(space.space_id) })) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async drill(stageId) {
    const stage = await this.getStage(stageId);
    return { ok: Boolean(stage), referencesValid: Boolean(stage), schemaCompatible: Boolean(stage) };
  }
}
