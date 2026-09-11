const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function run(executable, args) {
  console.log(`Checking ${args.join(' ')}`);
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error(result.error);
  if (result.status !== 0) {
    if (env.TODO_TEST_LOG && fs.existsSync(env.TODO_TEST_LOG)) console.error(fs.readFileSync(env.TODO_TEST_LOG, 'utf8'));
    process.exit(result.status || 1);
  }
}
run(process.execPath, ['--test', '--test-concurrency=2', ...fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.js')).map((name) => `tests/${name}`)]);
env.TODO_TEST_LOG = path.join(root, 'dist.noindex', 'windows-smoke', 'renderer-test.log');
fs.mkdirSync(path.dirname(env.TODO_TEST_LOG), { recursive: true });
fs.writeFileSync(env.TODO_TEST_LOG, '');
for (const file of ['notch-focus', 'retained-workspace', 'startup']) {
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-renderer-test-'));
  env.TODO_TEST_USER_DATA = testProfile;
  run(require('electron'), [`tests/${file}.electron.js`]);
  fs.rmSync(testProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
for (const file of ['main.js', 'main-services.js', 'platform.js', 'preload.js', 'ai/schema.js', 'ai/prompts.js', 'ai/service.js', 'launcher/domain.js', 'launcher/regex.js', 'launcher/application-actions.js', 'renderer/launcher-regex-worker.js', 'launcher/storage-schema.js', 'launcher/data-transfer.js', 'launcher/focus.js', 'launcher/paths.js', 'launcher/extension-runner.js', 'launcher/extension-schema.js', 'launcher/extension-host.js', 'launcher/service.js', 'renderer/launcher.js', 'renderer/settings.js', 'renderer/domain.js', 'renderer/ai-domain.js', 'renderer/ai.js', 'renderer/effects.js', 'renderer/app.js', 'renderer/workspace.js', 'renderer/icon-motion.js', 'renderer/notification.js', 'build/afterPack.js', 'scripts/codex-notify.js', 'scripts/claude-notify.js', 'scripts/smoke-app.js']) {
  run(process.execPath, ['--check', file]);
}
