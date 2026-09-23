import { readFile } from 'node:fs/promises';
import { redact } from '../backup/security.js';
import { commandError } from './operations.js';

export const EXIT = Object.freeze({ OK: 0, INTERNAL: 1, USAGE: 2, INVALID: 3, UNAVAILABLE: 4, VERIFICATION: 5, CONFLICT: 6 });
export const HELP = `Dynamic Panel sync administration\n\nUsage: dynamic-panel-sync <command> [action] [options]\n\nCommands:\n  account create|enable|disable|delete|reset-password\n  limits get|set\n  usage\n  audit\n  migrate run|status [--dry-run]\n  doctor\n  backup run|list|verify|prune|status\n  restore stage|apply|drill\n  export run --account ID --space ID\n  import stage|apply ID [--dry-run] [--account ID] [--space ID] [--confirm IMPORT]\n`;

function parse(argv) {
  const positionals = []; const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const key = value.slice(2);
    if (key === 'password' || key === 'client-key' || /credential|secret/i.test(key)) throw commandError('SECRET_ARGUMENT_FORBIDDEN', 'Secrets must be supplied through environment or a protected file');
    if (['dry-run', 'no-prune'].includes(key)) options[key] = true;
    else {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw commandError('INVALID_ARGUMENT', `Missing value for --${key}`);
      options[key] = next;
    }
  }
  return { positionals, options };
}

async function password(options, env) {
  const file = options['password-file'] ?? env.DP_ADMIN_PASSWORD_FILE;
  const value = file ? (await readFile(file, 'utf8')).replace(/[\r\n]+$/, '') : env.DP_ADMIN_PASSWORD;
  if (!value) throw commandError('SECRET_REQUIRED', 'Password input is required');
  return value;
}
function number(value, name) {
  const parsed = Number(value); if (!Number.isInteger(parsed)) throw commandError('INVALID_ARGUMENT', `${name} must be an integer`); return parsed;
}
function scope(options) {
  if (!options.account) throw commandError('INVALID_ARGUMENT', '--account is required');
  return options.space ? { type: 'space', accountId: options.account, spaceId: options.space } : { type: 'account', accountId: options.account };
}
function exitCode(error) {
  if (error.code === 'BACKUP_VERIFICATION_FAILED' || /VERIFY|CORRUPT|DRILL/.test(error.code ?? '')) return EXIT.VERIFICATION;
  if (/UNAVAILABLE|ECONN|TIMEOUT/.test(error.code ?? '')) return EXIT.UNAVAILABLE;
  if (/CONFLICT|NOT_READY|CONFIRMATION/.test(error.code ?? '')) return EXIT.CONFLICT;
  if (/INVALID|REQUIRED|FORBIDDEN|UNKNOWN|NOT_FOUND/.test(error.code ?? '')) return EXIT.INVALID;
  return EXIT.INTERNAL;
}

export async function runCli(argv, { operations, backup, restore, exporter, importer, env = {}, stdout = () => {}, stderr = () => {} }) {
  try {
    const { positionals: [group, action, ...rest], options } = parse(argv);
    let result;
    if (group === 'account') result = await operations.account(action, { accountId: rest[0] ?? options.account, username: options.username, password: ['create', 'reset-password'].includes(action) ? await password(options, env) : undefined });
    else if (group === 'limits') result = await operations.limits(action, { accountId: options.account, activeSpaces: options.spaces && number(options.spaces, 'spaces'), activeClientsPerSpace: options.clients && number(options.clients, 'clients') });
    else if (group === 'usage') result = await operations.usage({ accountId: options.account, spaceId: options.space });
    else if (group === 'audit') result = await operations.audit({ accountId: options.account, spaceId: options.space, action: options.action });
    else if (group === 'migrate') result = await operations.migration(action ?? 'run', { dryRun: options['dry-run'] === true });
    else if (group === 'doctor') result = await operations.doctor();
    else if (group === 'backup' && action === 'run') result = await backup.create({ reason: 'manual' });
    else if (group === 'backup' && action === 'list') result = await backup.list();
    else if (group === 'backup' && action === 'verify') result = await backup.verify(rest[0] ?? options.id);
    else if (group === 'backup' && action === 'prune') result = await backup.prune({ dryRun: options['dry-run'] === true });
    else if (group === 'backup' && action === 'status') result = await backup.health();
    else if (group === 'restore' && action === 'stage') result = await restore.stage(rest[0] ?? options.id, { dryRun: options['dry-run'] === true });
    else if (group === 'restore' && action === 'apply') result = await restore.apply(rest[0] ?? options.stage, { scope: scope(options), confirmation: options.confirm });
    else if (group === 'restore' && action === 'drill') result = await restore.drill(rest[0] ?? options.id);
    else if (group === 'export' && action === 'run') result = await exporter.create({ scope: { type: 'space', accountId: options.account, spaceId: options.space }, reason: 'export' });
    else if (group === 'import' && action === 'stage') result = await importer.stage(rest[0] ?? options.id, { dryRun: options['dry-run'] === true });
    else if (group === 'import' && action === 'apply') {
      if (options.confirm !== 'IMPORT') throw commandError('IMPORT_CONFIRMATION_REQUIRED', '--confirm IMPORT is required');
      result = await importer.apply(rest[0] ?? options.stage, { scope: scope(options), confirmation: 'RESTORE' });
    }
    else throw commandError('UNKNOWN_COMMAND');
    stdout(`${JSON.stringify({ ok: true, code: 'OK', data: redact(result) })}\n`);
    return EXIT.OK;
  } catch (error) {
    const code = exitCode(error);
    stderr(`${JSON.stringify({ ok: false, code: error.code ?? 'INTERNAL_ERROR', error: redact(error) })}\n`);
    return code;
  }
}
