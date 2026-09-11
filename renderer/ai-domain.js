(function initAIDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchAIDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createAIDomain() {
  const CATEGORY_IDS = ['P0', 'P1', 'P2', 'P3'];

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value == null ? '' : value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function sourceRevision(source) {
    const value = source && typeof source === 'object' ? source : {};
    return `${String(value.sourceType || 'manual')}:${String(value.sourceId || '')}:${simpleHash(value.text)}`;
  }

  function normalizeTitle(value) {
    return Array.from(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
  }

  function validFutureDeadline(value, now = Date.now()) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) && timestamp > Number(now) ? new Date(timestamp).toISOString() : '';
  }

  function prepareTodoCandidates(items, categories, now = Date.now()) {
    const names = categories && typeof categories === 'object' ? categories : {};
    return (Array.isArray(items) ? items : []).slice(0, 20).map((item, index) => {
      const categoryId = CATEGORY_IDS.includes(item && item.categoryId) ? item.categoryId : '';
      const deadline = validFutureDeadline(item && item.deadline, now);
      const text = normalizeTitle(item && item.text);
      const complete = Boolean(text && categoryId && deadline);
      return {
        candidateId: `candidate-${index + 1}-${simpleHash(`${text}:${item && item.evidence && item.evidence.quote || ''}`)}`,
        text,
        categoryId,
        categoryName: categoryId ? String(names[categoryId] || categoryId) : '',
        deadline,
        deadlineText: normalizeTitle(item && item.deadlineText),
        evidence: item && item.evidence ? { quote: String(item.evidence.quote || ''), offset: Math.max(0, Number(item.evidence.offset) || 0) } : null,
        selected: complete,
        complete,
      };
    });
  }

  function comparableTitle(value) {
    return normalizeTitle(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  function similarTitle(left, right) {
    const a = comparableTitle(left), b = comparableTitle(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    return shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.6;
  }

  function duplicateFor(candidate, todoData) {
    const text = normalizeTitle(candidate && candidate.text);
    if (!text) return null;
    for (const categoryId of CATEGORY_IDS) {
      const match = (Array.isArray(todoData && todoData[categoryId]) ? todoData[categoryId] : []).find((todo) => (
        todo && todo.done !== true && similarTitle(todo.text, text)
      ));
      if (match) return { categoryId, id: match.id, text: match.text, deadline: match.deadline };
    }
    return null;
  }

  function duplicateCandidateFor(candidate, candidates) {
    return (Array.isArray(candidates) ? candidates : []).find((item) => item !== candidate && similarTitle(item && item.text, candidate && candidate.text)) || null;
  }

  function validateCandidate(candidate, now = Date.now()) {
    const text = normalizeTitle(candidate && candidate.text);
    if (!text) return { ok: false, error: 'missing_text' };
    if (!CATEGORY_IDS.includes(candidate.categoryId)) return { ok: false, error: 'missing_category' };
    const deadline = validFutureDeadline(candidate.deadline, now);
    if (!deadline) return { ok: false, error: 'missing_deadline' };
    return { ok: true, value: { text, categoryId: candidate.categoryId, deadline } };
  }

  function createTodoBatch(todoData, candidates, createId, now = Date.now()) {
    const next = Object.fromEntries(CATEGORY_IDS.map((id) => [id, (Array.isArray(todoData && todoData[id]) ? todoData[id] : []).map((todo) => ({ ...todo }))]));
    const selected = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate && candidate.selected);
    if (!selected.length) return { ok: false, error: 'nothing_selected' };
    const normalized = [];
    for (const candidate of selected) {
      const result = validateCandidate(candidate, now);
      if (!result.ok) return { ok: false, error: result.error, candidateId: candidate.candidateId };
      normalized.push(result.value);
    }
    const createdAt = Number(now);
    const added = normalized.map((candidate, index) => {
      const todo = {
        id: String(createId(index)),
        text: candidate.text,
        done: false,
        createdAt,
        deadline: candidate.deadline,
        remindedAt: 0,
      };
      next[candidate.categoryId].push(todo);
      return { categoryId: candidate.categoryId, todo: { ...todo } };
    });
    return { ok: true, next, added };
  }

  function undoTodoBatch(todoData, added) {
    const conflicts = [];
    const removed = [];
    const snapshots = new Map((Array.isArray(added) ? added : []).map((entry) => [`${entry.categoryId}:${entry.todo.id}`, entry.todo]));
    const next = Object.fromEntries(CATEGORY_IDS.map((id) => [id, (Array.isArray(todoData && todoData[id]) ? todoData[id] : []).filter((todo) => {
      const expected = snapshots.get(`${id}:${todo && todo.id}`);
      if (!expected) return true;
      const unchanged = ['text', 'done', 'createdAt', 'deadline', 'remindedAt'].every((key) => todo[key] === expected[key]);
      if (!unchanged) { conflicts.push({ categoryId: id, id: todo.id }); return true; }
      removed.push({ categoryId: id, id: todo.id });
      return false;
    }).map((todo) => ({ ...todo }))]));
    return { next, conflicts, removed };
  }

  return {
    CATEGORY_IDS,
    simpleHash,
    sourceRevision,
    normalizeTitle,
    validFutureDeadline,
    prepareTodoCandidates,
    similarTitle,
    duplicateFor,
    duplicateCandidateFor,
    validateCandidate,
    createTodoBatch,
    undoTodoBatch,
  };
});
