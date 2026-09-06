const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.js')).map((name) => `tests/${name}`)]);
run(require('electron'), ['tests/notch-focus.electron.js']);
for (const file of ['main.js', 'main-services.js', 'platform.js', 'preload.js', 'renderer/domain.js', 'renderer/effects.js', 'renderer/app.js', 'renderer/workspace.js', 'renderer/icon-motion.js', 'renderer/notification.js', 'build/afterPack.js', 'scripts/codex-notify.js', 'scripts/claude-notify.js', 'scripts/smoke-app.js']) {
  run(process.execPath, ['--check', file]);
}
