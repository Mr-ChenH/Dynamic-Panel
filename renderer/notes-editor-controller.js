(function exposeNotesEditor() {
  function createController(host) {
    const {
      document,
      storage,
      domain,
      buildMarkdownPreview,
      safeMarkdownUrl,
      getDetailElement = () => document.getElementById('notes-detail'),
      getArchive,
      saveArchive,
      updateSavedNotePresentation,
      requestNoteTitle,
      renderDetail,
      getWorkspaceReloadPending = () => false,
    } = host;

    const NOTE_KEY = 'notch-home-note';
    const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
    const noteInput = document.getElementById('home-note');
    const notePreview = document.getElementById('home-note-preview');
    const noteFormatActions = document.getElementById('note-format-actions');
    const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
    const noteEditButton = document.getElementById('note-edit-btn');
    const homeNote = document.querySelector('.home-note');
    const state = {
      homeMode: 'edit',
      homeSelection: { start: 0, end: 0, direction: 'none', scrollTop: 0 },
      homeComposing: false,
      homeTimer: null,
      detailMode: 'edit',
      detailTimer: null,
      pendingDetailEditor: null,
      boundDetail: false,
    };

    function raf(callback) {
      return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0);
    }

    function renderHomePreview() {
      if (!noteInput || !notePreview) return;
      notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
    }

    function replaceText(editor, start, end, replacement, selectionStart, selectionEnd, direction = 'none') {
      if (!editor) return;
      editor.setRangeText(replacement, start, end, 'end');
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(selectionStart, selectionEnd, direction);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function stripBlockPrefix(line) {
      return line.replace(/^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '');
    }

    function applyTabIndentation(editor, event, composing = false) {
      if (!editor || event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || composing) return false;
      event.preventDefault();
      const change = domain.adjustNoteIndentation(editor.value, editor.selectionStart, editor.selectionEnd, event.shiftKey);
      if (change.value === editor.value) return true;
      const direction = editor.selectionDirection;
      editor.setRangeText(change.replacement, change.replaceStart, change.replaceEnd, 'end');
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(change.selectionStart, change.selectionEnd, direction);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    function continueList(editor, event, composing = false) {
      if (!editor || event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || composing || editor.selectionStart !== editor.selectionEnd) return false;
      const value = editor.value;
      const cursor = editor.selectionStart;
      const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
      const nextBreak = value.indexOf('\n', cursor);
      const lineEnd = nextBreak === -1 ? value.length : nextBreak;
      const line = value.slice(lineStart, lineEnd);
      const match = line.match(/^(\s*)([-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)(.*)$/);
      if (!match) return false;
      event.preventDefault();
      if (!match[3].trim()) {
        replaceText(editor, lineStart, cursor, match[1], lineStart + match[1].length, lineStart + match[1].length);
        return true;
      }
      let prefix = match[2];
      const ordered = prefix.match(/^(\d+)[.)]\s+$/);
      if (ordered) prefix = `${Number(ordered[1]) + 1}. `;
      if (/^[-*+]\s+\[[ xX]\]\s+$/i.test(prefix)) prefix = '- [ ] ';
      const insertion = `\n${match[1]}${prefix}`;
      replaceText(editor, cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
      return true;
    }

    function wrapHomeSelection(open, close, placeholder) {
      if (!noteInput) return;
      const start = noteInput.selectionStart;
      const end = noteInput.selectionEnd;
      const direction = noteInput.selectionDirection;
      const selected = noteInput.value.slice(start, end);
      const hasOuterMarkers = selected && start >= open.length && noteInput.value.slice(start - open.length, start) === open && noteInput.value.slice(end, end + close.length) === close;
      if (hasOuterMarkers) {
        replaceText(noteInput, start - open.length, end + close.length, selected, start - open.length, end - open.length, direction);
        return;
      }
      if (selected && selected.startsWith(open) && selected.endsWith(close)) {
        const unwrapped = selected.slice(open.length, selected.length - close.length);
        replaceText(noteInput, start, end, unwrapped, start, start + unwrapped.length, direction);
        return;
      }
      const content = selected || placeholder;
      const replacement = open + content + close;
      replaceText(noteInput, start, end, replacement, start + open.length, start + open.length + content.length, direction);
    }

    function applyHomeLineFormat(type) {
      if (!noteInput) return;
      const value = noteInput.value;
      const start = noteInput.selectionStart;
      const end = noteInput.selectionEnd;
      const direction = noteInput.selectionDirection;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = end > start && value[end - 1] === '\n' ? end - 1 : (() => {
        const nextBreak = value.indexOf('\n', end);
        return nextBreak === -1 ? value.length : nextBreak;
      })();
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const matchers = { heading: /^#{1,6}\s+/, bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/, ordered: /^\d+[.)]\s+/, task: /^[-*+]\s+\[[ xX]\]\s+/, quote: /^>\s+/ };
      const matcher = matchers[type];
      if (!matcher) return;
      const shouldRemove = lines.filter((line) => line.trim()).length > 0 && lines.filter((line) => line.trim()).every((line) => matcher.test(line.trimStart()));
      let orderedIndex = 1;
      const transformed = lines.map((line) => {
        if (!line.trim() && lines.length > 1) return line;
        const indentation = line.match(/^\s*/)[0];
        const body = line.slice(indentation.length);
        if (shouldRemove) return indentation + body.replace(matcher, '');
        const content = stripBlockPrefix(body) || (type === 'heading' ? '标题' : type === 'task' ? '待办' : type === 'quote' ? '引用' : '项目');
        if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
        if (type === 'heading') return indentation + '# ' + content;
        if (type === 'task') return indentation + '- [ ] ' + content;
        if (type === 'quote') return indentation + '> ' + content;
        return indentation + '- ' + content;
      }).join('\n');
      const emptySingleLine = lines.length === 1 && !lines[0].trim() && !shouldRemove;
      let nextStart = lineStart;
      const nextEnd = lineStart + transformed.length;
      if (emptySingleLine) {
        const indentationLength = lines[0].match(/^\s*/)[0].length;
        const prefixLength = type === 'heading' ? 2 : type === 'task' ? 6 : type === 'ordered' ? 3 : 2;
        nextStart += indentationLength + prefixLength;
      }
      replaceText(noteInput, lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
    }

    function applyHomeFormat(type) {
      if (!noteInput || state.homeComposing) return;
      if (type === 'bold') return wrapHomeSelection('**', '**', '加粗文字');
      if (type === 'italic') return wrapHomeSelection('*', '*', '斜体文字');
      if (type === 'code') return wrapHomeSelection('`', '`', '代码');
      if (type === 'link') {
        const start = noteInput.selectionStart;
        const end = noteInput.selectionEnd;
        const direction = noteInput.selectionDirection;
        const selected = noteInput.value.slice(start, end);
        const label = selected || '链接文字';
        const replacement = '[' + label + '](https://)';
        const urlStart = start + label.length + 3;
        replaceText(noteInput, start, end, replacement, selected ? urlStart : start + 1, selected ? urlStart + 8 : start + 1 + label.length, direction);
        return;
      }
      applyHomeLineFormat(type);
    }

    function setHomeMode(mode, focusTarget = true) {
      if (!noteInput || !notePreview) return;
      const previousMode = state.homeMode;
      state.homeMode = mode === 'preview' ? 'preview' : 'edit';
      const isPreview = state.homeMode === 'preview';
      if (isPreview || previousMode === 'edit') {
        state.homeSelection = { start: noteInput.selectionStart, end: noteInput.selectionEnd, direction: noteInput.selectionDirection, scrollTop: noteInput.scrollTop };
      }
      if (isPreview) renderHomePreview();
      noteInput.hidden = isPreview;
      notePreview.hidden = !isPreview;
      if (noteFormatActions) noteFormatActions.hidden = isPreview;
      if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
      noteModeButtons.forEach((button) => {
        const active = button.dataset.noteMode === state.homeMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      if (noteEditButton) {
        noteEditButton.classList.toggle('active', !isPreview);
        noteEditButton.textContent = isPreview ? '编辑' : '完成';
        noteEditButton.setAttribute('aria-pressed', String(!isPreview));
      }
      if (!focusTarget) return;
      raf(() => {
        if (isPreview) notePreview.focus({ preventScroll: true });
        else {
          noteInput.focus({ preventScroll: true });
          noteInput.setSelectionRange(state.homeSelection.start, state.homeSelection.end, state.homeSelection.direction);
          noteInput.scrollTop = state.homeSelection.scrollTop;
        }
      });
    }

    function saveHomeNote() {
      if (state.homeTimer) clearTimeout(state.homeTimer);
      state.homeTimer = null;
      if (getWorkspaceReloadPending()) return;
      try { storage.setItem(NOTE_KEY, noteInput?.value || ''); } catch (error) { /* quota errors leave the in-memory draft intact */ }
    }

    function bindHomeEditor() {
      if (!noteInput) return;
      try { noteInput.value = storage.getItem(NOTE_KEY) || ''; } catch (error) { /* ignore malformed or unavailable storage */ }
      noteInput.addEventListener('input', () => {
        if (!noteInput.value.trim()) storage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
        renderHomePreview();
        clearTimeout(state.homeTimer);
        state.homeTimer = setTimeout(saveHomeNote, 300);
      });
      noteInput.addEventListener('blur', saveHomeNote);
      noteInput.addEventListener('compositionstart', () => { state.homeComposing = true; });
      noteInput.addEventListener('compositionend', () => { state.homeComposing = false; });
      noteInput.addEventListener('keydown', (event) => {
        if (applyTabIndentation(noteInput, event, state.homeComposing)) return;
        if (continueList(noteInput, event, state.homeComposing)) return;
        if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
        const key = event.key.toLowerCase();
        if (key !== 'b' && key !== 'i') return;
        event.preventDefault();
        applyHomeFormat(key === 'b' ? 'bold' : 'italic');
      });
      window.addEventListener('beforeunload', saveHomeNote);
      document.addEventListener('visibilitychange', () => { if (document.hidden) saveHomeNote(); });
      noteFormatActions?.addEventListener('mousedown', (event) => { if (event.target.closest('[data-note-format]')) event.preventDefault(); });
      noteFormatActions?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-note-format]');
        if (button) applyHomeFormat(button.dataset.noteFormat);
      });
      noteModeButtons.forEach((button) => button.addEventListener('click', () => setHomeMode(button.dataset.noteMode)));
      noteEditButton?.addEventListener('click', () => setHomeMode(state.homeMode === 'preview' ? 'edit' : 'preview'));
      notePreview?.addEventListener('click', (event) => {
        const link = event.target.closest('[data-note-href]');
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        const href = safeMarkdownUrl(link.dataset.noteHref);
        if (href) host.getApi?.()?.openExternal?.(href).catch(() => {});
      });
      notePreview?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const link = event.target.closest('[data-note-href]');
        if (!link) return;
        event.preventDefault();
        const href = safeMarkdownUrl(link.dataset.noteHref);
        if (href) host.getApi?.()?.openExternal?.(href).catch(() => {});
      });
      noteInput.hidden = false;
    }

    function applyDetailFormat(editor, type) {
      if (!editor) return;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.slice(start, end);
      const inline = { bold: ['**', '**', '加粗文字'], italic: ['*', '*', '斜体文字'], code: ['`', '`', '代码'] }[type];
      if (inline) {
        const content = selected || inline[2];
        const replacement = inline[0] + content + inline[1];
        replaceText(editor, start, end, replacement, start + inline[0].length, start + inline[0].length + content.length, editor.selectionDirection);
        return;
      }
      if (type === 'link') {
        const label = selected || '链接文字';
        const replacement = `[${label}](https://)`;
        const urlStart = start + label.length + 3;
        replaceText(editor, start, end, replacement, urlStart, urlStart + 8, editor.selectionDirection);
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
      const matcher = type === 'heading' ? /^#{1,6}\s+/ : type === 'task' ? /^[-*+]\s+\[[ xX]\]\s+/ : type === 'quote' ? /^>\s?/ : /^[-*+]\s+/;
      const remove = lines.filter((line) => line.trim()).every((line) => matcher.test(line.trimStart()));
      const replacement = lines.map((line) => {
        if (!line.trim()) return remove ? '' : prefix;
        const indentation = line.match(/^\s*/)[0];
        const body = line.slice(indentation.length);
        return indentation + (remove ? body.replace(matcher, '') : prefix + stripBlockPrefix(body));
      }).join('\n');
      replaceText(editor, lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length, editor.selectionDirection);
    }

    function persistDetailEditor(editor) {
      if (!editor?.dataset.noteId) return;
      const notes = domain.updateNoteInArchive(getArchive(), editor.dataset.noteId, editor.value, Date.now());
      saveArchive(notes);
      const updated = notes.find((note) => note.id === editor.dataset.noteId);
      if (storage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === editor.dataset.noteId && noteInput) {
        noteInput.value = editor.value;
        storage.setItem(NOTE_KEY, editor.value);
        renderHomePreview();
      }
      updateSavedNotePresentation(updated);
      void requestNoteTitle(updated);
      if (state.pendingDetailEditor === editor) state.pendingDetailEditor = null;
    }

    function flushDetailSave() {
      if (getWorkspaceReloadPending()) return;
      if (state.detailTimer) clearTimeout(state.detailTimer);
      state.detailTimer = null;
      const editor = state.pendingDetailEditor;
      state.pendingDetailEditor = null;
      if (editor) persistDetailEditor(editor);
    }

    function scheduleDetailSave(editor) {
      state.pendingDetailEditor = editor;
      if (state.detailTimer) clearTimeout(state.detailTimer);
      const time = getDetailElement()?.querySelector('.notes-detail-time');
      if (time) time.textContent = '正在保存…';
      state.detailTimer = setTimeout(() => {
        state.detailTimer = null;
        const pending = state.pendingDetailEditor;
        state.pendingDetailEditor = null;
        if (pending) persistDetailEditor(pending);
      }, 220);
    }

    function handleDetailInput(event) {
      const title = event.target.closest('.notes-detail-title');
      if (title?.dataset.noteId) {
        const notes = domain.updateNoteTitle(getArchive(), title.dataset.noteId, title.value, Date.now());
        saveArchive(notes);
        updateSavedNotePresentation(notes.find((note) => note.id === title.dataset.noteId));
        return true;
      }
      const editor = event.target.closest('#notes-editor');
      if (!editor) return false;
      getDetailElement()?.querySelectorAll('[data-action="organize-note"], [data-action="name-note-ai"]').forEach((button) => button.toggleAttribute('disabled', !editor.value.trim()));
      scheduleDetailSave(editor);
      return true;
    }

    function handleDetailFocusout(event) {
      const title = event.target.closest('.notes-detail-title');
      if (title?.dataset.noteId) {
        const note = getArchive().find((item) => item.id === title.dataset.noteId);
        if (note) title.value = note.title;
      }
      if (event.target.closest('#notes-editor')) flushDetailSave();
    }

    function setDetailMode(mode, options = {}) {
      const next = mode === 'preview' ? 'preview' : 'edit';
      if (next === state.detailMode && !options.force) return;
      flushDetailSave();
      state.detailMode = next;
      if (options.render !== false) renderDetail(getArchive());
      if (options.focus === false) return;
      raf(() => getDetailElement()?.querySelector(next === 'preview' ? '#notes-preview' : '#notes-editor')?.focus({ preventScroll: true }));
    }

    function bindDetailEditor({ attachments, onAction } = {}) {
      if (state.boundDetail) return;
      const detail = getDetailElement();
      if (!detail) return;
      state.boundDetail = true;
      detail.addEventListener('input', handleDetailInput);
      detail.addEventListener('focusout', handleDetailFocusout);
      detail.addEventListener('mousedown', (event) => { if (event.target.closest('[data-notes-format]')) event.preventDefault(); });
      detail.addEventListener('click', (event) => {
        const format = event.target.closest('[data-notes-format]')?.dataset.notesFormat;
        if (format) {
          applyDetailFormat(detail.querySelector('#notes-editor'), format);
          return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action) onAction?.(action, event);
      });
      detail.addEventListener('keydown', (event) => {
        const editor = event.target.closest('#notes-editor');
        if (!editor) return;
        if (applyTabIndentation(editor, event)) return;
        if (continueList(editor, event)) return;
        if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
        const key = event.key.toLowerCase();
        if (key !== 'b' && key !== 'i') return;
        event.preventDefault();
        applyDetailFormat(editor, key === 'b' ? 'bold' : 'italic');
      });
      detail.addEventListener('paste', (event) => {
        const editor = event.target.closest('#notes-editor');
        if (!editor) return;
        const images = Array.from(event.clipboardData?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
        if (!images.length) return;
        event.preventDefault();
        void attachments?.saveFiles(editor, images);
      });
      detail.addEventListener('dragover', (event) => {
        const editor = event.target.closest('#notes-editor') || (event.target.closest('.notes-content') && detail.querySelector('#notes-editor'));
        if (!editor || !Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        detail.classList.add('is-image-dragging');
      });
      detail.addEventListener('dragleave', (event) => { if (!detail.contains(event.relatedTarget)) detail.classList.remove('is-image-dragging'); });
      detail.addEventListener('drop', (event) => {
        detail.classList.remove('is-image-dragging');
        const editor = event.target.closest('#notes-editor') || (event.target.closest('.notes-content') && detail.querySelector('#notes-editor'));
        if (!editor) return;
        const images = Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
        if (!images.length) return;
        event.preventDefault();
        void attachments?.saveFiles(editor, images);
      });
    }

    bindHomeEditor();

    return Object.freeze({
      renderHomePreview,
      homeValue: () => noteInput?.value || '',
      setHomeMode,
      homeMode: () => state.homeMode,
      applyHomeFormat,
      detailMode: () => state.detailMode,
      setDetailMode,
      applyDetailFormat,
      flushDetailSave,
      scheduleDetailSave,
      replaceEditorText: (editor, ...args) => replaceText(editor, ...args),
      bindDetailEditor,
      getDetailEditor: () => getDetailElement()?.querySelector('#notes-editor') || null,
      dispose: () => {
        if (state.homeTimer) clearTimeout(state.homeTimer);
        if (state.detailTimer) clearTimeout(state.detailTimer);
      },
    });
  }

  window.NotchNotesEditor = Object.freeze({ createController });
})();
