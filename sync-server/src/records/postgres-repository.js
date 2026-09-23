import { withSpaceTx } from '../db/postgres.js';
import { RepositoryError } from './memory-repository.js';

function mapRecord(row) {
  if (!row) return undefined;
  return { spaceId: row.space_id, entityType: row.entity_type, entityId: row.entity_id, category: row.category, schemaVersion: row.schema_version, revision: Number(row.revision), updatedAt: iso(row.updated_at), originClientId: row.origin_client_id, deleted: row.deleted, payload: row.payload, sequence: Number(row.last_sequence ?? row.sequence), retainUntil: iso(row.retain_until) };
}
function mapVersion(row) { if (!row) return undefined; return { ...mapRecord(row), baseRevision: Number(row.base_revision), operationId: row.operation_id }; }
function mapCategory(row) { return { category:row.category,present:row.present,clearGeneration:Number(row.clear_generation),lastSequence:Number(row.last_sequence),updatedAt:iso(row.updated_at) }; }
function mapConflict(row) {
  if (!row) return undefined;
  return { conflictId: row.conflict_id, accountId: row.account_id, spaceId: row.space_id, entityType: row.entity_type, entityId: row.entity_id, category: row.category, baseRevision: Number(row.base_revision), currentRevision: Number(row.current_revision), currentPayload: row.current_payload, incomingPayload: row.incoming_payload, currentOriginClientId: row.current_origin_client_id, incomingOriginClientId: row.incoming_origin_client_id, changedFields: row.changed_fields, reason: row.reason, status: row.status, resolutionRevision: row.resolution_revision == null ? null : Number(row.resolution_revision), createdAt: iso(row.created_at), resolvedAt: iso(row.resolved_at), retainUntil: iso(row.retain_until), sequence: Number(row.sequence) };
}
const iso = (value) => value instanceof Date ? value.toISOString() : value ?? null;
const bytes = (payload) => Buffer.byteLength(JSON.stringify(payload), 'utf8');

export class PostgresRecordRepository {
  constructor(pool) { this.pool = pool; }

  transaction(scope, callback) {
    return withSpaceTx(this.pool, scope, async (client) => {
      const row = (await client.query("SELECT account_id,space_id,restore_epoch,next_sequence,status FROM spaces WHERE account_id=$1 AND space_id=$2 FOR UPDATE", [scope.accountId, scope.spaceId])).rows[0];
      if (!row || row.status !== 'active') throw new RepositoryError('scope_not_found');
      if (scope.restoreEpoch !== undefined && Number(row.restore_epoch) !== scope.restoreEpoch) throw new RepositoryError('restore_epoch_changed');
      return callback(new PostgresRecordTransaction(client, scope, row));
    });
  }
  read(scope, callback) { return this.transaction(scope, callback); }
  async setFloor(scope, sequence) { return this.transaction(scope, (tx) => tx.setFloor(sequence)); }
  async advanceEpoch(scope) {
    return withSpaceTx(this.pool, scope, async (client) => {
      const row = (await client.query("UPDATE spaces SET restore_epoch=restore_epoch+1,updated_at=now() WHERE account_id=$1 AND space_id=$2 AND status='active' RETURNING restore_epoch,next_sequence", [scope.accountId, scope.spaceId])).rows[0];
      if (!row) throw new RepositoryError('scope_not_found');
      await client.query('DELETE FROM changes WHERE account_id=$1 AND space_id=$2', [scope.accountId, scope.spaceId]);
      const floorSequence = Number(row.next_sequence) + 1;
      await client.query('UPDATE space_stream_floors SET restore_epoch=$3,minimum_sequence=$4,updated_at=now() WHERE account_id=$1 AND space_id=$2', [scope.accountId, scope.spaceId, row.restore_epoch, floorSequence]);
      return { ...scope, restoreEpoch: Number(row.restore_epoch), nextSequence: Number(row.next_sequence), floorSequence };
    });
  }
}

class PostgresRecordTransaction {
  constructor(client, scope, space) { this.client = client; this.scope = scope; this.spaceRow = space; }
  async space() {
    const floor = (await this.client.query('SELECT minimum_sequence FROM space_stream_floors WHERE account_id=$1 AND space_id=$2', [this.scope.accountId, this.scope.spaceId])).rows[0];
    return { accountId: this.scope.accountId, spaceId: this.scope.spaceId, restoreEpoch: Number(this.spaceRow.restore_epoch), nextSequence: Number(this.spaceRow.next_sequence), floorSequence: Number(floor?.minimum_sequence ?? 1) };
  }
  async getOperation(clientId, operationId) { const row = (await this.client.query('SELECT request_hash,result,created_at FROM operations WHERE account_id=$1 AND space_id=$2 AND client_id=$3 AND operation_id=$4', [this.scope.accountId, this.scope.spaceId, clientId, operationId])).rows[0]; return row && { requestHash: row.request_hash.trim(), result: row.result, createdAt: iso(row.created_at) }; }
  async putOperation(clientId, operationId, value) { await this.client.query('INSERT INTO operations(account_id,space_id,client_id,operation_id,request_hash,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [this.scope.accountId, this.scope.spaceId, clientId, operationId, value.requestHash, value.result, value.createdAt]); }
  async getRecord(type, id) { return mapRecord((await this.client.query('SELECT * FROM records WHERE account_id=$1 AND space_id=$2 AND entity_type=$3 AND entity_id=$4 FOR UPDATE', [this.scope.accountId, this.scope.spaceId, type, id])).rows[0]); }
  async putRecord(row) {
    await this.client.query(`INSERT INTO records(account_id,space_id,entity_type,entity_id,category,schema_version,revision,payload,payload_bytes,deleted,origin_client_id,updated_at,last_sequence,retain_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(account_id,space_id,entity_type,entity_id) DO UPDATE SET category=excluded.category,schema_version=excluded.schema_version,revision=excluded.revision,payload=excluded.payload,payload_bytes=excluded.payload_bytes,deleted=excluded.deleted,origin_client_id=excluded.origin_client_id,updated_at=excluded.updated_at,last_sequence=excluded.last_sequence,retain_until=excluded.retain_until`,
    [this.scope.accountId,this.scope.spaceId,row.entityType,row.entityId,row.category,row.schemaVersion,row.revision,row.payload,bytes(row.payload),row.deleted,row.originClientId,row.updatedAt,row.sequence,row.retainUntil]);
  }
  async getVersion(type, id, revision) { if (!revision) return undefined; return mapVersion((await this.client.query('SELECT *,sequence AS last_sequence FROM record_versions WHERE account_id=$1 AND space_id=$2 AND entity_type=$3 AND entity_id=$4 AND revision=$5', [this.scope.accountId,this.scope.spaceId,type,id,revision])).rows[0]); }
  async putVersion(row) { await this.client.query(`INSERT INTO record_versions(account_id,space_id,entity_type,entity_id,revision,base_revision,operation_id,category,schema_version,payload,payload_bytes,deleted,origin_client_id,sequence,created_at,retain_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [this.scope.accountId,this.scope.spaceId,row.entityType,row.entityId,row.revision,row.baseRevision,row.operationId,row.category,row.schemaVersion,row.payload,bytes(row.payload),row.deleted,row.originClientId,row.sequence,row.updatedAt,row.retainUntil]); }
  async nextSequence() { const row = (await this.client.query('UPDATE spaces SET next_sequence=next_sequence+1 WHERE account_id=$1 AND space_id=$2 RETURNING next_sequence', [this.scope.accountId,this.scope.spaceId])).rows[0]; this.spaceRow.next_sequence = row.next_sequence; return Number(row.next_sequence); }
  async addChange(row) { await this.client.query(`INSERT INTO changes(account_id,space_id,sequence,event_kind,category,entity_type,entity_id,revision,conflict_id,record_snapshot,conflict_snapshot,origin_client_id,server_time)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [this.scope.accountId,this.scope.spaceId,row.sequence,row.kind,row.category,row.entityType,row.entityId,row.revision,row.conflict?.conflictId??null,row.record??null,row.conflict??null,row.originClientId,row.serverTime]); }
  async listChanges(after, upper, limit, categories = []) {
    const rows = (await this.client.query(`SELECT * FROM changes WHERE account_id=$1 AND space_id=$2 AND sequence>$3 AND sequence<=$4 AND (cardinality($5::text[])=0 OR category=ANY($5::text[])) ORDER BY sequence LIMIT $6`, [this.scope.accountId,this.scope.spaceId,after,upper,categories,limit])).rows;
    return rows.map((row) => ({ sequence:Number(row.sequence),kind:row.event_kind,category:row.category,entityType:row.entity_type,entityId:row.entity_id,revision:row.revision==null?null:Number(row.revision),...(row.record_snapshot?{record:row.record_snapshot}:{}),...(row.conflict_snapshot?{conflict:row.conflict_snapshot}:{}),originClientId:row.origin_client_id,serverTime:iso(row.server_time) }));
  }
  async listRecords(categories = []) { return (await this.client.query('SELECT * FROM records WHERE account_id=$1 AND space_id=$2 AND (cardinality($3::text[])=0 OR category=ANY($3::text[])) ORDER BY entity_type,entity_id', [this.scope.accountId,this.scope.spaceId,categories])).rows.map(mapRecord); }
  async addConflict(row) { const result = await this.client.query(`INSERT INTO conflicts(account_id,space_id,entity_type,entity_id,category,base_revision,current_revision,current_payload,incoming_payload,current_origin_client_id,incoming_origin_client_id,changed_fields,reason,status,sequence,created_at,retain_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [this.scope.accountId,this.scope.spaceId,row.entityType,row.entityId,row.category,row.baseRevision,row.currentRevision,row.currentPayload,row.incomingPayload,row.currentOriginClientId,row.incomingOriginClientId,row.changedFields,row.reason,row.status,row.sequence,row.createdAt,row.retainUntil]); return mapConflict(result.rows[0]); }
  async getConflict(id) { return mapConflict((await this.client.query('SELECT * FROM conflicts WHERE account_id=$1 AND space_id=$2 AND conflict_id=$3 FOR UPDATE', [this.scope.accountId,this.scope.spaceId,id])).rows[0]); }
  async listConflicts(status, after = '', limit = 100) {
    const rows = (await this.client.query(`SELECT * FROM conflicts WHERE account_id=$1 AND space_id=$2 AND status=$3
      AND ($4::text='' OR conflict_id::text>$4) ORDER BY conflict_id LIMIT $5`, [this.scope.accountId,this.scope.spaceId,status,after,limit])).rows;
    return rows.map(mapConflict);
  }
  async updateConflict(id, patch) { const row = (await this.client.query('UPDATE conflicts SET status=COALESCE($4,status),resolution_revision=COALESCE($5,resolution_revision),resolved_at=COALESCE($6,resolved_at) WHERE account_id=$1 AND space_id=$2 AND conflict_id=$3 RETURNING *', [this.scope.accountId,this.scope.spaceId,id,patch.status??null,patch.resolutionRevision??null,patch.resolvedAt??null])).rows[0]; return mapConflict(row); }
  async countConflicts() { return Number((await this.client.query("SELECT count(*) FROM conflicts WHERE account_id=$1 AND space_id=$2 AND status='unresolved'", [this.scope.accountId,this.scope.spaceId])).rows[0].count); }
  async setCategory(category, patch) { const row = (await this.client.query(`INSERT INTO category_state(account_id,space_id,category,present,clear_generation,last_sequence,updated_at) VALUES($1,$2,$3,$4,COALESCE($5,0),$6,$7)
    ON CONFLICT(account_id,space_id,category) DO UPDATE SET present=excluded.present,clear_generation=COALESCE($5,category_state.clear_generation),last_sequence=excluded.last_sequence,updated_at=excluded.updated_at RETURNING *`, [this.scope.accountId,this.scope.spaceId,category,patch.present??false,patch.clearGeneration??null,patch.lastSequence??0,patch.updatedAt??new Date().toISOString()])).rows[0]; return mapCategory(row); }
  async categories() { return (await this.client.query('SELECT * FROM category_state WHERE account_id=$1 AND space_id=$2 ORDER BY category', [this.scope.accountId,this.scope.spaceId])).rows.map(mapCategory); }
  async setFloor(sequence) { await this.client.query('UPDATE space_stream_floors SET minimum_sequence=$3,updated_at=now() WHERE account_id=$1 AND space_id=$2', [this.scope.accountId,this.scope.spaceId,sequence]); return this.space(); }
}
