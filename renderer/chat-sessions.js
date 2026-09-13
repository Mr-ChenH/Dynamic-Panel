(function exposeChatSessions(root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./chat-context') : root.NotchChatContext,
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchChatSessions = api;
})(typeof window !== 'undefined' ? window : globalThis, function createChatSessions(ChatContext) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'notch-ai-chat-sessions-v1';
  const MAX_SESSIONS = 30;
  const MAX_RECORDS = 30;
  const MAX_SESSION_CHARS = 512000;
  const MAX_TOTAL_CHARS = 2000000;
  const STATES = new Set(['complete', 'stopped', 'error']);

  function cleanText(value, limit) {
    return String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, limit);
  }

  function cleanLine(value, limit) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function safeTime(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
  }

  function normalizeHistory(value) {
    const rows = Array.isArray(value) ? value.slice(-12) : [];
    if (rows.length % 2 !== 0) rows.shift();
    const history = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const role = index % 2 ? 'assistant' : 'user';
      const content = cleanText(row?.content, role === 'assistant' ? 65536 : 12000).trim();
      if (!row || row.role !== role || !content) return [];
      history.push({ role, content });
    }
    while (history.length && history.reduce((sum, row) => sum + row.content.length, 0) > 12000) history.splice(0, 2);
    return history;
  }

  function normalizeRecord(value, index = 0) {
    if (!value || typeof value !== 'object' || !STATES.has(value.state)) return null;
    const prompt = cleanText(value.prompt, 12000).trim();
    if (!prompt) return null;
    const groupId = cleanLine(value.groupId, 100) || `turn-${index + 1}`;
    const sources = ChatContext.normalizeSources(value.sources).map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      sourceRevision: source.sourceRevision,
      text: cleanText(source.text, 12000),
      detail: source.detail,
      updatedAt: source.updatedAt,
    }));
    return {
      id: cleanLine(value.id, 100) || `${groupId}-reply-${index + 1}`,
      groupId,
      prompt,
      sources,
      context: normalizeHistory(value.context),
      answer: cleanText(value.answer, 65536),
      state: value.state,
      detail: cleanLine(value.detail, 300),
      createdAt: safeTime(value.createdAt, index + 1),
    };
  }

  function normalizeSession(value, index = 0) {
    if (!value || typeof value !== 'object') return null;
    const id = cleanLine(value.id, 100);
    if (!id) return null;
    const records = (Array.isArray(value.records) ? value.records : []).slice(-MAX_RECORDS).map(normalizeRecord).filter(Boolean);
    const createdAt = safeTime(value.createdAt, index + 1);
    const updatedAt = safeTime(value.updatedAt, createdAt);
    const fallbackTitle = records[0]?.prompt.split('\n')[0] || '已保存对话';
    return {
      id,
      title: cleanLine(value.title, 48) || cleanLine(fallbackTitle, 48) || '已保存对话',
      createdAt,
      updatedAt,
      records,
      history: normalizeHistory(value.history),
    };
  }

  function normalizeSessions(value) {
    const source = Array.isArray(value) ? value : Array.isArray(value?.sessions) ? value.sessions : [];
    const seen = new Set();
    return source.map(normalizeSession).filter((session) => {
      if (!session || seen.has(session.id) || JSON.stringify(session).length > MAX_SESSION_CHARS) return false;
      seen.add(session.id);
      return true;
    }).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_SESSIONS);
  }

  function parseSessions(raw) {
    try { return normalizeSessions(typeof raw === 'string' ? JSON.parse(raw) : raw); }
    catch { return []; }
  }

  function serializeSessions(sessions) {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: normalizeSessions(sessions) });
  }

  function upsertSession(sessions, value) {
    if (!value || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) return { ok: false, error: 'record_limit' };
    const session = normalizeSession(value);
    if (!session || !session.records.length) return { ok: false, error: 'invalid_session' };
    if (JSON.stringify(session).length > MAX_SESSION_CHARS) return { ok: false, error: 'session_too_large' };
    const current = normalizeSessions(sessions);
    if (!current.some((item) => item.id === session.id) && current.length >= MAX_SESSIONS) return { ok: false, error: 'session_limit' };
    const next = [session, ...current.filter((item) => item.id !== session.id)].sort((left, right) => right.updatedAt - left.updatedAt);
    const serialized = JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: next });
    if (serialized.length > MAX_TOTAL_CHARS) return { ok: false, error: 'storage_limit' };
    return { ok: true, next, serialized };
  }

  function renameSession(sessions, sessionId, title, updatedAt) {
    const nextTitle = cleanLine(title, 48);
    if (!nextTitle) return { ok: false, error: 'invalid_title' };
    const current = normalizeSessions(sessions);
    if (!current.some((session) => session.id === sessionId)) return { ok: false, error: 'missing_session' };
    const next = current.map((session) => session.id === sessionId ? { ...session, title: nextTitle, updatedAt: safeTime(updatedAt, session.updatedAt) } : session)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const serialized = JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: next });
    if (serialized.length > MAX_TOTAL_CHARS) return { ok: false, error: 'storage_limit' };
    return { ok: true, next, serialized };
  }

  function removeSession(sessions, sessionId) {
    const current = normalizeSessions(sessions);
    const next = current.filter((session) => session.id !== sessionId);
    return current.length === next.length
      ? { ok: false, error: 'missing_session' }
      : { ok: true, next, serialized: JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: next }) };
  }

  function searchSessions(sessions, query = '') {
    const terms = cleanLine(query, 80).toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
    return normalizeSessions(sessions).filter((session) => {
      if (!terms.length) return true;
      const content = `${session.title} ${session.records.map((record) => `${record.prompt} ${record.answer}`).join(' ')}`.toLocaleLowerCase('zh-CN');
      return terms.every((term) => content.includes(term));
    });
  }

  return {
    SCHEMA_VERSION,
    STORAGE_KEY,
    MAX_SESSIONS,
    MAX_RECORDS,
    MAX_SESSION_CHARS,
    MAX_TOTAL_CHARS,
    normalizeRecord,
    normalizeSession,
    normalizeSessions,
    parseSessions,
    serializeSessions,
    upsertSession,
    renameSession,
    removeSession,
    searchSessions,
  };
});
