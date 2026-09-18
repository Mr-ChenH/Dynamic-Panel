(function exposeWorkspaceTranscriptionPipeline() {
  function createPipeline(host) {
    const {
      Domain,
      getConfig,
      getStream,
      getRecordingStatus,
      getTranscript,
      setTranscript,
      getInterimTranscript,
      setInterimTranscript,
      updateUi,
    } = host;
    let status = 'idle';
    let startPromise = null;
    let audioContext = null;
    let audioSource = null;
    let audioProcessor = null;
    let audioMute = null;
    let pcmQueue = [];
    let speechRecognition = null;
    let speechRecognitionBlocked = false;

    function setStatus(value) {
      status = value;
      updateUi();
    }

    function stopAudioPipeline() {
      if (audioProcessor) {
        audioProcessor.onaudioprocess = null;
        try { audioProcessor.disconnect(); } catch (error) {}
      }
      if (audioSource) {
        try { audioSource.disconnect(); } catch (error) {}
      }
      if (audioMute) {
        try { audioMute.disconnect(); } catch (error) {}
      }
      if (audioContext) audioContext.close().catch(() => {});
      audioContext = null;
      audioSource = null;
      audioProcessor = null;
      audioMute = null;
      pcmQueue = [];
    }

    function sendPcm(buffer) {
      if (!buffer || !buffer.byteLength || !window.notchAPI) return;
      if (status === 'connected') {
        window.notchAPI.sendTranscriptionAudio(buffer);
        return;
      }
      if (status === 'connecting') {
        pcmQueue.push(buffer);
        if (pcmQueue.length > 60) pcmQueue.shift();
      }
    }

    function startAudioPipeline(stream) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext || !stream) return false;
      try {
        audioContext = new AudioContext({ sampleRate: 16000 });
        audioSource = audioContext.createMediaStreamSource(stream);
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        audioMute = audioContext.createGain();
        audioMute.gain.value = 0;
        audioProcessor.onaudioprocess = (event) => {
          if (getRecordingStatus() !== 'recording') return;
          const source = event.inputBuffer.getChannelData(0);
          const pcm = Domain.resampleFloat32ToPcm16(source, audioContext.sampleRate, 16000);
          sendPcm(pcm.buffer);
        };
        audioSource.connect(audioProcessor);
        audioProcessor.connect(audioMute);
        audioMute.connect(audioContext.destination);
        return true;
      } catch (error) {
        stopAudioPipeline();
        return false;
      }
    }

    async function connectCloud(stream) {
      if (!getConfig().configured || !window.notchAPI || !stream) return { ok: false, error: 'not_configured' };
      status = 'connecting';
      pcmQueue = [];
      startAudioPipeline(stream);
      updateUi();
      let result;
      try {
        result = await window.notchAPI.startTranscription();
      } catch (error) {
        result = { ok: false, error: 'connection_failed' };
      }
      if (!result?.ok) {
        status = 'error';
        stopAudioPipeline();
        updateUi();
        return result || { ok: false };
      }
      status = 'connected';
      const queued = pcmQueue;
      pcmQueue = [];
      queued.forEach((buffer) => window.notchAPI.sendTranscriptionAudio(buffer));
      updateUi();
      return result;
    }

    function startCloud(stream = getStream()) {
      if (startPromise) return startPromise;
      startPromise = connectCloud(stream);
      return startPromise;
    }

    async function finishCloud() {
      if (!startPromise) return { ok: false, error: 'not_active', transcript: getTranscript() };
      stopAudioPipeline();
      await startPromise;
      startPromise = null;
      if (status !== 'connected') return { ok: false, error: 'not_connected', transcript: getTranscript() };
      status = 'finishing';
      updateUi();
      let result;
      try {
        result = await window.notchAPI.finishTranscription();
      } catch (error) {
        result = { ok: false, error: 'finish_failed', transcript: getTranscript() };
      }
      if (result?.transcript) setTranscript(result.transcript);
      status = result?.ok ? 'idle' : 'error';
      setInterimTranscript('');
      updateUi();
      return result;
    }

    function stopBrowser() {
      const recognition = speechRecognition;
      speechRecognition = null;
      if (recognition) {
        try { recognition.stop(); } catch (error) {}
      }
      setInterimTranscript('');
    }

    function startBrowser() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setStatus('browser-error');
        return;
      }
      if (speechRecognitionBlocked || getRecordingStatus() !== 'recording') return;
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let interim = '';
        let transcript = getTranscript();
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = String(event.results[index][0]?.transcript || '').trim();
          if (!text) continue;
          if (event.results[index].isFinal) transcript = `${transcript} ${text}`.trim();
          else interim = `${interim} ${text}`.trim();
        }
        setTranscript(transcript);
        setInterimTranscript(interim);
        updateUi();
      };
      recognition.onerror = (event) => {
        setInterimTranscript('');
        const error = String(event?.error || 'unknown');
        if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) {
          speechRecognitionBlocked = true;
          status = 'browser-error';
        }
        updateUi();
      };
      recognition.onend = () => {
        if (speechRecognition !== recognition) return;
        speechRecognition = null;
        if (getRecordingStatus() === 'recording' && !speechRecognitionBlocked) setTimeout(startBrowser, 180);
      };
      speechRecognition = recognition;
      try {
        recognition.start();
      } catch (error) {
        speechRecognition = null;
      }
    }

    function reset() {
      stopBrowser();
      stopAudioPipeline();
      status = 'idle';
      startPromise = null;
      speechRecognitionBlocked = false;
    }

    function dispose() {
      stopBrowser();
      stopAudioPipeline();
      if (startPromise && window.notchAPI) window.notchAPI.finishTranscription().catch(() => {});
      startPromise = null;
    }

    if (window.notchAPI && typeof window.notchAPI.onTranscriptionEvent === 'function') {
      window.notchAPI.onTranscriptionEvent((event) => {
        if (!event || !['recording', 'paused', 'saving'].includes(getRecordingStatus())) return;
        if (event.type === 'transcript') {
          setTranscript(String(event.final || '').trim());
          setInterimTranscript(String(event.interim || '').trim());
        } else if (event.type === 'error') status = 'error';
        updateUi();
      });
    }

    return Object.freeze({
      status: () => status,
      hasCloudSession: () => Boolean(startPromise),
      startCloud,
      finishCloud,
      startBrowser,
      stopBrowser,
      reset,
      dispose,
    });
  }

  window.NotchWorkspaceTranscriptionPipeline = Object.freeze({ createPipeline });
})();
