(function exposeSyncScanner(root, factory) {
const exported = factory();
root.NotchSyncScanner = exported;
if (typeof module !== 'undefined') module.exports = exported;
})(typeof window === 'undefined' ? globalThis : window, function createSyncScanner() {
const FORBIDDEN_FIELDS = new Set([
  'authorization', 'clientkey', 'password', 'cookie', 'csrftoken', 'sessiontoken', 'apikey', 'encryptedapikey',
  'encryptedkeyid', 'encryptedsecretkey', 'encryptedcontact', 'ciphertext', 'credential', 'credentials', 'secret',
  'workspacepath', 'workspace', 'path', 'filepath', 'filename', 'audiopath', 'transcript', 'recording', 'recordings',
  'audio', 'video', 'partial', 'shortcut', 'shortcuts', 'autolaunch', 'notchheight', 'diagnostics', 'draft', 'cache',
  'extensioncode', 'permissions', 'storagepath', 'windowid', 'windowtitle', 'currenttab', 'usage',
]);
const SECRET_TEXT = /(?:dpk_v1_[A-Za-z0-9_-]+|\b(?:api[_ -]?key|password|secret)\s*[:=]\s*\S+)/i;
const WINDOWS_ABSOLUTE = /(?:^|[\s("'])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\][^\\\s]+)/;
const POSIX_ABSOLUTE = /(?:^|[\s("'=])\/(?!\/)[^\s)"']+/;
const FILE_URI = /\bfile:\/\//i;

function normalizedField(key) { return String(key).replace(/[-_\s]/g, '').toLowerCase(); }

function scanPortableValue(value, { maxDepth = 24, maxString = 512000 } = {}) {
  const findings = [];
  const seen = new Set();
  function visit(current, path, depth) {
    if (depth > maxDepth) { findings.push({ path, reason: 'depth_limit' }); return; }
    if (typeof current === 'string') {
      if (current.length > maxString) findings.push({ path, reason: 'string_limit' });
      if (SECRET_TEXT.test(current)) findings.push({ path, reason: 'secret_text' });
      if (WINDOWS_ABSOLUTE.test(current) || POSIX_ABSOLUTE.test(current) || FILE_URI.test(current)) findings.push({ path, reason: 'absolute_path' });
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) { findings.push({ path, reason: 'cycle' }); return; }
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_FIELDS.has(normalizedField(key))) findings.push({ path: childPath, reason: 'forbidden_field' });
      visit(child, childPath, depth + 1);
    }
    seen.delete(current);
  }
  visit(value, '$', 0);
  return Object.freeze(findings.map(Object.freeze));
}

function assertPortableValue(value) {
  const findings = scanPortableValue(value);
  if (findings.length) throw Object.assign(new TypeError(`forbidden_sync_value:${findings[0].reason}`), { findings });
  return value;
}

return Object.freeze({ FORBIDDEN_FIELDS, scanPortableValue, assertPortableValue });
});
