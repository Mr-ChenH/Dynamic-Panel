import { fileURLToPath } from 'node:url';
import { composeCli } from './cli/index.js';
import { BackupJob, DailyScheduler } from './jobs/index.js';

export async function startWorker(env = process.env, overrides = {}) {
  const composed = await composeCli(env, overrides);
  const job = new BackupJob({ backup: composed.cli.backup });
  const scheduler = new DailyScheduler({ job, hour: Number(env.DP_BACKUP_HOUR_UTC ?? 2), minute: Number(env.DP_BACKUP_MINUTE_UTC ?? 0) });
  scheduler.start();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    scheduler.stop();
    await composed.pool.end();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { scheduler, shutdown, composed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startWorker();
