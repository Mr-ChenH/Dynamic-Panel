import { errors } from '../errors.js';
import { uuid } from './crypto.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class MemoryIdentityStore {
  constructor({ instanceId = uuid() } = {}) {
    this.instanceId = instanceId;
    this.accounts = new Map();
    this.accountsByUsername = new Map();
    this.sessions = new Map();
    this.sessionsByFingerprint = new Map();
    this.spaces = new Map();
    this.clients = new Map();
    this.keyGenerations = new Map();
    this.keysByFingerprint = new Map();
    this.auditEvents = [];
  }

  async getInstance() {
    return { instanceId: this.instanceId, protocolMin: 1, protocolMax: 1, recordSchemaMin: 1, recordSchemaMax: 1 };
  }

  async createAccount(account) {
    if (this.accountsByUsername.has(account.normalizedUsername)) throw errors.nameConflict();
    const row = { accountId: uuid(), status: 'active', mustChangePassword: false, authEpoch: 1, createdAt: new Date().toISOString(), ...account };
    this.accounts.set(row.accountId, row);
    this.accountsByUsername.set(row.normalizedUsername, row.accountId);
    return clone(row);
  }

  async findAccountByUsername(normalizedUsername) {
    const id = this.accountsByUsername.get(normalizedUsername);
    return clone(id ? this.accounts.get(id) : undefined);
  }

  async getAccount(accountId) { return clone(this.accounts.get(accountId)); }
  async listAccounts() { return clone([...this.accounts.values()]); }

  async updateAccount(accountId, patch) {
    const row = this.accounts.get(accountId);
    if (!row) throw errors.notFound();
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    return clone(row);
  }

  async createSession(session) {
    const row = { sessionId: uuid(), revokedAt: null, recentAuthAt: null, ...session };
    this.sessions.set(row.sessionId, row);
    this.sessionsByFingerprint.set(row.tokenFingerprint, row.sessionId);
    return clone(row);
  }

  async findSessionByFingerprint(fingerprint) {
    const id = this.sessionsByFingerprint.get(fingerprint);
    return clone(id ? this.sessions.get(id) : undefined);
  }

  async updateSession(sessionId, patch) {
    const row = this.sessions.get(sessionId);
    if (!row) return undefined;
    Object.assign(row, patch);
    return clone(row);
  }

  async listSessions(accountId) {
    return clone([...this.sessions.values()].filter((row) => row.accountId === accountId));
  }

  async revokeOtherSessions(accountId, currentSessionId, revokedAt) {
    for (const row of this.sessions.values()) {
      if (row.accountId === accountId && row.sessionId !== currentSessionId && !row.revokedAt) row.revokedAt = revokedAt;
    }
  }

  async revokeAccountSessions(accountId, exceptSessionId, revokedAt) {
    for (const row of this.sessions.values()) {
      if (row.accountId === accountId && row.sessionId !== exceptSessionId && !row.revokedAt) row.revokedAt = revokedAt;
    }
  }

  async listSpaces(accountId) {
    return clone([...this.spaces.values()].filter((row) => row.accountId === accountId && row.status !== 'purged'));
  }

  async getSpace(accountId, spaceId) {
    const row = this.spaces.get(spaceId);
    return clone(row?.accountId === accountId && row.status !== 'purged' ? row : undefined);
  }

  async createSpace(accountId, data, limit) {
    const owned = [...this.spaces.values()].filter((row) => row.accountId === accountId && row.status !== 'purged');
    if (owned.some((row) => row.normalizedName === data.normalizedName)) throw errors.nameConflict();
    const activeCount = owned.filter((row) => row.status === 'active').length;
    if (activeCount >= limit) throw errors.spaceLimit(activeCount, limit);
    const now = new Date().toISOString();
    const row = { accountId, spaceId: uuid(), status: 'active', restoreEpoch: 1, createdAt: now, updatedAt: now, deletedAt: null, recoverableUntil: null, ...data };
    this.spaces.set(row.spaceId, row);
    return clone(row);
  }

  async updateSpace(accountId, spaceId, patch, limit) {
    const row = this.spaces.get(spaceId);
    if (!row || row.accountId !== accountId || row.status === 'purged') throw errors.notFound();
    if (patch.normalizedName && [...this.spaces.values()].some((item) => item.accountId === accountId && item.spaceId !== spaceId && item.status !== 'purged' && item.normalizedName === patch.normalizedName)) throw errors.nameConflict();
    if (patch.status === 'active' && row.status !== 'active') {
      const activeCount = [...this.spaces.values()].filter((item) => item.accountId === accountId && item.status === 'active').length;
      if (activeCount >= limit) throw errors.spaceLimit(activeCount, limit);
    }
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    return clone(row);
  }

  async listClients(accountId, spaceId) {
    return clone([...this.clients.values()].filter((row) => row.accountId === accountId && row.spaceId === spaceId));
  }

  async getClient(accountId, spaceId, clientId) {
    const row = this.clients.get(clientId);
    return clone(row?.accountId === accountId && row.spaceId === spaceId ? row : undefined);
  }

  async createClient(accountId, spaceId, data, keyGeneration, limit) {
    const space = this.spaces.get(spaceId);
    if (!space || space.accountId !== accountId) throw errors.notFound();
    const activeCount = [...this.clients.values()].filter((row) => row.accountId === accountId && row.spaceId === spaceId && row.status === 'active').length;
    if (activeCount >= limit) throw errors.clientLimit(activeCount, limit);
    const now = new Date().toISOString();
    const row = { accountId, spaceId, clientId: uuid(), status: 'active', installationId: null, firstConnectedAt: null, platform: null, appVersion: null, lastSeenAt: null, revokedAt: null, createdAt: now, ...data };
    this.clients.set(row.clientId, row);
    await this.addKeyGeneration({ ...keyGeneration, accountId, spaceId, clientId: row.clientId });
    return clone(row);
  }

  async updateClient(accountId, spaceId, clientId, patch) {
    const row = this.clients.get(clientId);
    if (!row || row.accountId !== accountId || row.spaceId !== spaceId) throw errors.notFound();
    Object.assign(row, patch);
    return clone(row);
  }

  async addKeyGeneration(generation) {
    if (this.keysByFingerprint.has(generation.lookupFingerprint)) throw new Error('duplicate key fingerprint');
    const row = { generationId: uuid(), revokedAt: null, expiresAt: null, createdAt: new Date().toISOString(), ...generation };
    this.keyGenerations.set(row.generationId, row);
    this.keysByFingerprint.set(row.lookupFingerprint, row.generationId);
    return clone(row);
  }

  async findKeyByFingerprint(fingerprint) {
    const id = this.keysByFingerprint.get(fingerprint);
    return clone(id ? this.keyGenerations.get(id) : undefined);
  }

  async listKeyGenerations(accountId, spaceId, clientId) {
    return clone([...this.keyGenerations.values()].filter((row) => row.accountId === accountId && row.spaceId === spaceId && row.clientId === clientId));
  }

  async updateKeyGeneration(generationId, patch) {
    const row = this.keyGenerations.get(generationId);
    if (!row) return undefined;
    Object.assign(row, patch);
    return clone(row);
  }

  async replaceClientKey(accountId, spaceId, clientId, { retirements = [], generation, clientPatch } = {}) {
    const client = this.clients.get(clientId);
    if (!client || client.accountId !== accountId || client.spaceId !== spaceId) throw errors.notFound();
    const clientsBefore = new Map([...this.clients].map(([id, row]) => [id, clone(row)]));
    const generationsBefore = new Map([...this.keyGenerations].map(([id, row]) => [id, clone(row)]));
    const fingerprintsBefore = new Map(this.keysByFingerprint);
    try {
      for (const retirement of retirements) {
        const row = this.keyGenerations.get(retirement.generationId);
        if (!row || row.accountId !== accountId || row.spaceId !== spaceId || row.clientId !== clientId) throw errors.notFound();
        await this.updateKeyGeneration(retirement.generationId, retirement.patch);
      }
      const inserted = await this.addKeyGeneration(generation);
      const updatedClient = clientPatch ? await this.updateClient(accountId, spaceId, clientId, clientPatch) : clone(client);
      return { client: updatedClient, generation: inserted };
    } catch (error) {
      this.clients = clientsBefore;
      this.keyGenerations = generationsBefore;
      this.keysByFingerprint = fingerprintsBefore;
      throw error;
    }
  }

  async bindClient(accountId, spaceId, clientId, installationId, metadata, now) {
    const row = this.clients.get(clientId);
    if (!row || row.accountId !== accountId || row.spaceId !== spaceId || row.status !== 'active') return { status: 'failed' };
    if (row.installationId && row.installationId !== installationId) return { status: 'mismatch' };
    if (!row.installationId) {
      row.installationId = installationId;
      row.firstConnectedAt = now;
    }
    Object.assign(row, metadata, { lastSeenAt: now });
    return { status: 'ok', client: clone(row) };
  }

  async audit(event) {
    const row = { eventId: uuid(), occurredAt: new Date().toISOString(), ...event };
    this.auditEvents.push(row);
    return clone(row);
  }

  async listAudit(accountId, filters = {}) {
    return clone(this.auditEvents.filter((row) => row.accountId === accountId && (!filters.spaceId || row.spaceId === filters.spaceId) && (!filters.action || row.action === filters.action)));
  }
}
