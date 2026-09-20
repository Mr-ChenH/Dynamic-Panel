const test = require('node:test');
const assert = require('node:assert/strict');

const domain = require('../renderer/domain');
const {
  createCommand,
  createRecording,
  removeRecordingState,
  calculateRecordingDuration,
  completionMatchesWindow,
  deriveWindowDisplayName,
  numberWindowLabels,
  createTodo,
  updateTodo,
  currentMonthDeadline,
  calendarDeadline,
  shiftCalendarMonth,
  defaultTodoDeadline,
  normalizeTodoCategoryNames,
  migrateTodoCategoryNames,
  calculateAudioLevel,
  resampleFloat32ToPcm16,
  shouldTogglePanelForSpace,
  todoTimeBattery,
  updateRangeSelection,
  sortTodosForDisplay,
  todoTimeBoundaries,
  todoTimeBucket,
  filterTodosByTimeScope,
  todoTimeScopeCounts,
  defaultTodoDeadlineForScope,
  filterCredentials,
  credentialRowAction,
  visiblePanelTabs,
  resolveDefaultPanelTab,
  settingsSummary,
  adjustNoteIndentation,
  normalizeNoteArchive,
  normalizeNoteCategoryName,
  normalizeNoteTags,
  normalizeNoteCategories,
  filterNotes,
  updateNoteInArchive,
  updateNoteCategory,
  updateNoteTag,
  removeNoteCategory,
  removeNoteTag,
  updateNoteTitle,
  applyGeneratedNoteTitle,
  apiCredentialStatuses,
  createExclusiveAsyncTask,
} = domain;

test('an exclusive async task coalesces repeated starts until the first attempt settles', async () => {
  let release;
  let attempts = 0;
  const pendingStates = [];
  const task = createExclusiveAsyncTask((pending) => pendingStates.push(pending));
  const work = () => {
    attempts += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = task.run(work);
  const second = task.run(work);

  assert.equal(task.isPending(), true);
  assert.strictEqual(second, first);
  assert.equal(attempts, 1);
  assert.deepEqual(pendingStates, [true]);

  release('started');
  assert.equal(await first, 'started');
  assert.equal(task.isPending(), false);
  assert.deepEqual(pendingStates, [true, false]);

  assert.equal(await task.run(async () => {
    attempts += 1;
    return 'started-again';
  }), 'started-again');
  assert.equal(attempts, 2);
});

test('createCommand and createRecording normalize user-authored metadata', () => {
  assert.deepEqual(createCommand('  npm test  ', 'c1', 100), {
    id: 'c1',
    text: 'npm test',
    createdAt: 100,
  });
  assert.equal(createCommand('   ', 'c2', 100), null);
  const recording = createRecording({
    id: 'r1',
    createdAt: 200,
    durationMs: 1234.8,
    transcript: '  第一段录音  ',
    audioPath: '/tmp/r1.webm',
    mimeType: 'audio/webm',
  });
  assert.equal(recording.id, 'r1');
  assert.equal(recording.transcript, '第一段录音');
  assert.notEqual(recording.title, recording.transcript);
  assert.equal(recording.category, '未分类');
});

test('single recording deletion removes only its row and keeps a valid active recording', () => {
  const recordings = [
    { id: 'first', title: '第一条' },
    { id: 'second', title: '第二条' },
    { id: 'third', title: '第三条' },
  ];
  assert.deepEqual(removeRecordingState(recordings, 'second', ['first', 'second'], 'second'), {
    recordings: [recordings[0], recordings[2]],
    selection: ['first'],
    selectedId: 'third',
  });
  assert.deepEqual(removeRecordingState(recordings, 'third', [], 'first'), {
    recordings: [recordings[0], recordings[1]],
    selection: [],
    selectedId: 'first',
  });
});

test('completionMatchesWindow distinguishes projects across VS Code windows', () => {
  const completion = { project: '灵动岛', title: '链接页已完成' };
  assert.equal(completionMatchesWindow(completion, {
    appName: 'Visual Studio Code',
    title: '灵动岛 — main.js — Visual Studio Code',
  }), true);
  assert.equal(completionMatchesWindow(completion, {
    appName: 'Visual Studio Code',
    title: 'website — page.tsx — Visual Studio Code',
  }), false);
});

test('calculateRecordingDuration does not double subtract an active pause', () => {
  assert.equal(calculateRecordingDuration({
    startedAt: 1000,
    status: 'recording',
    pausedAt: 0,
    pausedTotalMs: 2000,
    now: 11000,
  }), 8000);
  assert.equal(calculateRecordingDuration({
    startedAt: 1000,
    status: 'paused',
    pausedAt: 6000,
    pausedTotalMs: 0,
    now: 8000,
  }), 5000);
});

test('window labels expose VS Code workspace names instead of app sequence numbers', () => {
  assert.deepEqual(numberWindowLabels([
    { appName: 'Code', id: 'a', title: 'main.js — 灵动岛 — Visual Studio Code' },
    { appName: 'WeChat', id: 'b' },
    { appName: 'Code', id: 'c', title: 'Lollipop-Test' },
  ]).map((item) => item.displayName), ['灵动岛', 'WeChat', 'Lollipop-Test']);
});

test('window labels disambiguate duplicate workspace names without losing their identity', () => {
  assert.equal(deriveWindowDisplayName({ appName: 'Cursor', title: 'README.md — CourseKit — Cursor' }), 'CourseKit');
  assert.deepEqual(numberWindowLabels([
    { appName: 'Code', id: 'a', title: '灵动岛' },
    { appName: 'Code', id: 'b', title: '灵动岛' },
  ]).map((item) => item.displayName), ['灵动岛 · 1', '灵动岛 · 2']);
});

test('multiple browser windows use page titles instead of generic app numbers', () => {
  assert.deepEqual(numberWindowLabels([
    { appName: 'Arc', id: 'a', title: '阿里云百炼控制台 — Arc' },
    { appName: 'Arc', id: 'b', title: 'NotchTodo 设计稿 — Arc' },
  ]).map((item) => item.displayName), ['阿里云百炼控制台', 'NotchTodo 设计稿']);
});

test('createTodo requires a valid DDL and preserves reminder metadata', () => {
  assert.equal(createTodo('没有截止时间', '', 't0', 100), null);
  assert.equal(createTodo('日期无效', 'not-a-date', 't0', 100), null);
  assert.deepEqual(createTodo('  发布新版  ', '2026-08-22T10:30:00.000Z', 't1', 100), {
    id: 't1',
    text: '发布新版',
    done: false,
    createdAt: 100,
    deadline: '2026-08-22T10:30:00.000Z',
    remindedAt: 0,
  });
});

test('todo editor updates text and deadline while keeping completion state', () => {
  const original = { ...createTodo('旧标题', '2026-08-22T10:30:00.000Z', 't1', 100), done: true, remindedAt: 88 };
  const updated = updateTodo(original, '新标题', '2026-08-23T09:00:00.000Z');
  assert.equal(updated.id, 't1');
  assert.equal(updated.text, '新标题');
  assert.equal(updated.done, true);
  assert.equal(updated.remindedAt, 0);
  const localDeadline = new Date(currentMonthDeadline(
    { day: 21, hour: 14, minute: 30 },
    new Date(2026, 7, 1, 0, 0, 0, 0),
  ));
  assert.deepEqual([
    localDeadline.getFullYear(),
    localDeadline.getMonth(),
    localDeadline.getDate(),
    localDeadline.getHours(),
    localDeadline.getMinutes(),
  ], [2026, 7, 21, 14, 30]);
  assert.equal(currentMonthDeadline(
    { day: 32, hour: 14, minute: 30 },
    new Date(2026, 7, 1, 0, 0, 0, 0),
  ), null);
});

test('todo calendar month navigation crosses year boundaries in both directions', () => {
  assert.equal(typeof shiftCalendarMonth, 'function', 'shiftCalendarMonth must exist');
  assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftCalendarMonth({ year: 2027, month: 0 }, -1), { year: 2026, month: 11 });
});

test('todo deadline uses the calendar month being viewed instead of the current month', () => {
  assert.equal(typeof calendarDeadline, 'function', 'calendarDeadline must exist');
  const deadline = new Date(calendarDeadline({
    year: 2027,
    month: 0,
    day: 2,
    hour: 23,
    minute: 30,
  }));
  assert.deepEqual([
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
    deadline.getHours(),
    deadline.getMinutes(),
  ], [2027, 0, 2, 23, 30]);
  assert.equal(calendarDeadline({ year: 2027, month: 1, day: 29, hour: 23, minute: 30 }), null);
});

test('default todo deadline stays on the current local day, including after 23:30', () => {
  const daytime = new Date(2026, 7, 28, 9, 15, 0, 0);
  const sameDayDeadline = new Date(defaultTodoDeadline(daytime));
  assert.deepEqual([
    sameDayDeadline.getFullYear(),
    sameDayDeadline.getMonth(),
    sameDayDeadline.getDate(),
    sameDayDeadline.getHours(),
    sameDayDeadline.getMinutes(),
  ], [2026, 7, 28, 23, 30]);

  const afterCutoff = new Date(2026, 7, 31, 23, 31, 0, 0);
  const sameDayAfterCutoff = new Date(defaultTodoDeadline(afterCutoff));
  assert.deepEqual([
    sameDayAfterCutoff.getFullYear(),
    sameDayAfterCutoff.getMonth(),
    sameDayAfterCutoff.getDate(),
    sameDayAfterCutoff.getHours(),
    sameDayAfterCutoff.getMinutes(),
  ], [2026, 7, 31, 23, 30]);
});

test('todos sort unfinished by DDL and creation time with completed items last', () => {
  const rows = sortTodosForDisplay([
    { id: 'done', done: true, deadline: '2026-08-20T00:00:00.000Z', createdAt: 1 },
    { id: 'late', done: false, deadline: '2026-08-22T00:00:00.000Z', createdAt: 2 },
    { id: 'early-new', done: false, deadline: '2026-08-21T00:00:00.000Z', createdAt: 3 },
    { id: 'early-old', done: false, deadline: '2026-08-21T00:00:00.000Z', createdAt: 1 },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ['early-old', 'early-new', 'late', 'done']);
});

test('todo time scopes use local day and Monday week boundaries without overlap', () => {
  const now = new Date(2026, 8, 9, 12, 0, 0, 0);
  const at = (day, hour = 23) => new Date(2026, 8, day, hour, 0, 0, 0).toISOString();
  const items = [
    { id: 'overdue', done: false, deadline: at(8) },
    { id: 'today', done: false, deadline: at(9) },
    { id: 'week', done: false, deadline: at(13) },
    { id: 'later', done: false, deadline: at(14) },
    { id: 'done-today', done: true, deadline: at(9) },
    { id: 'done-past', done: true, deadline: at(8) },
    { id: 'unscheduled', done: false, deadline: '' },
  ];

  const boundaries = todoTimeBoundaries(now);
  assert.equal(new Date(boundaries.startNextWeek).getDay(), 1);
  assert.equal(todoTimeBucket(items[0], now), 'overdue');
  assert.equal(todoTimeBucket(items[5], now), 'past');
  assert.deepEqual(filterTodosByTimeScope(items, 'today', now).map((item) => item.id), [
    'overdue', 'today', 'done-today',
  ]);
  assert.deepEqual(filterTodosByTimeScope(items, 'week', now).map((item) => item.id), ['week']);
  assert.deepEqual(filterTodosByTimeScope(items, 'later', now).map((item) => item.id), ['later']);
  assert.equal(filterTodosByTimeScope(items, 'all', now).length, items.length);
  assert.deepEqual(todoTimeScopeCounts(items, now), {
    today: 2,
    week: 1,
    later: 1,
    all: 5,
    overdue: 1,
    unscheduled: 1,
  });
});

test('todo scope defaults stay visible in their selected range', () => {
  const wednesday = new Date(2026, 8, 9, 12, 0, 0, 0);
  const sunday = new Date(2026, 8, 13, 12, 0, 0, 0);
  assert.equal(todoTimeBucket({ deadline: defaultTodoDeadlineForScope('today', wednesday) }, wednesday), 'today');
  assert.equal(todoTimeBucket({ deadline: defaultTodoDeadlineForScope('week', wednesday) }, wednesday), 'week');
  assert.equal(todoTimeBucket({ deadline: defaultTodoDeadlineForScope('later', wednesday) }, wednesday), 'later');
  assert.equal(defaultTodoDeadlineForScope('week', sunday), null);
  const lateNight = new Date(2026, 8, 9, 23, 45, 0, 0);
  const lateNightDefault = new Date(defaultTodoDeadlineForScope('today', lateNight));
  assert.equal(lateNightDefault.getDate(), lateNight.getDate());
  assert.ok(lateNightDefault > lateNight);
});

test('credential search matches service or account without exposing passwords', () => {
  const rows = [
    { id: 'github', service: 'GitHub', account: 'hello@example.com', passwordMask: '********' },
    { id: 'feishu', service: '飞书', account: '13800000000', passwordMask: '********' },
  ];
  assert.deepEqual(filterCredentials(rows, 'GITHUB').map((row) => row.id), ['github']);
  assert.deepEqual(filterCredentials(rows, 'example').map((row) => row.id), ['github']);
  assert.deepEqual(filterCredentials(rows, '').map((row) => row.id), ['github', 'feishu']);
});

test('credential row routes its trailing action to delete while its body still opens editing', () => {
  assert.equal(typeof credentialRowAction, 'function', 'credentialRowAction must exist');
  assert.deepEqual(credentialRowAction({ requestedAction: 'delete' }), {
    type: 'delete',
    label: '删除',
    ariaLabel: '删除密钥',
  });
  assert.deepEqual(credentialRowAction({ copyField: 'account' }), { type: 'copy', field: 'account' });
  assert.deepEqual(credentialRowAction({ rowBody: true }), { type: 'edit' });
  assert.deepEqual(credentialRowAction({ rowBody: true, shiftKey: true }), { type: 'select' });
  assert.deepEqual(credentialRowAction({ rowBody: true, selected: true }), { type: 'select' });
});

test('settings stays at the far right when optional tabs are hidden', () => {
  assert.equal(typeof visiblePanelTabs, 'function', 'visiblePanelTabs must exist');
  const tabs = ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'];
  assert.deepEqual(visiblePanelTabs(tabs, { todo: false, clip: true }), [
    'home', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.deepEqual(visiblePanelTabs(tabs, {
    todo: false,
    notes: false,
    links: false,
    recordings: false,
    credentials: false,
    clip: false,
    settings: false,
  }), ['home', 'settings']);
});

test('default panel tab uses the preference only while that tab is visible', () => {
  assert.equal(resolveDefaultPanelTab('todo', ['home', 'todo', 'settings']), 'todo');
  assert.equal(resolveDefaultPanelTab('todo', ['home', 'settings']), 'home');
  assert.equal(resolveDefaultPanelTab('unknown', ['home', 'settings']), 'home');
});

test('settings summary combines safe API status with local device settings', () => {
  assert.equal(typeof settingsSummary, 'function', 'settingsSummary must exist');
  assert.deepEqual(settingsSummary({
    appSettings: { shortcut: 'Command+Shift+P', autoLaunch: true },
    workspace: { path: '/Users/test/Panel', portable: true },
    transcription: { configured: true, llmConfigured: false },
  }), {
    shortcut: 'Command+Shift+P',
    defaultTab: 'home',
    autoLaunch: true,
    workspacePath: '/Users/test/Panel',
    workspaceLabel: '自定义文件夹',
    transcription: { label: '已安全保存', state: 'saved' },
    llm: { label: '未配置', state: 'empty' },
  });
  assert.doesNotMatch(JSON.stringify(settingsSummary({
    transcription: { configured: true, apiKey: 'api-secret' },
  })), /api-secret/);
});

test('note Tab indentation edits text without moving focus out of the editor', () => {
  assert.deepEqual(adjustNoteIndentation('alpha', 2, 2), {
    value: 'al  pha',
    replaceStart: 2,
    replaceEnd: 2,
    replacement: '  ',
    selectionStart: 4,
    selectionEnd: 4,
  });

  const indented = adjustNoteIndentation('- one\n- two\ntext', 0, 11);
  assert.equal(indented.value, '  - one\n  - two\ntext');
  assert.deepEqual([indented.selectionStart, indented.selectionEnd], [2, 15]);

  const outdented = adjustNoteIndentation('  - one\n\t- two\ntext', 0, 14, true);
  assert.equal(outdented.value, '- one\n- two\ntext');
  assert.deepEqual([outdented.selectionStart, outdented.selectionEnd], [0, 11]);

  const currentLine = adjustNoteIndentation('before\n  item\nafter', 11, 11, true);
  assert.equal(currentLine.value, 'before\nitem\nafter');
  assert.deepEqual([currentLine.selectionStart, currentLine.selectionEnd], [9, 9]);

  const unchanged = adjustNoteIndentation('item', 2, 2, true);
  assert.equal(unchanged.value, 'item');
  assert.deepEqual([unchanged.selectionStart, unchanged.selectionEnd], [2, 2]);
});

test('saved notes preserve cleared content and keep recently updated notes first', () => {
  const notes = normalizeNoteArchive([
    { id: 'older', title: '产品复盘', titleSource: 'model', content: '  # 旧笔记\n正文  ', createdAt: 100, updatedAt: 200 },
    { id: 'newer', content: '新笔记', createdAt: 300, updatedAt: 400 },
    { id: 'empty', content: '', createdAt: 500, updatedAt: 500 },
    null,
  ]);
  assert.deepEqual(notes.map((note) => note.id), ['empty', 'newer', 'older']);
  assert.equal(notes[0].content, '');
  assert.equal(notes[2].content, '  # 旧笔记\n正文  ');
  assert.equal(notes[2].title, '产品复盘');
  assert.equal(notes[2].titleSource, 'model');
  assert.equal(notes[2].updatedAt, 200);
});

test('editing a saved note updates content and timestamp without losing its identity', () => {
  const notes = normalizeNoteArchive([
    { id: 'selected', content: '旧内容', createdAt: 100, updatedAt: 200 },
    { id: 'other', content: '其他笔记', createdAt: 150, updatedAt: 300 },
  ]);
  const updated = updateNoteInArchive(notes, 'selected', '新内容\n第二行', 400);
  assert.deepEqual(updated.map((note) => note.id), ['selected', 'other']);
  assert.deepEqual(updated[0], {
    id: 'selected',
    title: '',
    titleSource: '',
    categoryId: '',
    tagId: '',
    content: '新内容\n第二行',
    createdAt: 100,
    updatedAt: 400,
  });

  const cleared = updateNoteInArchive(updated, 'selected', '', 500);
  assert.equal(cleared[0].content, '');
  assert.equal(normalizeNoteArchive(JSON.parse(JSON.stringify(cleared)))[0].id, 'selected');
});

test('note search and category filters compose without changing archive order', () => {
  const notes = normalizeNoteArchive([
    { id: 'one', title: 'Dynamic Panel 设计', titleSource: 'model', categoryId: 'product', tagId: 'research', content: '正文没有产品英文名', createdAt: 100, updatedAt: 300 },
    { id: 'two', content: '会议备忘\n下周交付录制功能', createdAt: 200, updatedAt: 200 },
  ]);
  assert.deepEqual(filterNotes(notes, 'dynamic').map((note) => note.id), ['one']);
  assert.deepEqual(filterNotes(notes, '录制').map((note) => note.id), ['two']);
  assert.deepEqual(filterNotes(notes, '', 'product').map((note) => note.id), ['one']);
  assert.deepEqual(filterNotes(notes, '', 'product', 'research').map((note) => note.id), ['one']);
  assert.deepEqual(filterNotes(notes, '', 'product', '__untagged__').map((note) => note.id), []);
  assert.deepEqual(filterNotes(notes, '', '__uncategorized__').map((note) => note.id), ['two']);
  assert.deepEqual(filterNotes(notes, '').map((note) => note.id), ['one', 'two']);
});

test('note categories normalize, assign and remove without deleting notes', () => {
  assert.equal(normalizeNoteCategoryName('  产品   研究  '), '产品 研究');
  assert.deepEqual(normalizeNoteTags([{ id: 'idea', name: '想法' }, { id: 'idea-2', name: '想法' }]), [{ id: 'idea', name: '想法' }]);
  const categories = normalizeNoteCategories([
    { id: 'product', name: '产品研究', tags: [{ id: 'research', name: '调研' }, { id: 'plan', name: '规划' }] },
    { id: 'duplicate-name', name: '产品研究' },
    { id: 'course', name: '课程' },
  ]);
  assert.deepEqual(categories, [
    { id: 'product', name: '产品研究', tags: [{ id: 'research', name: '调研' }, { id: 'plan', name: '规划' }] },
    { id: 'course', name: '课程', tags: [] },
  ]);
  const assigned = updateNoteCategory([
    { id: 'one', content: '正文', createdAt: 100, updatedAt: 200 },
    { id: 'two', content: '保留', createdAt: 100, updatedAt: 150 },
  ], 'one', 'product', 300);
  assert.equal(assigned.find((note) => note.id === 'one').categoryId, 'product');
  const tagged = updateNoteTag(assigned, 'one', 'research', 350);
  assert.equal(tagged.find((note) => note.id === 'one').tagId, 'research');
  const removedTag = removeNoteTag(categories, tagged, 'product', 'research', 375);
  assert.deepEqual(removedTag.categories[0].tags, [{ id: 'plan', name: '规划' }]);
  assert.equal(removedTag.notes.find((note) => note.id === 'one').tagId, '');
  const retagged = updateNoteTag(removedTag.notes, 'one', 'plan', 390);
  const moved = updateNoteCategory(retagged, 'one', 'course', 395);
  assert.equal(moved.find((note) => note.id === 'one').tagId, '');
  const removed = removeNoteCategory(categories, tagged, 'product', 400);
  assert.deepEqual(removed.categories, [{ id: 'course', name: '课程', tags: [] }]);
  assert.equal(removed.notes.length, 2);
  assert.equal(removed.notes.find((note) => note.id === 'one').categoryId, '');
  assert.equal(removed.notes.find((note) => note.id === 'one').content, '正文');
});

test('users can rename a note without changing its content', () => {
  const notes = normalizeNoteArchive([
    { id: 'note-1', title: '模型标题', titleSource: 'model', content: '正文', createdAt: 100, updatedAt: 200 },
  ]);
  const renamed = updateNoteTitle(notes, 'note-1', '  用户自己的标题  ', 300);
  assert.deepEqual(renamed[0], {
    id: 'note-1',
    title: '用户自己的标题',
    titleSource: 'user',
    categoryId: '',
    tagId: '',
    content: '正文',
    createdAt: 100,
    updatedAt: 300,
  });
});

test('generated note titles never overwrite user titles or stale content', () => {
  const base = normalizeNoteArchive([
    { id: 'note-1', content: '最初正文', createdAt: 100, updatedAt: 200 },
  ]);
  const generated = applyGeneratedNoteTitle(base, 'note-1', '模型概括标题', '最初正文');
  assert.equal(generated[0].title, '模型概括标题');
  assert.equal(generated[0].titleSource, 'model');

  const userRenamed = updateNoteTitle(generated, 'note-1', '我的标题', 300);
  assert.equal(applyGeneratedNoteTitle(userRenamed, 'note-1', '迟到的模型标题', '最初正文')[0].title, '我的标题');

  const edited = updateNoteInArchive(base, 'note-1', '已经变化的正文', 400);
  assert.equal(applyGeneratedNoteTitle(edited, 'note-1', '过期标题', '最初正文')[0].title, '');
});

test('API credential statuses distinguish saved, missing, and legacy keys that need re-entry', () => {
  assert.deepEqual(apiCredentialStatuses({
    configured: true,
    llmConfigured: false,
    llmNeedsReentry: true,
  }), {
    transcription: { label: '已安全保存', state: 'saved' },
    llm: { label: '需重新输入', state: 'warning' },
  });
  assert.deepEqual(apiCredentialStatuses({}), {
    transcription: { label: '未配置', state: 'empty' },
    llm: { label: '未配置', state: 'empty' },
  });
});

test('todo category names use stable areas and preserve customized legacy values', () => {
  const defaults = {
    P0: '学习与课程',
    P1: '内容与创作',
    P2: '产品与开发',
    P3: '生活与事务',
  };
  const legacyDefaults = {
    P0: '课程',
    P1: '自媒体&写作',
    P2: 'Vibe coding',
    P3: '日常',
  };
  assert.deepEqual(normalizeTodoCategoryNames(null, defaults), defaults);
  assert.deepEqual(normalizeTodoCategoryNames({ P0: '  教学产品  ', P1: '', P4: '无效' }, defaults), {
    P0: '教学产品',
    P1: '内容与创作',
    P2: '产品与开发',
    P3: '生活与事务',
  });
  assert.deepEqual(migrateTodoCategoryNames(legacyDefaults, defaults, legacyDefaults), defaults);
  assert.deepEqual(migrateTodoCategoryNames({ ...legacyDefaults, P2: '客户端开发' }, defaults, legacyDefaults), {
    P0: '学习与课程',
    P1: '内容与创作',
    P2: '客户端开发',
    P3: '生活与事务',
  });
});

test('audio level returns stable RMS volume for recording strands', () => {
  assert.equal(calculateAudioLevel(new Float32Array([0, 0, 0])), 0);
  assert.equal(calculateAudioLevel(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(calculateAudioLevel(new Float32Array([2, -2])), 1);
});

test('resampleFloat32ToPcm16 downsamples and clamps audio', () => {
  const pcm = resampleFloat32ToPcm16(new Float32Array([1.5, 1, -1.5, -1]), 32000, 16000);
  assert.deepEqual(Array.from(pcm), [32767, -32768]);
});

test('shouldTogglePanelForSpace toggles plain Space but never steals typing input', () => {
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: false }), true);
  assert.equal(shouldTogglePanelForSpace({ key: 'Spacebar', repeat: false, editable: false }), true);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: true, editable: false }), false);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: true }), false);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: false, metaKey: true }), false);
});

test('todo time battery reports the remaining share with exact color boundaries', () => {
  const createdAt = Date.parse('2026-08-21T00:00:00.000Z');
  const deadline = '2026-08-21T10:00:00.000Z';
  const todo = { createdAt, deadline, done: false };
  assert.deepEqual(todoTimeBattery(todo, Date.parse('2026-08-21T02:00:00.000Z')), {
    percent: 80,
    tone: 'green',
    overdue: false,
    label: '剩余 80%',
  });
  assert.equal(todoTimeBattery(todo, Date.parse('2026-08-21T05:00:00.000Z')).tone, 'yellow');
  assert.equal(todoTimeBattery(todo, Date.parse('2026-08-21T07:00:00.000Z')).tone, 'red');
  // 恰好压在截止点上就算逾期，不再是「剩余 0%」。
  assert.deepEqual(todoTimeBattery(todo, Date.parse('2026-08-21T10:00:00.000Z')), {
    percent: 0,
    tone: 'red',
    overdue: true,
    label: '已逾期',
  });
  assert.deepEqual(todoTimeBattery(todo, Date.parse('2026-08-21T11:00:00.000Z')), {
    percent: 0,
    tone: 'red',
    overdue: true,
    label: '已逾期',
  });
  // 逾期前的最后一刻仍是「剩余 0%」：取整落到 0 与真正欠账必须可区分。
  const almostDue = todoTimeBattery(todo, Date.parse('2026-08-21T09:59:00.000Z'));
  assert.equal(almostDue.overdue, false);
  assert.equal(almostDue.percent, 0);
  assert.equal(almostDue.label, '剩余 0%');
  assert.equal(todoTimeBattery({ createdAt, deadline, done: true }, createdAt), null);
  assert.deepEqual(todoTimeBattery({ deadline }, createdAt), {
    percent: 0,
    tone: 'red',
    overdue: false,
    label: '待补充有效截止时间',
  });
});

test('Shift range selection selects contiguous rows while plain selection resets the range', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(updateRangeSelection(ids, [], 'b', null, false), {
    selected: ['b'],
    anchor: 'b',
  });
  assert.deepEqual(updateRangeSelection(ids, ['b'], 'd', 'b', true), {
    selected: ['b', 'c', 'd'],
    anchor: 'b',
  });
  assert.deepEqual(updateRangeSelection(ids, ['b', 'c', 'd'], 'c', 'b', false), {
    selected: ['c'],
    anchor: 'c',
  });
  assert.deepEqual(updateRangeSelection(ids, ['a'], 'missing', 'a', true), {
    selected: ['a'],
    anchor: 'a',
  });
});

test('credential selection can toggle its only selected row off', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(updateRangeSelection(ids, ['b'], 'b', 'b', false, true), {
    selected: [],
    anchor: null,
  });
});
