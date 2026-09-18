const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { registerNotesIpc } = require('../main/ipc/notes');

test('notes IPC preserves image limits and confines deletion to a note-owned directory', async () => {
  const handlers = new Map();
  const files = new Map([['C:/input/photo.png', Buffer.from('png')]]);
  const fs = {
    promises: {
      stat: async (filePath) => ({ isFile: () => files.has(filePath), size: files.get(filePath)?.length || 0 }),
      readFile: async (filePath) => files.get(filePath),
      lstat: async (filePath) => ({
        isSymbolicLink: () => false,
        isDirectory: () => filePath === path.resolve('C:/workspace/note-images') || filePath === path.resolve('C:/workspace/note-images/note-1'),
      }),
      rm: async (filePath) => files.delete(filePath),
    },
  };
  registerNotesIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    fs,
    path,
    validNoteId: (noteId) => /^note-\d+$/.test(noteId),
    persistNoteImage: async (noteId, bytes) => ({ ok: true, noteId, path: `${noteId}/photo.png`, size: bytes.length }),
    showOwnedOpenDialog: async () => ({ canceled: false, filePaths: ['C:/input/photo.png'] }),
    getSafeNoteImagePath: (imagePath) => imagePath === 'note-1/photo.png' ? 'C:/workspace/note-images/note-1/photo.png' : '',
    getNoteImagesDir: () => 'C:/workspace/note-images',
    getNoteImageDirectory: (noteId) => noteId === 'note-1' ? 'C:/workspace/note-images/note-1' : '',
    noteImageMaxBytes: 20 * 1024 * 1024,
  });

  assert.deepEqual(await handlers.get('notes:choose-images')({}, 'bad'), { ok: false, error: 'invalid_note', images: [] });
  assert.deepEqual(await handlers.get('notes:choose-images')({}, 'note-1'), {
    ok: true, canceled: false, images: [{ ok: true, noteId: 'note-1', path: 'note-1/photo.png', size: 3, name: 'photo' }],
  });
  assert.equal((await handlers.get('notes:read-image')({}, '../escape.png')), null);
  assert.equal(await handlers.get('notes:delete-images')({}, 'bad'), false);
  assert.equal(await handlers.get('notes:delete-images')({}, 'note-1'), true);
});
