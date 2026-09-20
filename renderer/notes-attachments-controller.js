(function exposeNotesAttachmentsController() {
  function createController(host) {
    const {
      getApi,
      isSafeImageReference,
      replaceEditorText,
      flushEditorSave,
      getDetailTime,
      showStatusToast,
    } = host;

    function markdownImageAlt(name) {
      return String(name || '图片').replace(/[\[\]\\]/g, '').trim().slice(0, 80) || '图片';
    }

    function insertReferences(editor, images) {
      const rows = (Array.isArray(images) ? images : []).filter((image) => isSafeImageReference(image && image.imagePath));
      if (!editor || !rows.length) return false;
      const markdown = rows.map((image) => `![${markdownImageAlt(image.name)}](${image.imagePath})`).join('\n\n');
      const before = editor.value.slice(0, editor.selectionStart);
      const after = editor.value.slice(editor.selectionEnd);
      const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
      const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
      const replacement = prefix + markdown + suffix;
      const start = editor.selectionStart;
      replaceEditorText(editor, start, editor.selectionEnd, replacement, start + replacement.length, start + replacement.length);
      flushEditorSave();
      return true;
    }

    async function saveFiles(editor, files) {
      const noteId = editor?.dataset.noteId;
      const imageFiles = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/')).slice(0, 12);
      const api = getApi?.();
      if (!noteId || !imageFiles.length || typeof api?.saveNoteImage !== 'function') return false;
      const time = getDetailTime?.();
      if (time) time.textContent = '正在添加图片…';
      const saved = [];
      for (const file of imageFiles) {
        try {
          const result = await api.saveNoteImage({ noteId, bytes: new Uint8Array(await file.arrayBuffer()) });
          if (result?.ok) saved.push({ ...result, name: file.name || '粘贴的图片' });
        } catch (error) {}
      }
      if (!insertReferences(editor, saved)) {
        if (time) time.textContent = '图片添加失败';
        return false;
      }
      showStatusToast(saved.length === 1 ? '图片已添加' : `已添加 ${saved.length} 张图片`);
      return true;
    }

    async function choose(noteId) {
      const api = getApi?.();
      return typeof api?.chooseNoteImages === 'function' ? api.chooseNoteImages(noteId) : null;
    }

    async function remove(noteId) {
      const api = getApi?.();
      return typeof api?.deleteNoteImages === 'function' ? api.deleteNoteImages(noteId) : false;
    }

    return Object.freeze({ insertReferences, saveFiles, choose, remove });
  }

  window.NotchNotesAttachments = Object.freeze({ createController });
})();
