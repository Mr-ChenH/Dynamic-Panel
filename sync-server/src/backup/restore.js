import { randomUUID } from 'node:crypto';

function assertScope(scope) {
  if (!scope || !['account', 'space'].includes(scope.type) || typeof scope.accountId !== 'string') throw new TypeError('Invalid restore scope');
  if (scope.type === 'space' && typeof scope.spaceId !== 'string') throw new TypeError('Space restore requires spaceId');
}

export class RestoreService {
  constructor({ backup, repository, preRestoreBackup = backup, clock = () => new Date(), id = randomUUID, invalidate = async () => {}, audit = async () => {} }) {
    if (!backup || !repository) throw new TypeError('backup and repository are required');
    this.backup = backup; this.repository = repository; this.preRestoreBackup = preRestoreBackup;
    this.clock = clock; this.id = id; this.invalidate = invalidate; this.audit = audit;
  }

  async stage(manifestId, { dryRun = false } = {}) {
    const verified = await this.backup.verify(manifestId);
    const report = await this.repository.inspectStage(verified.data, verified.manifest, verified.objects ?? []);
    const result = {
      stageId: dryRun ? null : this.id(), manifestId, dryRun,
      verifiedAt: this.clock().toISOString(), compatible: report.compatible !== false,
      accounts: report.accounts ?? 0, spaces: report.spaces ?? 0,
      missingObjects: report.missingObjects ?? [], corruptObjects: report.corruptObjects ?? [],
      errors: report.errors ?? []
    };
    result.ready = result.compatible && !result.missingObjects.length && !result.corruptObjects.length && !result.errors.length;
    if (!dryRun && result.ready) await this.repository.saveStage(result.stageId, verified.data, { ...result, manifest: verified.manifest }, verified.objects ?? []);
    return result;
  }

  async apply(stageId, { scope, confirmation, createPreRestore = true } = {}) {
    assertScope(scope);
    if (confirmation !== 'RESTORE') throw Object.assign(new Error('Restore confirmation is required'), { code: 'RESTORE_CONFIRMATION_REQUIRED' });
    const stage = await this.repository.getStage(stageId);
    if (!stage?.report?.ready) throw Object.assign(new Error('A verified ready stage is required'), { code: 'RESTORE_STAGE_NOT_READY' });
    let recoveryPoint = null;
    if (createPreRestore) recoveryPoint = await this.preRestoreBackup.create({ scope, reason: 'pre-restore' });
    const result = await this.repository.activateStage(stageId, scope, {
      incrementAffectedEpochs: true, preserveOtherScopes: true, resetStreamFloor: true
    });
    const affected = result.spaces ?? [];
    for (const space of affected) await this.invalidate({ accountId: space.accountId, spaceId: space.spaceId, restoreEpoch: space.restoreEpoch });
    await this.audit({ action: 'restore.apply', scope, stageId, manifestId: stage.report.manifestId, result: 'success' });
    return { stageId, scope, preRestoreManifestId: recoveryPoint?.manifestId ?? null, affectedSpaces: affected };
  }

  async drill(manifestId) {
    const stage = await this.stage(manifestId);
    if (!stage.ready) throw Object.assign(new Error('Restore drill staging failed'), { code: 'RESTORE_DRILL_FAILED', report: stage });
    const checks = await this.repository.drill(stage.stageId);
    return { manifestId, stageId: stage.stageId, status: checks.ok ? 'passed' : 'failed', checks, completedAt: this.clock().toISOString() };
  }
}
