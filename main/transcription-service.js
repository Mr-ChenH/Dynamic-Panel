function createTranscriptionService({
  WebSocket,
  getConfig,
  sampleRate,
  finishTimeoutMs,
  senderFor = () => null,
  eventId,
  urlFor,
}) {
  const sessions = new Map();

  function emit(session, payload) {
    const sender = senderFor(session.senderId) || session.sender;
    if (sender && !sender.isDestroyed()) sender.send('transcription:event', payload);
  }

  function transcript(session) {
    return [...session.finalSegments, session.interim].filter(Boolean).join(' ').trim();
  }

  function close(session, result = {}) {
    if (!session || session.closed) return;
    session.closed = true;
    clearTimeout(session.connectTimer);
    clearTimeout(session.finishTimer);
    sessions.delete(session.senderId);
    try { session.socket.close(); } catch (error) {}
    if (session.finishResolve) {
      session.finishResolve({ ok: result.ok !== false, transcript: transcript(session), error: result.error || null });
      session.finishResolve = null;
    }
  }

  function handleMessage(session, raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch (error) { return; }
    if (message.type === 'session.created' || message.type === 'session.updated') {
      emit(session, { type: 'status', status: 'connected' });
    } else if (message.type === 'conversation.item.input_audio_transcription.text') {
      session.interim = `${String(message.text || '').trim()}${String(message.stash || '').trim()}`;
      emit(session, { type: 'transcript', final: session.finalSegments.join(' ').trim(), interim: session.interim });
    } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(message.transcript || '').trim();
      if (text && session.finalSegments[session.finalSegments.length - 1] !== text) session.finalSegments.push(text);
      session.interim = '';
      emit(session, { type: 'transcript', final: session.finalSegments.join(' ').trim(), interim: '' });
    } else if (message.type === 'error' || message.type === 'conversation.item.input_audio_transcription.failed') {
      const details = message.error && message.error.message || '实时转写服务返回错误';
      emit(session, { type: 'error', message: details });
      session.lastError = details;
    } else if (message.type === 'session.finished') {
      close(session, { ok: !session.lastError, error: session.lastError });
    }
  }

  function start(senderId, sender) {
    const config = getConfig();
    if (!config.apiKey) return { ok: false, error: 'not_configured' };
    const existing = sessions.get(senderId);
    if (existing) close(existing, { ok: false, error: 'replaced' });
    return new Promise((resolve) => {
      const headers = { Authorization: `Bearer ${config.apiKey}`, 'OpenAI-Beta': 'realtime=v1', 'User-Agent': 'DynamicPanel/0.3' };
      if (config.workspaceId) headers['X-DashScope-WorkSpace'] = config.workspaceId;
      const socket = new WebSocket(urlFor(config), { headers });
      const session = { senderId, sender, socket, finalSegments: [], interim: '', ready: false, closed: false, startSettled: false, finishResolve: null, connectTimer: null, finishTimer: null, lastError: '' };
      sessions.set(senderId, session);
      const settle = (result) => {
        if (session.startSettled) return;
        session.startSettled = true;
        clearTimeout(session.connectTimer);
        resolve(result);
      };
      session.connectTimer = setTimeout(() => { settle({ ok: false, error: 'connect_timeout' }); close(session, { ok: false, error: 'connect_timeout' }); }, 8000);
      socket.on('open', () => {
        session.ready = true;
        socket.send(JSON.stringify({ event_id: eventId(), type: 'session.update', session: { input_audio_format: 'pcm', sample_rate: sampleRate, input_audio_transcription: { language: 'zh' }, turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 } } }));
        settle({ ok: true });
      });
      socket.on('message', (data) => handleMessage(session, data));
      socket.on('error', (error) => { const message = String(error && error.message || 'connection_failed'); emit(session, { type: 'error', message }); settle({ ok: false, error: 'connection_failed' }); close(session, { ok: false, error: message }); });
      socket.on('close', () => { settle({ ok: false, error: 'connection_closed' }); close(session, { ok: !session.lastError, error: session.lastError || null }); });
    });
  }

  function sendAudio(senderId, bytes) {
    const session = sessions.get(senderId);
    if (!session || !session.ready || session.closed || session.socket.readyState !== WebSocket.OPEN) return;
    const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
    if (!buffer.length || buffer.length > 512 * 1024) return;
    session.socket.send(JSON.stringify({ event_id: eventId(), type: 'input_audio_buffer.append', audio: buffer.toString('base64') }));
  }

  function finish(senderId) {
    const session = sessions.get(senderId);
    if (!session || session.closed) return { ok: false, error: 'not_active', transcript: '' };
    if (session.finishResolve) return { ok: false, error: 'already_finishing', transcript: transcript(session) };
    return new Promise((resolve) => {
      session.finishResolve = resolve;
      session.finishTimer = setTimeout(() => close(session, { ok: false, error: 'finish_timeout' }), finishTimeoutMs);
      if (session.socket.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ event_id: eventId(), type: 'session.finish' }));
      else close(session, { ok: false, error: 'connection_closed' });
    });
  }

  return { start, sendAudio, finish, closeAll: () => { for (const session of sessions.values()) close(session, { ok: false, error: 'app_quit' }); }, closeFor: (senderId, result) => close(sessions.get(senderId), result), sessions };
}

module.exports = { createTranscriptionService };
