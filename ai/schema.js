'use strict';

const ACTIONS = new Set([
  'summarize',
  'shorten',
  'translate',
  'extractTodos',
  'organizeRecording',
  'nameNote',
  'nameRecording',
  'nameLink',
]);
const TEXT_ACTIONS = new Set(['summarize', 'shorten', 'translate']);
const SOURCE_TYPES = new Set(['manual', 'note', 'recording', 'link']);
const CATEGORY_IDS = new Set(['P0', 'P1', 'P2', 'P3']);
const MAX_INPUT_LENGTH = 12000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_TEXT = 64 * 1024;
const MAX_TODOS = 20;

function cleanLine(value, limit) {
  return Array.from(String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, limit).join('');
}

function cleanText(value, limit = MAX_RESPONSE_TEXT) {
  return Array.from(String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .trim()).slice(0, limit).join('');
}

function normalizeCategories(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((id) => [id, cleanLine(source[id] || id, 24)]));
}

function validateRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'invalid_request' };
  const action = String(payload.action || '');
  if (!ACTIONS.has(action)) return { ok: false, error: 'invalid_action' };
  const requestId = cleanLine(payload.requestId, 80);
  if (!requestId || !/^[a-z0-9:_-]{1,80}$/i.test(requestId)) return { ok: false, error: 'invalid_request_id' };
  const context = payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context) ? payload.context : {};
  const sourceType = String(context.sourceType || 'manual');
  if (!SOURCE_TYPES.has(sourceType)) return { ok: false, error: 'invalid_source' };
  const text = cleanText(context.text, MAX_INPUT_LENGTH + 1);
  if (!text) return { ok: false, error: 'empty_text' };
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, error: 'input_too_long', limit: MAX_INPUT_LENGTH };
  const referenceTime = String(payload.referenceTime || '');
  if (!Number.isFinite(Date.parse(referenceTime))) return { ok: false, error: 'invalid_reference_time' };
  const timeZone = cleanLine(payload.timeZone, 80);
  if (!timeZone) return { ok: false, error: 'invalid_time_zone' };
  const targetLanguage = action === 'translate' ? cleanLine(payload.targetLanguage || '中文', 24) : '';
  const request = {
    requestId,
    action,
    context: {
      sourceType,
      sourceId: cleanLine(context.sourceId, 100),
      sourceTitle: cleanLine(context.sourceTitle, 160),
      sourceRevision: cleanLine(context.sourceRevision, 128),
      text,
    },
    referenceTime: new Date(referenceTime).toISOString(),
    timeZone,
    targetLanguage,
    interactive: payload.interactive === true,
    categories: normalizeCategories(payload.categories),
  };
  if (Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES) return { ok: false, error: 'request_too_large' };
  return { ok: true, value: request };
}

function stripCodeFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(stripCodeFence(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function normalizeEvidence(value, sourceText) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const quote = cleanText(value.quote, 500);
  if (!quote || !sourceText.includes(quote)) return null;
  return { quote, offset: sourceText.indexOf(quote) };
}

function normalizeTodo(value, sourceText) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = cleanLine(value.text, 80);
  const evidence = normalizeEvidence(value.evidence, sourceText);
  if (!text || !evidence) return null;
  const categoryId = CATEGORY_IDS.has(value.categoryId) ? value.categoryId : null;
  const deadline = typeof value.deadline === 'string' && value.deadline.trim() ? value.deadline.trim().slice(0, 80) : '';
  const deadlineText = cleanLine(value.deadlineText, 80);
  return { text, categoryId, deadline, deadlineText, evidence };
}

function normalizeResponse(action, content, sourceText) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_RESPONSE_TEXT) return { ok: false, error: 'response_too_large' };
  if (TEXT_ACTIONS.has(action)) {
    const text = cleanText(content);
    return text ? { ok: true, kind: 'text', text } : { ok: false, error: 'empty_response' };
  }
  const parsed = parseObject(content);
  if (!parsed) return { ok: false, error: 'invalid_response' };
  if (action === 'nameNote' || action === 'nameRecording' || action === 'nameLink') {
    const title = cleanLine(parsed.title, action === 'nameLink' ? 80 : 48);
    const category = cleanLine(parsed.category, action === 'nameLink' ? 14 : 24);
    return title ? { ok: true, kind: 'metadata', title, category } : { ok: false, error: 'invalid_response' };
  }
  const rawTodos = Array.isArray(parsed.todos) ? parsed.todos : [];
  if (rawTodos.length > MAX_TODOS) return { ok: false, error: 'too_many_todos' };
  const todos = rawTodos.map((item) => normalizeTodo(item, sourceText)).filter(Boolean);
  if (todos.length !== rawTodos.length) return { ok: false, error: 'invalid_evidence' };
  if (action === 'extractTodos') return { ok: true, kind: 'todos', todos };
  const summary = cleanText(parsed.summary, 12000);
  const decisions = Array.isArray(parsed.decisions)
    ? parsed.decisions.map((item) => {
      if (typeof item === 'string') return null;
      const text = cleanLine(item && item.text, 300);
      const evidence = normalizeEvidence(item && item.evidence, sourceText);
      return text && evidence ? { text, evidence } : null;
    }).filter(Boolean)
    : [];
  if (!summary && !decisions.length && !todos.length) return { ok: false, error: 'empty_response' };
  return { ok: true, kind: 'recording', summary, decisions, todos };
}

module.exports = {
  ACTIONS,
  TEXT_ACTIONS,
  MAX_INPUT_LENGTH,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_TEXT,
  MAX_TODOS,
  cleanLine,
  cleanText,
  normalizeCategories,
  validateRequest,
  normalizeResponse,
};
