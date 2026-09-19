(function exposeNotesController() {
  function createController(host) {
    const { generateId, showStatusToast, syncWorkspaceSnapshot, getActiveTab } = host;

// ============ 首页 · Markdown 速记 ============
// textarea 中的原始 Markdown 始终是唯一数据源；预览只用 DOM API + textContent 构建，
// 不执行用户输入的 HTML，也不自动加载远程图片。
const NOTE_KEY = 'notch-home-note';
const NOTE_ARCHIVE_KEY = 'notch-note-archive-v1';
const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
const NOTE_CATEGORIES_KEY = 'notch-note-categories-v1';
const noteInput = document.getElementById('home-note');
const notePreview = document.getElementById('home-note-preview');
const noteSaveButton = document.getElementById('note-save-btn');
const notesList = document.getElementById('notes-list');
const notesSearch = document.getElementById('notes-search');
const notesDetail = document.getElementById('notes-detail');
const notesCount = document.getElementById('notes-count');
const notesNewButton = document.getElementById('notes-new');
const notesTaxonomyTree = document.getElementById('notes-taxonomy-tree');
const notesTaxonomyCount = document.getElementById('notes-taxonomy-count');
const notesCategoryFilter = document.getElementById('notes-category-filter');
const notesCategoryAdd = document.getElementById('notes-category-add');
const notesCategoryRename = document.getElementById('notes-category-rename');
const notesCategoryDelete = document.getElementById('notes-category-delete');
const notesCategoryEditor = document.getElementById('notes-category-editor');
const notesCategoryName = document.getElementById('notes-category-name');
const notesCategorySave = document.getElementById('notes-category-save');
const notesCategoryCancel = document.getElementById('notes-category-cancel');
const notesCategoryConfirm = document.getElementById('notes-category-confirm');
const notesCategoryConfirmText = document.getElementById('notes-category-confirm-text');
const notesCategoryDeleteCancel = document.getElementById('notes-category-delete-cancel');
const notesCategoryDeleteConfirm = document.getElementById('notes-category-delete-confirm');
const notesTagToolbar = document.getElementById('notes-tag-toolbar');
const notesTagFilter = document.getElementById('notes-tag-filter');
const notesTagAdd = document.getElementById('notes-tag-add');
const notesTagRename = document.getElementById('notes-tag-rename');
const notesTagDelete = document.getElementById('notes-tag-delete');
const notesTagEditor = document.getElementById('notes-tag-editor');
const notesTagName = document.getElementById('notes-tag-name');
const notesTagSave = document.getElementById('notes-tag-save');
const notesTagCancel = document.getElementById('notes-tag-cancel');
const notesTagConfirm = document.getElementById('notes-tag-confirm');
const notesTagConfirmText = document.getElementById('notes-tag-confirm-text');
const notesTagDeleteCancel = document.getElementById('notes-tag-delete-cancel');
const notesTagDeleteConfirm = document.getElementById('notes-tag-delete-confirm');
const noteFormatActions = document.getElementById('note-format-actions');
const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
const noteEditButton = document.getElementById('note-edit-btn');
const homeNote = document.querySelector('.home-note');

const NOTE_INLINE_PATTERNS = [
  { type: 'image', regex: /!\[([^\]\n]*)\]\((note-images\/[a-z0-9-]{6,80}\/image-[a-f0-9-]{36}\.png)\)/gi },
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
  { type: 'strong', regex: /__([^_\n]+)__/g },
  { type: 'delete', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
  { type: 'emphasis', regex: /_([^_\n]+)_/g },
];

const NOTE_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const NOTE_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NOTE_ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const NOTE_QUOTE_RE = /^\s*>\s?(.*)$/;
const NOTE_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+)$/;
const NOTE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
const NOTE_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function findNextInlineToken(text, fromIndex) {
  let next = null;
  NOTE_INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = fromIndex;
    const match = pattern.regex.exec(text);
    if (
      match &&
      (!next || match.index < next.match.index ||
        (match.index === next.match.index && priority < next.priority))
    ) {
      next = { type: pattern.type, match, priority };
    }
  });
  return next;
}

function safeNoteImageReference(rawPath) {
  const normalized = String(rawPath || '').replace(/\\/g, '/');
  return /^note-images\/[a-z0-9-]{6,80}\/image-[a-f0-9-]{36}\.png$/i.test(normalized)
    ? normalized
    : null;
}

function safeMarkdownUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function appendInlineMarkdown(parent, source, depth = 0) {
  const text = String(source || '');
  if (!text || depth > 6) {
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      parent.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    const { type, match } = token;
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (type === 'image') {
      const imagePath = safeNoteImageReference(match[2]);
      if (!imagePath || !window.notchAPI?.readNoteImage) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const image = document.createElement('img');
        image.className = 'note-preview-image';
        image.alt = match[1] || '笔记图片';
        image.dataset.noteImage = imagePath;
        image.decoding = 'async';
        window.notchAPI.readNoteImage(imagePath).then((source) => {
          if (source && image.isConnected) image.src = source;
          else if (image.isConnected) image.replaceWith(document.createTextNode('[图片不可用]'));
        }).catch(() => {
          if (image.isConnected) image.replaceWith(document.createTextNode('[图片不可用]'));
        });
        parent.append(image);
      }
    } else if (type === 'code') {
      const code = document.createElement('code');
      code.textContent = match[1];
      parent.append(code);
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (!href) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const link = document.createElement('a');
        link.dataset.noteHref = href;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.rel = 'noreferrer';
        appendInlineMarkdown(link, match[1], depth + 1);
        parent.append(link);
      }
    } else {
      const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
      const formatted = document.createElement(tagName);
      appendInlineMarkdown(formatted, match[1], depth + 1);
      parent.append(formatted);
    }

    cursor = match.index + match[0].length;
  }
}

function appendMarkdownLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index > 0) parent.append(document.createElement('br'));
    appendInlineMarkdown(parent, line);
  });
}

function isMarkdownBlockStart(line) {
  if (!line.trim()) return true;
  return (
    NOTE_FENCE_RE.test(line) ||
    NOTE_HEADING_RE.test(line) ||
    NOTE_QUOTE_RE.test(line) ||
    NOTE_TASK_RE.test(line) ||
    NOTE_ORDERED_RE.test(line) ||
    NOTE_BULLET_RE.test(line) ||
    NOTE_RULE_RE.test(line)
  );
}

function buildMarkdownPreview(source) {
  const fragment = document.createDocumentFragment();
  const normalized = String(source || '').replace(/\r\n?/g, '\n');

  if (!normalized.trim()) {
    const empty = document.createElement('p');
    empty.className = 'note-preview-empty';
    empty.textContent = '写点内容后，在这里查看排版';
    fragment.append(empty);
    return fragment;
  }

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(NOTE_FENCE_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closeFence.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(NOTE_HEADING_RE);
    if (headingMatch) {
      const heading = document.createElement('h' + headingMatch[1].length);
      appendInlineMarkdown(heading, headingMatch[2]);
      fragment.append(heading);
      index += 1;
      continue;
    }

    if (NOTE_RULE_RE.test(line)) {
      fragment.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(NOTE_QUOTE_RE);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(NOTE_QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      const quote = document.createElement('blockquote');
      appendMarkdownLines(quote, quoteLines);
      fragment.append(quote);
      continue;
    }

    const taskMatch = line.match(NOTE_TASK_RE);
    if (taskMatch) {
      const list = document.createElement('ul');
      list.className = 'note-task-list';
      while (index < lines.length) {
        const match = lines[index].match(NOTE_TASK_RE);
        if (!match) break;
        const done = match[1].toLowerCase() === 'x';
        const item = document.createElement('li');
        item.className = 'note-task-item' + (done ? ' done' : '');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(done));
        const box = document.createElement('span');
        box.className = 'note-task-box';
        box.setAttribute('aria-hidden', 'true');
        box.textContent = done ? '✓' : '';
        const content = document.createElement('span');
        appendInlineMarkdown(content, match[2]);
        item.append(box, content);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const orderedMatch = line.match(NOTE_ORDERED_RE);
    if (orderedMatch) {
      const list = document.createElement('ol');
      const start = Number.parseInt(orderedMatch[1], 10);
      if (Number.isFinite(start) && start !== 1) list.start = start;
      while (index < lines.length) {
        const match = lines[index].match(NOTE_ORDERED_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const bulletMatch = line.match(NOTE_BULLET_RE);
    if (bulletMatch) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        if (NOTE_TASK_RE.test(lines[index])) break;
        const match = lines[index].match(NOTE_BULLET_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[1]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendMarkdownLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}

function renderNotePreview() {
  if (!noteInput || !notePreview) return;
  notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
}

function replaceNoteText(
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd,
  selectionDirection = 'none'
) {
  if (!noteInput) return;
  noteInput.setRangeText(replacement, start, end, 'end');
  noteInput.focus({ preventScroll: true });
  noteInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapNoteSelection(open, close, placeholder) {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);

  const hasOuterMarkers =
    selected &&
    start >= open.length &&
    noteInput.value.slice(start - open.length, start) === open &&
    noteInput.value.slice(end, end + close.length) === close;
  if (hasOuterMarkers) {
    replaceNoteText(
      start - open.length,
      end + close.length,
      selected,
      start - open.length,
      end - open.length,
      direction
    );
    return;
  }

  if (selected && selected.startsWith(open) && selected.endsWith(close)) {
    const unwrapped = selected.slice(open.length, selected.length - close.length);
    replaceNoteText(start, end, unwrapped, start, start + unwrapped.length, direction);
    return;
  }

  const content = selected || placeholder;
  const replacement = open + content + close;
  replaceNoteText(
    start,
    end,
    replacement,
    start + open.length,
    start + open.length + content.length,
    direction
  );
}

function stripNoteBlockPrefix(line) {
  return line.replace(
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/,
    ''
  );
}

function applyNoteLineFormat(type) {
  if (!noteInput) return;
  const value = noteInput.value;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd;
  if (end > start && value[end - 1] === '\n') {
    lineEnd = end - 1;
  } else {
    const nextBreak = value.indexOf('\n', end);
    lineEnd = nextBreak === -1 ? value.length : nextBreak;
  }

  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const matchers = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
    ordered: /^\d+[.)]\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };
  const matcher = matchers[type];
  if (!matcher) return;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => matcher.test(line.trimStart()));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    if (shouldRemove) return indentation + body.replace(matcher, '');
    const content = stripNoteBlockPrefix(body) || (
      type === 'heading' ? '标题' :
      type === 'task' ? '待办' :
      type === 'quote' ? '引用' : '项目'
    );
    if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
    if (type === 'heading') return indentation + '# ' + content;
    if (type === 'task') return indentation + '- [ ] ' + content;
    if (type === 'quote') return indentation + '> ' + content;
    return indentation + '- ' + content;
  }).join('\n');

  const emptySingleLine = lines.length === 1 && !original.trim() && !shouldRemove;
  let nextStart = lineStart;
  let nextEnd = lineStart + transformed.length;
  if (emptySingleLine) {
    const indentationLength = original.match(/^\s*/)[0].length;
    const prefixLength =
      type === 'heading' ? 2 :
      type === 'task' ? 6 :
      type === 'ordered' ? 3 : 2;
    nextStart += indentationLength + prefixLength;
  }
  replaceNoteText(lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
}

function applyNoteLink() {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);
  const label = selected || '链接文字';
  const url = 'https://';
  const replacement = '[' + label + '](' + url + ')';
  if (selected) {
    const urlStart = start + label.length + 3;
    replaceNoteText(start, end, replacement, urlStart, urlStart + url.length, direction);
  } else {
    replaceNoteText(start, end, replacement, start + 1, start + 1 + label.length, direction);
  }
}

let noteComposing = false;

function applyNoteFormat(type) {
  if (!noteInput || noteComposing) return;
  if (type === 'bold') return wrapNoteSelection('**', '**', '加粗文字');
  if (type === 'italic') return wrapNoteSelection('*', '*', '斜体文字');
  if (type === 'code') return wrapNoteSelection('`', '`', '代码');
  if (type === 'link') return applyNoteLink();
  applyNoteLineFormat(type);
}

let noteMode = 'edit';
let noteSelection = { start: 0, end: 0, direction: 'none', scrollTop: 0 };

function setNoteMode(mode, focusTarget = true) {
  if (!noteInput || !notePreview) return;
  const previousMode = noteMode;
  noteMode = mode === 'preview' ? 'preview' : 'edit';
  const isPreview = noteMode === 'preview';

  if (isPreview) {
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
    renderNotePreview();
  } else if (previousMode === 'edit') {
    // 重复点击已选中的“编辑”时保留用户当下光标，而不是恢复旧选区。
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
  }

  noteInput.hidden = isPreview;
  notePreview.hidden = !isPreview;
  if (noteFormatActions) noteFormatActions.hidden = isPreview;
  if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
  noteModeButtons.forEach((button) => {
    const active = button.dataset.noteMode === noteMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (noteEditButton) {
    noteEditButton.classList.toggle('active', !isPreview);
    noteEditButton.textContent = isPreview ? '编辑' : '完成';
    noteEditButton.setAttribute('aria-pressed', String(!isPreview));
  }

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) {
      notePreview.focus({ preventScroll: true });
    } else {
      noteInput.focus({ preventScroll: true });
      noteInput.setSelectionRange(
        noteSelection.start,
        noteSelection.end,
        noteSelection.direction
      );
      noteInput.scrollTop = noteSelection.scrollTop;
    }
  });
}

function applyNoteTabIndentation(editor, event) {
  if (
    !editor ||
    event.key !== 'Tab' ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing
  ) {
    return false;
  }
  event.preventDefault();
  const change = window.NotchDomain.adjustNoteIndentation(
    editor.value,
    editor.selectionStart,
    editor.selectionEnd,
    event.shiftKey
  );
  if (change.value === editor.value) return true;
  const direction = editor.selectionDirection;
  editor.setRangeText(change.replacement, change.replaceStart, change.replaceEnd, 'end');
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(change.selectionStart, change.selectionEnd, direction);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function continueNoteList(event) {
  if (
    !noteInput ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing ||
    noteInput.selectionStart !== noteInput.selectionEnd
  ) {
    return false;
  }

  const value = noteInput.value;
  const cursor = noteInput.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const patterns = [
    {
      regex: /^(\s*)[-*+]\s+\[[ xX]\]\s*(.*)$/,
      prefix: () => '- [ ] ',
    },
    {
      regex: /^(\s*)(\d+)[.)]\s+(.*)$/,
      prefix: (match) => String(Number.parseInt(match[2], 10) + 1) + '. ',
    },
    {
      regex: /^(\s*)[-*+]\s+(.*)$/,
      prefix: () => '- ',
    },
    {
      regex: /^(\s*)>\s?(.*)$/,
      prefix: () => '> ',
    },
  ];

  const definition = patterns.find((candidate) => candidate.regex.test(line));
  if (!definition) return false;
  const match = line.match(definition.regex);
  const content = match[match.length - 1];
  const indentation = match[1];
  event.preventDefault();

  if (!content.trim()) {
    replaceNoteText(
      lineStart,
      lineEnd,
      indentation,
      lineStart + indentation.length,
      lineStart + indentation.length
    );
    return true;
  }

  const prefix = indentation + definition.prefix(match);
  const insertion = '\n' + prefix;
  replaceNoteText(cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

if (noteInput) {
  try {
    noteInput.value = localStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    // ignore
  }

  let noteTimer = null;
  const saveNote = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    if (workspaceReloadPending) return;
    try {
      localStorage.setItem(NOTE_KEY, noteInput.value);
    } catch (e) {
      // ignore quota errors
    }
  };

  noteInput.addEventListener('input', () => {
    if (!noteInput.value.trim()) localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    renderNotePreview();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 300);
  });
  noteInput.addEventListener('blur', saveNote);
  noteInput.addEventListener('compositionstart', () => {
    noteComposing = true;
  });
  noteInput.addEventListener('compositionend', () => {
    noteComposing = false;
  });
  noteInput.addEventListener('keydown', (event) => {
    if (applyNoteTabIndentation(noteInput, event)) return;
    if (continueNoteList(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    applyNoteFormat(key === 'b' ? 'bold' : 'italic');
  });

  window.addEventListener('beforeunload', saveNote);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNote();
  });

  noteInput.hidden = false;
}

function loadNoteCategories() {
  try {
    return window.NotchDomain.normalizeNoteCategories(JSON.parse(localStorage.getItem(NOTE_CATEGORIES_KEY) || '[]'));
  } catch (error) {
    return [];
  }
}

function loadNoteArchive() {
  try {
    const parsed = window.NotchDomain.normalizeNoteArchive(JSON.parse(localStorage.getItem(NOTE_ARCHIVE_KEY) || '[]'));
    const categories = new Map(loadNoteCategories().map((category) => [category.id, new Set(category.tags.map((tag) => tag.id))]));
    return parsed.map((note) => {
      const tags = categories.get(note.categoryId);
      if (!tags) return { ...note, categoryId: '', tagId: '' };
      return tags.has(note.tagId) ? note : { ...note, tagId: '' };
    });
  } catch (error) {
    return [];
  }
}

function noteCategoryName(note, categories = loadNoteCategories()) {
  return categories.find((category) => category.id === String(note && note.categoryId || ''))?.name || '未分类';
}

function noteTagName(note, categories = loadNoteCategories()) {
  const category = categories.find((item) => item.id === String(note && note.categoryId || ''));
  return category?.tags.find((tag) => tag.id === String(note && note.tagId || ''))?.name || '';
}

function saveNoteCategories(categories) {
  const normalized = window.NotchDomain.normalizeNoteCategories(categories);
  localStorage.setItem(NOTE_CATEGORIES_KEY, JSON.stringify(normalized));
  return normalized;
}

let selectedNoteId = '';
let noteCategoryEditorMode = '';
let noteTagEditorMode = '';
const expandedNoteCategories = new Set();

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
let notesEditorMode = 'edit';

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
    button.classList.toggle('active', notesEditorMode === mode);
    button.setAttribute('aria-pressed', String(notesEditorMode === mode));
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
  toolbar.hidden = notesEditorMode !== 'edit';
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
  editor.hidden = notesEditorMode !== 'edit';
  const preview = document.createElement('article');
  preview.id = 'notes-preview';
  preview.className = 'note-preview notes-preview';
  preview.tabIndex = 0;
  preview.hidden = notesEditorMode !== 'preview';
  if (notesEditorMode === 'preview') preview.replaceChildren(buildMarkdownPreview(note.content));
  content.append(editor, preview);
  notesDetail.append(header, toolbar, content);
  requestNoteTitle(note);
}

let notesSaveTimer = null;
let pendingNotesEditor = null;
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
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next.slice(0, 200)));
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

function persistNotesEditor(editor) {
  if (!editor || !editor.dataset.noteId) return;
  const notes = window.NotchDomain.updateNoteInArchive(
    loadNoteArchive(),
    editor.dataset.noteId,
    editor.value,
    Date.now()
  );
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  const updated = notes.find((note) => note.id === editor.dataset.noteId);
  if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === editor.dataset.noteId && noteInput) {
    noteInput.value = editor.value;
    localStorage.setItem(NOTE_KEY, editor.value);
    renderNotePreview();
  }
  updateSavedNotePresentation(updated);
  void requestNoteTitle(updated);
  if (pendingNotesEditor === editor) pendingNotesEditor = null;
}

function flushNotesEditorSave() {
  if (workspaceReloadPending) return;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  const editor = pendingNotesEditor;
  pendingNotesEditor = null;
  if (editor) persistNotesEditor(editor);
}

function scheduleNotesEditorSave(editor) {
  pendingNotesEditor = editor;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在保存…';
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    const pending = pendingNotesEditor;
    pendingNotesEditor = null;
    if (pending) persistNotesEditor(pending);
  }, 220);
}

function renderNotesLibrary() {
  if (!notesList) return;
  const categories = loadNoteCategories();
  const archive = loadNoteArchive();
  renderNoteCategoryControls(categories, archive);
  const selectedCategory = selectedNoteCategory(categories);
  renderNoteTagControls(selectedCategory, archive);
  renderNotesTaxonomy(categories, archive);
  const categoryId = notesCategoryFilter?.value || '';
  const tagId = selectedCategory ? notesTagFilter?.value || '' : '';
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
  flushNotesEditorSave();
  const now = Date.now();
  const selectedCategoryId = selectedNoteCategory()?.id || '';
  const selectedTagId = selectedCategoryId ? selectedNoteTag()?.id || '' : '';
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
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
  } catch (error) {
    showStatusToast('无法创建笔记，请检查存储空间');
    return null;
  }
  selectedNoteId = note.id;
  notesEditorMode = 'edit';
  if (notesSearch) notesSearch.value = '';
  if (notesCategoryFilter && selectedCategoryId) notesCategoryFilter.value = selectedCategoryId;
  renderNotesLibrary();
  requestAnimationFrame(() => notesDetail?.querySelector('.notes-detail-title')?.focus({ preventScroll: true }));
  return note;
}

function replaceNotesEditorText(editor, start, end, replacement, selectionStart, selectionEnd) {
  editor.setRangeText(replacement, start, end, 'end');
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(selectionStart, selectionEnd);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyNotesEditorFormat(editor, type) {
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const inline = {
    bold: ['**', '**', '加粗文字'],
    italic: ['*', '*', '斜体文字'],
    code: ['`', '`', '代码'],
  }[type];
  if (inline) {
    const content = selected || inline[2];
    const replacement = inline[0] + content + inline[1];
    replaceNotesEditorText(
      editor, start, end, replacement,
      start + inline[0].length,
      start + inline[0].length + content.length
    );
    return;
  }
  if (type === 'link') {
    const label = selected || '链接文字';
    const replacement = `[${label}](https://)`;
    const urlStart = start + label.length + 3;
    replaceNotesEditorText(editor, start, end, replacement, urlStart, urlStart + 8);
    return;
  }
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const prefixes = { heading: '# ', bullet: '- ', task: '- [ ] ', quote: '> ' };
  const prefix = prefixes[type];
  if (!prefix) return;
  const matcher = type === 'heading' ? /^#{1,6}\s+/ :
    type === 'task' ? /^[-*+]\s+\[[ xX]\]\s+/ :
      type === 'quote' ? /^>\s?/ : /^[-*+]\s+/;
  const remove = lines.filter((line) => line.trim()).every((line) => matcher.test(line.trimStart()));
  const replacement = lines.map((line) => {
    if (!line.trim()) return remove ? '' : prefix;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    return indentation + (remove ? body.replace(matcher, '') : prefix + stripNoteBlockPrefix(body));
  }).join('\n');
  replaceNotesEditorText(editor, lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length);
}

function continueNotesEditorList(editor, event) {
  if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey
    || event.isComposing || editor.selectionStart !== editor.selectionEnd) return false;
  const cursor = editor.selectionStart;
  const lineStart = editor.value.lastIndexOf('\n', cursor - 1) + 1;
  const line = editor.value.slice(lineStart, cursor);
  const match = line.match(/^(\s*)([-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)(.*)$/);
  if (!match) return false;
  event.preventDefault();
  if (!match[3].trim()) {
    replaceNotesEditorText(editor, lineStart, cursor, match[1], lineStart + match[1].length, lineStart + match[1].length);
    return true;
  }
  let prefix = match[2];
  const ordered = prefix.match(/^(\d+)[.)]\s+$/);
  if (ordered) prefix = `${Number(ordered[1]) + 1}. `;
  if (/^[-*+]\s+\[[ xX]\]\s+$/i.test(prefix)) prefix = '- [ ] ';
  const insertion = `\n${match[1]}${prefix}`;
  replaceNotesEditorText(editor, cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

function markdownImageAlt(name) {
  return String(name || '图片').replace(/[\[\]\\]/g, '').trim().slice(0, 80) || '图片';
}

function insertNoteImageReferences(editor, images) {
  const rows = (Array.isArray(images) ? images : []).filter((image) => safeNoteImageReference(image && image.imagePath));
  if (!editor || !rows.length) return false;
  const markdown = rows.map((image) => `![${markdownImageAlt(image.name)}](${image.imagePath})`).join('\n\n');
  const before = editor.value.slice(0, editor.selectionStart);
  const after = editor.value.slice(editor.selectionEnd);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
  const replacement = prefix + markdown + suffix;
  const start = editor.selectionStart;
  replaceNotesEditorText(editor, start, editor.selectionEnd, replacement, start + replacement.length, start + replacement.length);
  flushNotesEditorSave();
  return true;
}

async function saveNoteImageFiles(editor, files) {
  const noteId = editor?.dataset.noteId;
  const imageFiles = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/')).slice(0, 12);
  if (!noteId || !imageFiles.length || !window.notchAPI?.saveNoteImage) return false;
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在添加图片…';
  const saved = [];
  for (const file of imageFiles) {
    try {
      const result = await window.notchAPI.saveNoteImage({
        noteId,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (result?.ok) saved.push({ ...result, name: file.name || '粘贴的图片' });
    } catch (error) {}
  }
  if (!insertNoteImageReferences(editor, saved)) {
    if (time) time.textContent = '图片添加失败';
    return false;
  }
  showStatusToast(saved.length === 1 ? '图片已添加' : `已添加 ${saved.length} 张图片`);
  return true;
}

function setNotesEditorMode(mode) {
  const next = mode === 'preview' ? 'preview' : 'edit';
  if (next === notesEditorMode) return;
  flushNotesEditorSave();
  notesEditorMode = next;
  renderNotesDetail(loadNoteArchive());
  requestAnimationFrame(() => notesDetail?.querySelector(next === 'preview' ? '#notes-preview' : '#notes-editor')?.focus({ preventScroll: true }));
}

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
    flushNotesEditorSave();
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
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(updated)); } catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot(), undo: { noteId, before: note.title, after: title, expectedText: note.content.trim() } };
  },
  async undoAIName(token) {
    flushNotesEditorSave();
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === token?.noteId);
    if (!note || noteArchiveTitle(note) !== token.after || note.content.trim() !== token.expectedText) return { ok: false, error: 'conflict' };
    const updated = window.NotchDomain.updateNoteTitle(notes, note.id, token.before, Date.now());
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(updated)); } catch (error) { return { ok: false, error: 'save_failed' }; }
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
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next)); }
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
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next)); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    return { ok: true, workspaceSynced: await syncWorkspaceSnapshot() };
  },
  async undoGenerated(snapshot) {
    const notes = loadNoteArchive();
    const note = notes.find((item) => item.id === snapshot?.id);
    if (!note || note.title !== snapshot.title || note.content !== snapshot.content || note.categoryId !== snapshot.categoryId || note.tagId !== snapshot.tagId || note.createdAt !== snapshot.createdAt) return { ok: false, error: 'conflict' };
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.filter((item) => item.id !== note.id))); }
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
    try { localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify([note, ...notes])); }
    catch (error) { return { ok: false, error: 'save_failed' }; }
    renderNotesLibrary();
    const workspaceSynced = await syncWorkspaceSnapshot();
    return { ok: true, noteId: note.id, note: { ...note }, workspaceSynced };
  },
  select: (noteId) => {
    if (!loadNoteArchive().some((note) => note.id === noteId)) return false;
    selectedNoteId = noteId;
    if (notesSearch) notesSearch.value = '';
    if (notesCategoryFilter) notesCategoryFilter.value = '';
    if (notesTagFilter) notesTagFilter.value = '';
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
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
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
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(result.notes.slice(0, 200)));
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
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(result.notes.slice(0, 200)));
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
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(updated.slice(0, 200)));
  } catch (error) {
    showStatusToast(category ? '笔记分类保存失败' : '笔记标签保存失败');
    renderNotesLibrary();
    return;
  }
  selectedNoteId = (category || tag).dataset.noteId;
  renderNotesLibrary();
  void syncWorkspaceSnapshot();
});

notesDetail?.addEventListener('input', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const notes = window.NotchDomain.updateNoteTitle(
      loadNoteArchive(),
      title.dataset.noteId,
      title.value,
      Date.now()
    );
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
    updateSavedNotePresentation(notes.find((note) => note.id === title.dataset.noteId));
    return;
  }
  const editor = event.target.closest('#notes-editor');
  if (editor) {
    notesDetail.querySelectorAll('[data-action="organize-note"], [data-action="name-note-ai"]').forEach((button) => button.toggleAttribute('disabled', !editor.value.trim()));
    scheduleNotesEditorSave(editor);
  }
});

notesDetail?.addEventListener('focusout', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const note = loadNoteArchive().find((item) => item.id === title.dataset.noteId);
    if (note) title.value = note.title;
  }
  if (event.target.closest('#notes-editor')) flushNotesEditorSave();
});

notesDetail?.addEventListener('mousedown', (event) => {
  if (event.target.closest('[data-notes-format]')) event.preventDefault();
});

notesDetail?.addEventListener('click', async (event) => {
  const format = event.target.closest('[data-notes-format]')?.dataset.notesFormat;
  if (format) {
    applyNotesEditorFormat(notesDetail.querySelector('#notes-editor'), format);
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'create-note') {
    createNote();
    return;
  }
  if (action === 'note-mode-edit' || action === 'note-mode-preview') {
    setNotesEditorMode(action.endsWith('preview') ? 'preview' : 'edit');
    return;
  }
  flushNotesEditorSave();
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
    if (notesEditorMode !== 'edit') {
      notesEditorMode = 'edit';
      renderNotesDetail(notes);
    }
    const activeEditor = notesDetail.querySelector('#notes-editor') || editor;
    const time = notesDetail.querySelector('.notes-detail-time');
    if (time) time.textContent = '正在选择图片…';
    const result = await window.notchAPI?.chooseNoteImages?.(note.id).catch(() => null);
    if (result?.images?.length) insertNoteImageReferences(activeEditor, result.images);
    else if (time) time.textContent = result?.canceled ? `已保存 · ${noteArchiveTime(note.updatedAt)}` : '图片添加失败';
    return;
  }
  if (action === 'delete-note') {
    const next = notes.filter((item) => item.id !== note.id);
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next));
    if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === note.id) {
      localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    }
    void window.notchAPI?.deleteNoteImages?.(note.id).catch(() => false);
    selectedNoteId = next[0]?.id || '';
    notesEditorMode = 'edit';
    renderNotesLibrary();
    showStatusToast('笔记已删除');
  }
});

notesDetail?.addEventListener('keydown', (event) => {
  const editor = event.target.closest('#notes-editor');
  if (!editor) return;
  if (applyNoteTabIndentation(editor, event)) return;
  if (continueNotesEditorList(editor, event)) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (key !== 'b' && key !== 'i') return;
  event.preventDefault();
  applyNotesEditorFormat(editor, key === 'b' ? 'bold' : 'italic');
});

notesDetail?.addEventListener('paste', (event) => {
  const editor = event.target.closest('#notes-editor');
  if (!editor) return;
  const images = Array.from(event.clipboardData?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  void saveNoteImageFiles(editor, images);
});

notesDetail?.addEventListener('dragover', (event) => {
  const editor = event.target.closest('#notes-editor')
    || (event.target.closest('.notes-content') && notesDetail.querySelector('#notes-editor'));
  if (!editor || !Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  notesDetail.classList.add('is-image-dragging');
});

notesDetail?.addEventListener('dragleave', (event) => {
  if (!notesDetail.contains(event.relatedTarget)) notesDetail.classList.remove('is-image-dragging');
});

notesDetail?.addEventListener('drop', (event) => {
  notesDetail.classList.remove('is-image-dragging');
  const editor = event.target.closest('#notes-editor')
    || (event.target.closest('.notes-content') && notesDetail.querySelector('#notes-editor'));
  if (!editor) return;
  const images = Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  void saveNoteImageFiles(editor, images);
});

notesDetail?.addEventListener('click', (event) => {
  const link = event.target.closest('#notes-preview [data-note-href]');
  if (!link) return;
  event.preventDefault();
  const href = safeMarkdownUrl(link.dataset.noteHref);
  if (href) window.notchAPI?.openExternal?.(href).catch(() => {});
});

document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab !== 'notes') flushNotesEditorSave();
});
window.addEventListener('beforeunload', flushNotesEditorSave);

if (noteFormatActions) {
  noteFormatActions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-note-format]')) event.preventDefault();
  });
  noteFormatActions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-format]');
    if (!button) return;
    applyNoteFormat(button.dataset.noteFormat);
  });
}

noteModeButtons.forEach((button) => {
  button.addEventListener('click', () => setNoteMode(button.dataset.noteMode));
});
noteEditButton?.addEventListener('click', () => setNoteMode(noteMode === 'preview' ? 'edit' : 'preview'));

if (notePreview) {
  notePreview.addEventListener('click', (event) => {
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
  notePreview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
}


    return Object.freeze(api);
  }

  window.NotchNotesController = Object.freeze({ createController });
})();
