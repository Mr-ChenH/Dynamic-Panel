'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const schema = require('./extension-schema');
// Node filesystem permissions restrict direct access; this is not an OS sandbox.
// No inherited API keys/NODE_OPTIONS, child-process, addon, worker or inspector grants.
function queryExtension(directory, manifest, commandId, query, signal, executable = process.execPath, operation = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('cancelled'));
    const env = { ELECTRON_RUN_AS_NODE: '1' };
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'PATH']) if (process.env[key]) env[key] = process.env[key];
    const requestId = require('node:crypto').randomUUID();
    const runner = fs.realpathSync(path.join(__dirname, 'extension-runner.js'));
    const extensionDirectory = fs.realpathSync(directory);
    const entry = fs.realpathSync(path.join(extensionDirectory, manifest.runtime.entry));
    const storagePath = operation.storagePath ? fs.realpathSync(operation.storagePath) : '';
    const args = ['--permission', `--allow-fs-read=${runner}`, `--allow-fs-read=${extensionDirectory}`];
    if (storagePath) args.push(`--allow-fs-read=${storagePath}`, `--allow-fs-write=${storagePath}`);
    args.push(runner, entry, requestId);
    const child = spawn(executable, args, { cwd: extensionDirectory, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false, buffer = '', bytes = 0, ready = false, timer, cancelTimer;
    const finish = (error, result) => {
      if (settled) return;
      if (signal?.aborted) error = Error('cancelled');
      clearTimeout(cancelTimer);
      settled = true; clearTimeout(timer); clearTimeout(startupTimer); signal?.removeEventListener('abort', cancel);
      child.stdout.destroy(); child.stderr.destroy();
      let completed = false, escalation, deadline;
      const complete = () => {
        if (completed) return;
        completed = true; clearTimeout(escalation); clearTimeout(deadline);
        // The leader can exit before descendants; do not cancel escalation
        // without also terminating remaining members of its process group.
        if (process.platform !== 'win32' && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        }
        child.stdout.destroy(); child.stderr.destroy();
        if (error) reject(error); else resolve(result);
      };
      const terminate = (force = false) => {
        try {
          if (process.platform === 'win32') {
            if (child.kill('SIGKILL')) return;
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => { try { child.kill('SIGKILL'); } catch {} });
          } else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch { try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch {} }
      };
      child.stdin.destroy();
      if (!child.pid) complete();
      else {
        child.once('close', complete);
        terminate();
        escalation = setTimeout(() => terminate(true), 250);
        deadline = setTimeout(() => { error = Error('extension_cleanup_failed'); terminate(true); complete(); }, 1500);
        if (child.exitCode !== null || child.signalCode !== null) complete();
      }
    };
    const cancel = () => {
      if (!ready || child.stdin.destroyed) return finish(Error('cancelled'));
      cancelTimer = setTimeout(() => finish(Error('cancelled')), 25);
      child.stdin.write(JSON.stringify({ type: 'cancel', requestId, commandId, extensionId: manifest.id }) + '\n', () => finish(Error('cancelled')));
    };
    const startupTimer = setTimeout(() => finish(Error('extension_start_timeout')), 3000);
    signal?.addEventListener('abort', cancel, { once: true });
    child.on('error', () => finish(Error('extension_start_failed')));
    child.on('exit', () => finish(Error('extension_exited')));
    child.stdin.on('error', () => finish(Error('extension_pipe_failed')));
    child.stderr.on('data', (chunk) => { bytes += chunk.length; if (bytes > 262144) finish(Error('extension_output_limit')); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk); if (bytes > 262144) return finish(Error('extension_output_limit'));
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0 && !settled) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const response = JSON.parse(line);
          if (response.requestId !== requestId) continue;
          if (response.type === 'ready' && !ready) {
            ready = true; clearTimeout(startupTimer);
            timer = setTimeout(() => finish(Error('extension_timeout')), operation.type === 'execute' ? Math.max(500, Math.min(10000, Number(operation.executeTimeoutMs) || 5000)) : Math.max(300, Math.min(5000, Number(operation.queryTimeoutMs) || 800)));
            sendRequest(); continue;
          }
          if (!ready || response.type !== 'result') throw Error('invalid_response');
          finish(null, schema.items(response.items, manifest.permissions));
        } catch (error) { finish(Error('invalid_extension_response')); }
      }
    });
    function sendRequest() { child.stdin.write(JSON.stringify({ type: operation.type === 'execute' ? 'execute' : 'query', requestId, commandId, query, extensionId: manifest.id, ...(operation.itemId ? { itemId: operation.itemId } : {}), context: { platform: process.platform, ...(storagePath ? { storagePath } : {}) } }) + '\n'); }
  });
}
module.exports = { queryExtension };
