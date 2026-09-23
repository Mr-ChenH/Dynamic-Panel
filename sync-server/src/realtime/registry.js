export const POLLING_FALLBACK_MS = 30_000;

export class InvalidationRegistry {
  constructor() { this.bySpace = new Map(); this.bySpaceId = new Map(); this.byClient = new Map(); this.byGeneration = new Map(); }

  register(context, sink) {
    if (!context?.accountId || !context?.spaceId || !context?.clientId || typeof sink?.send !== 'function') throw new TypeError('invalid realtime registration');
    const connection = { context: { accountId: context.accountId, spaceId: context.spaceId, clientId: context.clientId, keyGenerationId: context.keyGenerationId }, sink };
    add(this.bySpace, `${context.accountId}:${context.spaceId}`, connection); add(this.bySpaceId, context.spaceId, connection); add(this.byClient, context.clientId, connection);
    if (context.keyGenerationId) add(this.byGeneration, context.keyGenerationId, connection);
    return () => this.remove(connection);
  }

  publish({ accountId, spaceId, sequence, restoreEpoch, cursor }) {
    const message = Object.freeze({ type: 'cursor-available', ...(cursor ? { cursor } : { sequence }), restoreEpoch });
    assertInvalidationPayload(message);
    for (const connection of this.bySpace.get(`${accountId}:${spaceId}`) ?? []) connection.sink.send(message);
    return message;
  }

  closeClient(clientId, reason = 'client_revoked') { return this.closeSet(this.byClient.get(clientId), reason); }
  closeGeneration(generationId, reason = 'client_revoked') { return this.closeSet(this.byGeneration.get(generationId), reason); }
  closeSpace(spaceId, reason = 'space_inactive') { return this.closeSet(this.bySpaceId.get(spaceId), reason); }
  closeAccount(accountId, reason = 'account_disabled') {
    let count = 0; for (const [key, connections] of this.bySpace) if (key.startsWith(`${accountId}:`)) count += this.closeSet(connections, reason); return count;
  }
  closeSet(connections, reason) { const message = { type: 'connection-revoked', reason }; assertInvalidationPayload(message); let count = 0; for (const connection of [...(connections ?? [])]) { connection.sink.send(message); connection.sink.close?.(); this.remove(connection); count += 1; } return count; }
  remove(connection) { remove(this.bySpace, `${connection.context.accountId}:${connection.context.spaceId}`, connection); remove(this.bySpaceId, connection.context.spaceId, connection); remove(this.byClient, connection.context.clientId, connection); if (connection.context.keyGenerationId) remove(this.byGeneration, connection.context.keyGenerationId, connection); }
}

export class PostgresInvalidationListener {
  constructor({ client, registry, channel = 'sync_invalidation' }) { this.client = client; this.registry = registry; this.channel = channel; this.onNotification = this.onNotification.bind(this); }
  async start() { if (!/^[a-z_]+$/.test(this.channel)) throw new TypeError('invalid channel'); await this.client.query(`LISTEN ${this.channel}`); this.client.on('notification', this.onNotification); }
  async stop() { this.client.off('notification', this.onNotification); await this.client.query(`UNLISTEN ${this.channel}`); }
  onNotification(event) { if (event.channel !== this.channel) return; let value; try { value = JSON.parse(event.payload); } catch { return; } try { assertDatabaseInvalidation(value); this.registry.publish(value); } catch {} }
}

export function assertInvalidationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('business data forbidden in invalidation');
  const keys = Object.keys(payload).sort();
  if (payload.type === 'cursor-available') {
    const allowed = ['cursor', 'restoreEpoch', 'sequence', 'type'];
    if (keys.some((key) => !allowed.includes(key)) || (!Number.isSafeInteger(payload.sequence) && typeof payload.cursor !== 'string') || !Number.isSafeInteger(payload.restoreEpoch)) throw new TypeError('business data forbidden in invalidation');
    return payload;
  }
  if (payload.type === 'connection-revoked' && keys.join(',') === 'reason,type' && ['client_revoked', 'space_inactive', 'account_disabled'].includes(payload.reason)) return payload;
  throw new TypeError('business data forbidden in invalidation');
}
function assertDatabaseInvalidation(value) { const keys = Object.keys(value).sort(); if (keys.join(',') !== 'accountId,restoreEpoch,sequence,spaceId' || !Number.isSafeInteger(value.sequence) || !Number.isSafeInteger(value.restoreEpoch) || typeof value.accountId !== 'string' || typeof value.spaceId !== 'string') throw new TypeError('invalid database invalidation'); }
function add(index, key, value) { if (!index.has(key)) index.set(key, new Set()); index.get(key).add(value); }
function remove(index, key, value) { const set = index.get(key); if (!set) return; set.delete(value); if (!set.size) index.delete(key); }
