'use strict';

const { validateRequest, normalizeResponse, TEXT_ACTIONS } = require('./schema');
const { PROMPT_VERSION, actionPrompt } = require('./prompts');
const { providerFor } = require('./providers');

function endpointFor(baseUrl, adapterId = 'openai-chat') {
  const value = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = adapterId === 'anthropic-messages' ? '/v1/messages' : '/chat/completions';
  return value.endsWith(suffix) ? value : `${value}${suffix}`;
}

function providerError(status) {
  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  return `http_${status}`;
}

function completionError(payload) {
  const reason = String(payload?.choices?.[0]?.finish_reason || '').toLowerCase();
  if (!reason || reason === 'stop') return '';
  if (reason === 'length') return 'output_truncated';
  if (reason === 'content_filter') return 'content_filtered';
  return 'unsupported_finish_reason';
}

const MAX_PROVIDER_BYTES = 256 * 1024;

async function readProviderStream(response, onDelta, options = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', total = 0, usage = null, completed = false, doneMarker = false, malformed = false, finishReason = '', terminalError = '';
  const consume = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { completed = true; doneMarker = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch (error) { malformed = true; return; }
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) { content += delta; if (onDelta) onDelta(delta); }
    if (choice?.finish_reason) {
      completed = true;
      const reason = String(choice.finish_reason);
      finishReason ||= reason;
      terminalError ||= completionError({ choices: [{ finish_reason: reason }] });
    }
    if (chunk?.usage) usage = chunk.usage;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_BYTES) { await reader.cancel().catch(() => {}); throw Error('response_too_large'); }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || '';
    blocks.forEach(consume);
  }
  buffer += decoder.decode();
  if (buffer.trim()) buffer.split(/\r?\n\r?\n/).forEach(consume);
  if (malformed) throw Error('invalid_stream');
  if (!completed || (options.requireDoneMarker && !doneMarker)) throw Error('stream_incomplete');
  if (terminalError) throw Error(terminalError);
  return { choices: [{ message: { content }, finish_reason: finishReason || null }], usage };
}

async function readProviderPayload(response, onDelta, options = {}) {
  const declared = Number(response && response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BYTES) throw Error('response_too_large');
  if (!response || !response.body || typeof response.body.getReader !== 'function') return response.json();
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream')) return readProviderStream(response, onDelta, options);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_BYTES) { await reader.cancel().catch(() => {}); throw Error('response_too_large'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function anthropicFinishReason(reason) {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length';
  if (reason === 'refusal') return 'content_filter';
  return reason || null;
}

function normalizeAnthropicPayload(payload) {
  const content = Array.isArray(payload?.content)
    ? payload.content.filter((block) => block?.type === 'text').map((block) => String(block.text || '')).join('')
    : '';
  return {
    choices: [{ message: { content }, finish_reason: anthropicFinishReason(payload?.stop_reason) }],
    usage: payload?.usage ? {
      prompt_tokens: Number(payload.usage.input_tokens) || 0,
      completion_tokens: Number(payload.usage.output_tokens) || 0,
    } : null,
  };
}

async function readAnthropicStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', total = 0, completed = false, malformed = false, stopReason = '', inputTokens = 0, outputTokens = 0;
  const consume = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!data) return;
    let event;
    try { event = JSON.parse(data); } catch (error) { malformed = true; return; }
    if (event.type === 'message_start') inputTokens = Number(event.message?.usage?.input_tokens) || inputTokens;
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const delta = String(event.delta.text || '');
      content += delta;
      if (delta && onDelta) onDelta(delta);
    }
    if (event.type === 'message_delta') {
      stopReason = String(event.delta?.stop_reason || stopReason);
      outputTokens = Number(event.usage?.output_tokens) || outputTokens;
    }
    if (event.type === 'message_stop') completed = true;
    if (event.type === 'error') throw Error('provider_stream_error');
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_BYTES) { await reader.cancel().catch(() => {}); throw Error('response_too_large'); }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || '';
    blocks.forEach(consume);
  }
  buffer += decoder.decode();
  if (buffer.trim()) buffer.split(/\r?\n\r?\n/).forEach(consume);
  if (malformed) throw Error('invalid_stream');
  if (!completed) throw Error('stream_incomplete');
  return {
    choices: [{ message: { content }, finish_reason: anthropicFinishReason(stopReason) }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
  };
}

async function readAnthropicPayload(response, onDelta) {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (response.body && typeof response.body.getReader === 'function' && contentType.includes('text/event-stream')) {
    return readAnthropicStream(response, onDelta);
  }
  return normalizeAnthropicPayload(await readProviderPayload(response));
}

function buildProviderRequest(config, request, prompt) {
  const provider = providerFor(config.providerId);
  const adapterId = config.adapterId || provider.adapterId;
  const maxTokens = request.action === 'organizeRecording' || request.action === 'extractTodos' ? 4096 : 2048;
  if (adapterId === 'anthropic-messages') {
    return {
      endpoint: endpointFor(config.baseUrl, adapterId),
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model: config.model,
        temperature: 0.1,
        max_tokens: maxTokens,
        stream: TEXT_ACTIONS.has(request.action),
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
      read: readAnthropicPayload,
    };
  }
  return {
    endpoint: endpointFor(config.baseUrl, adapterId),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: {
      model: config.model,
      temperature: 0.1,
      max_tokens: maxTokens,
      ...(TEXT_ACTIONS.has(request.action) ? { stream: true, stream_options: { include_usage: true } } : { response_format: { type: 'json_object' } }),
      ...(config.providerId === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    },
    read: (response, onDelta) => readProviderPayload(response, onDelta, { requireDoneMarker: provider.requireDoneMarker === true }),
  };
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function createAIService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const getConfig = options.getConfig || (() => ({}));
  const validateEndpoint = options.validateEndpoint || (async (url) => url);
  const onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : null;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const getBinding = typeof options.getBinding === 'function' ? options.getBinding : (() => '');
  const automaticQueueWaitMs = Math.max(1, Number(options.automaticQueueWaitMs) || 30000);
  const emit = (ownerId, event) => { if (onEvent) { try { onEvent(ownerId, event); } catch (error) {} } };
  const currentBinding = () => { try { return String(getBinding() || ''); } catch (error) { return ''; } };
  const active = new Map();
  const queued = [];

  function reportDiagnostic(request, result, details = {}) {
    if (!onDiagnostic) return;
    try {
      onDiagnostic({
        request,
        config: details.config || getConfig() || {},
        result,
        durationMs: Math.max(0, Number(details.durationMs) || 0),
        queueWaitMs: Math.max(0, Number(details.queueWaitMs) || 0),
        promptVersion: PROMPT_VERSION,
      });
    } catch (error) {}
  }

  function automaticQueueKey(ownerId, request) {
    return `${ownerId}:${request.action}:${request.context.sourceId}:${request.context.sourceRevision}`;
  }

  function enqueueAutomatic(ownerId, payload, request, binding) {
    const queueKey = automaticQueueKey(ownerId, request);
    const existing = queued.find((entry) => entry.queueKey === queueKey);
    if (existing) return existing.promise;
    if (queued.length >= 10) {
      const result = { ok: false, error: 'queue_full' };
      reportDiagnostic(request, result);
      return Promise.resolve(result);
    }
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const entry = { ownerId, payload, request, requestId: request.requestId, queueKey, binding, enqueuedAt: Date.now(), promise, resolve, expiryTimer: null };
    entry.expiryTimer = setTimeout(() => {
      const index = queued.indexOf(entry);
      if (index < 0) return;
      queued.splice(index, 1);
      const result = { ok: false, error: 'queue_expired' };
      reportDiagnostic(entry.request, result, { queueWaitMs: Date.now() - entry.enqueuedAt });
      entry.resolve(result);
      queueMicrotask(drainQueue);
    }, automaticQueueWaitMs);
    queued.push(entry);
    return promise;
  }

  function drainQueue() {
    if (active.size >= 2 || !queued.length) return;
    const index = queued.findIndex((entry) => ![...active.values()].some((activeEntry) => activeEntry.ownerId === entry.ownerId && activeEntry.kind === 'automatic'));
    if (index < 0) return;
    const [entry] = queued.splice(index, 1);
    clearTimeout(entry.expiryTimer);
    run(entry.ownerId, entry.payload, { binding: entry.binding, enqueuedAt: entry.enqueuedAt }).then(entry.resolve).finally(() => queueMicrotask(drainQueue));
    queueMicrotask(drainQueue);
  }

  async function run(ownerId, payload, queuedContext = null) {
    const validated = validateRequest(payload);
    if (!validated.ok) return validated;
    const request = validated.value;
    const key = `${ownerId}:${request.requestId}`;
    const requestKind = request.interactive || !request.action.startsWith('name') ? 'interactive' : 'automatic';
    const binding = queuedContext ? queuedContext.binding : currentBinding();
    if (queuedContext && binding !== currentBinding()) {
      const result = { ok: false, error: 'stale_context' };
      reportDiagnostic(request, result, { queueWaitMs: Date.now() - queuedContext.enqueuedAt });
      return result;
    }
    if (active.has(key)) return { ok: false, error: 'request_in_progress' };
    if ([...active.values()].some((entry) => entry.ownerId === ownerId && entry.kind === requestKind) || active.size >= 2) {
      return requestKind === 'automatic' ? enqueueAutomatic(ownerId, payload, request, binding) : { ok: false, error: 'service_busy' };
    }
    const config = getConfig();
    if (!config || !config.apiKey || !config.model) return { ok: false, error: 'not_configured' };
    const controller = new AbortController();
    const timeoutMs = Math.max(10000, Math.min(60000, Number(config.timeoutMs) || 30000));
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const activeEntry = { controller, ownerId, kind: requestKind, binding };
    active.set(key, activeEntry);
    const prompt = actionPrompt(request);
    const startedAt = Date.now();
    let diagnosticResult = null;
    const finish = (result) => { diagnosticResult = result; return result; };
    try {
      emit(ownerId, { requestId: request.requestId, type: 'started' });
      const providerRequest = buildProviderRequest(config, request, prompt);
      const endpoint = await abortable(validateEndpoint(providerRequest.endpoint), controller.signal);
      if (controller.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (binding !== currentBinding()) throw Error('stale_context');
      if (!endpoint) { emit(ownerId, { requestId: request.requestId, type: 'failed', error: 'invalid_endpoint' }); return finish({ ok: false, error: 'invalid_endpoint' }); }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: providerRequest.headers,
        body: JSON.stringify(providerRequest.body),
      });
      if (!response.ok) {
        if (response.body?.cancel) await response.body.cancel().catch(() => {});
        const error = providerError(response.status);
        emit(ownerId, { requestId: request.requestId, type: 'failed', error });
        return finish({ ok: false, error });
      }
      const payloadBody = await providerRequest.read(response, (delta) => {
        if (binding === currentBinding()) emit(ownerId, { requestId: request.requestId, type: 'textDelta', text: delta });
      });
      if (binding !== currentBinding()) throw Error('stale_context');
      const completionFailure = completionError(payloadBody);
      if (completionFailure) throw Error(completionFailure);
      const content = payloadBody && payloadBody.choices && payloadBody.choices[0]
        && payloadBody.choices[0].message && payloadBody.choices[0].message.content;
      const normalized = normalizeResponse(request.action, content, request.context.text);
      if (!normalized.ok) { emit(ownerId, { requestId: request.requestId, type: 'failed', error: normalized.error }); return finish(normalized); }
      const completed = finish({
        ...normalized,
        requestId: request.requestId,
        promptVersion: PROMPT_VERSION,
        usage: payloadBody.usage && typeof payloadBody.usage === 'object' ? {
          inputTokens: Math.max(0, Number(payloadBody.usage.prompt_tokens) || 0),
          outputTokens: Math.max(0, Number(payloadBody.usage.completion_tokens) || 0),
        } : null,
      });
      emit(ownerId, { requestId: request.requestId, type: 'completed' });
      return completed;
    } catch (error) {
      const knownFailure = ['response_too_large', 'stream_incomplete', 'invalid_stream', 'output_truncated', 'content_filtered', 'unsupported_finish_reason', 'stale_context'].includes(error?.message)
        ? error.message : '';
      const failure = knownFailure ? { ok: false, error: knownFailure }
        : controller.signal.aborted ? { ok: false, error: controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled' }
          : { ok: false, error: 'network_error' };
      emit(ownerId, { requestId: request.requestId, type: failure.error === 'cancelled' ? 'cancelled' : 'failed', error: failure.error });
      return finish(failure);
    } finally {
      clearTimeout(timer);
      if (active.get(key) === activeEntry) active.delete(key);
      if (diagnosticResult) reportDiagnostic(request, diagnosticResult, {
        config,
        durationMs: Date.now() - startedAt,
        queueWaitMs: queuedContext ? startedAt - queuedContext.enqueuedAt : 0,
      });
      queueMicrotask(drainQueue);
    }
  }

  function cancel(ownerId, requestId) {
    const normalizedId = String(requestId || '');
    const queuedIndex = queued.findIndex((entry) => entry.ownerId === ownerId && entry.requestId === normalizedId);
    if (queuedIndex >= 0) { const [entry] = queued.splice(queuedIndex, 1); clearTimeout(entry.expiryTimer); entry.resolve({ ok: false, error: 'cancelled' }); return { ok: true, cancelled: true }; }
    const key = `${ownerId}:${normalizedId}`;
    const entry = active.get(key);
    if (!entry) return { ok: true, cancelled: false };
    entry.controller.abort('cancelled');
    return { ok: true, cancelled: true };
  }

  function cancelOwner(ownerId) {
    for (let index = queued.length - 1; index >= 0; index -= 1) {
      if (queued[index].ownerId !== ownerId) continue;
      const [entry] = queued.splice(index, 1); clearTimeout(entry.expiryTimer); entry.resolve({ ok: false, error: 'cancelled' });
    }
    for (const entry of active.values()) {
      if (entry.ownerId !== ownerId) continue;
      entry.controller.abort('cancelled');
    }
  }

  function cancelAll() {
    for (let index = queued.length - 1; index >= 0; index -= 1) {
      const [entry] = queued.splice(index, 1);
      clearTimeout(entry.expiryTimer);
      entry.resolve({ ok: false, error: 'cancelled' });
    }
    for (const entry of active.values()) entry.controller.abort('cancelled');
  }

  return { run, cancel, cancelOwner, cancelAll, endpointFor };
}

module.exports = {
  createAIService,
  endpointFor,
  providerError,
  completionError,
  readProviderPayload,
  readProviderStream,
  readAnthropicPayload,
  readAnthropicStream,
  buildProviderRequest,
  MAX_PROVIDER_BYTES,
};
