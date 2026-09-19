(function exposeWorkspaceRecordingProjection() {
  function createProjection(host = {}) {
    const {
      Domain,
      elements = {},
      getLifecycle = () => null,
      getSelectedId = () => null,
      getAIConfig = () => ({}),
      getAppSettings = () => null,
      currentText = () => '',
      currentFeedback = () => '正在录音',
      formatClock,
    } = host;
    const {
      homeRecorder,
      recordingDot,
      recordingStateLabel,
      recordingTime,
      liveTranscript,
      recordingList,
      recordingDetail,
      recordingNew,
      recordStart,
      recordPause,
      recordStop,
    } = elements;

    function isActive() {
      return getLifecycle()?.isActive() === true;
    }

    function isBusy() {
      return getLifecycle()?.isBusy() === true;
    }

    function syncDraftUi() {
      const lifecycle = getLifecycle();
      const draft = lifecycle?.activeDraft();
      if (!draft) return;
      const durationMs = lifecycle.stopDuration() || lifecycle.currentDuration();
      const text = currentText();
      const status = lifecycle.status();
      draft.durationMs = durationMs;
      draft.transcript = lifecycle.transcript();
      const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
      const preview = row?.querySelector('[data-recording-preview]');
      const meta = row?.querySelector('[data-recording-meta]');
      if (preview) preview.textContent = text || currentFeedback();
      if (meta) meta.textContent = `${status === 'saving' ? '保存中' : status === 'paused' ? '已暂停' : '录音中'} · ${formatClock(durationMs)}`;
      if (getSelectedId() !== draft.id) return;
      const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
      const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
      const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
      const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
      const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
      const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
      const detailPause = recordingDetail?.querySelector('.recording-live-pause');
      const detailStop = recordingDetail?.querySelector('.recording-live-stop');
      if (detailState) detailState.textContent = status === 'saving' ? '正在保存' : status === 'paused' ? '已暂停' : '正在录音';
      if (detailDot) detailDot.dataset.state = status;
      if (detailTime) detailTime.textContent = formatClock(durationMs);
      if (detailTranscript && detailTranscript.value !== text) detailTranscript.value = text;
      if (detailFeedback) detailFeedback.textContent = text ? '转写内容会随录音实时更新' : currentFeedback();
      const transcriptionConfig = getAIConfig() || {};
      if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
      if (detailPause) {
        detailPause.textContent = status === 'paused' ? '继续' : '暂停';
        detailPause.disabled = status === 'saving';
      }
      if (detailStop) detailStop.disabled = status === 'saving';
    }

    function update() {
      const lifecycle = getLifecycle();
      const recordingActive = isActive();
      const recordingBusy = isBusy();
      const status = lifecycle?.status() || 'idle';
      const starting = lifecycle?.isStarting() === true;
      const visualState = starting ? 'requesting' : status;
      if (homeRecorder) homeRecorder.dataset.state = visualState;
      if (recordingDot) recordingDot.dataset.state = visualState;
      if (recordingStateLabel) {
        recordingStateLabel.textContent = starting
          ? '等待录音权限'
          : status === 'recording'
          ? '正在录音'
          : status === 'paused'
            ? '已暂停'
            : status === 'saving'
              ? '正在保存'
              : '快速录音';
      }
      if (recordingTime) recordingTime.textContent = formatClock(recordingActive ? lifecycle.currentDuration() : 0);
      if (recordStart) recordStart.disabled = recordingBusy;
      if (recordPause) {
        recordPause.disabled = !['recording', 'paused'].includes(status);
        recordPause.setAttribute('aria-label', status === 'paused' ? '继续录音' : '暂停录音');
        recordPause.classList.toggle('resume', status === 'paused');
      }
      if (recordStop) recordStop.disabled = !['recording', 'paused'].includes(status);
      if (recordingNew) {
        recordingNew.disabled = recordingBusy;
        recordingNew.textContent = recordingBusy ? '录制' : '录音';
        recordingNew.setAttribute('aria-label', starting
          ? '正在请求麦克风权限'
          : recordingActive ? '录音进行中' : '开始录音');
      }
      if (liveTranscript && recordingBusy) {
        const text = currentText();
        const fallback = currentFeedback();
        liveTranscript.textContent = text || fallback;
        liveTranscript.hidden = !(text || fallback);
      }
      syncDraftUi();
      getAppSettings()?.renderHomeModules?.();
      document.dispatchEvent(new CustomEvent('notch:recording-state-changed', {
        detail: { active: recordingBusy },
      }));
    }

    return Object.freeze({
      isActive,
      isBusy,
      syncDraftUi,
      update,
    });
  }

  window.NotchWorkspaceRecordingProjection = Object.freeze({ createProjection });
})();
