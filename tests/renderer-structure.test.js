const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const financeIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'finance.js'), 'utf8');
const financeBackgroundJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'finance-background-refresh.js'), 'utf8');
const homeIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'home.js'), 'utf8');
const systemIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'system.js'), 'utf8');
const windowIpcJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc', 'window.js'), 'utf8');
const shortcutServiceJs = fs.readFileSync(path.join(__dirname, '..', 'main', 'shortcut-service.js'), 'utf8');
const launcherDomain = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'domain.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const clipboardDomainJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'clipboard-domain.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const workspaceWindowsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-windows.js'), 'utf8');
const workspaceCredentialsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace-credentials.js'), 'utf8');
const panelControllerJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'panel-controller.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const credentialsCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'credentials.css'), 'utf8');
const todoPlannerCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'todo-planner.css'), 'utf8');
const aiCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai.css'), 'utf8');
const aiJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'settings.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home.js'), 'utf8');
const homeCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'home.css'), 'utf8');
const financeJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance.js'), 'utf8');
const markdownJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'markdown.js'), 'utf8');
const chatContextJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat-context.js'), 'utf8');
const chatSessionsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat-sessions.js'), 'utf8');
const chatReaderJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat-reader.js'), 'utf8');

test('panel navigation is exposed by a dedicated controller through an injected host', () => {
  assert.ok(html.indexOf('app.js') < html.indexOf('panel-controller.js'));
  assert.match(appJs, /window\.NotchPanelHost\s*=/);
  assert.match(panelControllerJs, /window\.NotchPanel\s*=\s*Object\.freeze/);
  assert.match(panelControllerJs, /host\.navigate/);
  assert.doesNotMatch(appJs, /window\.NotchPanel\s*=\s*\{/);
});

test('current windows keep their domain state outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-windows.js') < html.indexOf('workspace.js'));
  assert.match(workspaceWindowsJs, /notchAPI\.listWindows/);
  assert.match(workspaceWindowsJs, /notchAPI\?\.focusWindow/);
  assert.match(workspaceWindowsJs, /notch-hidden-windows/);
  assert.match(workspaceWindowsJs, /window\.NotchWorkspaceWindows/);
  assert.doesNotMatch(workspaceJs, /function renderWindows\(/);
  assert.doesNotMatch(workspaceJs, /function refreshWindows\(/);
});

test('credential storage and selection state stay outside the workspace coordinator', () => {
  assert.ok(html.indexOf('workspace-credentials.js') < html.indexOf('workspace.js'));
  assert.match(workspaceCredentialsJs, /listCredentials/);
  assert.match(workspaceCredentialsJs, /saveCredential/);
  assert.match(workspaceCredentialsJs, /notch:clear-selection/);
  assert.match(workspaceCredentialsJs, /window\.NotchWorkspaceCredentials/);
  assert.doesNotMatch(workspaceJs, /function renderCredentials\(/);
  assert.doesNotMatch(workspaceJs, /credentialSelection/);
});

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
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

test('light theme covers weather surfaces and preserves weather accents', () => {
  assert.match(homeCss, /:root\[data-theme='light'\] \.home-weather/);
  assert.match(homeCss, /:root\[data-theme='light'\] \.weather-detail-hero/);
  assert.match(homeCss, /:root\[data-theme='light'\] \.weather-detail-section/);
  assert.match(homeCss, /:root\[data-theme='light'\] #home-weather-results/);
});

test('light theme covers recording and clipboard surfaces', () => {
  assert.match(stylesCss, /:root\[data-theme='light'\] \.recording-library/);
  assert.match(stylesCss, /:root\[data-theme='light'\] \.recording-detail/);
  assert.match(stylesCss, /:root\[data-theme='light'\] \.recording-transcript-editor/);
  assert.match(stylesCss, /:root\[data-theme='light'\] \.clip-clear-btn/);
  assert.match(stylesCss, /:root\[data-theme='light'\] \.clip-item/);
  assert.match(stylesCss, /:root\[data-theme='light'\] \.clip-timeline-node/);
});

test('clipboard history renders a dated timeline with filtered result counts', () => {
  assert.match(html, /id="clip-result-count"/);
  assert.match(clipboardDomainJs, /groupByDay/);
  assert.match(appJs, /clip-timeline-group/);
  assert.match(clipboardDomainJs, /formatMoment/);
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
  assert.match(todoPlannerCss, /\.todo-scope-control/);
  assert.match(stylesCss, /\.todo-completed-disclosure/);
  assert.doesNotMatch(appJs, /localStorage\.setItem\([^\n]*todo-time-scope/);
});

test('launcher loads the browser pinyin index before its shared search domain', () => {
  assert.ok(html.indexOf('pinyin-pro/dist/index.js') < html.indexOf('launcher/domain.js'));
  assert.match(launcherDomain, /pinyinPro\?\.pinyin/);
  assert.match(launcherDomain, /pattern: 'first'/);
});

test('global shortcuts expose configurable panel, launcher, screenshot, screen recording and audio actions', () => {
  for (const id of ['settings-shortcut-value', 'settings-launcher-shortcut-value', 'settings-screenshot-shortcut-value', 'settings-video-shortcut-value', 'settings-audio-shortcut-value']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(preloadJs, /setShortcut:.*settings:set-shortcut/);
  assert.match(preloadJs, /onAudioRecordingShortcut:.*shortcut:audio-recording/);
  assert.match(shortcutServiceJs, /onActionShortcut\(action\)/);
  assert.match(mainJs, /onActionShortcut: \(action\)/);
  assert.match(mainJs, /mode: 'video', region: true/);
  assert.match(mainJs, /captureService\.open\(request\)/);
  assert.match(workspaceJs, /settingsVideoShortcutChange/);
  assert.match(workspaceJs, /onAudioRecordingShortcut/);
  assert.match(workspaceJs, /await window\.NotchPanel\?\.navigate\(\{ tab: 'recordings' \}\)/);
  assert.match(appJs, /shortcutRecorderAction/);
  assert.match(appJs, /saveRecordedShortcut/);
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
  assert.match(windowIpcJs, /ipcMain\.on\('window:set-collapsed-hover'/);
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
  assert.match(appJs, /function applyNoteTabIndentation/);
  assert.match(appJs, /applyNoteTabIndentation\(editor, event\)/);
  assert.match(appJs, /notesTaxonomyTree\?\.addEventListener/);
  assert.match(appJs, /addEventListener\('paste'/);
  assert.match(appJs, /addEventListener\('drop'/);
  assert.match(appJs, /safeNoteImageReference/);
  assert.match(stylesCss, /\.notes-list \{[^}]*scrollbar-gutter:\s*stable[^}]*scrollbar-color:\s*transparent transparent/);
  assert.match(stylesCss, /\.notes-list:hover,\s*\.notes-list:focus-within \{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb-hover\)/);
  assert.match(stylesCss, /\.notes-list::-webkit-scrollbar-button \{[^}]*display:\s*none[^}]*width:\s*0[^}]*height:\s*0/);
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

test('home recent notes show category and tag while keeping inactive scrolling unobtrusive', () => {
  assert.match(html, /id="home-recent-summary"/);
  assert.match(homeJs, /category\.tags\.find\(\(item\) => item\.id === note\.tagId\)/);
  assert.match(homeJs, /className = 'home-note-tag'/);
  assert.match(homeCss, /\.home-note-rows \{[^}]*scrollbar-color:\s*transparent transparent/);
  assert.match(homeCss, /\.home-note-rows:hover, \.home-note-rows:focus-within/);
  assert.match(homeCss, /\.home-note-rows:focus-within::-webkit-scrollbar-thumb/);
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
    'home', 'todo', 'finance', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

test('finance IPC turns expected cancellation into a structured result', () => {
  assert.match(mainJs, /registerFinanceIpc\(/);
  assert.match(financeIpcJs, /async function handleFinanceRequest\(work\)/);
  assert.match(financeIpcJs, /error\?\.code === 'cancelled'/);
  assert.match(financeIpcJs, /error\?\.name === 'AbortError'/);
  assert.doesNotMatch(financeIpcJs, /\/cancel\/i/);
  assert.match(financeIpcJs, /finance:quotes.*handleFinanceRequest/);
  assert.match(financeJs, /const isCancelledFinanceResult/);
  assert.ok((financeJs.match(/isCancelledFinanceResult\(/g) || []).length >= 9);
});

test('finance is a provider-backed peer workspace with management isolated in settings', () => {
  assert.match(html, /data-tab="finance"/);
  assert.match(html, /id="tab-finance"/);
  assert.match(html, /id="finance-market-status"/);
  assert.match(html, /id="finance-overview-chart"/);
  assert.match(html, /id="finance-overview-market-summaries"/);
  assert.match(html, /id="finance-overview-cn"/);
  assert.match(html, /id="finance-overview-us"/);
  assert.match(html, /id="finance-overview-crypto"/);
  assert.match(html, /class="finance-market-mover-grid"/);
  assert.match(html, /id="finance-ai-analyze"/);
  assert.match(html, /id="finance-ai-result"/);
  assert.match(html, /id="finance-ai-scope"/);
  assert.match(html, /id="finance-ranking-list"/);
  assert.match(html, /id="finance-ranking-source"/);
  assert.match(html, /id="finance-ranking-title"/);
  assert.match(html, /id="finance-ranking-total"/);
  assert.match(html, /id="finance-ranking-spotlight"/);
  assert.match(html, /id="finance-ranking-pagination"/);
  assert.match(html, /id="finance-ranking-previous"/);
  assert.match(html, /id="finance-ranking-next"/);
  assert.match(html, /class="finance-ranking-summary"/);
  assert.match(html, /class="finance-ranking-spotlight-section"/);
  assert.match(financeJs, /finance-ranking-spotlight-card/);
  assert.match(financeJs, /data-finance-ranking-asset/);
  assert.match(financeJs, /openRankingAsset/);
  assert.match(financeJs, /finance-ranking-sparkline/);
  assert.match(financeJs, /market: 'all', source: state\.preferences\.defaultSource, sort: 'gainers'/);
  assert.match(financeJs, /market: 'all', source: state\.preferences\.defaultSource, sort: 'losers'/);
  assert.match(financeJs, /market: 'all', source: state\.preferences\.defaultSource, sort: 'volume'/);
  assert.match(financeJs, /data-finance-overview-asset/);
  assert.match(financeJs, /榜单已加载/);
  assert.match(financeJs, /openAssetDetail\(quote\)/);
  assert.match(financeJs, /Array\.isArray\(quote\.sparkline\) && quote\.sparkline\.length > 1/);
  assert.match(financeJs, /const OVERVIEW_MARKETS = Object\.freeze\(\[[\s\S]*?market: 'cn'[\s\S]*?market: 'us'[\s\S]*?market: 'crypto'/);
  assert.match(financeJs, /function overviewMarkets\(result\)/);
  assert.match(financeJs, /overviewMarkets\(result\)\.map/);
  assert.match(financeJs, /RANKING_PAGE_SIZE = 50/);
  assert.match(financeJs, /rankingPage/);
  assert.match(financeJs, /rememberRanking/);
  assert.match(financeJs, /function rankingSourceFor/);
  assert.match(financeJs, /sort === 'market_cap'.*source === 'binance'.*'coingecko'/);
  assert.match(financeJs, /value === null \|\| value === undefined/);
  assert.match(financeJs, /JSON\.stringify\(parsed\) !== JSON\.stringify\(normalized\).*localStorage\.setItem\(PREFERENCES_KEY/);
  assert.match(financeJs, /只统计 provider 返回结果/);
  assert.match(html, /id="finance-list-select"/);
  assert.match(html, /class="finance-watchlist-workspace"/);
  assert.match(html, /id="finance-quotes"/);
  assert.match(html, /id="finance-detail"/);
  assert.doesNotMatch(html, /class="finance-sidebar"/);
  assert.doesNotMatch(html, /id="finance-watchlists"/);
  assert.doesNotMatch(html, /id="finance-search"/);
  assert.doesNotMatch(html, /id="finance-add-list"/);

  assert.match(html, /id="finance-settings-asset-search"/);
  assert.match(html, /id="finance-settings-target-list"/);
  assert.match(html, /id="finance-settings-watchlists"/);
  assert.match(html, /id="finance-settings-default-view"/);
  assert.match(html, /id="finance-settings-default-source"/);
  assert.match(html, /class="finance-settings-nav"/);
  assert.match(html, /data-finance-settings-tab="crypto"/);
  assert.match(html, /<\/section>\s*<\/div>\s*<div class="finance-settings-preferences"/);
  assert.doesNotMatch(html, /<\/section>\s*<\/div>\s*<\/div>\s*<div class="finance-settings-preferences"/);
  assert.doesNotMatch(html, /data-finance-market="binance"/);
  assert.match(html, /id="finance-coingecko-key"[^>]*type="password"/);
  assert.match(html, /id="finance-binance-enabled"/);
  assert.match(html, /id="finance-alpha-vantage-key"[^>]*type="password"/);
  assert.match(html, /id="finance-alpaca-secret"[^>]*type="password"/);
  assert.match(html, /id="finance-twelve-data-key"[^>]*type="password"/);
  assert.match(html, /id="finance-sec-edgar-contact"[^>]*type="email"/);
  assert.match(html, /id="finance-quantdash-key"[^>]*type="password"/);
  assert.match(html, /id="finance-quantdash-enabled"/);
  assert.match(html, /id="finance-tencent-enabled"/);
  assert.match(html, /id="finance-eastmoney-enabled"/);
  assert.match(html, /id="finance-sina-enabled"/);
  assert.doesNotMatch(html, /id="finance-tushare-/);
  assert.match(html, /data-finance-provider-save="cn-stock"/);
  assert.match(html, /data-finance-provider-test="coingecko"/);
  assert.match(html, /data-finance-provider-test="binance"/);
  assert.match(html, /data-finance-provider-test="alpha-vantage"/);
  assert.match(html, /data-finance-provider-test="twelve-data"/);
  assert.match(html, /data-finance-provider-test="sec-edgar"/);
  assert.match(html, /data-finance-provider-test="cn-stock"/);
  assert.match(html, /data-finance-provider-save="cn-tencent"/);
  assert.match(html, /data-finance-provider-save="cn-eastmoney"/);
  assert.match(html, /data-finance-provider-save="cn-sina"/);
  assert.match(html, /data-finance-provider-capabilities="cn-stock"/);
  assert.match(html, /CN_Stock|标的池/);
  assert.match(html, /市值榜暂不提供/);
  assert.match(financeJs, /market_cap_not_supported/);
  assert.match(financeJs, /asset_search_symbol_only/);
  assert.match(financeJs, /capabilities\.fullMarket/);
  assert.match(settingsJs, /id:'finance'[\s\S]*?selector:'\.settings-finance-card'/);

  assert.match(financeJs, /notch-finance-view-preferences-v1/);
  assert.match(financeJs, /searchFinanceAssets/);
  assert.match(financeJs, /getFinanceQuotes/);
  assert.match(financeJs, /getFinanceHistory/);
  assert.match(financeJs, /getFinanceFundamentals/);
  assert.match(financeJs, /SEC 申报基本面/);
  assert.match(financeJs, /cancelFinanceRequests/);
  assert.match(financeJs, /runAI/);
  assert.match(financeJs, /financeInterpretation/);
  assert.match(financeJs, /renderFinanceInterpretation/);
  assert.match(financeJs, /retainFinanceInterpretation/);
  assert.match(financeJs, /正在生成新解读，显示上次解读/);
  assert.match(financeJs, /行情已更新，显示上次解读/);
  assert.match(financeJs, /financeSnapshotRevision/);
  assert.match(financeJs, /drawChart/);
  assert.doesNotMatch(financeJs, /renderBars/);
  assert.doesNotMatch(financeJs, /const ASSETS\s*=/);
  assert.doesNotMatch(financeJs, /Math\.(?:random|sin)/);
  assert.match(preloadJs, /getFinanceOverview/);
  assert.match(preloadJs, /getFinanceHistory/);
  assert.match(preloadJs, /getFinanceFundamentals/);
  assert.match(preloadJs, /cancelFinanceRequest/);
  assert.match(preloadJs, /setFinanceProvider/);
  assert.match(preloadJs, /setFinanceRefreshInterval/);
  assert.match(preloadJs, /onFinanceUpdate/);
  assert.match(financeJs, /setFinanceActivity/);
  assert.match(financeJs, /financeStartupReady/);
  assert.match(financeJs, /startupPrefetchRequested/);
  assert.match(financeJs, /prefetch: startupPrefetch/);
  assert.match(financeJs, /const startupPrefetch = !state\.startupPrefetchRequested;/);
  assert.doesNotMatch(financeJs, /!state\.startupPrefetchRequested && state\.preferences\.refreshSeconds > 0/);
  assert.match(financeJs, /onFinanceUpdate/);
  assert.match(financeJs, /Startup prefetch often completes while the workspace is collapsed/);
  assert.doesNotMatch(financeJs, /if \(!state\.financeActive\) return;\s*if \(state\.currentView === 'overview'\) renderOverview\(\);/);
  assert.match(financeJs, /后台更新中/);
  assert.doesNotMatch(financeJs, /refreshTimer/);
  assert.match(mainJs, /createFinanceService/);
  assert.match(mainJs, /refreshFinanceBackground/);
  assert.match(mainJs, /createFinanceBackgroundRefresh/);
  assert.doesNotMatch(mainJs, /clearFinanceBackgroundTimer/);
  assert.match(financeBackgroundJs, /allowInactive/);
  assert.match(financeBackgroundJs, /startupPrefetch/);
  assert.match(financeBackgroundJs, /if \(startupPrefetch\) void refresh\(\{ allowInactive: true \}\)/);
  assert.match(financeBackgroundJs, /interval \* 1000/);
  assert.match(mainJs, /finance:update/);
  assert.match(financeBackgroundJs, /Background refresh .* completed with issues/);
  assert.match(financeBackgroundJs, /Background refresh .* failed/);
  assert.match(mainJs, /api\.binance\.com/);
  assert.match(mainJs, /alphavantage\.co/);
  assert.match(mainJs, /api\.twelvedata\.com/);
  assert.match(mainJs, /data\.sec\.gov/);
  assert.match(mainJs, /api\.quantdash\.net/);
  assert.match(mainJs, /QUANTDASH_API_KEY/);
  assert.doesNotMatch(mainJs, /api\.tushare\.pro/);
  assert.doesNotMatch(mainJs, /TUSHARE_API_TOKEN/);
  assert.match(mainJs, /FINANCE_FETCH_MAX_REQUEST_BYTES/);
  assert.match(mainJs, /method === 'POST'/);
  assert.match(financeIpcJs, /finance:history/);
  assert.match(financeIpcJs, /finance:fundamentals/);
  assert.match(financeIpcJs, /finance:cancel/);
  assert.match(mainJs, /safeStorage\.encryptString\(apiKey\)/);
  assert.match(mainJs, /encryptedApiKey/);
  assert.match(financeIpcJs, /capabilities: result\.ok && result\.capabilities/);
  assert.match(mainJs, /finance: true/);
  assert.match(appJs, /'finance'/);
});

test('home quick capture routes notes and links through explicit modes', () => {
  assert.match(html, /data-home-capture-mode="auto"[^>]*aria-pressed="true"/);
  assert.match(html, /data-home-capture-mode="note"/);
  assert.match(html, /data-home-capture-mode="link"/);
  assert.match(homeJs, /NotchDomain\.classifyHomeCapture/);
  assert.match(homeJs, /NotchWorkspace\?\.saveCapturedLink/);
  assert.match(homeJs, /NotchNotes\.saveCaptured/);
  assert.match(appJs, /async saveCaptured\(content\)[\s\S]*?requestNoteTitle\(result\.note\)/);
  assert.match(workspaceJs, /async saveCapturedLink\(rawValue\)/);
});

test('editable fields receive a native context menu without collapsing the panel', () => {
  assert.match(mainJs, /webContents\.on\('context-menu'/);
  assert.match(mainJs, /editableContextMenuTemplate\(params\.editFlags\)/);
  assert.match(mainJs, /transientSystemInteractionRequests\+\+/);
  assert.match(mainJs, /menu\.popup\(\{ window: owner, callback: release \}\)/);
});

test('home chat exposes temporary-session state, recovery controls and safe markdown', () => {
  assert.match(html, /id="home-chat-empty"/);
  assert.match(html, /id="home-chat-provider"/);
  assert.match(html, /id="home-chat-model-name"/);
  assert.match(html, /id="home-chat-new"[^>]*aria-label="新建对话"/);
  assert.match(html, /id="home-chat-session-save"[^>]*aria-label="保存到当前工作区"/);
  assert.match(html, /id="home-chat-sessions"[^>]*aria-controls="home-chat-session-panel"/);
  assert.match(html, /id="home-chat-session-panel"[^>]*role="dialog"/);
  assert.match(html, /id="home-chat-session-confirm-save"[^>]*hidden/);
  assert.match(html, /id="home-chat-reader"[^>]*role="region"/);
  assert.doesNotMatch(html, /id="home-chat-reader"[^>]*aria-modal/);
  assert.match(html, /id="home-chat-reader-outline"/);
  assert.match(html, /id="home-chat-reader-copy-selection"[^>]*disabled/);
  assert.match(html, /id="home-chat-reader-todos"/);
  assert.match(html, /id="home-chat-context-picker"[^>]*role="dialog"/);
  assert.match(html, /id="home-chat-context-add"[^>]*aria-expanded="false"/);
  assert.match(html, /data-chat-context-type="note"/);
  assert.match(html, /data-chat-context-type="recording"/);
  assert.match(html, /data-chat-context-type="todo"/);
  assert.match(html, /data-chat-context-type="link"/);
  assert.match(html, /data-chat-context-type="clipboard"/);
  assert.match(html, /script src="chat-context\.js"/);
  assert.match(html, /script src="chat-sessions\.js"/);
  assert.match(html, /script src="chat-reader\.js"/);
  assert.match(html, /script src="markdown\.js"/);
  assert.match(chatContextJs, /MAX_SOURCES = 3/);
  assert.match(chatSessionsJs, /STORAGE_KEY = 'notch-ai-chat-sessions-v1'/);
  assert.match(chatSessionsJs, /MAX_SESSIONS = 30/);
  assert.match(chatSessionsJs, /MAX_SESSION_CHARS = 512000/);
  assert.match(chatSessionsJs, /MAX_TOTAL_CHARS = 2000000/);
  assert.match(chatReaderJs, /MIN_LONG_CHARS = 600/);
  assert.match(chatReaderJs, /MAX_TODO_SOURCE_CHARS = 12000/);
  assert.match(chatContextJs, /用户显式选择的本地参考资料/);
  assert.match(markdownJs, /window\.NotchMarkdown = \{ render \}/);
  assert.match(markdownJs, /code\.textContent = codeText/);
  assert.doesNotMatch(markdownJs, /container\.innerHTML\s*=/);
  assert.match(mainJs, /registerSystemIpc\(/);
  assert.match(systemIpcJs, /ipcMain\.handle\('shell:openExternal',[\s\S]*?validatePublicHttpUrl\(value\)/);
  assert.match(homeJs, /setTurnState\(turn, 'stopped'/);
  assert.match(homeJs, /setTurnState\(turn, 'error'/);
  assert.match(homeJs, /NotchNotes\?\.saveGenerated/);
  assert.match(homeJs, /NotchNotes\?\.chatContexts/);
  assert.match(homeJs, /NotchWorkspace\?\.chatContexts/);
  assert.match(homeJs, /NotchTodo\?\.chatContexts/);
  assert.match(homeJs, /NotchClipboard\?\.chatContexts/);
  assert.match(homeJs, /context: \{ sourceType: 'manual', text, sources \}/);
  assert.match(homeJs, /persistCurrentSession\(\{ create: true \}\)/);
  assert.match(homeJs, /ChatSessions\.searchSessions/);
  assert.match(homeJs, /ChatSessions\.renameSession/);
  assert.match(homeJs, /ChatSessions\.removeSession/);
  assert.match(homeJs, /ChatReader\.todoSource/);
  assert.match(homeJs, /function openReader\(turn\)/);
  assert.match(homeJs, /toggleTurnNote\(readerTurn\)/);
  assert.match(homeJs, /window\.NotchChatReaderView = Object\.freeze/);
  assert.match(appJs, /NotchChatReaderView\?\.handleEscape\(\)/);
  assert.match(aiJs, /returnFocus = active instanceof HTMLElement/);
  assert.doesNotMatch(homeJs, /pendingReply\?\.remove|pendingUser\?\.remove/);
});

test('home music is app-owned and switches local, HTTPS and go-music-dl playlists', () => {
  assert.match(html, /id="home-music-audio"/);
  assert.match(html, /data-home-media="shuffle"/);
  assert.match(homeJs, /MUSIC_SHUFFLE_KEY/);
  assert.match(homeJs, /shuffledMusicTrack/);
  assert.match(html, /id="home-media-cover"/);
  assert.match(html, /id="home-media-discover"/);
  assert.match(html, /id="home-media-discovery"/);
  assert.match(html, /id="home-media-source-select"/);
  assert.match(html, /class="music-settings-modebar"/);
  assert.match(html, /id="home-media-platform-select"/);
  assert.match(html, /id="home-media-online-results"/);
  assert.match(html, /class="links-layout"/);
  assert.match(html, /class="links-sidebar"/);
  assert.match(html, /data-links-sidebar-view="favorite"/);
  assert.match(html, /id="links-sidebar-groups"/);
  assert.match(html, /id="links-sidebar-tags"/);
  assert.match(html, /class="links-page-head"/);
  assert.match(html, /class="links-capture-bar"/);
  assert.match(html, /id="links-add-submit"/);
  assert.match(html, /class="links-search-wrap"/);
  assert.match(html, /id="links-view-filter"/);
  assert.match(html, /id="links-tag-filter"/);
  assert.match(html, /搜索标题、网址、描述或标签/);
  assert.match(html, /img-src 'self' data: blob:/);
  assert.match(html, /data-music-catalog-view="mine"/);
  assert.match(html, /data-music-catalog-view="discover"/);
  assert.match(html, /id="home-media-library"[^>]*aria-label="打开音乐库"/);
  assert.match(html, /id="home-media-queue"/);
  assert.match(html, /id="home-media-queue-label"/);
  assert.match(html, /id="music-source-select"/);
  assert.match(html, /id="music-playlist-select"/);
  assert.match(html, /id="music-platform-select"/);
  assert.match(html, /id="music-category-select"/);
  assert.match(html, /id="music-playlist-search-form"/);
  assert.match(html, /id="music-online-results"/);
  assert.match(homeCss, /\.music-online-results \{[^}]*min-height: 160px; max-height: 360px/);
  assert.match(html, /id="music-source-form"/);
  assert.match(html, /id="music-local-add-folder"/);
  assert.match(html, /id="music-volume"[^>]*type="range"/);
  assert.match(settingsJs, /id:'music'/);
  for (const api of ['getHomeMusicLibrary', 'setHomeMusicMode', 'selectHomeMusicPlaylist', 'refreshHomeMusicSource', 'addHomeMusicSource', 'removeHomeMusicSource', 'browseHomeMusicCategories', 'searchHomeMusicPlaylists', 'browseHomeMusicCategory', 'browseHomeMusicRecommend', 'browseHomeMusicUserPlaylists', 'selectHomeMusicOnlinePlaylist', 'loadHomeMusicCover', 'chooseHomeMusicFiles', 'chooseHomeMusicFolder', 'addHomeMusicUrl', 'removeHomeMusicTrack', 'loadHomeMusicTrack']) assert.match(preloadJs, new RegExp(api));
  for (const channel of ['home:music-library', 'home:music-mode', 'home:music-select-playlist', 'home:music-refresh-source', 'home:music-add-source', 'home:music-remove-source', 'home:music-browse-categories', 'home:music-search-playlists', 'home:music-browse-category', 'home:music-browse-recommend', 'home:music-browse-user-playlists', 'home:music-select-online-playlist', 'home:music-cover', 'home:music-choose-files', 'home:music-choose-folder', 'home:music-add-network', 'home:music-remove', 'home:music-load']) assert.match(homeIpcJs, new RegExp(channel));
  assert.match(homeJs, /URL\.createObjectURL/);
  assert.match(homeJs, /loadHomeMusicCover\?\.\(reference\)/);
  assert.match(homeJs, /browseHomeMusicCategories/);
  assert.match(homeJs, /browseHomeMusicUserPlaylists/);
  assert.match(homeJs, /home-media-discovery/);
  assert.match(homeJs, /homeDiscoverySource/);
  assert.match(homeJs, /ensureHomeMusicCategories/);
  assert.match(homeJs, /ensureMusicSettingsCategories/);
  assert.match(homeJs, /notch:settings-category-change/);
  assert.match(homeJs, /MUSIC_DISCOVERY_FILTER_KEY/);
  assert.match(homeJs, /saveMusicDiscoveryFilter/);
  assert.match(workspaceJs, /parseLinkQuery/);
  assert.match(workspaceJs, /toggle-link-favorite/);
  assert.match(workspaceJs, /toggle-link-read/);
  assert.match(workspaceJs, /link\.description/);
  assert.match(aiJs, /ai-metadata-tags/);
  assert.match(homeJs, /settingsPlaylists = musicCatalogView === 'mine'/);
  assert.match(homeJs, /home-media-progress'\)\.hidden = !activeMusicTrack\(\)/);
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
  assert.match(workspaceWindowsJs, /NotchHome\?\.isVisible/);
});
