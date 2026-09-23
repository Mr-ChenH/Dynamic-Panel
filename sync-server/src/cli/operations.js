export class OperationsService {
  constructor({ identity, repository, backup, restore, migrate, clock = () => new Date() }) {
    this.identity = identity; this.repository = repository; this.backup = backup; this.restore = restore; this.migrate = migrate; this.clock = clock;
  }

  async account(action, input) {
    if (action === 'create') return this.identity.createAccount({ username: input.username, password: input.password, mustChangePassword: true });
    if (action === 'list') return this.identity.listAccounts();
    if (action === 'reset-password') return this.identity.resetPassword(input.accountId, input.password, 'cli');
    if (['enable', 'disable', 'delete'].includes(action)) return this.identity[`${action}Account`](input.accountId, 'cli');
    throw commandError('UNKNOWN_COMMAND');
  }

  async limits(action, input) {
    if (action === 'get') return this.repository.getLimits(input.accountId);
    if (action === 'set') return this.repository.setLimits(input.accountId, { activeSpaces: input.activeSpaces, activeClientsPerSpace: input.activeClientsPerSpace });
    throw commandError('UNKNOWN_COMMAND');
  }
  async usage(input) { return this.repository.usage(input.accountId, input.spaceId); }
  async audit(input) { return this.repository.audit(input.accountId, input); }
  async migration(action, input) {
    if (action === 'status') return this.repository.migrationStatus();
    if (action === 'run') return this.migrate(input);
    throw commandError('UNKNOWN_COMMAND');
  }
  async doctor() {
    const components = await this.repository.health();
    const backup = await this.backup.health();
    return { status: components.every((item) => item.status === 'ok') && backup.status === 'ok' ? 'ok' : 'degraded', components, backup, checkedAt: this.clock().toISOString() };
  }
}

export function commandError(code, message = 'Unsupported command') { return Object.assign(new Error(message), { code }); }
