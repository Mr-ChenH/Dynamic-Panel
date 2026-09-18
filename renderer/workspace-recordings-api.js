(function exposeWorkspaceRecordingsApi() {
  function createApi(host) {
    const {
      getRecordings,
      getSelectedRecordingId,
      persist,
      render,
      syncWorkspaceData,
      startRecording,
      isRecordingActive,
    } = host;

    function recordingRows() {
      return getRecordings().filter((recording) => !recording.isDraft && recording.transcript.trim()).map((recording) => ({
        sourceType: 'recording',
        sourceId: recording.id,
        sourceTitle: recording.title,
        sourceRevision: String(recording.updatedAt || recording.createdAt || ''),
        text: recording.transcript,
        detail: recording.category || '未分类',
        updatedAt: recording.updatedAt || recording.createdAt || 0,
      }));
    }

    return Object.freeze({
      recordingContext(id = getSelectedRecordingId()) {
        const recording = getRecordings().find((item) => item.id === id && !item.isDraft);
        return recording ? { sourceType: 'recording', sourceId: recording.id, sourceTitle: recording.title, text: recording.transcript, createdAt: recording.createdAt } : null;
      },
      recordingRows,
      async applyAIName(source, titleValue, categoryValue) {
        if (source?.sourceType !== 'recording') return { ok: false, error: 'invalid_source' };
        const title = String(titleValue || '').trim().slice(0, 80);
        const category = String(categoryValue || '').trim().slice(0, 24);
        if (!title) return { ok: false, error: 'missing_title' };
        const recording = getRecordings().find((item) => item.id === source.sourceId && !item.isDraft);
        if (!recording || recording.transcript.trim() !== source.text.trim() || recording.title !== source.sourceTitle) return { ok: false, error: 'source_changed' };
        const undo = {
          sourceType: 'recording', id: recording.id,
          beforeTitle: recording.title, beforeCategory: recording.category,
          afterTitle: title, afterCategory: category || recording.category,
          expectedText: recording.transcript.trim(),
        };
        recording.title = undo.afterTitle;
        recording.category = undo.afterCategory;
        if (!persist()) {
          recording.title = undo.beforeTitle;
          recording.category = undo.beforeCategory;
          return { ok: false, error: 'save_failed' };
        }
        render();
        return { ok: true, undo, workspaceSynced: await syncWorkspaceData() };
      },
      async undoAIName(token) {
        if (token?.sourceType !== 'recording') return { ok: false, error: 'invalid_source' };
        const recording = getRecordings().find((item) => item.id === token.id && !item.isDraft);
        if (!recording || recording.title !== token.afterTitle || recording.category !== token.afterCategory || recording.transcript.trim() !== token.expectedText) return { ok: false, error: 'conflict' };
        recording.title = token.beforeTitle;
        recording.category = token.beforeCategory;
        if (!persist()) {
          recording.title = token.afterTitle;
          recording.category = token.afterCategory;
          return { ok: false, error: 'save_failed' };
        }
        render();
        return { ok: true, workspaceSynced: await syncWorkspaceData() };
      },
      startRecording,
      isRecordingActive,
    });
  }

  window.NotchWorkspaceRecordingsApi = Object.freeze({ createApi });
})();
