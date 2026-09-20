(function exposeNotesController() {
  function createController(host) {
    const { generateId, showStatusToast, syncWorkspaceSnapshot, getActiveTab } = host;

    // Notes editor lifecycle is injected after archive/detail functions are declared.
    let notesEditor;
    const NOTE_KEY = 'notch-home-note';
    const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
    const noteInput = document.getElementById('home-note');
    const noteSaveButton = document.getElementById('note-save-btn');
    const notesList = document.getElementById('notes-list');
    const notesSearch = document.getElementById('notes-search');
    const notesDetail = document.getElementById('notes-detail');
    const notesCount = document.getElementById('notes-count');
    const notesNewButton = document.getElementById('notes-new');

    const notesMarkdown = window.NotchNotesMarkdown.createRenderer({
      document,
      getReadNoteImage: () => {
        const readNoteImage = window.notchAPI?.readNoteImage;
        return typeof readNoteImage === 'function'
          ? (imagePath) => readNoteImage(imagePath)
          : null;
      },
    });
    const {
      buildMarkdownPreview,
      safeMarkdownUrl,
      safeNoteImageReference,
    } = notesMarkdown;
    const notesStore = window.NotchNotesStore.createStore({
      storage: localStorage,
      domain: window.NotchDomain,
    });

    const notesTaxonomy = window.NotchNotesTaxonomy.createController({
      document,
      domain: window.NotchDomain,
      store: notesStore,
      getArchive: () => loadNoteArchive(),
      getCategories: () => loadNoteCategories(),
      saveArchive: (notes) => saveNoteArchive(notes),
      saveCategories: (categories) => saveNoteCategories(categories),
      generateId,
      showStatusToast,
      syncWorkspaceSnapshot,
      flushEditorSave: () => notesEditor?.flushDetailSave(),
      renderLibrary: () => renderNotesLibrary(),
    });





function loadNoteCategories() {
  return notesStore.loadCategories();
}

function loadNoteArchive() {
  return notesStore.loadArchive();
}

function saveNoteArchive(notes) {
  return notesStore.saveArchive(notes);
}

function noteCategoryName(note, categories = loadNoteCategories()) {
  return notesStore.categoryName(note, categories);
}

function noteTagName(note, categories = loadNoteCategories()) {
  return notesStore.tagName(note, categories);
}

function saveNoteCategories(categories) {
  return notesStore.saveCategories(categories);
}

let selectedNoteId = '';

function noteArchiveTitle(note) {
  return String(note && note.title || '').trim() || '未命名笔记';
}

function noteArchiveExcerpt(note) {
  const content = String(note && note.content || '')
    .replace(/!\[([^\]]*)\]\(note-images\/[^)]+\)/gi, '$1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.join(' ').replace(/[#*_~`>\[\]]/g, '').slice(0, 86);
}

function noteArchiveTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

const NOTES_TOOL_ICONS = {
  heading: '<b>H</b>',
  bold: '<b>B</b>',
  italic: '<i>I</i>',
  bullet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="6" height="6" rx="1"/><path d="m4.5 7 1.5 1.5L8.5 6M13 7h8M3 17h6M13 17h8"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 8H4v4h4v4H4M17 8h-3v4h4v4h-4"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>',
};

function noteActionButton(action, label, icon, className = 'notes-icon-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

/* Legacy taxonomy functions moved to renderer/notes-taxonomy-controller.js.
function selectedNoteCategory(categories = loadNoteCategories()) {
  const id = String(notesCategoryFilter?.value || '');
  return categories.find((category) => category.id === id) || null;
}

function renderNoteCategoryControls(categories, archive) {
  if (!notesCategoryFilter) return;
  const selected = notesCategoryFilter.value;
  const counts = new Map(categories.map((category) => [category.id, 0]));
  let uncategorized = 0;
  archive.forEach((note) => {
    if (counts.has(note.categoryId)) counts.set(note.categoryId, counts.get(note.categoryId) + 1);
    else uncategorized += 1;
  });
  notesCategoryFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = `全部分类 (${archive.length})`;
  const empty = document.createElement('option');
  empty.value = '__uncategorized__';
  empty.textContent = `未分类 (${uncategorized})`;
  notesCategoryFilter.append(all, empty);
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = `${category.name} (${counts.get(category.id) || 0})`;
    notesCategoryFilter.append(option);
  });
  notesCategoryFilter.value = [...notesCategoryFilter.options].some((option) => option.value === selected) ? selected : '';
  const customSelected = Boolean(selectedNoteCategory(categories));
  if (notesCategoryAdd) notesCategoryAdd.disabled = categories.length >= 40;
  if (notesCategoryRename) notesCategoryRename.disabled = !customSelected;
  if (notesCategoryDelete) notesCategoryDelete.disabled = !customSelected;
}

function selectedNoteTag(category = selectedNoteCategory()) {
  const id = String(notesTagFilter?.value || '');
  return category?.tags.find((tag) => tag.id === id) || null;
}

function renderNoteTagControls(category, archive) {
  if (!notesTagToolbar || !notesTagFilter) return;
  notesTagToolbar.hidden = !category;
  if (!category) {
    notesTagFilter.replaceChildren();
    if (notesTagEditor) notesTagEditor.hidden = true;
    if (notesTagConfirm) notesTagConfirm.hidden = true;
    return;
  }
  const selected = notesTagFilter.value;
  const categoryNotes = archive.filter((note) => note.categoryId === category.id);
  const counts = new Map(category.tags.map((tag) => [tag.id, 0]));
  let untagged = 0;
  categoryNotes.forEach((note) => {
    if (counts.has(note.tagId)) counts.set(note.tagId, counts.get(note.tagId) + 1);
    else untagged += 1;
  });
  notesTagFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = `全部标签 (${categoryNotes.length})`;
  const empty = document.createElement('option');
  empty.value = '__untagged__';
  empty.textContent = `无标签 (${untagged})`;
  notesTagFilter.append(all, empty);
  category.tags.forEach((tag) => {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = `${tag.name} (${counts.get(tag.id) || 0})`;
    notesTagFilter.append(option);
  });
  notesTagFilter.value = [...notesTagFilter.options].some((option) => option.value === selected) ? selected : '';
  const customSelected = Boolean(selectedNoteTag(category));
  if (notesTagAdd) notesTagAdd.disabled = category.tags.length >= 30;
  if (notesTagRename) notesTagRename.disabled = !customSelected;
  if (notesTagDelete) notesTagDelete.disabled = !customSelected;
}

function notesTaxonomyAction(action, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notes-taxonomy-action';
  button.dataset.notesTaxonomyAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

function notesTaxonomySelect(label, count, scope, selected, categoryId = '', tagId = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `notes-taxonomy-select${selected ? ' active' : ''}`;
  button.dataset.notesTaxonomyScope = scope;
  if (categoryId) button.dataset.categoryId = categoryId;
  if (tagId) button.dataset.tagId = tagId;
  button.setAttribute('aria-current', selected ? 'true' : 'false');
  const name = document.createElement('span');
  name.textContent = label;
  const total = document.createElement('small');
  total.textContent = String(count);
  button.append(name, total);
  return button;
}

function renderNotesTaxonomy(categories, archive) {
  if (!notesTaxonomyTree) return;
  if (notesTaxonomyCount) notesTaxonomyCount.textContent = `${categories.length} 个分类`;
  const selectedCategoryId = String(notesCategoryFilter?.value || '');
  const selectedTagId = String(notesTagFilter?.value || '');
  notesTaxonomyTree.replaceChildren();
  notesTaxonomyTree.append(
    notesTaxonomySelect('全部笔记', archive.length, 'all', !selectedCategoryId),
    notesTaxonomySelect('未分类', archive.filter((note) => !note.categoryId).length, 'uncategorized', selectedCategoryId === '__uncategorized__')
  );
  const plusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 16 9.5-9.5 4 4L8 20H4zM12 8l4 4"/></svg>';
  const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  categories.forEach((category) => {
    const group = document.createElement('section');
    group.className = 'notes-taxonomy-group';
    const row = document.createElement('div');
    row.className = 'notes-taxonomy-row';
    const expanded = expandedNoteCategories.has(category.id);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'notes-taxonomy-toggle';
    toggle.dataset.notesTaxonomyToggle = category.id;
    toggle.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}${category.name}`);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>';
    const count = archive.filter((note) => note.categoryId === category.id).length;
    const select = notesTaxonomySelect(category.name, count, 'category', selectedCategoryId === category.id && !selectedTagId, category.id);
    const actions = document.createElement('div');
    actions.className = 'notes-taxonomy-actions';
    const addTag = notesTaxonomyAction('add-tag', `在${category.name}中新建标签`, plusIcon);
    addTag.dataset.categoryId = category.id;
    const rename = notesTaxonomyAction('rename-category', `重命名${category.name}`, editIcon);
    rename.dataset.categoryId = category.id;
    const remove = notesTaxonomyAction('delete-category', `删除${category.name}`, deleteIcon);
    remove.dataset.categoryId = category.id;
    remove.classList.add('danger');
    actions.append(addTag, rename, remove);
    row.append(toggle, select, actions);
    group.append(row);
    if (expanded) {
      const children = document.createElement('div');
      children.className = 'notes-taxonomy-children';
      const untagged = archive.filter((note) => note.categoryId === category.id && !note.tagId).length;
      children.append(notesTaxonomySelect('无标签', untagged, 'untagged', selectedCategoryId === category.id && selectedTagId === '__untagged__', category.id, '__untagged__'));
      category.tags.forEach((tag) => {
        const tagRow = document.createElement('div');
        tagRow.className = 'notes-taxonomy-row tag';
        const tagCount = archive.filter((note) => note.categoryId === category.id && note.tagId === tag.id).length;
        const tagSelect = notesTaxonomySelect(tag.name, tagCount, 'tag', selectedCategoryId === category.id && selectedTagId === tag.id, category.id, tag.id);
        const tagActions = document.createElement('div');
        tagActions.className = 'notes-taxonomy-actions';
        const renameTag = notesTaxonomyAction('rename-tag', `重命名${tag.name}`, editIcon);
        renameTag.dataset.categoryId = category.id;
        renameTag.dataset.tagId = tag.id;
        const removeTag = notesTaxonomyAction('delete-tag', `删除${tag.name}`, deleteIcon);
        removeTag.dataset.categoryId = category.id;
        removeTag.dataset.tagId = tag.id;
        removeTag.classList.add('danger');
        tagActions.append(renameTag, removeTag);
        tagRow.append(tagSelect, tagActions);
        children.append(tagRow);
      });
      group.append(children);
    }
    notesTaxonomyTree.append(group);
  });
}

function closeNoteTagControls() {
  noteTagEditorMode = '';
  if (notesTagEditor) notesTagEditor.hidden = true;
  if (notesTagConfirm) notesTagConfirm.hidden = true;
  if (notesTagName) {
    notesTagName.value = '';
    notesTagName.removeAttribute('aria-invalid');
  }
}

function closeNoteCategoryControls() {
  noteCategoryEditorMode = '';
  if (notesCategoryEditor) notesCategoryEditor.hidden = true;
  if (notesCategoryConfirm) notesCategoryConfirm.hidden = true;
  if (notesCategoryName) {
    notesCategoryName.value = '';
    notesCategoryName.removeAttribute('aria-invalid');
  }
}

function openNoteTagEditor(mode) {
  closeNoteCategoryControls();
  const category = selectedNoteCategory();
  const tag = selectedNoteTag(category);
  if (!category || (mode === 'rename' && !tag)) return;
  noteTagEditorMode = mode;
  if (notesTagConfirm) notesTagConfirm.hidden = true;
  if (notesTagEditor) notesTagEditor.hidden = false;
  if (notesTagName) {
    notesTagName.value = mode === 'rename' ? tag.name : '';
    notesTagName.removeAttribute('aria-invalid');
    requestAnimationFrame(() => {
      notesTagName.focus({ preventScroll: true });
      notesTagName.select();
    });
  }
}

function openNoteCategoryEditor(mode) {
  closeNoteTagControls();
  const category = selectedNoteCategory();
  if (mode === 'rename' && !category) return;
  noteCategoryEditorMode = mode;
  if (notesCategoryConfirm) notesCategoryConfirm.hidden = true;
  if (notesCategoryEditor) notesCategoryEditor.hidden = false;
  if (notesCategoryName) {
    notesCategoryName.value = mode === 'rename' ? category.name : '';
    notesCategoryName.removeAttribute('aria-invalid');
    requestAnimationFrame(() => {
      notesCategoryName.focus({ preventScroll: true });
      notesCategoryName.select();
    });
  }
}

*/

function renderNotesDetail(notes = loadNoteArchive()) {
  if (!notesDetail) return;
  notesDetail.replaceChildren();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) {
    const empty = document.createElement('div');
    empty.className = 'notes-detail-empty';
    const hasArchive = loadNoteArchive().length > 0;
    empty.innerHTML = hasArchive
      ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的笔记</strong><p>试试搜索其他关键词。</p>'
      : '<span class="notes-empty-mark" aria-hidden="true">✎</span><strong>还没有笔记</strong><button class="notes-empty-create" type="button" data-action="create-note">新建笔记</button>';
    notesDetail.append(empty);
    return;
  }

  const header = document.createElement('header');
  header.className = 'notes-detail-head';
  const heading = document.createElement('div');
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'notes-detail-title';
  title.dataset.noteId = note.id;
  title.value = String(note.title || '');
  title.placeholder = '未命名笔记';
  title.maxLength = 80;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.setAttribute('aria-label', '笔记标题');
  const meta = document.createElement('div');
  meta.className = 'notes-detail-meta';
  const category = document.createElement('select');
  category.className = 'notes-detail-category';
  category.dataset.noteId = note.id;
  category.setAttribute('aria-label', '笔记分类');
  const uncategorized = document.createElement('option');
  uncategorized.value = '';
  uncategorized.textContent = '未分类';
  category.append(uncategorized);
  const noteCategories = loadNoteCategories();
  noteCategories.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    category.append(option);
  });
  category.value = note.categoryId || '';
  const tag = document.createElement('select');
  tag.className = 'notes-detail-tag';
  tag.dataset.noteId = note.id;
  tag.setAttribute('aria-label', '笔记标签');
  const untagged = document.createElement('option');
  untagged.value = '';
  untagged.textContent = note.categoryId ? '无标签' : '先选择分类';
  tag.append(untagged);
  const noteCategory = noteCategories.find((item) => item.id === note.categoryId);
  noteCategory?.tags.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    tag.append(option);
  });
  tag.value = note.tagId || '';
  tag.disabled = !noteCategory;
  const time = document.createElement('time');
  time.className = 'notes-detail-time';
  time.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  meta.append(category, tag, time);
  heading.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'notes-detail-actions';
  const modes = document.createElement('div');
  modes.className = 'notes-mode-control';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', '笔记显示模式');
  for (const [mode, label] of [['edit', '编辑'], ['preview', '预览']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = `note-mode-${mode}`;
    button.textContent = label;
    button.classList.toggle('active', notesEditor?.detailMode() === mode);
    button.setAttribute('aria-pressed', String(notesEditor?.detailMode() === mode));
    modes.append(button);
  }
  const nameWithAI = noteActionButton(
    'name-note-ai',
    '生成标题',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
    'notes-icon-button ai-note-organize'
  );
  const organize = noteActionButton(
    'organize-note',
    '整理笔记',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
    'notes-icon-button ai-note-organize'
  );
  nameWithAI.disabled = !String(note.content || '').trim();
  organize.disabled = !String(note.content || '').trim();
  const attach = noteActionButton(
    'attach-note-image',
    '添加图片',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="3"/></svg>'
  );
  const remove = noteActionButton(
    'delete-note',
    '删除笔记',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>',
    'notes-icon-button danger'
  );
  actions.append(modes, nameWithAI, organize, attach, remove);
  header.append(heading, actions);

  const toolbar = document.createElement('div');
  toolbar.className = 'notes-format-toolbar';
  toolbar.hidden = notesEditor?.detailMode() !== 'edit';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '笔记格式');
  const labels = {
    heading: '标题', bold: '加粗', italic: '斜体', bullet: '项目列表',
    task: '待办列表', quote: '引用', code: '行内代码', link: '链接',
  };
  for (const type of Object.keys(labels)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.notesFormat = type;
    button.setAttribute('aria-label', labels[type]);
    button.title = labels[type];
    button.innerHTML = NOTES_TOOL_ICONS[type];
    toolbar.append(button);
  }

  const content = document.createElement('div');
  content.className = 'notes-content';
  const editor = document.createElement('textarea');
  editor.id = 'notes-editor';
  editor.className = 'notes-editor';
  editor.dataset.noteId = note.id;
  editor.value = note.content;
  editor.placeholder = '开始写作…';
  editor.setAttribute('aria-label', `编辑笔记：${noteArchiveTitle(note)}`);
  editor.spellcheck = true;
  editor.hidden = notesEditor?.detailMode() !== 'edit';
  const preview = document.createElement('article');
  preview.id = 'notes-preview';
  preview.className = 'note-preview notes-preview';
  preview.tabIndex = 0;
  preview.hidden = notesEditor?.detailMode() !== 'preview';
  if (notesEditor?.detailMode() === 'preview') preview.replaceChildren(buildMarkdownPreview(note.content));
  content.append(editor, preview);
  notesDetail.append(header, toolbar, content);
  requestNoteTitle(note);
}
const noteTitleAttempts = new Set();

async function requestNoteTitle(note) {
  if (
    !note
    || note.title
    || note.titleSource === 'user'
    || !String(note.content || '').trim()
    || noteTitleAttempts.has(note.id)
    || window.NotchAISettings?.autoNameNotes !== true
    || !window.notchAPI?.organizeMaterial
  ) return;
  noteTitleAttempts.add(note.id);
  const expectedContent = note.content;
  const result = await window.notchAPI.organizeMaterial({ kind: 'note', sourceId: note.id, text: expectedContent }).catch(() => null);
  if (!result?.ok || !result.title) {
    noteTitleAttempts.delete(note.id);
    return;
  }
  const next = window.NotchDomain.applyGeneratedNoteTitle(
    loadNoteArchive(),
    note.id,
    result.title,
    expectedContent
  );
  const updated = next.find((item) => item.id === note.id);
  if (!updated?.title || updated.titleSource !== 'model') {
    noteTitleAttempts.delete(note.id);
    return;
  }
  saveNoteArchive(next);
  updateSavedNotePresentation(updated);
  await syncWorkspaceSnapshot();
}

function updateSavedNotePresentation(note) {
  if (!note) return;
  const title = noteArchiveTitle(note);
  const detailTitle = notesDetail?.querySelector('.notes-detail-title');
  const detailTime = notesDetail?.querySelector('.notes-detail-time');
  if (detailTitle && document.activeElement !== detailTitle) detailTitle.value = note.title || '';
  if (detailTime) detailTime.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  const row = notesList?.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!row) return;
  const rowTitle = row.querySelector('strong');
  const rowExcerpt = row.querySelector('span');
  const rowTime = row.querySelector('time');
  if (rowTitle) rowTitle.textContent = title;
  if (rowExcerpt) rowExcerpt.textContent = noteArchiveExcerpt(note);
  if (rowTime) rowTime.textContent = noteArchiveTime(note.updatedAt);
}


  notesEditor = window.NotchNotesEditor.createController({
    document,
    storage: localStorage,
    domain: window.NotchDomain,
    buildMarkdownPreview,
    safeMarkdownUrl,
    getApi: () => window.notchAPI,
    getDetailElement: () => notesDetail,
    getArchive: () => loadNoteArchive(),
    saveArchive: (notes) => saveNoteArchive(notes),
    updateSavedNotePresentation,
    requestNoteTitle,
    renderDetail: (notes) => renderNotesDetail(notes),
    getWorkspaceReloadPending: () => workspaceReloadPending,
  });

function flushNotesEditorSave() {
  notesEditor?.flushDetailSave();
}

function renderNotesLibrary() {
  if (!notesList) return;
  const categories = loadNoteCategories();
  const archive = loadNoteArchive();
  notesTaxonomy.render(categories, archive);
  const selectedCategory = notesTaxonomy.selectedCategory(categories);
  const categoryId = notesTaxonomy.selectedCategoryId();
  const tagId = selectedCategory ? notesTaxonomy.selectedTagId() : '';
  const searchQuery = notesSearch?.value || '';
  const scopedNotes = window.NotchDomain.filterNotes(archive, '', categoryId, tagId);
  const notes = window.NotchDomain.filterNotes(scopedNotes, searchQuery);
  if (notesCount) {
    notesCount.textContent = searchQuery.trim() && notes.length !== scopedNotes.length
      ? `${notes.length} / ${scopedNotes.length} 篇`
      : `${scopedNotes.length} 篇`;
  }
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0]?.id || '';
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    empty.textContent = !archive.length
      ? '保存的笔记会出现在这里'
      : scopedNotes.length
        ? '没有匹配的笔记'
        : '当前范围还没有笔记';
    notesList.append(empty);
    renderNotesDetail(notes);
    return;
  }
  notes.forEach((note) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notes-list-item${note.id === selectedNoteId ? ' active' : ''}`;
    button.dataset.noteId = note.id;
    button.dataset.lineSidebarItem = '';
    button.setAttribute('aria-pressed', String(note.id === selectedNoteId));
    const title = document.createElement('strong');
    title.textContent = noteArchiveTitle(note);
    const time = document.createElement('time');
    time.textContent = noteArchiveTime(note.updatedAt);
    const excerpt = document.createElement('span');
    excerpt.textContent = noteArchiveExcerpt(note);
    const category = document.createElement('small');
    category.className = 'notes-list-category';
    const tag = noteTagName(note, categories);
    category.textContent = tag ? `${noteCategoryName(note, categories)} · ${tag}` : noteCategoryName(note, categories);
    button.append(title, time, excerpt, category);
    notesList.append(button);
  });
  renderNotesDetail(notes);
}

function createNote() {
  notesEditor.flushDetailSave();
  const now = Date.now();
  const selectedCategoryId = notesTaxonomy.selectedCategory()?.id || '';
  const selectedTagId = selectedCategoryId ? notesTaxonomy.selectedTag()?.id || '' : '';
  const note = {
    id: generateId(),
    title: '',
    titleSource: '',
    categoryId: selectedCategoryId,
    tagId: selectedTagId,
    content: '',
    createdAt: now,
    updatedAt: now,
  };
  const notes = [note, ...loadNoteArchive()].slice(0, 200);
  try {
    saveNoteArchive(notes);
  } catch (error) {
    showStatusToast('无法创建笔记，请检查存储空间');
    return null;
  }
  selectedNoteId = note.id;
  notesEditor.setDetailMode('edit', { force: true, render: false, focus: false });
  if (notesSearch) notesSearch.value = '';
  if (selectedCategoryId) notesTaxonomy.select(selectedCategoryId, selectedTagId);
  renderNotesLibrary();
  requestAnimationFrame(() => notesDetail?.querySelector('.notes-detail-title')?.focus({ preventScroll: true }));
  return note;
}

const notesAttachments = window.NotchNotesAttachments.createController({
  getApi: () => window.notchAPI,
  isSafeImageReference: safeNoteImageReference,
  replaceEditorText: (editor, ...args) => notesEditor.replaceEditorText(editor, ...args),
  flushEditorSave: () => notesEditor.flushDetailSave(),
  getDetailTime: () => notesDetail?.querySelector('.notes-detail-time'),
  showStatusToast,
});

notesEditor.bindDetailEditor({
  attachments: notesAttachments,
  onAction: (action, event) => handleNotesDetailAction(action, event),
});

notesNewButton?.addEventListener('click', createNote);
document.addEventListener('keydown', (event) => {
  if (getActiveTab() !== 'notes' || event.altKey || event.shiftKey || event.isComposing
    || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'n') return;
  event.preventDefault();
  createNote();
});

const api = {
  create: createNote,
  context(noteId = selectedNoteId, includeSelection = true) {
    const editor = notesDetail?.querySelector('#notes-editor');
    const selection = includeSelection && editor && editor.dataset.noteId === noteId && editor.selectionEnd > editor.selectionStart
      ? { start: editor.selectionStart, end: editor.selectionEnd, text: editor.value.slice(editor.selectionStart, editor.selectionEnd) }
      : null;
    notesEditor.flushDetailSave();
    const note = loadNoteArchive().find((item) => item.id === noteId);
    return note ? { sourceType: 'note', sourceId: note.id, sourceTitle: noteArchiveTitle(note), text: selection?.text || note.content, selection, createdAt: note.createdAt } : null;
  },
  async applyAIName(noteId, expectedText, expectedTitle, nextTitle) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === noteId);
    const title = String(nextTitle || '').trim().slice(0, 80);
    if (!note || note.content.trim() !== String(expectedText || '').trim() || noteArchiveTitle(note) !== expectedTitle) return { ok: false, error: 'source_changed' };
    if (!title) return { ok: false, error: 'missing_title' };
    const updated = window.NotchDomain.updateNoteTitle(notes, noteId, title, Date.now());
    try { saveNoteArchive(updated); } catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot(), undo: { noteId, before: note.title, after: title, expectedText: note.content.trim() } };
  },
  async undoAIName(token) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === token?.noteId);
    if (!note || noteArchiveTitle(note) !== token.after || note.content.trim() !== token.expectedText) return { ok: false, error: 'conflict' };
    const updated = window.NotchDomain.updateNoteTitle(notes, note.id, token.before, Date.now());
    try { saveNoteArchive(updated); } catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async replaceAISelection(noteId, selection, expected, replacement) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === noteId);
    const start = Number(selection && selection.start), end = Number(selection && selection.end);
    if (!note || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
      || note.content.slice(start, end) !== String(expected || '')) return { ok: false, error: 'source_changed' };
    const nextContent = note.content.slice(0, start) + String(replacement || '') + note.content.slice(end);
    const next = window.NotchDomain.updateNoteInArchive(notes, noteId, nextContent, Date.now());
    try { saveNoteArchive(next); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, workspaceSynced, undo: { noteId, start, before: expected, after: String(replacement || ''), contentAfter: nextContent } };
  },
  async undoAISelection(token) {
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === token?.noteId);
    if (!note || note.content !== token.contentAfter || note.content.slice(token.start, token.start + token.after.length) !== token.after) return { ok: false, error: 'conflict' };
    const content = note.content.slice(0, token.start) + token.before + note.content.slice(token.start + token.after.length);
    const next = window.NotchDomain.updateNoteInArchive(notes, token.noteId, content, Date.now());
    try { saveNoteArchive(next); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async undoGenerated(snapshot) {
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === snapshot?.id);
    if (!note || note.title !== snapshot.title || note.content !== snapshot.content || note.categoryId !== snapshot.categoryId || note.tagId !== snapshot.tagId || note.createdAt !== snapshot.createdAt) return { ok: false, error: 'conflict' };
    try { saveNoteArchive(notes.filter((item) => item.id !== note.id)); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    if (selectedNoteId === note.id) selectedNoteId = null;
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async saveCaptured(content) {
    const result = await api.saveGenerated('', content, '');
    if (result.ok && result.note) void requestNoteTitle(result.note);
    return result;
  },
  async saveGenerated(title, content, titleSource = 'model') {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    if (notes.length >= 200) return { ok: false, error: 'capacity' };
    const now = Date.now();
    const note = { id: generateId(), title: String(title || '').slice(0, 80), titleSource, categoryId: '', tagId: '', content: String(content || ''), createdAt: now, updatedAt: now };
    try { saveNoteArchive([note, ...notes]); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, noteId: note.id, note: { ...note }, workspaceSynced };
  },
  select: (noteId) => {
    if (!loadNoteArchive().some((note) => note.id === noteId)) return false;
    selectedNoteId = noteId;
    if (notesSearch) notesSearch.value = '';
    notesTaxonomy.clearSelection();
    renderNotesLibrary();
    return true;
  },
  list: () => loadNoteArchive().map((note) => ({ ...note })),
  render: () => renderNotesLibrary(),
  chatContexts: () => {
    flushNotesEditorSave();
    const categories = loadNoteCategories();
    return loadNoteArchive().filter((note) => note.content.trim()).map((note) => {
      const category = categories.find((item) => item.id === note.categoryId);
      const tag = category?.tags?.find((item) => item.id === note.tagId);
      return {
        sourceType: 'note',
        sourceId: note.id,
        sourceTitle: noteArchiveTitle(note),
        sourceRevision: String(note.updatedAt || note.createdAt || ''),
        text: note.content,
        detail: [category?.name || '未分类', tag?.name].filter(Boolean).join(' · '),
        updatedAt: note.updatedAt || note.createdAt || 0,
      };
    });
  },
};

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast('先写点内容再存档');
    return;
  }
  const notes = loadNoteArchive();
  let activeId = localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) || '';
  const existing = notes.find((item) => item.id === activeId);
  if (existing) {
    existing.content = content;
    existing.updatedAt = Date.now();
  } else {
    activeId = generateId();
    notes.unshift({ id: activeId, categoryId: '', tagId: '', content, createdAt: Date.now(), updatedAt: Date.now() });
  }
  localStorage.setItem(NOTE_ACTIVE_ARCHIVE_KEY, activeId);
  saveNoteArchive(notes);
  localStorage.setItem(NOTE_KEY, noteInput.value);
  selectedNoteId = activeId;
  renderNotesLibrary();
  showStatusToast('笔记已保存');
});

notesList?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-note-id]');
  if (!row) return;
  flushNotesEditorSave();
  selectedNoteId = row.dataset.noteId;
  renderNotesLibrary();
});

notesSearch?.addEventListener('input', () => {
  flushNotesEditorSave();
  renderNotesLibrary();
});

/* Legacy taxonomy listeners moved to renderer/notes-taxonomy-controller.js.
function selectNotesTaxonomy(categoryId, tagId = '') {
  flushNotesEditorSave();
  closeNoteCategoryControls();
  closeNoteTagControls();
  if (notesCategoryFilter) notesCategoryFilter.value = categoryId;
  if (notesTagFilter) notesTagFilter.value = '';
  if (categoryId && categoryId !== '__uncategorized__') expandedNoteCategories.add(categoryId);
  renderNotesLibrary();
  if (notesTagFilter && tagId) {
    notesTagFilter.value = tagId;
    renderNotesLibrary();
  }
}

notesTaxonomyTree?.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-notes-taxonomy-toggle]');
  if (toggle) {
    const categoryId = toggle.dataset.notesTaxonomyToggle;
    if (expandedNoteCategories.has(categoryId)) expandedNoteCategories.delete(categoryId);
    else expandedNoteCategories.add(categoryId);
    renderNotesTaxonomy(loadNoteCategories(), loadNoteArchive());
    return;
  }
  const action = event.target.closest('[data-notes-taxonomy-action]');
  if (action) {
    const categoryId = action.dataset.categoryId || '';
    const tagId = action.dataset.tagId || '';
    selectNotesTaxonomy(categoryId, tagId);
    if (action.dataset.notesTaxonomyAction === 'add-tag') notesTagAdd?.click();
    if (action.dataset.notesTaxonomyAction === 'rename-category') notesCategoryRename?.click();
    if (action.dataset.notesTaxonomyAction === 'delete-category') notesCategoryDelete?.click();
    if (action.dataset.notesTaxonomyAction === 'rename-tag') notesTagRename?.click();
    if (action.dataset.notesTaxonomyAction === 'delete-tag') notesTagDelete?.click();
    return;
  }
  const item = event.target.closest('[data-notes-taxonomy-scope]');
  if (!item) return;
  const scope = item.dataset.notesTaxonomyScope;
  if (scope === 'all') selectNotesTaxonomy('');
  else if (scope === 'uncategorized') selectNotesTaxonomy('__uncategorized__');
  else selectNotesTaxonomy(item.dataset.categoryId || '', scope === 'category' ? '' : item.dataset.tagId || '');
});

notesTaxonomyTree?.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const items = [...notesTaxonomyTree.querySelectorAll('.notes-taxonomy-select')];
  const index = items.indexOf(document.activeElement);
  if (index < 0 || !items.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});

notesCategoryFilter?.addEventListener('change', () => {
  flushNotesEditorSave();
  closeNoteCategoryControls();
  closeNoteTagControls();
  if (notesTagFilter) notesTagFilter.value = '';
  const category = selectedNoteCategory();
  if (category) expandedNoteCategories.add(category.id);
  renderNotesLibrary();
});

notesCategoryAdd?.addEventListener('click', () => openNoteCategoryEditor('create'));
notesCategoryRename?.addEventListener('click', () => openNoteCategoryEditor('rename'));
notesCategoryCancel?.addEventListener('click', closeNoteCategoryControls);
notesCategoryDeleteCancel?.addEventListener('click', closeNoteCategoryControls);
notesCategoryDelete?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  if (!category || !notesCategoryConfirm) return;
  noteCategoryEditorMode = '';
  if (notesCategoryEditor) notesCategoryEditor.hidden = true;
  notesCategoryConfirm.hidden = false;
  if (notesCategoryConfirmText) notesCategoryConfirmText.textContent = `删除“${category.name}”？其中笔记将移至未分类。`;
  notesCategoryDeleteCancel?.focus({ preventScroll: true });
});

function saveNoteCategoryEdit() {
  if (!noteCategoryEditorMode || !notesCategoryName) return;
  const editingMode = noteCategoryEditorMode;
  const name = window.NotchDomain.normalizeNoteCategoryName(notesCategoryName.value);
  const categories = loadNoteCategories();
  const current = selectedNoteCategory(categories);
  const duplicate = categories.some((category) => category.id !== current?.id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!name || duplicate || (noteCategoryEditorMode === 'create' && categories.length >= 40)) {
    notesCategoryName.setAttribute('aria-invalid', 'true');
    showStatusToast(!name ? '请输入分类名称' : duplicate ? '已有同名分类' : '最多创建 40 个分类');
    return;
  }
  const categoryId = editingMode === 'rename' && current ? current.id : `note-category-${generateId()}`;
  const next = editingMode === 'rename'
    ? categories.map((category) => category.id === categoryId ? { ...category, name } : category)
    : [...categories, { id: categoryId, name, tags: [] }];
  try {
    saveNoteCategories(next);
  } catch (error) {
    showStatusToast('分类保存失败，请检查存储空间');
    return;
  }
  closeNoteCategoryControls();
  renderNotesLibrary();
  showStatusToast(editingMode === 'rename' ? '分类已重命名' : '分类已创建');
  void syncWorkspaceSnapshot();
}

notesCategorySave?.addEventListener('click', saveNoteCategoryEdit);
notesCategoryName?.addEventListener('input', () => notesCategoryName.removeAttribute('aria-invalid'));
notesCategoryName?.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); saveNoteCategoryEdit(); }
  if (event.key === 'Escape') { event.preventDefault(); closeNoteCategoryControls(); notesCategoryFilter?.focus(); }
});
notesCategoryDeleteConfirm?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  if (!category) return;
  flushNotesEditorSave();
  const result = window.NotchDomain.removeNoteCategory(loadNoteCategories(), loadNoteArchive(), category.id, Date.now());
  try {
    saveNoteArchive(result.notes);
    saveNoteCategories(result.categories);
  } catch (error) {
    showStatusToast('分类删除失败，请检查存储空间');
    return;
  }
  closeNoteCategoryControls();
  closeNoteTagControls();
  if (notesCategoryFilter) notesCategoryFilter.value = '__uncategorized__';
  renderNotesLibrary();
  showStatusToast('分类已删除，笔记已移至未分类');
  void syncWorkspaceSnapshot();
});

notesTagFilter?.addEventListener('change', () => {
  flushNotesEditorSave();
  closeNoteTagControls();
  renderNotesLibrary();
});
notesTagAdd?.addEventListener('click', () => openNoteTagEditor('create'));
notesTagRename?.addEventListener('click', () => openNoteTagEditor('rename'));
notesTagCancel?.addEventListener('click', closeNoteTagControls);
notesTagDeleteCancel?.addEventListener('click', closeNoteTagControls);
notesTagDelete?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  const tag = selectedNoteTag(category);
  if (!category || !tag || !notesTagConfirm) return;
  noteTagEditorMode = '';
  if (notesTagEditor) notesTagEditor.hidden = true;
  notesTagConfirm.hidden = false;
  if (notesTagConfirmText) notesTagConfirmText.textContent = `删除“${tag.name}”？笔记将保留在“${category.name}”。`;
  notesTagDeleteCancel?.focus({ preventScroll: true });
});

function saveNoteTagEdit() {
  if (!noteTagEditorMode || !notesTagName) return;
  const editingMode = noteTagEditorMode;
  const name = window.NotchDomain.normalizeNoteCategoryName(notesTagName.value);
  const categories = loadNoteCategories();
  const category = selectedNoteCategory(categories);
  const current = selectedNoteTag(category);
  if (!category) return;
  const duplicate = category.tags.some((tag) => tag.id !== current?.id && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!name || duplicate || (editingMode === 'create' && category.tags.length >= 30)) {
    notesTagName.setAttribute('aria-invalid', 'true');
    showStatusToast(!name ? '请输入标签名称' : duplicate ? '当前分类已有同名标签' : '每个分类最多创建 30 个标签');
    return;
  }
  const tagId = editingMode === 'rename' && current ? current.id : `note-tag-${generateId()}`;
  const tags = editingMode === 'rename'
    ? category.tags.map((tag) => tag.id === tagId ? { ...tag, name } : tag)
    : [...category.tags, { id: tagId, name }];
  try {
    saveNoteCategories(categories.map((item) => item.id === category.id ? { ...item, tags } : item));
  } catch (error) {
    showStatusToast('标签保存失败，请检查存储空间');
    return;
  }
  closeNoteTagControls();
  renderNotesLibrary();
  showStatusToast(editingMode === 'rename' ? '标签已重命名' : '标签已创建');
  void syncWorkspaceSnapshot();
}

notesTagSave?.addEventListener('click', saveNoteTagEdit);
notesTagName?.addEventListener('input', () => notesTagName.removeAttribute('aria-invalid'));
notesTagName?.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); saveNoteTagEdit(); }
  if (event.key === 'Escape') { event.preventDefault(); closeNoteTagControls(); notesTagFilter?.focus(); }
});
notesTagDeleteConfirm?.addEventListener('click', () => {
  const category = selectedNoteCategory();
  const tag = selectedNoteTag(category);
  if (!category || !tag) return;
  flushNotesEditorSave();
  const result = window.NotchDomain.removeNoteTag(loadNoteCategories(), loadNoteArchive(), category.id, tag.id, Date.now());
  try {
    saveNoteArchive(result.notes);
    saveNoteCategories(result.categories);
  } catch (error) {
    showStatusToast('标签删除失败，请检查存储空间');
    return;
  }
  closeNoteTagControls();
  if (notesTagFilter) notesTagFilter.value = '__untagged__';
  renderNotesLibrary();
  showStatusToast('标签已删除，笔记已移至无标签');
  void syncWorkspaceSnapshot();
});

*/

notesDetail?.addEventListener('change', (event) => {
  const category = event.target.closest('.notes-detail-category');
  const tag = event.target.closest('.notes-detail-tag');
  if (!category?.dataset.noteId && !tag?.dataset.noteId) return;
  flushNotesEditorSave();
  const categories = loadNoteCategories();
  const notes = loadNoteArchive();
  let updated;
  if (category) {
    const categoryId = categories.some((item) => item.id === category.value) ? category.value : '';
    updated = window.NotchDomain.updateNoteCategory(notes, category.dataset.noteId, categoryId, Date.now());
  } else {
    const note = notes.find((item) => item.id === tag.dataset.noteId);
    const parent = categories.find((item) => item.id === note?.categoryId);
    const tagId = parent?.tags.some((item) => item.id === tag.value) ? tag.value : '';
    updated = window.NotchDomain.updateNoteTag(notes, tag.dataset.noteId, tagId, Date.now());
  }
  try {
    saveNoteArchive(updated);
  } catch (error) {
    showStatusToast(category ? '笔记分类保存失败' : '笔记标签保存失败');
    renderNotesLibrary();
    return;
  }
  selectedNoteId = (category || tag).dataset.noteId;
  renderNotesLibrary();
  void syncWorkspaceSnapshot();
});

async function handleNotesDetailAction(action, event) {
  if (action === 'create-note') {
    createNote();
    return;
  }
  if (action === 'note-mode-edit' || action === 'note-mode-preview') {
    notesEditor.setDetailMode(action.endsWith('preview') ? 'preview' : 'edit');
    return;
  }
  notesEditor.flushDetailSave();
  const notes = loadNoteArchive();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) return;
  if (action === 'organize-note') {
    window.NotchAI?.openNote?.('summarize');
    return;
  }
  if (action === 'name-note-ai') {
    window.NotchAI?.openNote?.('nameNote');
    return;
  }
  if (action === 'attach-note-image') {
    const editor = notesDetail.querySelector('#notes-editor');
    if (notesEditor.detailMode() !== 'edit') {
      notesEditor.setDetailMode('edit', { force: true });
    }
    const activeEditor = notesDetail.querySelector('#notes-editor') || editor;
    const time = notesDetail.querySelector('.notes-detail-time');
    if (time) time.textContent = '正在选择图片…';
    const result = await notesAttachments.choose(note.id).catch(() => null);
    if (result?.images?.length) notesAttachments.insertReferences(activeEditor, result.images);
    else if (time) time.textContent = result?.canceled ? `已保存 · ${noteArchiveTime(note.updatedAt)}` : '图片添加失败';
    return;
  }
  if (action === 'delete-note') {
    const next = notes.filter((item) => item.id !== note.id);
    saveNoteArchive(next);
    if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === note.id) {
      localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    }
    void notesAttachments.remove(note.id).catch(() => false);
    selectedNoteId = next[0]?.id || '';
    notesEditor.setDetailMode('edit', { force: true, render: false, focus: false });
    renderNotesLibrary();
    showStatusToast('笔记已删除');
  }
}

notesDetail?.addEventListener('click', (event) => {
  const link = event.target.closest('#notes-preview [data-note-href]');
  if (!link) return;
  event.preventDefault();
  const href = safeMarkdownUrl(link.dataset.noteHref);
  if (href) window.notchAPI?.openExternal?.(href).catch(() => {});
});

document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab !== 'notes') notesEditor.flushDetailSave();
});
window.addEventListener('beforeunload', () => notesEditor.flushDetailSave());


    return Object.freeze(api);
  }

  window.NotchNotesController = Object.freeze({ createController });
})();
