const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('Windows collapsed notch stays compact and grows only on approach', () => {
  assert.match(appJs, /app\.dataset\.platform\s*=\s*window\.notchAPI\?\.platform/);
  const compactRule = stylesCss.match(/#app\[data-platform='win32'\]\.collapsed \.notch \{([\s\S]*?)\n\}/)?.[1] || '';
  const hoverRule = stylesCss.match(/#app\[data-platform='win32'\]\.collapsed \.notch:hover \{([\s\S]*?)\n\}/)?.[1] || '';
  const closingRule = stylesCss.match(/#app\[data-platform='win32'\]\.closing \.notch \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactRule, /width:\s*160px/);
  assert.match(compactRule, /height:\s*16px/);
  assert.match(compactRule, /width var\(--d-base\)/);
  assert.match(hoverRule, /width:\s*184px/);
  assert.match(hoverRule, /height:\s*30px/);
  assert.match(closingRule, /width:\s*160px/);
  assert.match(closingRule, /height:\s*16px/);
  assert.match(closingRule, /background:\s*var\(--bg-base\)/);
  assert.doesNotMatch(appJs, /native-resizing/);
});

test('Windows panel motion stays on compositor-only properties', () => {
  const shellRule = stylesCss.match(/#app\[data-platform='win32'\] \.panel::before \{([\s\S]*?)\n\}/)?.[1] || '';
  const expandedRule = stylesCss.match(/#app\[data-platform='win32'\]\.expanded \.panel::before \{([\s\S]*?)\n\}/)?.[1] || '';
  const closingShellRule = stylesCss.match(/#app\[data-platform='win32'\]\.closing \.panel::before \{([\s\S]*?)\n\}/)?.[1] || '';
  const mainWindowOptions = mainJs.match(/mainWindow = new BrowserWindow\(\{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(mainWindowOptions, /backgroundThrottling:\s*false/);
  assert.match(shellRule, /clip-path:\s*none/);
  assert.match(shellRule, /transform:\s*scaleX\(0\.15\)/);
  assert.match(shellRule, /will-change:\s*transform, opacity/);
  assert.match(expandedRule, /transform:\s*scaleX\(1\)/);
  assert.match(closingShellRule, /transform:\s*scaleX\(0\.13\)/);
  assert.doesNotMatch(shellRule, /transition:[\s\S]*clip-path/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('home and settings remove the mirror module completely', () => {
  assert.doesNotMatch(html, /home-mirror|mirror-stage|mirror-video|data-settings-home-module="mirror"/);
  assert.doesNotMatch(stylesCss, /home-mirror|mirror-stage|mirror-video|--home-mirror|镜子/);
  assert.doesNotMatch(appJs, /HOME_MODULE_REGISTRY[^\n]*mirror|startMirror|stopMirror|getUserMedia/);
  assert.doesNotMatch(workspaceJs, /getMirrorImage|chooseMirrorImage|settingsMirrorPreview/);
  assert.doesNotMatch(mainJs, /MIRROR_IMAGE_FILE|mirror:choose-image|media:camera|替换镜子配图/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /notch-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.NotchHome\s*=/);
  assert.match(appJs, /notch:home-modules-changed/);
  assert.match(appJs, /notch:home-layout-error/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'music', 'pomodoro', 'recorder', 'windows', 'note', 'commands',
  ]);
  assert.match(workspaceJs, /isRecordingActive/);
  assert.match(workspaceJs, /recording_active/);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /notch:home-modules-changed/);
  assert.match(workspaceJs, /NotchHome\?\.isVisible/);
});
