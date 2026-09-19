(function exposeWorkspaceRecordingLifecycle() {
  function createLifecycle(host) {
    const {
      Domain,
      elements,
      getRecordings,
      setRecordings,
      getSelectedId,
      setSelectedId,
      getSelection,
      setSelectionAnchor,
      getConfig,
      getPipeline,
      persist,
      render,
      startStrands,
      stopStrands,
      uid,
      formatClock,
    } = host;
    const { liveTranscript, recordStart, recordPause, recordStop, recordingNew } = elements;
    let mediaStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let status = 'idle';
    let audioCaptureReserved = false;
    let startedAt = 0;
    let pausedAt = 0;
    let pausedTotalMs = 0;
    let transcript = '';
    let interimTranscript = '';
    let timer = null;
    let stopDurationMs = 0;
    let captureIssue = '';
    let draftId = '';
    let transcriptionFinishPromise = null;
    const startTask = Domain.createExclusiveAsyncTask(() => updateUi());

    function releaseAudioCapture() {
      if (!audioCaptureReserved) return;
      audioCaptureReserved = false;
      const result = window.notchAPI?.endAudioCapture?.();
      result?.catch?.(() => {});
    }

    function isActive() {
      return ['recording', 'paused', 'saving'].includes(status);
    }

    function isBusy() {
      return startTask.isPending() || isActive();
    }

    function currentDuration() {
      return Domain.calculateRecordingDuration({
        startedAt,
        status,
        pausedAt,
        pausedTotalMs,
        now: Date.now(),
      });
    }

    function currentText() {
      return `${transcript} ${interimTranscript}`.trim();
    }

    function currentFeedback() {
      if (startTask.isPending()) return '等待确认麦克风权限…';
      if (captureIssue) return captureIssue;
      if (status === 'saving') return '正在保存录音…';
      const config = getConfig();
      const pipelineStatus = getPipeline()?.status() || 'idle';
      if (config.asrNeedsReentry) return '转写密钥已失效 · 请重新配置 API Key';
      if (pipelineStatus === 'browser-error') return '未配置转写 API · 音频仍在录制';
      if (pipelineStatus === 'error') return '转写连接失败 · 音频仍在录制';
      if (pipelineStatus === 'connecting') return '正在连接转写服务';
      if (status === 'paused') return '录音已暂停';
      if (!config.configured && !currentText()) return '未配置转写 API · 音频仍会保存在本机';
      return '正在录音';
    }

    function activeDraft() {
      return draftId && getRecordings().find((recording) => recording.id === draftId) || null;
    }

    function beginDraft() {
      draftId = uid('recording');
      const draft = {
        ...Domain.createRecording({ id: draftId, createdAt: startedAt, durationMs: 0, transcript: '' }),
        isDraft: true,
      };
      getRecordings().unshift(draft);
      setSelectedId(draft.id);
      setSelectionAnchor(draft.id);
      render();
    }

    function discardDraft() {
      if (!draftId) return;
      setRecordings(getRecordings().filter((recording) => recording.id !== draftId));
      getSelection().delete(draftId);
      const nextId = getRecordings()[0]?.id || '';
      setSelectedId(nextId);
      setSelectionAnchor(nextId || null);
      draftId = '';
      render();
    }

    function stopMediaTracks() {
      stopStrands();
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
    }

    function chooseMimeType() {
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
    }

    function showTranscriptMessage(message) {
      if (!liveTranscript) return;
      liveTranscript.textContent = message;
      liveTranscript.hidden = false;
    }

    async function finalize(blob, durationMs) {
      status = 'saving';
      updateUi();
      if (!blob || blob.size === 0) {
        discardDraft();
        showTranscriptMessage('录音为空 · 请检查麦克风输入');
        return;
      }
      let saved;
      try {
        saved = window.notchAPI && await window.notchAPI.saveRecording({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type || 'audio/webm',
        });
      } catch (error) {
        saved = null;
      }
      if (saved?.ok) {
        const draft = activeDraft();
        const recording = Domain.createRecording({
          id: draft?.id || uid('recording'),
          createdAt: draft?.createdAt || Date.now(),
          durationMs,
          transcript,
          audioPath: saved.audioPath,
          mimeType: saved.mimeType || blob.type,
        });
        const recordings = getRecordings();
        const draftIndex = recordings.findIndex((item) => item.id === recording.id);
        if (draftIndex >= 0) recordings.splice(draftIndex, 1, recording);
        else recordings.unshift(recording);
        draftId = '';
        setSelectedId(recording.id);
        persist();
        render();
        const config = getConfig();
        if (recording.transcript && config.autoNameRecordings === true && window.notchAPI?.organizeMaterial) {
          const expectedTitle = recording.title;
          const expectedCategory = recording.category;
          const expectedTranscript = recording.transcript;
          window.notchAPI.organizeMaterial({ kind: 'recording', sourceId: recording.id, text: expectedTranscript }).then((metadata) => {
            const target = getRecordings().find((item) => item.id === recording.id);
            if (!target || target.title !== expectedTitle || target.category !== expectedCategory || target.transcript !== expectedTranscript || !metadata?.ok) return;
            target.title = metadata.title || target.title;
            target.category = metadata.category || target.category;
            persist();
            render();
          }).catch(() => {});
        }
        showTranscriptMessage(recording.transcript || (config.configured ? '录音已保存 · 暂无转写' : '录音已保存 · 请配置转写 API'));
      } else {
        discardDraft();
        showTranscriptMessage('录音保存失败，请检查本机存储权限');
      }
    }

    function resetAfterRecording() {
      status = 'idle';
      startedAt = 0;
      releaseAudioCapture();
      pausedAt = 0;
      pausedTotalMs = 0;
      audioChunks = [];
      transcript = '';
      interimTranscript = '';
      captureIssue = '';
      updateUi();
    }

    async function startAttempt() {
      if (status !== 'idle' || !navigator.mediaDevices || !window.MediaRecorder) return;
      try {
        if (window.notchAPI?.beginAudioCapture) {
          const reservation = await window.notchAPI.beginAudioCapture();
          if (!reservation?.ok) {
            showTranscriptMessage('请先结束当前截图或录屏，再开始录音。');
            return;
          }
          audioCaptureReserved = true;
        }
        if (window.notchAPI && !(await window.notchAPI.ensureMicrophone())) {
          releaseAudioCapture();
          showTranscriptMessage('无法访问麦克风 · 请在系统设置中授权');
          return;
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        const audioTrack = mediaStream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('audio_track_unavailable');
        captureIssue = '';
        audioTrack.addEventListener('mute', () => {
          if (!['recording', 'paused'].includes(status)) return;
          captureIssue = '麦克风无输入 · 请检查系统音源';
          updateUi();
        });
        audioTrack.addEventListener('unmute', () => {
          captureIssue = '';
          updateUi();
        });
        startStrands(mediaStream);
        const mimeType = chooseMimeType();
        mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
        audioChunks = [];
        transcript = '';
        interimTranscript = '';
        startedAt = Date.now();
        stopDurationMs = 0;
        pausedTotalMs = 0;
        getPipeline().reset();
        mediaRecorder.ondataavailable = (event) => {
          if (event.data?.size) audioChunks.push(event.data);
        };
        mediaRecorder.onerror = () => {
          captureIssue = '录音中断 · 请重新开始';
          updateUi();
        };
        mediaRecorder.onstop = async () => {
          const durationMs = stopDurationMs || currentDuration();
          const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
          stopMediaTracks();
          if (transcriptionFinishPromise) {
            await transcriptionFinishPromise;
            transcriptionFinishPromise = null;
          }
          await finalize(blob, durationMs);
          resetAfterRecording();
        };
        mediaRecorder.start(1000);
        status = 'recording';
        transcriptionFinishPromise = null;
        beginDraft();
        if (getConfig().configured) getPipeline().startCloud(mediaStream);
        else getPipeline().startBrowser();
        clearInterval(timer);
        timer = setInterval(updateUi, 500);
        updateUi();
      } catch (error) {
        stopMediaTracks();
        status = 'idle';
        releaseAudioCapture();
        captureIssue = '';
        discardDraft();
        showTranscriptMessage('无法开始录音 · 请检查麦克风权限');
        updateUi();
      }
    }

    function start() {
      return startTask.run(startAttempt);
    }

    function togglePause() {
      if (!mediaRecorder) return;
      if (status === 'recording') {
        mediaRecorder.pause();
        pausedAt = Date.now();
        status = 'paused';
        if (!getConfig().configured) getPipeline().stopBrowser();
      } else if (status === 'paused') {
        pausedTotalMs += Date.now() - pausedAt;
        pausedAt = 0;
        mediaRecorder.resume();
        status = 'recording';
        if (!getConfig().configured) getPipeline().startBrowser();
      }
      updateUi();
    }

    function stop() {
      if (!mediaRecorder || !['recording', 'paused'].includes(status)) return;
      stopDurationMs = currentDuration();
      status = 'saving';
      getPipeline().stopBrowser();
      transcriptionFinishPromise = getPipeline().hasCloudSession()
        ? getPipeline().finishCloud()
        : Promise.resolve({ ok: false, error: 'not_active', transcript });
      clearInterval(timer);
      timer = null;
      updateUi();
      try {
        mediaRecorder.stop();
      } catch (error) {
        stopMediaTracks();
        releaseAudioCapture();
        status = 'idle';
        discardDraft();
        updateUi();
      }
    }

    function updateUi() {
      host.updateUi();
    }

    recordStart?.addEventListener('click', start);
    recordPause?.addEventListener('click', togglePause);
    recordStop?.addEventListener('click', stop);
    recordingNew?.addEventListener('click', start);
    window.notchAPI?.onAudioRecordingShortcut?.(async () => {
      if (['recording', 'paused'].includes(status)) {
        stop();
        return;
      }
      if (status !== 'idle' || startTask.isPending()) return;
      await window.NotchPanel?.navigate({ tab: 'recordings' });
      await start();
    });

    function dispose() {
      clearInterval(timer);
      timer = null;
      getPipeline()?.dispose();
      stopMediaTracks();
      releaseAudioCapture();
    }

    return Object.freeze({
      start,
      stop,
      togglePause,
      dispose,
      isActive,
      isBusy,
      isStarting: () => startTask.isPending(),
      status: () => status,
      stream: () => mediaStream,
      currentDuration,
      currentText,
      currentFeedback,
      transcript: () => transcript,
      setTranscript: (value) => { transcript = String(value || ''); },
      interimTranscript: () => interimTranscript,
      setInterimTranscript: (value) => { interimTranscript = String(value || ''); },
      activeDraft,
      stopDuration: () => stopDurationMs,
      captureIssue: () => captureIssue,
      draftId: () => draftId,
    });
  }

  window.NotchWorkspaceRecordingLifecycle = Object.freeze({ createLifecycle });
})();
