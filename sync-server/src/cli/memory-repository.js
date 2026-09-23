function clone(value) { return structuredClone(value); }

export class MemoryOperationsRepository {
  constructor({ identityStore, usage = [], components = [{ name: 'database', status: 'ok' }], migrations = [] } = {}) {
    this.identityStore = identityStore;
    this.usageRows = usage;
    this.components = components;
    this.migrations = migrations;
    this.limits = new Map();
  }
  async getLimits(accountId) { return clone(this.limits.get(accountId) ?? { accountId, activeSpaces: 10, activeClientsPerSpace: 10 }); }
  async setLimits(accountId, limits) {
    if (!Number.isInteger(limits.activeSpaces) || limits.activeSpaces < 1 || limits.activeSpaces > 10 || !Number.isInteger(limits.activeClientsPerSpace) || limits.activeClientsPerSpace < 1 || limits.activeClientsPerSpace > 10) {
      throw Object.assign(new Error('Limits must be integers from 1 through 10'), { code: 'INVALID_ARGUMENT' });
    }
    const row = { accountId, ...limits }; this.limits.set(accountId, row); return clone(row);
  }
  async usage(accountId, spaceId) { return clone(this.usageRows.filter((row) => (!accountId || row.accountId === accountId) && (!spaceId || row.spaceId === spaceId))); }
  async audit(accountId, filters) { return this.identityStore?.listAudit(accountId, filters) ?? []; }
  async migrationStatus() { return { applied: clone(this.migrations) }; }
  async health() { return clone(this.components); }
}
