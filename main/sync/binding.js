const crypto = require('node:crypto');

function cleanId(value, name) {
  const text = String(value || '').trim();
  if (!text || text.length > 160 || /[\0\r\n]/.test(text)) throw new TypeError(`invalid_${name}`);
  return text;
}

function bindingNamespace(binding) {
  const parts = ['instanceId', 'spaceId', 'clientId', 'workspaceId'].map((key) => cleanId(binding?.[key], key));
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function createInstallationModel({ randomUUID = crypto.randomUUID, initialInstallationId, initialBinding = null } = {}) {
  let installationId = initialInstallationId || randomUUID();
  let binding = initialBinding ? Object.freeze({ ...initialBinding }) : null;
  let generation = 1;
  function token() { return Object.freeze({ namespace: binding ? bindingNamespace(binding) : null, generation }); }
  return Object.freeze({
    installationId: () => installationId,
    current: () => binding && Object.freeze({ ...binding, namespace: bindingNamespace(binding), generation }),
    token,
    isCurrent(candidate) { const current = token(); return Boolean(candidate) && candidate.generation === current.generation && candidate.namespace === current.namespace; },
    bind(next) { bindingNamespace(next); generation += 1; binding = Object.freeze({ ...next }); return this.current(); },
    remove() { generation += 1; binding = null; return token(); },
    resetInstallation() { generation += 1; installationId = randomUUID(); binding = null; return installationId; },
  });
}

function assertSessionMatches(binding, session) {
  const expected = { instanceId: binding?.instanceId, spaceId: binding?.spaceId, clientId: binding?.clientId };
  const actual = { instanceId: session?.instance?.instanceId, spaceId: session?.identity?.spaceId, clientId: session?.identity?.clientId };
  for (const key of Object.keys(expected)) if (expected[key] && expected[key] !== actual[key]) throw new TypeError(`${key}_changed`);
  if (binding?.restoreEpoch != null && session?.state?.restoreEpoch !== binding.restoreEpoch) throw new TypeError('restore_epoch_changed');
  return true;
}

module.exports = { bindingNamespace, createInstallationModel, assertSessionMatches };
