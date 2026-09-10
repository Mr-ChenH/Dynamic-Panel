const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-recordings':JSON.stringify([{id:'startup-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]),
}}));
const noteImageBase64 = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'assets', 'app-logo-128.png')).toString('base64');
const errors = [];
setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    setTimeout(async () => {
      try {
        const state = await contents.executeJavaScript(`
          (async () => {
            const encoded = '${noteImageBase64}';
            const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
            const saved = await window.notchAPI.saveNoteImage({ noteId: 'startup-note', bytes });
            const source = saved.ok ? await window.notchAPI.readNoteImage(saved.imagePath) : null;
            const deleted = await window.notchAPI.deleteNoteImages('startup-note');
            const afterDelete = saved.ok ? await window.notchAPI.readNoteImage(saved.imagePath) : null;
            return {
              home: !!window.NotchHome,
              workspace: !!window.NotchWorkspace,
              note: document.getElementById('home-note').value,
              recordings: document.querySelectorAll('.recording-item').length,
              imageSaved: saved.ok,
              imagePath: saved.imagePath,
              imageReadable: String(source || '').startsWith('data:image/png;base64,'),
              imageDeleted: deleted,
              imageGone: afterDelete === null,
            };
          })()
        `);
        assert.deepEqual(errors, []);
        assert.deepEqual(state, {
          home: true,
          workspace: true,
          note: 'Recovered workspace note',
          recordings: 1,
          imageSaved: true,
          imagePath: state.imagePath,
          imageReadable: true,
          imageDeleted: true,
          imageGone: true,
        });
        assert.match(state.imagePath, /^note-images\/startup-note\/image-[a-f0-9-]{36}\.png$/);
        console.log('Production workspace and note attachment checks passed');
        app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    }, 2000);
  });
});
require('../main.js');
