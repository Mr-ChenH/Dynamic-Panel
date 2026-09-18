(function exposeWorkspaceRecordingsView() {
  function createView(host) {
    const {
      Domain,
      elements,
      getRecordings,
      setRecordings,
      getSelectedId,
      setSelectedId,
      getSelection,
      setSelection,
      getSelectionAnchor,
      setSelectionAnchor,
      getStatus,
      currentText,
      currentFeedback,
      formatClock,
      formatShortDate,
      persist,
      syncDraftUi,
      pauseRecording,
      stopRecording,
      openTranscriptionSettings,
      createIconButton,
      icons,
    } = host;
    const { recordingList, recordingDetail, recordingCount, recordingBulkDelete } = elements;
    let currentAudioUrl = '';

    async function loadAudio(recording, container) {
      if (!window.notchAPI || !recording.audioPath) return;
      const result = await window.notchAPI.readRecording(recording.audioPath);
      if (!result || getSelectedId() !== recording.id || !container.isConnected) {
        container.textContent = '音频文件不可用';
        return;
      }
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = currentAudioUrl;
      container.replaceChildren(audio);
    }

    async function deleteOne(recordingId) {
      const recordings = getRecordings();
      const recording = recordings.find((item) => item.id === recordingId);
      if (!recording) return;
      if (window.notchAPI && recording.audioPath) await window.notchAPI.deleteRecording(recording.audioPath).catch(() => false);
      const next = Domain.removeRecordingState(recordings, recording.id, [...getSelection()], getSelectedId());
      setRecordings(next.recordings);
      setSelection(new Set(next.selection));
      setSelectedId(next.selectedId);
      setSelectionAnchor(next.selectedId || null);
      persist();
      render();
    }

    function renderDetail() {
      if (!recordingDetail) return;
      const recording = getRecordings().find((item) => item.id === getSelectedId());
      recordingDetail.replaceChildren();
      if (!recording) {
        const empty = document.createElement('div');
        empty.className = 'recording-detail-empty';
        empty.textContent = '完成一次录音后，音频和转写文本会保存在这里。';
        recordingDetail.appendChild(empty);
        return;
      }
      if (recording.isDraft) {
        const liveHeader = document.createElement('header');
        liveHeader.className = 'recording-live-head';
        const liveState = document.createElement('div');
        liveState.className = 'recording-live-state';
        const liveDot = document.createElement('span');
        liveDot.className = 'recording-state-dot';
        liveDot.dataset.recordingLiveDot = '';
        liveDot.dataset.state = getStatus();
        const liveLabel = document.createElement('strong');
        liveLabel.dataset.recordingLiveState = '';
        const liveTime = document.createElement('time');
        liveTime.dataset.recordingLiveTime = '';
        liveState.append(liveDot, liveLabel);
        liveHeader.append(liveState, liveTime);
        const liveAudio = document.createElement('div');
        liveAudio.className = 'recording-live-audio';
        const liveAudioTitle = document.createElement('strong');
        liveAudioTitle.textContent = '音频正在本机录制';
        const liveAudioHint = document.createElement('span');
        liveAudioHint.textContent = '结束后会自动保存并出现播放器';
        const liveControls = document.createElement('div');
        liveControls.className = 'recording-live-controls';
        const pause = document.createElement('button');
        pause.type = 'button';
        pause.className = 'workspace-button compact recording-live-pause';
        pause.textContent = getStatus() === 'paused' ? '继续' : '暂停';
        pause.addEventListener('click', pauseRecording);
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'workspace-button compact primary recording-live-stop';
        stop.textContent = '结束并保存';
        stop.addEventListener('click', stopRecording);
        liveControls.append(pause, stop);
        liveAudio.append(liveAudioTitle, liveAudioHint, liveControls);
        const transcriptHead = document.createElement('div');
        transcriptHead.className = 'recording-transcript-head';
        const transcriptLabel = document.createElement('span');
        transcriptLabel.className = 'tile-label';
        transcriptLabel.textContent = '实时转写';
        const configure = document.createElement('button');
        configure.type = 'button';
        configure.className = 'workspace-button compact recording-live-configure';
        configure.dataset.action = 'configure-transcription';
        configure.textContent = '配置 API';
        configure.addEventListener('click', openTranscriptionSettings);
        transcriptHead.append(transcriptLabel, configure);
        const transcript = document.createElement('textarea');
        transcript.className = 'recording-transcript-editor recording-live-transcript';
        transcript.readOnly = true;
        transcript.dataset.recordingLiveTranscript = '';
        transcript.placeholder = '开始说话后，转写内容会出现在这里。';
        transcript.setAttribute('aria-label', '实时转写文本');
        const feedback = document.createElement('p');
        feedback.className = 'recording-live-feedback';
        feedback.dataset.recordingLiveFeedback = '';
        feedback.setAttribute('aria-live', 'polite');
        recordingDetail.append(liveHeader, liveAudio, transcriptHead, transcript, feedback);
        syncDraftUi();
        return;
      }
      const header = document.createElement('header');
      header.className = 'recording-detail-head';
      const title = document.createElement('input');
      title.className = 'recording-title-input';
      title.value = recording.title;
      title.setAttribute('aria-label', '录音名称');
      const meta = document.createElement('span');
      meta.textContent = `${recording.category || '未分类'} · ${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
      header.append(title, meta);
      const audioWrap = document.createElement('div');
      audioWrap.className = 'recording-audio';
      audioWrap.textContent = '正在读取音频…';
      const transcriptHead = document.createElement('div');
      transcriptHead.className = 'recording-transcript-head';
      const label = document.createElement('span');
      label.className = 'tile-label';
      label.textContent = '转写文本';
      const actions = document.createElement('div');
      const organize = document.createElement('button');
      organize.type = 'button'; organize.className = 'workspace-button compact recording-organize';
      organize.dataset.action = 'organize-recording'; organize.textContent = '整理录音';
      organize.disabled = !recording.transcript.trim();
      const nameWithAI = document.createElement('button');
      nameWithAI.type = 'button'; nameWithAI.className = 'workspace-button compact';
      nameWithAI.dataset.action = 'name-recording-ai'; nameWithAI.textContent = '生成名称';
      nameWithAI.disabled = !recording.transcript.trim();
      actions.append(
        nameWithAI, organize,
        createIconButton('copy-recording', '复制转写文本', icons.copy),
        createIconButton('reveal-recording', '在文件夹中显示', icons.open),
        createIconButton('delete-recording', '删除录音', icons.delete, true)
      );
      transcriptHead.append(label, actions);
      const transcript = document.createElement('textarea');
      transcript.className = 'recording-transcript-editor';
      transcript.value = recording.transcript;
      transcript.placeholder = '当前环境没有生成实时转写。你仍可播放音频，或在这里补充文字。';
      transcript.setAttribute('aria-label', '录音转写文本');
      recordingDetail.append(header, audioWrap, transcriptHead, transcript);
      title.addEventListener('change', () => {
        if (title.value.trim()) recording.title = title.value.trim();
        title.value = recording.title;
        persist();
        renderList();
      });
      transcript.addEventListener('input', () => {
        recording.transcript = transcript.value;
        organize.disabled = !recording.transcript.trim();
        nameWithAI.disabled = !recording.transcript.trim();
        persist();
      });
      actions.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'organize-recording') window.NotchAI?.openRecording?.(recording.id);
        if (action.dataset.action === 'name-recording-ai') window.NotchAI?.openRecordingName?.(recording.id);
        if (action.dataset.action === 'copy-recording' && window.notchAPI && recording.transcript) await window.notchAPI.writeClipboard({ type: 'text', text: recording.transcript });
        if (action.dataset.action === 'reveal-recording' && window.notchAPI && recording.audioPath) await window.notchAPI.revealRecording(recording.audioPath);
        if (action.dataset.action === 'delete-recording') await deleteOne(recording.id);
      });
      void loadAudio(recording, audioWrap);
    }

    function renderList() {
      if (!recordingList) return;
      const recordings = getRecordings();
      const selection = getSelection();
      recordingList.replaceChildren();
      if (recordingBulkDelete) {
        recordingBulkDelete.hidden = selection.size === 0;
        recordingBulkDelete.textContent = '删除';
        recordingBulkDelete.setAttribute('aria-label', selection.size ? `删除 ${selection.size} 项` : '删除所选');
      }
      if (!recordings.length) {
        const empty = document.createElement('div');
        empty.className = 'recording-list-empty';
        empty.textContent = '还没有录音';
        recordingList.appendChild(empty);
        return;
      }
      recordings.forEach((recording) => {
        const row = document.createElement('div');
        row.className = `recording-item${recording.id === getSelectedId() ? ' active' : ''}${selection.has(recording.id) ? ' multi-selected' : ''}${recording.isDraft ? ' is-live' : ''}`;
        row.dataset.id = recording.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recording-item-main';
        button.setAttribute('aria-label', `打开录音：${recording.title}`);
        const title = document.createElement('strong');
        title.textContent = recording.title;
        const preview = document.createElement('span');
        preview.dataset.recordingPreview = '';
        preview.textContent = recording.isDraft ? (currentText() || currentFeedback()) : (recording.transcript || '仅音频 · 暂无转写');
        const meta = document.createElement('time');
        meta.dataset.recordingMeta = '';
        meta.textContent = recording.isDraft
          ? `${getStatus() === 'saving' ? '保存中' : getStatus() === 'paused' ? '已暂停' : '录音中'} · ${formatClock(recording.durationMs)}`
          : `${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
        button.append(title, preview, meta);
        row.append(button);
        if (!recording.isDraft) {
          const remove = createIconButton('delete-recording-item', `删除录音：${recording.title}`, icons.delete, true);
          remove.classList.add('recording-item-delete');
          row.append(remove);
        }
        recordingList.appendChild(row);
      });
    }

    function render() {
      if (recordingCount) recordingCount.textContent = `${getRecordings().length} 条`;
      renderList();
      renderDetail();
    }

    recordingList?.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-action="delete-recording-item"]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('.recording-item[data-id]');
        if (row) await deleteOne(row.dataset.id);
        return;
      }
      const item = event.target.closest('.recording-item[data-id]');
      if (!item) return;
      const recordings = getRecordings();
      const target = recordings.find((recording) => recording.id === item.dataset.id);
      if (event.shiftKey && target && !target.isDraft) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          recordings.filter((recording) => !recording.isDraft).map((recording) => recording.id),
          [...getSelection()], item.dataset.id, getSelectionAnchor(), true
        );
        setSelection(new Set(result.selected));
        setSelectionAnchor(result.anchor);
        renderList();
        return;
      }
      setSelectedId(item.dataset.id);
      setSelectionAnchor(item.dataset.id);
      render();
    });

    recordingBulkDelete?.addEventListener('click', async () => {
      const selection = getSelection();
      if (!selection.size) return;
      const targets = getRecordings().filter((recording) => !recording.isDraft && selection.has(recording.id));
      if (!targets.length) return;
      if (window.notchAPI) {
        await Promise.all(targets.map((recording) => recording.audioPath
          ? window.notchAPI.deleteRecording(recording.audioPath).catch(() => false)
          : Promise.resolve(true)));
      }
      const targetIds = new Set(targets.map((recording) => recording.id));
      const recordings = getRecordings().filter((recording) => !targetIds.has(recording.id));
      setRecordings(recordings);
      selection.clear();
      setSelectedId(recordings[0]?.id || '');
      setSelectionAnchor(recordings[0]?.id || null);
      persist();
      render();
    });

    function dispose() {
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = '';
    }

    return Object.freeze({ render, renderList, renderDetail, deleteOne, dispose });
  }

  window.NotchWorkspaceRecordingsView = Object.freeze({ createView });
})();
