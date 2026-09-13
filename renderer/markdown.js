(function initSafeMarkdown() {
  const INLINE_PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_([^_\n]+)_|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/gi;

  function appendInline(container, value) {
    const text = String(value || '');
    let offset = 0;
    for (const match of text.matchAll(INLINE_PATTERN)) {
      if (match.index > offset) container.append(document.createTextNode(text.slice(offset, match.index)));
      const token = match[0];
      if (token.startsWith('`')) {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        container.append(code);
      } else if (token.startsWith('**') || token.startsWith('__')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        container.append(strong);
      } else if (token.startsWith('[')) {
        const parts = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i);
        if (parts) {
          const link = document.createElement('a');
          link.href = '#';
          link.dataset.externalUrl = parts[2];
          link.textContent = parts[1];
          link.title = parts[2];
          container.append(link);
        } else container.append(document.createTextNode(token));
      } else {
        const emphasis = document.createElement('em');
        emphasis.textContent = token.slice(1, -1);
        container.append(emphasis);
      }
      offset = match.index + token.length;
    }
    if (offset < text.length) container.append(document.createTextNode(text.slice(offset)));
  }

  function isBlockStart(lines, index) {
    const line = lines[index] || '';
    return /^\s*```/.test(line) || /^\s{0,3}#{1,4}\s+/.test(line) || /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)
      || /^\s*>\s?/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)
      || isTableStart(lines, index);
  }

  function tableCells(line) {
    const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((cell) => cell.trim());
  }

  function isTableStart(lines, index) {
    if (!String(lines[index] || '').includes('|')) return false;
    const separators = tableCells(lines[index + 1]);
    return separators.length > 1 && separators.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function appendCodeBlock(container, language, codeText) {
    const figure = document.createElement('figure');
    figure.className = 'markdown-code';
    const header = document.createElement('figcaption');
    const label = document.createElement('span');
    label.textContent = language || '代码';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.dataset.markdownCopy = '';
    copy.setAttribute('aria-label', '复制代码');
    copy.title = '复制代码';
    copy.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>';
    header.append(label, copy);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = codeText;
    pre.append(code);
    figure.append(header, pre);
    container.append(figure);
  }

  function appendTable(container, lines, start) {
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const body = document.createElement('tbody');
    const headings = tableCells(lines[start]);
    const headingRow = document.createElement('tr');
    headings.forEach((value) => {
      const cell = document.createElement('th');
      appendInline(cell, value);
      headingRow.append(cell);
    });
    head.append(headingRow);
    let index = start + 2;
    while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
      const row = document.createElement('tr');
      const cells = tableCells(lines[index]);
      headings.forEach((_, cellIndex) => {
        const cell = document.createElement('td');
        appendInline(cell, cells[cellIndex] || '');
        row.append(cell);
      });
      body.append(row);
      index += 1;
    }
    table.append(head, body);
    const wrap = document.createElement('div');
    wrap.className = 'markdown-table-wrap';
    wrap.append(table);
    container.append(wrap);
    return index;
  }

  function render(container, source) {
    container.replaceChildren();
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }
      const fence = line.match(/^\s*```\s*([\w.+-]*)\s*$/);
      if (fence) {
        const body = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index++]);
        if (index < lines.length) index += 1;
        appendCodeBlock(container, fence[1], body.join('\n'));
        continue;
      }
      const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
      if (heading) {
        const node = document.createElement(`h${Math.min(4, heading[1].length + 1)}`);
        appendInline(node, heading[2]);
        container.append(node);
        index += 1;
        continue;
      }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        container.append(document.createElement('hr'));
        index += 1;
        continue;
      }
      if (isTableStart(lines, index)) {
        index = appendTable(container, lines, index);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote = document.createElement('blockquote');
        const parts = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) parts.push(lines[index++].replace(/^\s*>\s?/, ''));
        appendInline(quote, parts.join('\n'));
        container.append(quote);
        continue;
      }
      const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+(.+)$/);
      if (listMatch) {
        const ordered = /^\d/.test(listMatch[1]);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length) {
          const itemMatch = lines[index].match(ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
          if (!itemMatch) break;
          const item = document.createElement('li');
          appendInline(item, itemMatch[1]);
          list.append(item);
          index += 1;
        }
        container.append(list);
        continue;
      }
      const paragraph = [];
      while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !isBlockStart(lines, index))) paragraph.push(lines[index++].trim());
      const node = document.createElement('p');
      appendInline(node, paragraph.join('\n'));
      container.append(node);
    }
  }

  window.NotchMarkdown = { render };
})();
