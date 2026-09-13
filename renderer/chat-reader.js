(function exposeChatReader(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchChatReader = api;
})(typeof window !== 'undefined' ? window : globalThis, function createChatReader() {
  'use strict';

  const MIN_LONG_CHARS = 600;
  const MIN_HEADINGS = 2;
  const MIN_NONEMPTY_LINES = 18;
  const MAX_TODO_SOURCE_CHARS = 12000;

  function sourceText(value) {
    return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  }

  function plainHeading(value) {
    return String(value || '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function headings(value) {
    const result = [];
    let fenced = false;
    for (const line of sourceText(value).split('\n')) {
      if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const match = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
      if (!match) continue;
      const title = plainHeading(match[2]);
      if (title) result.push({ level: match[1].length, title });
    }
    return result;
  }

  function analyze(value) {
    const text = sourceText(value);
    const outline = headings(text);
    const nonemptyLines = text.split('\n').filter((line) => line.trim()).length;
    return {
      text,
      charCount: text.length,
      headings: outline,
      nonemptyLines,
      eligible: text.length >= MIN_LONG_CHARS || outline.length >= MIN_HEADINGS || nonemptyLines >= MIN_NONEMPTY_LINES,
    };
  }

  function title(value) {
    const analysis = analyze(value);
    if (analysis.headings[0]?.title) return analysis.headings[0].title.slice(0, 80);
    const first = analysis.text.split('\n').map((line) => plainHeading(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))).find(Boolean);
    return first?.slice(0, 80) || 'AI 长回答';
  }

  function todoSource(value, selected = '') {
    const selection = sourceText(selected);
    const text = selection || sourceText(value);
    if (!text) return { ok: false, error: 'empty_source' };
    if (text.length > MAX_TODO_SOURCE_CHARS) return { ok: false, error: 'source_too_long', length: text.length, scope: selection ? 'selection' : 'full' };
    return { ok: true, text, scope: selection ? 'selection' : 'full', length: text.length };
  }

  return {
    MIN_LONG_CHARS,
    MIN_HEADINGS,
    MIN_NONEMPTY_LINES,
    MAX_TODO_SOURCE_CHARS,
    sourceText,
    headings,
    analyze,
    title,
    todoSource,
  };
});
