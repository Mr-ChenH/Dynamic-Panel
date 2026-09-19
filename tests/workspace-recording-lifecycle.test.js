const test = require('node:test');
const assert = require('node:assert/strict');

const Domain = require('../renderer/domain');

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadLifecycleModule(windowValue) {
  const modulePath = require.resolve('../renderer/workspace-recording-lifecycle');
  delete require.cache[modulePath];
  global.window = windowValue;
  require(modulePath);
  return windowValue.NotchWorkspaceRecordingLifecycle;
}

function createButton() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get('click')?.();
    },
  };
}

function createHarness(options = {}) {
  let recordings = [];
  let selectedId = '';
  let selectionAnchor = '';
  let persistCount = 0;
  let renderCount = 0;
  let releaseCount = 0;
  let stoppedTracks = 0;
  const selection = new Set();
  const audioTrack = {
    readyState: 'live',
    addEventListener() {},
    stop() { stoppedTracks += 1; },
  };
  const stream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack],
  };
  const pipelineCalls = [];
  const pipeline = {
    reset() { pipelineCalls.push('reset'); },
    startCloud() { pipelineCalls.push('startCloud'); },
    startBrowser() { pipelineCalls.push('startBrowser'); },
    stopBrowser() { pipelineCalls.push('stopBrowser'); },
    hasCloudSession() { return false; },
    finishCloud() { return Promise.resolve({ ok: false, error: 'not_active' }); },
    status() { return 'idle'; },
    dispose() { pipelineCalls.push('dispose'); },
  };
  const liveTranscript = { textContent: '', hidden: true };
  const notchAPI = {
    beginAudioCapture: async () => ({ ok: true }),
    ensureMicrophone: async () => true,
    endAudioCapture: async () => { releaseCount += 1; },
    saveRecording: async () => ({ ok: true, audioPath: 'recordings/test.webm', mimeType: 'audio/webm' }),
    onAudioRecordingShortcut() {},
    ...options.notchAPI,
  };
  const windowValue = { notchAPI, MediaRecorder: null };
  const api = loadLifecycleModule(windowValue);

  class MockMediaRecorder {
    static isTypeSupported(type) {
      return type === 'audio/webm;codecs=opus';
    }

    constructor(inputStream, config) {
      this.stream = inputStream;
      this.mimeType = config?.mimeType || 'audio/webm';
      this.state = 'inactive';
      MockMediaRecorder.instance = this;
    }

    start() {
      this.state = 'recording';
      this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
    }

    pause() {
      this.state = 'paused';
    }

    resume() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  }
  windowValue.MediaRecorder = MockMediaRecorder;
  global.MediaRecorder = MockMediaRecorder;
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });

  const lifecycle = api.createLifecycle({
    Domain,
    elements: {
      liveTranscript,
      recordStart: createButton(),
      recordPause: createButton(),
      recordStop: createButton(),
      recordingNew: createButton(),
    },
    getRecordings: () => recordings,
    setRecordings: (value) => { recordings = value; },
    getSelectedId: () => selectedId,
    setSelectedId: (value) => { selectedId = value; },
    getSelection: () => selection,
    setSelectionAnchor: (value) => { selectionAnchor = value; },
    getConfig: () => ({ configured: options.configured === true, autoNameRecordings: false }),
    getPipeline: () => pipeline,
    persist: () => { persistCount += 1; },
    render: () => { renderCount += 1; },
    startStrands() {},
    stopStrands() {},
    uid: () => 'recording-test',
    updateUi() {},
  });

  return {
    lifecycle,
    liveTranscript,
    pipelineCalls,
    stream,
    state: () => ({ recordings, selectedId, selectionAnchor, persistCount, renderCount, releaseCount, stoppedTracks }),
  };
}

test('recording lifecycle promotes a live draft after MediaRecorder stops', async () => {
  const harness = createHarness();

  await harness.lifecycle.start();
  assert.equal(harness.lifecycle.status(), 'recording');
  assert.equal(harness.state().recordings.length, 1);
  assert.equal(harness.state().recordings[0].isDraft, true);
  assert.deepEqual(harness.pipelineCalls, ['reset', 'startBrowser']);

  harness.lifecycle.stop();
  await flushAsyncWork();
  await flushAsyncWork();

  const state = harness.state();
  assert.equal(harness.lifecycle.status(), 'idle');
  assert.equal(state.recordings.length, 1);
  assert.equal(state.recordings[0].isDraft, undefined);
  assert.equal(state.recordings[0].audioPath, 'recordings/test.webm');
  assert.equal(state.persistCount, 1);
  assert.equal(state.releaseCount, 1);
  assert.equal(state.stoppedTracks, 1);
  assert.match(harness.liveTranscript.textContent, /录音已保存/);
});

test('recording lifecycle pauses and resumes MediaRecorder with browser transcription', async () => {
  const harness = createHarness();

  await harness.lifecycle.start();
  harness.lifecycle.togglePause();
  assert.equal(harness.lifecycle.status(), 'paused');
  assert.deepEqual(harness.pipelineCalls, ['reset', 'startBrowser', 'stopBrowser']);

  harness.lifecycle.togglePause();
  assert.equal(harness.lifecycle.status(), 'recording');
  assert.deepEqual(harness.pipelineCalls, ['reset', 'startBrowser', 'stopBrowser', 'startBrowser']);

  harness.lifecycle.dispose();
});

test('recording lifecycle releases reservation and discards its draft when saving fails', async () => {
  const harness = createHarness({
    notchAPI: {
      saveRecording: async () => ({ ok: false, error: 'write_failed' }),
    },
  });

  await harness.lifecycle.start();
  harness.lifecycle.stop();
  await flushAsyncWork();
  await flushAsyncWork();

  const state = harness.state();
  assert.equal(harness.lifecycle.status(), 'idle');
  assert.deepEqual(state.recordings, []);
  assert.equal(state.persistCount, 0);
  assert.equal(state.releaseCount, 1);
  assert.match(harness.liveTranscript.textContent, /录音保存失败/);
});

test('recording lifecycle dispose releases capture and transcription resources', async () => {
  const harness = createHarness({ configured: true });

  await harness.lifecycle.start();
  assert.deepEqual(harness.pipelineCalls, ['reset', 'startCloud']);

  harness.lifecycle.dispose();

  const state = harness.state();
  assert.equal(state.releaseCount, 1);
  assert.equal(state.stoppedTracks, 1);
  assert.deepEqual(harness.pipelineCalls, ['reset', 'startCloud', 'dispose']);
});
