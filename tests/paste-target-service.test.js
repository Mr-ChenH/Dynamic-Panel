const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasteTargetService } = require('../main/paste-target-service');

function createExecFile(outputs) {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const output = outputs.shift() || { stdout: '', error: null };
    setImmediate(() => callback(output.error, output.stdout));
  };
  execFile.calls = calls;
  return execFile;
}

test('paste target service ignores unsupported platforms without invoking JXA', async () => {
  let calls = 0;
  const service = createPasteTargetService({ automaticPaste: false, execFile: () => { calls += 1; } });
  assert.equal(await service.remember(), null);
  assert.equal(await service.pasteToPreviousApp({ bundleId: 'com.example.Editor' }), false);
  assert.equal(calls, 0);
});

test('paste target service remembers only external frontmost applications', async () => {
  const execFile = createExecFile([
    { stdout: JSON.stringify({ name: 'Dynamic Panel', bundleId: 'com.dynamicpanel.app', path: '/Applications/Dynamic Panel.app' }) },
    { stdout: JSON.stringify({ name: 'Editor', bundleId: 'com.example.Editor', path: '/Applications/Editor.app' }) },
    { stdout: '{bad-json' },
  ]);
  const service = createPasteTargetService({ automaticPaste: true, execFile });
  assert.equal(await service.remember(), null);
  const remembered = await service.remember();
  assert.deepEqual(remembered, { name: 'Editor', bundleId: 'com.example.Editor', path: '/Applications/Editor.app' });
  assert.deepEqual(await service.remember(), remembered);
  assert.equal(execFile.calls.length, 3);
});

test('paste target service invokes the guarded paste helper for a remembered target', async () => {
  const execFile = createExecFile([{ stdout: 'ok\n' }]);
  const service = createPasteTargetService({ automaticPaste: true, execFile });
  const result = await service.pasteToPreviousApp({ bundleId: 'com.example.Editor' });
  assert.equal(result, true);
  assert.equal(execFile.calls[0].args[0], '-l');
  assert.equal(execFile.calls[0].args.at(-1), 'com.example.Editor');
  assert.equal(await service.pasteToPreviousApp({ bundleId: 'com.dynamicpanel.app' }), false);
});
