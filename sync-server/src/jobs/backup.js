export class BackupJob {
  constructor({ backup, jobs = null, clock = () => new Date() }) { this.backup = backup; this.jobs = jobs; this.clock = clock; }

  async run({ prune = true, scope, reason = 'scheduled' } = {}) {
    const job = { type: 'backup', status: 'running', startedAt: this.clock().toISOString(), reason };
    const jobId = await this.jobs?.start?.(job);
    try {
      const point = await this.backup.create({ scope, reason });
      let retention = null;
      if (prune) retention = await this.backup.prune();
      const result = { ...job, status: 'verified', completedAt: this.clock().toISOString(), point, retention };
      await this.jobs?.finish?.(jobId, result);
      return result;
    } catch (error) {
      await this.jobs?.finish?.(jobId, { ...job, status: 'failed', completedAt: this.clock().toISOString(), errorCode: error.code ?? 'BACKUP_FAILED' });
      throw error;
    }
  }
}

export class DailyScheduler {
  constructor({ job, hour = 2, minute = 0, clock = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.job = job; this.hour = hour; this.minute = minute; this.clock = clock; this.setTimer = setTimer; this.clearTimer = clearTimer; this.timer = null;
  }
  nextRun(now = this.clock()) {
    const next = new Date(now); next.setUTCHours(this.hour, this.minute, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  start() {
    const delay = this.nextRun().getTime() - this.clock().getTime();
    this.timer = this.setTimer(async () => { try { await this.job.run(); } finally { this.start(); } }, delay);
    this.timer?.unref?.();
    return this.nextRun();
  }
  stop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; }
}
