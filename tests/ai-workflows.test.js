const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest, normalizeResponse } = require('../ai/schema');
const { createAIService, endpointFor, providerError, completionError, readProviderPayload, MAX_PROVIDER_BYTES } = require('../ai/service');
const AIDomain = require('../renderer/ai-domain');

function request(overrides = {}) {
  return {
    requestId: 'ai-test-1',
    action: 'extractTodos',
    context: { sourceType: 'manual', sourceId: '', sourceRevision: 'r1', text: '明晚九点前发产品演示视频' },
    referenceTime: '2026-09-11T09:00:00+08:00',
    timeZone: 'Asia/Shanghai',
    categories: { P0: '学习', P1: '创作', P2: '开发', P3: '生活' },
    ...overrides,
  };
}

test('AI request validation rejects implicit, oversized and invalid inputs', () => {
  assert.equal(validateRequest(null).error, 'invalid_request');
  assert.equal(validateRequest(request({ action: 'shell' })).error, 'invalid_action');
  assert.equal(validateRequest(request({ context: { sourceType: 'manual', text: '' } })).error, 'empty_text');
  assert.equal(validateRequest(request({ context: { sourceType: 'manual', text: 'x'.repeat(12001) } })).error, 'input_too_long');
  assert.equal(validateRequest(request({ referenceTime: 'tomorrow' })).error, 'invalid_reference_time');
  assert.equal(validateRequest(request()).ok, true);
});

test('AI todo response requires bounded candidates with source evidence', () => {
  const source = '明晚九点前发产品演示视频，购买电池以后再说';
  const valid = normalizeResponse('extractTodos', JSON.stringify({ todos: [{
    text: '发产品演示视频', categoryId: 'P2', deadline: '2026-09-12T21:00:00+08:00', deadlineText: '明晚九点前', evidence: { quote: '明晚九点前发产品演示视频' },
  }] }), source);
  assert.equal(valid.ok, true);
  assert.equal(valid.todos[0].evidence.offset, 0);
  assert.equal(normalizeResponse('extractTodos', JSON.stringify({ todos: [{ text: '编造任务', evidence: { quote: '不存在' } }] }), source).error, 'invalid_evidence');
  assert.equal(normalizeResponse('extractTodos', JSON.stringify({ todos: Array.from({ length: 21 }, () => ({ text: 'a', evidence: { quote: '购买电池' } })) }), source).error, 'too_many_todos');
});

test('AI recording response validates decisions and todos against source', () => {
  const content = JSON.stringify({
    summary: '讨论了上线准备。',
    decisions: [{ text: '周五发布', evidence: { quote: '决定周五发布' } }],
    todos: [{ text: '完成测试', categoryId: 'P2', deadline: '', evidence: { quote: '需要完成测试' } }],
  });
  const result = normalizeResponse('organizeRecording', content, '决定周五发布，需要完成测试');
  assert.equal(result.ok, true);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.todos.length, 1);
});

test('AI service runs through compatible provider and reports usage', async () => {
  let body, diagnostic;
  const events = [];
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model', kind: 'compatible', timeoutMs: 10000 }),
    validateEndpoint: async (url) => url,
    onDiagnostic: (value) => { diagnostic = value; },
    onEvent: (_ownerId, event) => events.push(event.type),
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"todos":[]}' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } }) };
    },
  });
  const result = await service.run(7, request());
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'todos');
  assert.equal(body.response_format.type, 'json_object');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  assert.equal(diagnostic.request.action, 'extractTodos');
  assert.equal(diagnostic.result.ok, true);
  assert.deepEqual(events, ['started', 'completed']);
});

test('AI service cancellation aborts only the matching owner request', async () => {
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true });
    }),
  });
  const pending = service.run(7, request());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(service.cancel(8, 'ai-test-1'), { ok: true, cancelled: false });
  assert.deepEqual(service.cancel(7, 'ai-test-1'), { ok: true, cancelled: true });
  assert.equal((await pending).error, 'cancelled');
});

test('AI cancellation keeps its concurrency slot until the provider settles', async () => {
  const base = request();
  let rejectFirst;
  let fetchCount = 0;
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"title":"next"}' } }] }) };
    },
  });
  const first = service.run(7, { ...base, requestId: 'slot-1', action: 'nameNote', interactive: true, context: { ...base.context, sourceType: 'note', sourceId: 'note-a' } });
  await new Promise((resolve) => setImmediate(resolve));
  service.cancel(7, 'slot-1');
  const blocked = await service.run(7, { ...base, requestId: 'slot-2', action: 'nameNote', interactive: true, context: { ...base.context, sourceType: 'note', sourceId: 'note-b' } });
  assert.equal(blocked.error, 'service_busy');
  assert.equal(fetchCount, 1);
  rejectFirst(Error('provider settled after abort'));
  assert.equal((await first).error, 'cancelled');
  const next = await service.run(7, { ...base, requestId: 'slot-3', action: 'nameNote', interactive: true, context: { ...base.context, sourceType: 'note', sourceId: 'note-b' } });
  assert.equal(next.ok, true);
  assert.equal(fetchCount, 2);
});

test('AI cancellation covers endpoint validation and concurrency is bounded', async () => {
  let releaseValidation;
  const validation = new Promise((resolve) => { releaseValidation = resolve; });
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model', timeoutMs: 10000 }),
    validateEndpoint: () => validation,
    fetchImpl: async () => { throw Error('fetch must not run after cancellation'); },
  });
  const pending = service.run(7, request());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.run(7, { ...request(), requestId: 'ai-test-2' })).error, 'service_busy');
  assert.deepEqual(service.cancel(7, 'ai-test-1'), { ok: true, cancelled: true });
  assert.equal((await pending).error, 'cancelled');
  releaseValidation('https://api.example.test/v1/chat/completions');
});

test('AI automatic naming queues by owner instead of dropping requests', async () => {
  const resolvers = [];
  let fetchIndex = 0;
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    fetchImpl: () => new Promise((resolve) => { const title = `生成名称${++fetchIndex}`; resolvers.push(() => resolve({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ title, category: '分类' }) } }] }) })); }),
  });
  const base = request();
  const first = service.run(7, { ...base, requestId: 'auto-1', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-1' } });
  await new Promise((resolve) => setImmediate(resolve));
  const second = service.run(7, { ...base, requestId: 'auto-2', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-2' } });
  assert.equal(resolvers.length, 1);
  resolvers.shift()();
  assert.equal((await first).title, '生成名称1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvers.length, 1);
  resolvers.shift()();
  assert.equal((await second).title, '生成名称2');
});

test('AI service rejects truncated and unsupported finish reasons', async () => {
  assert.equal(completionError({ choices: [{ finish_reason: 'stop' }] }), '');
  assert.equal(completionError({ choices: [{ finish_reason: 'length' }] }), 'output_truncated');
  assert.equal(completionError({ choices: [{ finish_reason: 'content_filter' }] }), 'content_filtered');
  assert.equal(completionError({ choices: [{ finish_reason: 'tool_calls' }] }), 'unsupported_finish_reason');
  const base = request();
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }) }),
  });
  assert.equal((await service.run(7, { ...base, action: 'summarize' })).error, 'output_truncated');
  const streamed = { headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')); controller.close(); } }) };
  await assert.rejects(() => readProviderPayload(streamed), /output_truncated/);
});

test('AI service isolates event delivery failures from provider results', async () => {
  const base = request();
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    onEvent: () => { throw Error('renderer disappeared'); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"生成名称"}' } }] }) }),
  });
  const result = await service.run(7, { ...base, action: 'nameNote', interactive: true, context: { ...base.context, sourceType: 'note' } });
  assert.equal(result.ok, true);
  assert.equal(result.title, '生成名称');
});

test('AI automatic queue expires and rejects changed bindings', async () => {
  const base = request();
  let release;
  let binding = 'workspace-a:config-a';
  const diagnostics = [];
  const fetchImpl = () => new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"生成名称"}' } }] }) }); });
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    getBinding: () => binding,
    automaticQueueWaitMs: 15,
    validateEndpoint: async (url) => url,
    onDiagnostic: (entry) => diagnostics.push(entry),
    fetchImpl,
  });
  const first = service.run(7, { ...base, requestId: 'bound-1', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-a' } });
  await new Promise((resolve) => setImmediate(resolve));
  const expired = service.run(7, { ...base, requestId: 'bound-2', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-b' } });
  assert.equal((await expired).error, 'queue_expired');
  assert.equal(diagnostics[0].result.error, 'queue_expired');
  assert.ok(diagnostics[0].queueWaitMs >= 1);
  binding = 'workspace-b:config-b';
  release();
  assert.equal((await first).error, 'stale_context');
});

test('AI automatic queue does not execute after its context binding changes', async () => {
  const base = request();
  let release;
  let binding = 'workspace-a:config-a';
  let fetchCount = 0;
  const diagnostics = [];
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    getBinding: () => binding,
    validateEndpoint: async (url) => url,
    onDiagnostic: (entry) => diagnostics.push(entry),
    fetchImpl: () => { fetchCount += 1; return new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"生成名称"}' } }] }) }); }); },
  });
  const first = service.run(7, { ...base, requestId: 'stale-1', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-a' } });
  await new Promise((resolve) => setImmediate(resolve));
  const queued = service.run(7, { ...base, requestId: 'stale-2', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-b' } });
  binding = 'workspace-b:config-b';
  release();
  assert.equal((await first).error, 'stale_context');
  assert.equal((await queued).error, 'stale_context');
  assert.equal(fetchCount, 1);
  assert.equal(diagnostics.filter((entry) => entry.result.error === 'stale_context').length, 2);
});

test('AI queue-full failures are reported to diagnostics', async () => {
  const base = request();
  const diagnostics = [];
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    onDiagnostic: (entry) => diagnostics.push(entry),
    fetchImpl: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true })),
  });
  const activeA = service.run(7, { ...base, requestId: 'full-active-a', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'active-a' } });
  const activeB = service.run(8, { ...base, requestId: 'full-active-b', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'active-b' } });
  await new Promise((resolve) => setImmediate(resolve));
  const queued = Array.from({ length: 10 }, (_, index) => service.run(9, { ...base, requestId: `full-queued-${index}`, action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: `queued-${index}` } }));
  const overflow = await service.run(9, { ...base, requestId: 'full-overflow', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'overflow', text: 'private overflow text' } });
  assert.equal(overflow.error, 'queue_full');
  assert.equal(diagnostics.at(-1).result.error, 'queue_full');
  service.cancelAll();
  await Promise.all([activeA, activeB, ...queued]);
});

test('AI service cancels active and queued work when its context changes', async () => {
  const base = request();
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    fetchImpl: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true })),
  });
  const first = service.run(7, { ...base, requestId: 'cancel-all-1', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-a' } });
  await new Promise((resolve) => setImmediate(resolve));
  const queued = service.run(7, { ...base, requestId: 'cancel-all-2', action: 'nameNote', context: { ...base.context, sourceType: 'note', sourceId: 'note-b' } });
  service.cancelAll();
  assert.equal((await first).error, 'cancelled');
  assert.equal((await queued).error, 'cancelled');
});

test('AI provider response reader assembles SSE text deltas', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"第一"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"段"}}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
    'data: [DONE]\n\n',
  ];
  const response = { headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk))); controller.close(); } }) };
  const deltas = [];
  const result = await readProviderPayload(response, (delta) => deltas.push(delta));
  assert.equal(result.choices[0].message.content, '第一段');
  assert.deepEqual(deltas, ['第一', '段']);
});

test('AI provider response reader rejects malformed SSE even when DONE arrives', async () => {
  const response = { headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[}\n\ndata: [DONE]\n\n')); controller.close(); } }) };
  await assert.rejects(() => readProviderPayload(response), /invalid_stream/);
});

test('AI provider response reader rejects an incomplete SSE response', async () => {
  const makeResponse = () => ({ ok: true, headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')); controller.close(); } }) });
  await assert.rejects(() => readProviderPayload(makeResponse()), /stream_incomplete/);
  const events = [];
  const service = createAIService({
    getConfig: () => ({ apiKey: 'secret', baseUrl: 'https://api.example.test/v1', model: 'model' }),
    validateEndpoint: async (url) => url,
    fetchImpl: async () => makeResponse(),
    onEvent: (_ownerId, event) => events.push(event),
  });
  const result = await service.run(7, request());
  assert.equal(result.error, 'stream_incomplete');
  assert.equal(events.at(-1).type, 'failed');
  assert.equal(events.at(-1).error, 'stream_incomplete');
});

test('AI provider response reader rejects oversized streamed bodies', async () => {
  const chunk = new Uint8Array(MAX_PROVIDER_BYTES + 1);
  const response = { headers: { get: () => null }, body: new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } }) };
  await assert.rejects(() => readProviderPayload(response), /response_too_large/);
});

test('AI provider helpers normalize endpoints and errors', () => {
  assert.equal(endpointFor('https://api.example.test/v1/'), 'https://api.example.test/v1/chat/completions');
  assert.equal(endpointFor('https://api.example.test/chat/completions'), 'https://api.example.test/chat/completions');
  assert.equal(providerError(401), 'authentication_failed');
  assert.equal(providerError(429), 'rate_limited');
});

test('AI todo duplicate detection finds similar unfinished titles and batch candidates', () => {
  const data = { P0: [{ id: 'done', text: '提交报告', done: true }], P1: [], P2: [{ id: 'open', text: '  提交报告 ', done: false, deadline: '2030-01-01T00:00:00Z' }], P3: [] };
  assert.equal(AIDomain.duplicateFor({ text: '提交报告' }, data).id, 'open');
  assert.equal(AIDomain.duplicateFor({ text: '提交报告给组' }, data).id, 'open');
  assert.equal(AIDomain.duplicateFor({ text: '其他任务' }, data), null);
  const candidates = [{ text: '提交报告' }, { text: '提交报告给组' }];
  assert.equal(AIDomain.duplicateCandidateFor(candidates[0], candidates), candidates[1]);
});

test('AI todo domain prepares, applies and conflict-safely undoes a batch', () => {
  const categories = { P0: '学习', P1: '创作', P2: '开发', P3: '生活' };
  const items = [{ text: '发视频', categoryId: 'P2', deadline: '2026-09-12T13:00:00.000Z', evidence: { quote: '发视频', offset: 0 } }];
  const candidates = AIDomain.prepareTodoCandidates(items, categories, Date.parse('2026-09-11T00:00:00Z'));
  assert.equal(candidates[0].selected, true);
  const empty = { P0: [], P1: [], P2: [], P3: [] };
  const applied = AIDomain.createTodoBatch(empty, candidates, () => 'todo-ai-1', Date.parse('2026-09-11T00:00:00Z'));
  assert.equal(applied.ok, true);
  assert.equal(applied.next.P2.length, 1);
  const edited = structuredClone(applied.next);
  edited.P2[0].text = '用户已修改';
  const undo = AIDomain.undoTodoBatch(edited, applied.added);
  assert.equal(undo.removed.length, 0);
  assert.equal(undo.conflicts.length, 1);
});

test('AI todo domain does not select missing or past deadlines', () => {
  const rows = AIDomain.prepareTodoCandidates([
    { text: '无日期', categoryId: 'P1', deadline: '', evidence: { quote: '无日期', offset: 0 } },
    { text: '过去', categoryId: 'P1', deadline: '2025-01-01T00:00:00Z', evidence: { quote: '过去', offset: 0 } },
  ], { P1: '创作' }, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(rows.every((row) => !row.complete && !row.selected), true);
});
