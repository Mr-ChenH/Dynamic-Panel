function clone(value) { return structuredClone(value); }
function accountId(row) { return row?.accountId ?? row?.account_id; }
function spaceId(row) { return row?.spaceId ?? row?.space_id; }
function inScope(row, scope) {
  if (accountId(row) !== scope.accountId) return false;
  return scope.type === 'account' || spaceId(row) === scope.spaceId;
}

export class MemoryRestoreRepository {
  constructor(online = { accounts: [], spaces: [] }) {
    this.online = clone(online);
    this.stages = new Map();
    this.mutations = 0;
  }

  async inspectStage(data, manifest, objects = []) {
    const accounts = data.accounts ?? [];
    const spaces = data.spaces ?? [];
    const accountIds = new Set(accounts.map((row) => row.accountId));
    const errors = [];
    for (const space of spaces) if (!accountIds.has(space.accountId)) errors.push({ code: 'orphan_space', spaceId: space.spaceId });
    const expected = manifest.objects ?? { count: 0, bytes: 0 };
    const actualBytes = objects.reduce((sum, object) => sum + object.bytes.length, 0);
    if (objects.length !== expected.count || actualBytes !== expected.bytes) errors.push({ code: 'object_inventory_mismatch' });
    return { compatible: manifest.databaseSchema === 1, accounts: accounts.length, spaces: spaces.length, errors, missingObjects: [], corruptObjects: [] };
  }

  async saveStage(stageId, data, report, objects = []) { this.stages.set(stageId, { data: clone(data), report: clone(report), objects: clone(objects) }); }
  async getStage(stageId) { return clone(this.stages.get(stageId)); }

  async activateStage(stageId, scope) {
    const stage = this.stages.get(stageId);
    if (!stage) throw Object.assign(new Error('Stage not found'), { code: 'RESTORE_STAGE_NOT_FOUND' });
    const selected = stage.data.spaces.filter((space) => space.accountId === scope.accountId && (scope.type === 'account' || space.spaceId === scope.spaceId));
    if (!selected.length) throw Object.assign(new Error('Restore scope not present in stage'), { code: 'RESTORE_SCOPE_NOT_FOUND' });
    const selectedIds = new Set(selected.map((space) => space.spaceId));
    const currentEpochs = new Map(this.online.spaces.map((space) => [space.spaceId, space.restoreEpoch ?? 1]));
    this.online.spaces = [
      ...this.online.spaces.filter((space) => !selectedIds.has(space.spaceId)),
      ...selected.map((space) => ({ ...clone(space), restoreEpoch: (currentEpochs.get(space.spaceId) ?? space.restoreEpoch ?? 1) + 1, nextSequence: 0 }))
    ];
    if (scope.type === 'account') {
      const restored = stage.data.accounts.find((account) => account.accountId === scope.accountId);
      if (restored) this.online.accounts = [...this.online.accounts.filter((account) => account.accountId !== scope.accountId), clone(restored)];
    }
    for (const [name, stagedRows] of Object.entries(stage.data)) {
      if (name === 'accounts' || name === 'spaces' || !Array.isArray(stagedRows)) continue;
      const onlineRows = Array.isArray(this.online[name]) ? this.online[name] : [];
      const isScopedCollection = [...onlineRows, ...stagedRows].some((row) => row && typeof row === 'object' && (Object.hasOwn(row, 'accountId') || Object.hasOwn(row, 'account_id')));
      if (!isScopedCollection) continue;
      this.online[name] = [
        ...onlineRows.filter((row) => !inScope(row, scope)),
        ...stagedRows.filter((row) => inScope(row, scope)).map(clone)
      ];
    }
    this.online.objectArtifacts = [
      ...(Array.isArray(this.online.objectArtifacts) ? this.online.objectArtifacts : []).filter((item) => !inScope(item.metadata, scope)),
      ...stage.objects.filter((item) => inScope(item.metadata, scope)).map(clone)
    ];
    this.mutations += 1;
    return { spaces: this.online.spaces.filter((space) => selectedIds.has(space.spaceId)).map(clone) };
  }

  async drill(stageId) {
    const stage = this.stages.get(stageId);
    return { ok: Boolean(stage), referencesValid: Boolean(stage), schemaCompatible: stage?.report?.compatible === true };
  }
}
