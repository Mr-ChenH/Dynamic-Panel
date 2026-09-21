const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'renderer', 'shell.css'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const homeCss = fs.readFileSync(path.join(root, 'renderer', 'home.css'), 'utf8');
const recordingsCss = fs.readFileSync(path.join(root, 'renderer', 'recordings.css'), 'utf8');
const clipboardCss = fs.readFileSync(path.join(root, 'renderer', 'clipboard.css'), 'utf8');
const todoQuadrantsCss = fs.readFileSync(path.join(root, 'renderer', 'todo-quadrants.css'), 'utf8');
const notesCss = fs.readFileSync(path.join(root, 'renderer', 'notes.css'), 'utf8');
const themeCss = fs.readFileSync(path.join(root, 'renderer', 'theme.css'), 'utf8');
const platformCss = fs.readFileSync(path.join(root, 'renderer', 'platform.css'), 'utf8');
const credentialsCss = fs.readFileSync(path.join(root, 'renderer', 'credentials.css'), 'utf8');
const todoPlannerCss = fs.readFileSync(path.join(root, 'renderer', 'todo-planner.css'), 'utf8');
const todoListCss = fs.readFileSync(path.join(root, 'renderer', 'todo-list.css'), 'utf8');
const todoEditorCss = fs.readFileSync(path.join(root, 'renderer', 'todo-editor.css'), 'utf8');
const todoCss = fs.readFileSync(path.join(root, 'renderer', 'todo.css'), 'utf8');
const todoDeadlinePopoverCss = fs.readFileSync(path.join(root, 'renderer', 'todo-deadline-popover.css'), 'utf8');
const clipboardDomainJs = fs.readFileSync(path.join(root, 'renderer', 'clipboard-domain.js'), 'utf8');
const clipboardControllerJs = fs.readFileSync(path.join(root, 'renderer', 'clipboard-controller.js'), 'utf8');

test('shared design tokens load from shell.css before module and shell rules', () => {
  assert.ok(html.indexOf('shell.css') < html.indexOf('todo.css'));
  assert.ok(html.indexOf('shell.css') < html.indexOf('styles.css'));
  assert.match(shellCss, /--surface-1:/);
  assert.match(shellCss, /--ease-out:/);
  assert.doesNotMatch(stylesCss, /^:root \{/);
});

test('credential styles load as a dedicated module while shared theme selectors remain in the shell stylesheet', () => {
  assert.ok(html.indexOf('credentials.css') < html.indexOf('launcher.css'));
  assert.match(credentialsCss, /\.credentials-page/);
  assert.match(credentialsCss, /\.credential-item\.editing/);
  assert.match(credentialsCss, /data-theme='light'/);
  assert.doesNotMatch(stylesCss, /\/\* ============ 密钥库 ============ \*\//);
  assert.doesNotMatch(stylesCss, /\.credential-item\.editing \{/);
});

test('todo time-range planner styles load outside the shell stylesheet', () => {
  assert.ok(html.indexOf('todo-planner.css') < html.indexOf('launcher.css'));
  assert.match(todoPlannerCss, /\.todo-scope-control/);
  assert.match(todoPlannerCss, /\.todo-overdue-jump/);
  assert.doesNotMatch(stylesCss, /待办 · 时间范围 \+ P0–P3 四象限/);
  assert.doesNotMatch(stylesCss, /\.todo-planner-bar \{/);
});

test('todo list and completed disclosure styles load outside the shell stylesheet', () => {
  assert.ok(html.indexOf('todo-list.css') < html.indexOf('launcher.css'));
  assert.match(todoListCss, /\.todo-completed-disclosure/);
  assert.match(todoListCss, /\.todo-reschedule-action/);
  assert.match(todoListCss, /\.todo-add-button/);
  assert.doesNotMatch(stylesCss, /DDL 与文字分两层/);
  assert.doesNotMatch(stylesCss, /\.todo-completed-disclosure button \{/);
});

test('core todo row styles load from a dedicated stylesheet before shell overrides', () => {
  assert.ok(html.indexOf('todo.css') < html.indexOf('styles.css'));
  assert.match(todoCss, /\.todo-item \{/);
  assert.match(todoCss, /\.checkbox \{/);
  assert.match(todoCss, /\.add-row input \{/);
  assert.doesNotMatch(stylesCss, /\/\* ============ 待办项 ============ \*\//);
  assert.doesNotMatch(stylesCss, /\.todo-item \{\n  display: flex;/);
});

test('todo deadline popover styles load after shell overrides', () => {
  assert.ok(html.indexOf('todo-deadline-popover.css') > html.indexOf('styles.css'));
  assert.match(todoDeadlinePopoverCss, /\.todo-date-popover \{/);
  assert.match(todoDeadlinePopoverCss, /\.quadrant > \.todo-date-popover/);
  assert.match(todoDeadlinePopoverCss, /z-index:\s*80/);
  assert.match(todoDeadlinePopoverCss, /background:\s*var\(--surface-1\)/);
  assert.match(todoDeadlinePopoverCss, /border:\s*1px solid var\(--hairline\)/);
  assert.match(todoDeadlinePopoverCss, /grid-auto-rows:\s*17px/);
  assert.match(todoDeadlinePopoverCss, /\.quadrant > \.todo-date-popover \.todo-calendar-grid > span/);
  assert.match(todoDeadlinePopoverCss, /\.quadrant:nth-child\(-n \+ 2\) > \.todo-date-popover/);
  assert.doesNotMatch(todoDeadlinePopoverCss, /linear-gradient\(/);
  assert.doesNotMatch(stylesCss, /\.todo-date-popover \{/);
});

test('todo deadline editor styles load before shell overrides', () => {
  assert.ok(html.indexOf('todo-editor.css') < html.indexOf('styles.css'));
  assert.match(todoEditorCss, /\.todo-editor-backdrop/);
  assert.match(todoEditorCss, /\.todo-calendar-grid/);
  assert.match(todoEditorCss, /\.todo-deadline-trigger/);
  assert.match(todoEditorCss, /background:\s*var\(--surface-2\)/);
  assert.match(todoEditorCss, /border:\s*1px solid var\(--hairline\)/);
  assert.doesNotMatch(stylesCss, /\.todo-editor-backdrop \{/);
});

test('light theme covers weather surfaces and preserves weather accents', () => {
  assert.match(homeCss, /:root\[data-theme='light'\] \.home-weather/);
  assert.match(homeCss, /:root\[data-theme='light'\] \.weather-detail-hero/);
  assert.match(homeCss, /:root\[data-theme='light'\] \.weather-detail-section/);
  assert.match(homeCss, /:root\[data-theme='light'\] #home-weather-results/);
});

test('recording library styles load before shell overrides', () => {
  assert.ok(html.indexOf('recordings.css') < html.indexOf('styles.css'));
  assert.match(recordingsCss, /\.recordings-page/);
  assert.match(recordingsCss, /\.recording-live-audio/);
  assert.match(recordingsCss, /\.recording-transcript-editor/);
  assert.doesNotMatch(stylesCss, /\/\* ============ 录制资料库 ============ \*\//);
  assert.doesNotMatch(stylesCss, /\.recording-live-audio \{/);
});

test('clipboard styles load outside the shell stylesheet', () => {
  assert.ok(html.indexOf('clipboard.css') < html.indexOf('styles.css'));
  assert.match(clipboardCss, /#tab-clip \{/);
  assert.match(clipboardCss, /\.clip-timeline-items \{/);
  assert.match(clipboardCss, /\.clip-item \{/);
  assert.match(clipboardCss, /:root\[data-theme='light'\] \.clip-item/);
  assert.doesNotMatch(stylesCss, /#tab-clip \{/);
  assert.doesNotMatch(stylesCss, /\.clip-timeline-items \{/);
});

test('todo quadrant styles load outside the shell stylesheet', () => {
  assert.ok(html.indexOf('todo-quadrants.css') < html.indexOf('styles.css'));
  assert.match(todoQuadrantsCss, /\.sections \{/);
  assert.match(todoQuadrantsCss, /\.quadrant-header \{/);
  assert.match(todoQuadrantsCss, /\.todo-list \{/);
  assert.doesNotMatch(stylesCss, /\.quadrant-header \{/);
  assert.doesNotMatch(stylesCss, /\.todo-list::-webkit-scrollbar/);
});

test('notes page styles load outside the shell stylesheet', () => {
  assert.ok(html.indexOf('notes.css') < html.indexOf('styles.css'));
  assert.match(notesCss, /#tab-notes \{ min-height: 0; \}/);
  assert.match(notesCss, /\.notes-page \{/);
  assert.match(notesCss, /\.notes-list \{/);
  assert.match(notesCss, /\.notes-editor \{/);
  assert.doesNotMatch(stylesCss, /#tab-notes \{ min-height: 0; \}/);
  assert.doesNotMatch(stylesCss, /\.notes-page \{/);
  assert.doesNotMatch(stylesCss, /\.notes-editor \{/);
});

test('theme overrides load after all workbench module styles', () => {
  assert.ok(html.indexOf('theme.css') > html.indexOf('styles.css'));
  assert.match(themeCss, /:root\[data-theme='light'\] \{/);
  assert.match(themeCss, /:root\[data-theme='light'\] \.recording-library/);
  assert.match(themeCss, /:root\[data-theme='light'\] \.home-chat/);
  assert.doesNotMatch(stylesCss, /\/\* ============ 亮色主题 ============ \*\//);
});

test('platform overrides load after theme and shell styles', () => {
  assert.ok(html.indexOf('platform.css') > html.indexOf('theme.css'));
  assert.match(platformCss, /#app\[data-platform='win32'\]\.collapsed \.notch/);
  assert.match(platformCss, /#app\[data-platform='win32'\] \.panel::before/);
  assert.doesNotMatch(stylesCss, /Windows 没有物理刘海遮挡/);
  assert.doesNotMatch(stylesCss, /#app\[data-platform='win32'\] \.panel::before/);
});

test('light theme covers recording and clipboard surfaces', () => {
  assert.match(themeCss, /:root\[data-theme='light'\] \.recording-library/);
  assert.match(themeCss, /:root\[data-theme='light'\] \.recording-detail/);
  assert.match(themeCss, /:root\[data-theme='light'\] \.recording-transcript-editor/);
  assert.match(clipboardCss, /:root\[data-theme='light'\] \.clip-clear-btn/);
  assert.match(clipboardCss, /:root\[data-theme='light'\] \.clip-item/);
  assert.match(clipboardCss, /:root\[data-theme='light'\] \.clip-timeline-node/);
});

test('clipboard history renders a dated timeline with filtered result counts', () => {
  assert.match(html, /id="clip-result-count"/);
  assert.match(clipboardDomainJs, /groupByDay/);
  assert.match(clipboardControllerJs, /clip-timeline-group/);
  assert.match(clipboardDomainJs, /formatMoment/);
  assert.match(clipboardCss, /\.clip-timeline-group::before/);
  assert.match(clipboardCss, /\.clip-timeline-node/);
});
