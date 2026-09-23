import { withAdminTx, withSpaceTx } from '../db/postgres.js';
import { clientScopeKey, sameScope, scopeKey } from './constants.js';

export class MemoryObjectRepository {
  constructor() {
    this.uploads = new Map();
    this.objects = new Map();
    this.references = new Map();
  }

  async createUpload(row) { this.uploads.set(row.uploadId, row); return row; }
  async getUpload(scope, uploadId) {
    const row = this.uploads.get(uploadId);
    return sameScope(row, scope, true) ? row : undefined;
  }
  async updateUpload(row) { this.uploads.set(row.uploadId, row); return row; }
  async activeUploads(scope, now) {
    return [...this.uploads.values()].filter((row) => clientScopeKey(row) === clientScopeKey(scope) && ['open', 'completing'].includes(row.status) && row.expiresAt > now).length;
  }
  async expiredUploads(now) {
    return [...this.uploads.values()].filter((row) => ['open', 'completing'].includes(row.status) && row.expiresAt <= now);
  }

  async createObject(row) { this.objects.set(row.objectId, row); return row; }
  async commitObject(upload, row) {
    this.objects.set(row.objectId, row);
    upload.status = 'complete';
    upload.objectId = row.objectId;
    this.uploads.set(upload.uploadId, upload);
    return row;
  }
  async getObject(scope, objectId) {
    const row = this.objects.get(objectId);
    return sameScope(row, scope) ? row : undefined;
  }
  async deleteObject(row) { this.objects.delete(row.objectId); }
  async objectsForScope(scope) { return [...this.objects.values()].filter((row) => sameScope(row, scope)); }
  async allObjects() { return [...this.objects.values()]; }
  async incompleteUploadsForScope(scope, now) {
    return [...this.uploads.values()].filter((row) => sameScope(row, scope) && ['open', 'completing'].includes(row.status) && row.expiresAt > now);
  }

  async replaceReferences(scope, referenceId, rows) {
    const key = `${scopeKey(scope)}\u0000${referenceId}`;
    const previous = this.references.get(key) ?? [];
    this.references.set(key, rows);
    return previous;
  }
  async deleteReferences(scope, referenceId) { this.references.delete(`${scopeKey(scope)}\u0000${referenceId}`); }
  async referencesForObject(scope, objectId) {
    const prefix = `${scopeKey(scope)}\u0000`;
    return [...this.references.entries()].filter(([key]) => key.startsWith(prefix)).flatMap(([, rows]) => rows).filter((row) => row.objectId === objectId);
  }
  async allReferences(scope) {
    const prefix = `${scopeKey(scope)}\u0000`;
    return [...this.references.entries()].filter(([key]) => key.startsWith(prefix)).flatMap(([, rows]) => rows);
  }
}

function asDate(value) { return value instanceof Date ? value : value ? new Date(value) : null; }
function mapPart(row) { return { partNumber: row.part_number, storageKey: row.storage_key, digest: row.digest.trim(), bytes: Number(row.bytes) }; }
function mapUpload(row, parts = []) {
  if (!row) return undefined;
  return {
    uploadId: row.upload_id, accountId: row.account_id, spaceId: row.space_id, clientId: row.client_id,
    digest: row.expected_digest.trim(), bytes: Number(row.expected_bytes), mimeType: row.mime_type, purpose: row.purpose,
    status: row.status, createdAt: asDate(row.created_at), expiresAt: asDate(row.expires_at),
    parts: new Map(parts.map((part) => [part.partNumber, part])), objectId: row.object_id
  };
}
function mapObject(row) {
  if (!row) return undefined;
  return {
    objectId: row.object_id, accountId: row.account_id, spaceId: row.space_id,
    digest: row.digest.trim(), bytes: Number(row.bytes), mimeType: row.mime_type, purpose: row.purpose,
    storageKey: row.storage_key, committedAt: asDate(row.committed_at), unreferencedAt: asDate(row.unreferenced_at), retainUntil: asDate(row.retain_until)
  };
}
function mapReference(row) { return { referenceId: row.reference_id, objectId: row.object_id, retainUntil: asDate(row.retain_until) }; }

export class PostgresObjectRepository {
  constructor(pool) {
    if (!pool) throw new TypeError('PostgreSQL pool is required');
    this.pool = pool;
  }

  async createUpload(row) {
    return withSpaceTx(this.pool, row, async (client) => mapUpload((await client.query(`INSERT INTO object_upload_sessions(upload_id,account_id,space_id,client_id,expected_digest,expected_bytes,mime_type,purpose,status,object_id,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [row.uploadId,row.accountId,row.spaceId,row.clientId,row.digest,row.bytes,row.mimeType,row.purpose,row.status,row.objectId,row.expiresAt,row.createdAt])).rows[0]));
  }

  async getUpload(scope, uploadId) {
    return withSpaceTx(this.pool, scope, async (client) => {
      const row = (await client.query('SELECT * FROM object_upload_sessions WHERE account_id=$1 AND space_id=$2 AND upload_id=$3', [scope.accountId,scope.spaceId,uploadId])).rows[0];
      if (!row || row.client_id !== scope.clientId) return undefined;
      const parts = (await client.query('SELECT * FROM object_upload_parts WHERE upload_id=$1 ORDER BY part_number', [uploadId])).rows.map(mapPart);
      return mapUpload(row, parts);
    });
  }

  async updateUpload(row) {
    return withSpaceTx(this.pool, row, async (client) => {
      const updated = (await client.query(`UPDATE object_upload_sessions SET status=$5,object_id=$6,expires_at=$7,updated_at=now()
        WHERE account_id=$1 AND space_id=$2 AND client_id=$3 AND upload_id=$4 RETURNING *`, [row.accountId,row.spaceId,row.clientId,row.uploadId,row.status,row.objectId,row.expiresAt])).rows[0];
      if (!updated) return undefined;
      for (const part of row.parts.values()) await client.query(`INSERT INTO object_upload_parts(upload_id,part_number,storage_key,digest,bytes) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(upload_id,part_number) DO UPDATE SET storage_key=excluded.storage_key,digest=excluded.digest,bytes=excluded.bytes`, [row.uploadId,part.partNumber,part.storageKey,part.digest,part.bytes]);
      return mapUpload(updated, [...row.parts.values()]);
    });
  }

  async activeUploads(scope, now) {
    return withSpaceTx(this.pool, scope, async (client) => Number((await client.query("SELECT count(*) FROM object_upload_sessions WHERE account_id=$1 AND space_id=$2 AND client_id=$3 AND status IN ('open','completing') AND expires_at>$4", [scope.accountId,scope.spaceId,scope.clientId,now])).rows[0].count));
  }

  async expiredUploads(now) {
    const rows = await withAdminTx(this.pool, { actorType: 'admin', actorId: 'object-maintenance' }, async (client) => (await client.query("SELECT * FROM object_upload_sessions WHERE status IN ('open','completing') AND expires_at<=$1", [now])).rows);
    const output = [];
    for (const row of rows) {
      const upload = await this.getUpload({ accountId: row.account_id, spaceId: row.space_id, clientId: row.client_id }, row.upload_id);
      if (upload) output.push(upload);
    }
    return output;
  }

  async createObject(row) {
    return withSpaceTx(this.pool, row, async (client) => this.#insertObject(client, row));
  }

  async commitObject(upload, row) {
    return withSpaceTx(this.pool, upload, async (client) => {
      const object = await this.#insertObject(client, row);
      const updated = await client.query("UPDATE object_upload_sessions SET status='complete',object_id=$5,updated_at=now() WHERE account_id=$1 AND space_id=$2 AND client_id=$3 AND upload_id=$4 AND status='completing'", [upload.accountId,upload.spaceId,upload.clientId,upload.uploadId,row.objectId]);
      if (!updated.rowCount) throw new Error('upload_commit_race');
      return object;
    });
  }

  async #insertObject(client, row) {
    const physical = (await client.query('INSERT INTO physical_objects(storage_key,digest,bytes,mime_type,verified_at,created_at) VALUES($1,$2,$3,$4,$5,$5) RETURNING physical_object_id', [row.storageKey,row.digest,row.bytes,row.mimeType,row.committedAt])).rows[0];
    return mapObject((await client.query(`INSERT INTO space_objects(account_id,space_id,object_id,physical_object_id,digest,bytes,mime_type,purpose,committed_at,unreferenced_at,retain_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING space_objects.*,$12::text AS storage_key`, [row.accountId,row.spaceId,row.objectId,physical.physical_object_id,row.digest,row.bytes,row.mimeType,row.purpose,row.committedAt,row.unreferencedAt,row.retainUntil,row.storageKey])).rows[0]);
  }

  async getObject(scope, objectId) {
    return withSpaceTx(this.pool, scope, async (client) => mapObject((await client.query(`SELECT o.*,p.storage_key FROM space_objects o JOIN physical_objects p USING(physical_object_id)
      WHERE o.account_id=$1 AND o.space_id=$2 AND o.object_id=$3`, [scope.accountId,scope.spaceId,objectId])).rows[0]));
  }

  async deleteObject(row) {
    return withSpaceTx(this.pool, row, async (client) => {
      const removed = (await client.query('DELETE FROM space_objects WHERE account_id=$1 AND space_id=$2 AND object_id=$3 RETURNING physical_object_id', [row.accountId,row.spaceId,row.objectId])).rows[0];
      if (removed) await client.query('DELETE FROM physical_objects WHERE physical_object_id=$1 AND NOT EXISTS (SELECT 1 FROM space_objects WHERE physical_object_id=$1)', [removed.physical_object_id]);
    });
  }

  async objectsForScope(scope) {
    return withSpaceTx(this.pool, scope, async (client) => (await client.query(`SELECT o.*,p.storage_key FROM space_objects o JOIN physical_objects p USING(physical_object_id)
      WHERE o.account_id=$1 AND o.space_id=$2 ORDER BY o.object_id`, [scope.accountId,scope.spaceId])).rows.map(mapObject));
  }

  async allObjects() {
    return withAdminTx(this.pool, { actorType: 'admin', actorId: 'object-maintenance' }, async (client) => (await client.query('SELECT o.*,p.storage_key FROM space_objects o JOIN physical_objects p USING(physical_object_id) ORDER BY o.account_id,o.space_id,o.object_id')).rows.map(mapObject));
  }

  async incompleteUploadsForScope(scope, now) {
    return withSpaceTx(this.pool, scope, async (client) => {
      const rows = (await client.query("SELECT * FROM object_upload_sessions WHERE account_id=$1 AND space_id=$2 AND status IN ('open','completing') AND expires_at>$3", [scope.accountId,scope.spaceId,now])).rows;
      const output = [];
      for (const row of rows) {
        const parts = (await client.query('SELECT * FROM object_upload_parts WHERE upload_id=$1 ORDER BY part_number', [row.upload_id])).rows.map(mapPart);
        output.push(mapUpload(row, parts));
      }
      return output;
    });
  }

  async replaceReferences(scope, referenceId, rows) {
    return withSpaceTx(this.pool, scope, async (client) => {
      const previous = (await client.query('SELECT * FROM object_refs WHERE account_id=$1 AND space_id=$2 AND reference_id=$3', [scope.accountId,scope.spaceId,referenceId])).rows.map(mapReference);
      await client.query('DELETE FROM object_refs WHERE account_id=$1 AND space_id=$2 AND reference_id=$3', [scope.accountId,scope.spaceId,referenceId]);
      for (const row of rows) await client.query('INSERT INTO object_refs(account_id,space_id,reference_id,object_id,retain_until) VALUES($1,$2,$3,$4,$5)', [scope.accountId,scope.spaceId,referenceId,row.objectId,row.retainUntil]);
      if (rows.length) {
        const latestRetainUntil = rows.reduce((latest, row) => !latest || row.retainUntil > latest ? row.retainUntil : latest, null);
        await client.query(`UPDATE space_objects SET unreferenced_at=NULL,retain_until=CASE WHEN $3::timestamptz IS NULL THEN retain_until WHEN retain_until IS NULL OR retain_until<$3 THEN $3 ELSE retain_until END
          WHERE account_id=$1 AND space_id=$2 AND object_id=ANY($4::text[])`, [scope.accountId,scope.spaceId,latestRetainUntil,rows.map((row)=>row.objectId)]);
      }
      const removed = previous.filter((row) => !rows.some((current) => current.objectId === row.objectId)).map((row) => row.objectId);
      if (removed.length) await client.query(`UPDATE space_objects o SET unreferenced_at=COALESCE(unreferenced_at,now()) WHERE account_id=$1 AND space_id=$2 AND object_id=ANY($3::text[])
        AND NOT EXISTS (SELECT 1 FROM object_refs r WHERE r.account_id=o.account_id AND r.space_id=o.space_id AND r.object_id=o.object_id)`, [scope.accountId,scope.spaceId,removed]);
      return previous;
    });
  }

  async deleteReferences(scope, referenceId) {
    return withSpaceTx(this.pool, scope, async (client) => {
      const removed = (await client.query('DELETE FROM object_refs WHERE account_id=$1 AND space_id=$2 AND reference_id=$3 RETURNING object_id', [scope.accountId,scope.spaceId,referenceId])).rows.map((row) => row.object_id);
      if (removed.length) await client.query(`UPDATE space_objects o SET unreferenced_at=COALESCE(unreferenced_at,now()) WHERE account_id=$1 AND space_id=$2 AND object_id=ANY($3::text[])
        AND NOT EXISTS (SELECT 1 FROM object_refs r WHERE r.account_id=o.account_id AND r.space_id=o.space_id AND r.object_id=o.object_id)`, [scope.accountId,scope.spaceId,removed]);
    });
  }

  async referencesForObject(scope, objectId) {
    return withSpaceTx(this.pool, scope, async (client) => (await client.query('SELECT * FROM object_refs WHERE account_id=$1 AND space_id=$2 AND object_id=$3', [scope.accountId,scope.spaceId,objectId])).rows.map(mapReference));
  }

  async allReferences(scope) {
    return withSpaceTx(this.pool, scope, async (client) => (await client.query('SELECT * FROM object_refs WHERE account_id=$1 AND space_id=$2', [scope.accountId,scope.spaceId])).rows.map(mapReference));
  }
}
