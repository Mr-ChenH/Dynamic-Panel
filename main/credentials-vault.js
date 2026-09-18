function createCredentialsVault({
  fs,
  safeStorage,
  normalizeCredentialInput,
  vaultPath,
  randomId,
  now = Date.now,
  processId,
}) {
  function isAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  function readRows() {
    if (!isAvailable()) return [];
    try {
      const envelope = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
      const decoded = safeStorage.decryptString(Buffer.from(String(envelope.payload || ''), 'base64'));
      const rows = JSON.parse(decoded);
      return Array.isArray(rows)
        ? rows.map((item) => normalizeCredentialInput(item, item && item.id, item && item.createdAt)).filter(Boolean)
        : [];
    } catch (error) {
      return [];
    }
  }

  function writeRows(rows) {
    const temporaryPath = `${vaultPath}.${processId}.tmp`;
    try {
      if (!isAvailable()) return false;
      const payload = safeStorage.encryptString(JSON.stringify(rows)).toString('base64');
      fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, payload }), { mode: 0o600 });
      fs.renameSync(temporaryPath, vaultPath);
      return true;
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
      return false;
    }
  }

  function publicCredential(item) {
    return {
      id: item.id,
      service: item.service,
      account: item.account,
      passwordMask: '**********',
      createdAt: item.createdAt,
    };
  }

  function list() {
    return {
      ok: isAvailable(),
      secureStorage: isAvailable(),
      items: readRows().map(publicCredential),
    };
  }

  function get(id) {
    const item = readRows().find((row) => row.id === String(id || ''));
    return item ? { ok: true, item: { ...item } } : { ok: false, error: 'not_found' };
  }

  function save(input) {
    if (!isAvailable()) return { ok: false, error: 'secure_storage_unavailable' };
    const rows = readRows();
    const existing = input && input.id ? rows.find((item) => item.id === input.id) : null;
    const normalized = normalizeCredentialInput(
      existing && !String(input && input.password || '') ? { ...input, password: existing.password } : input,
      existing ? existing.id : randomId(),
      existing ? existing.createdAt : now()
    );
    if (!normalized) return { ok: false, error: 'invalid_credential' };
    const next = existing
      ? rows.map((item) => item.id === existing.id ? normalized : item)
      : [normalized, ...rows];
    return writeRows(next)
      ? { ok: true, item: publicCredential(normalized) }
      : { ok: false, error: 'save_failed' };
  }

  function deleteMany(ids) {
    const targets = new Set(Array.isArray(ids) ? ids.map(String) : []);
    if (!targets.size) return { ok: true, deleted: 0 };
    const rows = readRows();
    const next = rows.filter((item) => !targets.has(item.id));
    if (!writeRows(next)) return { ok: false, error: 'save_failed' };
    return { ok: true, deleted: rows.length - next.length };
  }

  function value(id, field) {
    if (!['account', 'password'].includes(field)) return null;
    const item = readRows().find((row) => row.id === String(id || ''));
    return item ? item[field] : null;
  }

  return { isAvailable, list, get, save, deleteMany, value };
}

module.exports = { createCredentialsVault };
