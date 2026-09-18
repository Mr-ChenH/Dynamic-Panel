const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createWorkspaceFiles } = require('../main/workspace-files');
const { validNoteId, parseNoteImageReference } = require('../main-services');

function createFiles(root) {
  return createWorkspaceFiles({
    fs,
    path,
    crypto,
    nativeImage: {},
    workspaceRoot: () => root,
    workspacePath: (name) => path.join(root, name),
    platformPolicy: { portableMediaPath: (directory, filePath) => `${directory}/${path.basename(filePath)}` },
    validNoteId,
    parseNoteImageReference,
    recordingExtension: () => 'webm',
    recordingsDirName: 'recordings',
    noteImagesDirName: 'note-images',
    clipImagesDirName: 'clipboard-images',
    recordingMaxBytes: 1024,
    noteImageMaxBytes: 1024,
    noteImageMaxEdge: 2400,
  });
}

test('workspace file service confines recording and clipboard paths to owned files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-panel-files-'));
  const files = createFiles(root);
  files.ensureRecordingsDir();
  files.ensureClipImagesDir();
  const saved = await files.saveRecording({ bytes: Buffer.from('audio'), mimeType: 'audio/webm' });
  assert.equal(saved.ok, true);
  assert.match(saved.audioPath, /^recordings\/recording-[a-z0-9-]+\.webm$/);
  assert.equal(await files.readRecording(saved.audioPath).then((value) => value.mimeType), 'audio/webm');
  assert.equal(files.getSafeRecordingPath('../outside.webm'), null);
  assert.equal(files.getSafeClipImagePath('../outside.png'), null);
  assert.equal(await files.deleteRecording(saved.audioPath), true);
  fs.rmSync(root, { recursive: true, force: true });
});
