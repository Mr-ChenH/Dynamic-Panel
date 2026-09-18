const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRecordingsIpc } = require('../main/ipc/recordings');

test('recordings IPC delegates storage operations and rejects unsafe reveal paths', async () => {
  const handlers = new Map();
  const revealed = [];
  registerRecordingsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    saveRecording: async (payload) => ({ ok: true, payload }),
    readRecording: async (audioPath) => ({ audioPath }),
    deleteRecording: async (audioPath) => ({ ok: true, audioPath }),
    getSafeRecordingPath: (audioPath) => audioPath === 'safe.webm' ? 'C:/data/safe.webm' : '',
    revealItem: (audioPath) => revealed.push(audioPath),
  });

  assert.deepEqual(await handlers.get('recordings:save')({}, { id: 'one' }), { ok: true, payload: { id: 'one' } });
  assert.deepEqual(await handlers.get('recordings:read')({}, 'safe.webm'), { audioPath: 'safe.webm' });
  assert.deepEqual(await handlers.get('recordings:delete')({}, 'safe.webm'), { ok: true, audioPath: 'safe.webm' });
  assert.equal(await handlers.get('recordings:reveal')({}, '../unsafe.webm'), false);
  assert.equal(await handlers.get('recordings:reveal')({}, 'safe.webm'), true);
  assert.deepEqual(revealed, ['C:/data/safe.webm']);
});
