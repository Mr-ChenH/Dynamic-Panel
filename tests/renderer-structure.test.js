const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const aiCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai.css'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'settings.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home.js'), 'utf8');

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('clipboard history renders a dated timeline with filtered result counts', () => {
  assert.match(html, /id="clip-result-count"/);
  assert.match(appJs, /groupClipItemsByDay/);
  assert.match(appJs, /clip-timeline-group/);
  assert.match(appJs, /formatClipMoment/);
  assert.match(stylesCss, /\.clip-timeline-group::before/);
  assert.match(stylesCss, /\.clip-timeline-node/);
});

test('todo keeps P0-P3 storage while time scopes stay derived from deadlines', () => {
  for (const name of ['学习与课程', '内容与创作', '产品与开发', '生活与事务']) {
    assert.match(html, new RegExp(`value="${name}"`));
  }
  assert.match(appJs, /migrateTodoCategoryNames/);
  assert.equal((html.match(/data-todo-scope="(?:today|week|later|all)"/g) || []).length, 4);
  assert.equal((html.match(/data-todo-date-shortcut="(?:today|tomorrow|weekend|next-week)"/g) || []).length, 4);
  assert.match(appJs, /filterTodosByTimeScope\(data\[priority\]/);
  assert.match(appJs, /todoTimeScopeCounts\(allTodoItems\(\)/);
  assert.match(appJs, /data-todo-completed-toggle/);
  assert.match(appJs, /defaultTodoDeadlineForScope\(todoTimeScope/);
  assert.match(appJs, /window\.addEventListener\('focus', refreshTodoTemporalView\)/);
  assert.match(stylesCss, /\.todo-scope-control/);
  assert.match(stylesCss, /\.todo-completed-disclosure/);
  assert.doesNotMatch(appJs, /localStorage\.setItem\([^\n]*todo-time-scope/);
});

test('Windows collapsed notch stays compact and grows only on approach', () => {
  assert.match(appJs, /app\.dataset\.platform\s*=\s*window\.notchAPI\?\.platform/);
  const compactRule = stylesCss.match(/#app\[data-platform='win32'\]\.collapsed \.notch \{([\s\S]*?)\n\}/)?.[1] || '';
  const hoverRule = stylesCss.match(/#app\[data-platform='win32'\]\.collapsed \.notch:hover \{([\s\S]*?)\n\}/)?.[1] || '';
  const closingRule = stylesCss.match(/#app\[data-platform='win32'\]\.closing \.notch \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactRule, /width:\s*160px/);
  assert.match(compactRule, /height:\s*8px/);
  assert.match(compactRule, /width var\(--d-base\)/);
  assert.match(hoverRule, /width:\s*184px/);
  assert.match(hoverRule, /height:\s*30px/);
  assert.match(closingRule, /width:\s*160px/);
  assert.match(closingRule, /height:\s*8px/);
  assert.match(closingRule, /background:\s*var\(--bg-base\)/);
  assert.match(preloadJs, /setCollapsedHover:.*window:set-collapsed-hover/);
  assert.match(appJs, /notch\.addEventListener\('mouseenter'.*setCollapsedHover/s);
  assert.match(appJs, /notch\.addEventListener\('mouseleave'.*setCollapsedHover/s);
  assert.match(mainJs, /ipcMain\.on\('window:set-collapsed-hover'/);
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

test('notes provide local-first creation, rich editing, and guarded image attachments', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-new"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /class="notes-taxonomy tile"/);
  assert.match(html, /id="notes-taxonomy-tree"/);
  assert.match(html, /id="notes-category-filter"/);
  assert.match(html, /id="notes-category-add"/);
  assert.match(html, /id="notes-category-editor"/);
  assert.match(html, /id="notes-category-confirm"/);
  assert.match(html, /id="notes-tag-toolbar"/);
  assert.match(html, /id="notes-tag-filter"/);
  assert.match(html, /id="notes-tag-editor"/);
  assert.match(html, /id="notes-tag-confirm"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
  assert.match(appJs, /function createNote\(\)/);
  assert.match(appJs, /NOTE_CATEGORIES_KEY = 'notch-note-categories-v1'/);
  assert.match(appJs, /updateNoteCategory/);
  assert.match(appJs, /removeNoteCategory/);
  assert.match(appJs, /updateNoteTag/);
  assert.match(appJs, /removeNoteTag/);
  assert.match(appJs, /function renderNotesTaxonomy/);
  assert.match(appJs, /notesTaxonomyTree\?\.addEventListener/);
  assert.match(appJs, /addEventListener\('paste'/);
  assert.match(appJs, /addEventListener\('drop'/);
  assert.match(appJs, /safeNoteImageReference/);
  assert.match(preloadJs, /notes:save-image/);
  assert.match(preloadJs, /notes:choose-images/);
  assert.match(preloadJs, /notes:read-image/);
  assert.match(preloadJs, /notes:delete-images/);
  assert.match(mainJs, /NOTE_IMAGE_MAX_BYTES\s*=\s*20 \* 1024 \* 1024/);
  assert.match(mainJs, /NOTE_IMAGE_MAX_EDGE\s*=\s*2400/);
  assert.match(mainJs, /getSafeNoteImagePath/);
  assert.match(mainJs, /NOTE_IMAGES_DIR_NAME/);
  assert.doesNotMatch(appJs, /data:image\/[^;]+;base64[^\n]*localStorage/);
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

test('retired homepage widgets keep migration data but have no user-facing entry', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'music', 'pomodoro', 'recorder', 'windows', 'note', 'commands',
  ]);
  assert.doesNotMatch(html, /id="home-view-toggle"/);
  assert.match(html, /id="home-bento"[^>]*aria-hidden="true"[^>]*hidden[^>]*inert/);
  assert.doesNotMatch(settingsJs, /\{id:'home',title:'首页组件'/);
  assert.match(settingsJs, /retiredHomeCard\.hidden=true/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

test('home music is app-owned and configures local or public HTTPS sources', () => {
  assert.match(html, /id="home-music-audio"/);
  assert.match(html, /data-music-source="local"/);
  assert.match(html, /data-music-source="network"/);
  assert.match(html, /id="music-local-add-folder"/);
  assert.match(html, /id="music-volume"[^>]*type="range"/);
  assert.match(settingsJs, /id:'music'/);
  for (const api of ['getHomeMusicLibrary', 'setHomeMusicMode', 'chooseHomeMusicFiles', 'chooseHomeMusicFolder', 'addHomeMusicUrl', 'removeHomeMusicTrack', 'loadHomeMusicTrack']) assert.match(preloadJs, new RegExp(api));
  for (const channel of ['home:music-library', 'home:music-mode', 'home:music-choose-files', 'home:music-choose-folder', 'home:music-add-network', 'home:music-remove', 'home:music-load']) assert.match(mainJs, new RegExp(channel));
  assert.match(homeJs, /URL\.createObjectURL/);
  assert.doesNotMatch(preloadJs, /getHomeMedia|controlHomeMedia|getMusicStatus|controlMusic/);
  assert.doesNotMatch(mainJs, /home:media-status|home:media-control|music:status|music:control|SODA_MUSIC/);
  assert.doesNotMatch(workspaceJs, /getMusicStatus|controlMusic/);
});

test('AI providers configure directly inside the settings page', () => {
  assert.match(html, /class="tile settings-card settings-api-card"/);
  assert.match(html, /class="ai-provider-sidebar"/);
  assert.match(html, /id="ai-content-provider-list"/);
  assert.match(html, /class="ai-provider-config"/);
  assert.match(html, /id="llm-model-list"/);
  assert.match(html, /id="llm-model-add"/);
  assert.match(workspaceJs, /llmModels:\s*normalizedModels/);
  assert.doesNotMatch(html, /id="transcription-settings-backdrop"|id="settings-api-configure"|id="ai-service-tab-content"/);
  assert.match(workspaceJs, /data-ai-provider/);
  assert.match(workspaceJs, /NotchSettings\?\.select\('api'\)/);
  assert.match(aiCss, /\.ai-settings-layout[^}]*grid-template-columns:\s*196px minmax\(0,1fr\)/);
});

test('automatic AI naming sends stable source identities', () => {
  assert.match(appJs, /organizeMaterial\(\{ kind: 'note', sourceId: note\.id, text: expectedContent \}\)/);
  assert.match(workspaceJs, /organizeMaterial\(\{ kind: 'recording', sourceId: recording\.id, text: expectedTranscript \}\)/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /notch:home-modules-changed/);
  assert.match(workspaceJs, /NotchHome\?\.isVisible/);
});
