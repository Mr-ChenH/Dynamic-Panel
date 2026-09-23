const FORBIDDEN_PLAINTEXT_KEYS = /^(password|clientKey|backup(Credential|Secret|AccessKey|SessionToken))$/i;

export function assertNoPlaintextSecrets(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PLAINTEXT_KEYS.test(key)) {
      throw Object.assign(new Error(`Plaintext secret field is forbidden at ${path}.${key}`), { code: 'BACKUP_SECRET_REJECTED' });
    }
    assertNoPlaintextSecrets(child, `${path}.${key}`);
  }
}

export function redact(value) {
  if (value instanceof Error) return { code: value.code ?? 'INTERNAL_ERROR', message: safeMessage(value.message) };
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /password|client.?key|credential|secret|token/i.test(key) ? '[REDACTED]' : redact(child)]));
}

function safeMessage(message) {
  return String(message ?? 'Operation failed').replace(/(password|client.?key|credential|secret|token)\s*[=:]\s*\S+/gi, '$1=[REDACTED]').slice(0, 512);
}
