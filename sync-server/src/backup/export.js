const EXCLUDED_EXPORT_FIELDS = new Set([
  'password', 'passwordHash', 'password_hash', 'tokenFingerprint', 'token_fingerprint', 'csrfFingerprint', 'csrf_fingerprint',
  'verifier', 'lookupFingerprint', 'lookup_fingerprint', 'clientKey', 'client_key', 'backupSettings', 'backup_settings',
  'backupCredentials', 'backup_credentials', 'auditEvents', 'audit_events', 'sessions', 'keyGenerations', 'client_key_generations'
]);

function filtered(value) {
  if (Array.isArray(value)) return value.map(filtered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !EXCLUDED_EXPORT_FIELDS.has(key)).map(([key, child]) => [key, filtered(child)]));
}

export class ExportSource {
  constructor(source) { this.source = source; }
  async snapshot(options) {
    if (options.scope?.type !== 'space' || !options.scope.accountId || !options.scope.spaceId) throw new TypeError('Exports require an account and space scope');
    const snapshot = await this.source.snapshot(options);
    return { ...snapshot, data: filtered(snapshot.data ?? snapshot), release: snapshot.release };
  }
  async validateSnapshot(data, manifest) { return this.source.validateSnapshot?.(data, manifest); }
}

export { filtered as filterExportData };
