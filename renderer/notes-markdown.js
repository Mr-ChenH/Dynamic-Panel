(function exposeNotesMarkdown() {
  function createRenderer(options = {}) {
    const doc = options.document || document;
    const getReadNoteImage = options.getReadNoteImage;

    const inlinePatterns = [
      { type: 'image', regex: /!\[([^\]\n]*)\]\((note-images\/[a-z0-9-]{6,80}\/image-[a-f0-9-]{36}\.png)\)/gi },
      { type: 'code', regex: /`([^`\n]+)`/g },
      { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
      { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
      { type: 'strong', regex: /__([^_\n]+)__/g },
      { type: 'delete', regex: /~~([^~\n]+)~~/g },
      { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
      { type: 'emphasis', regex: /_([^_\n]+)_/g },
    ];

    const taskRe = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
    const bulletRe = /^\s*[-*+]\s+(.*)$/;
    const orderedRe = /^\s*(\d+)[.)]\s+(.*)$/;
    const quoteRe = /^\s*>\s?(.*)$/;
    const headingRe = /^\s{0,3}(#{1,6})\s+(.+)$/;
    const fenceRe = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
    const ruleRe = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

    function findNextInlineToken(text, fromIndex) {
      let next = null;
      inlinePatterns.forEach((pattern, priority) => {
        pattern.regex.lastIndex = fromIndex;
        const match = pattern.regex.exec(text);
        if (
          match &&
          (!next || match.index < next.match.index ||
            (match.index === next.match.index && priority < next.priority))
        ) {
          next = { type: pattern.type, match, priority };
        }
      });
      return next;
    }

    function safeNoteImageReference(rawPath) {
      const normalized = String(rawPath || '').replace(/\\/g, '/');
      return /^note-images\/[a-z0-9-]{6,80}\/image-[a-f0-9-]{36}\.png$/i.test(normalized)
        ? normalized
        : null;
    }

    function safeMarkdownUrl(rawUrl) {
      try {
        const url = new URL(rawUrl);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
      } catch (error) {
        return null;
      }
    }

    function appendInlineMarkdown(parent, source, depth = 0) {
      const text = String(source || '');
      if (!text || depth > 6) {
        if (text) parent.append(doc.createTextNode(text));
        return;
      }

      let cursor = 0;
      while (cursor < text.length) {
        const token = findNextInlineToken(text, cursor);
        if (!token) {
          parent.append(doc.createTextNode(text.slice(cursor)));
          break;
        }

        const { type, match } = token;
        if (match.index > cursor) {
          parent.append(doc.createTextNode(text.slice(cursor, match.index)));
        }

        if (type === 'image') {
          const imagePath = safeNoteImageReference(match[2]);
          const readNoteImage = typeof getReadNoteImage === 'function' ? getReadNoteImage() : null;
          if (!imagePath || typeof readNoteImage !== 'function') {
            parent.append(doc.createTextNode(match[0]));
          } else {
            const image = doc.createElement('img');
            image.className = 'note-preview-image';
            image.alt = match[1] || '笔记图片';
            image.dataset.noteImage = imagePath;
            image.decoding = 'async';
            Promise.resolve(readNoteImage(imagePath)).then((sourceUrl) => {
              if (sourceUrl && image.isConnected) image.src = sourceUrl;
              else if (image.isConnected) image.replaceWith(doc.createTextNode('[图片不可用]'));
            }).catch(() => {
              if (image.isConnected) image.replaceWith(doc.createTextNode('[图片不可用]'));
            });
            parent.append(image);
          }
        } else if (type === 'code') {
          const code = doc.createElement('code');
          code.textContent = match[1];
          parent.append(code);
        } else if (type === 'link') {
          const href = safeMarkdownUrl(match[2]);
          if (!href) {
            parent.append(doc.createTextNode(match[0]));
          } else {
            const link = doc.createElement('a');
            link.dataset.noteHref = href;
            link.setAttribute('role', 'link');
            link.tabIndex = 0;
            link.rel = 'noreferrer';
            appendInlineMarkdown(link, match[1], depth + 1);
            parent.append(link);
          }
        } else {
          const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
          const formatted = doc.createElement(tagName);
          appendInlineMarkdown(formatted, match[1], depth + 1);
          parent.append(formatted);
        }

        cursor = match.index + match[0].length;
      }
    }

    function appendMarkdownLines(parent, lines) {
      lines.forEach((line, index) => {
        if (index > 0) parent.append(doc.createElement('br'));
        appendInlineMarkdown(parent, line);
      });
    }

    function isMarkdownBlockStart(line) {
      if (!line.trim()) return true;
      return (
        fenceRe.test(line) ||
        headingRe.test(line) ||
        quoteRe.test(line) ||
        taskRe.test(line) ||
        orderedRe.test(line) ||
        bulletRe.test(line) ||
        ruleRe.test(line)
      );
    }

    function buildMarkdownPreview(source) {
      const fragment = doc.createDocumentFragment();
      const normalized = String(source || '').replace(/\r\n?/g, '\n');

      if (!normalized.trim()) {
        const empty = doc.createElement('p');
        empty.className = 'note-preview-empty';
        empty.textContent = '写点内容后，在这里查看排版';
        fragment.append(empty);
        return fragment;
      }

      const lines = normalized.split('\n');
      let index = 0;
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
          index += 1;
          continue;
        }

        const fenceMatch = line.match(fenceRe);
        if (fenceMatch) {
          const fenceChar = fenceMatch[1][0];
          const fenceLength = fenceMatch[1].length;
          const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
          const codeLines = [];
          index += 1;
          while (index < lines.length && !closeFence.test(lines[index])) {
            codeLines.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          const pre = doc.createElement('pre');
          const code = doc.createElement('code');
          if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
          code.textContent = codeLines.join('\n');
          pre.append(code);
          fragment.append(pre);
          continue;
        }

        const headingMatch = line.match(headingRe);
        if (headingMatch) {
          const heading = doc.createElement('h' + headingMatch[1].length);
          appendInlineMarkdown(heading, headingMatch[2]);
          fragment.append(heading);
          index += 1;
          continue;
        }

        if (ruleRe.test(line)) {
          fragment.append(doc.createElement('hr'));
          index += 1;
          continue;
        }

        const quoteMatch = line.match(quoteRe);
        if (quoteMatch) {
          const quoteLines = [];
          while (index < lines.length) {
            const match = lines[index].match(quoteRe);
            if (!match) break;
            quoteLines.push(match[1]);
            index += 1;
          }
          const quote = doc.createElement('blockquote');
          appendMarkdownLines(quote, quoteLines);
          fragment.append(quote);
          continue;
        }

        const taskMatch = line.match(taskRe);
        if (taskMatch) {
          const list = doc.createElement('ul');
          list.className = 'note-task-list';
          while (index < lines.length) {
            const match = lines[index].match(taskRe);
            if (!match) break;
            const done = match[1].toLowerCase() === 'x';
            const item = doc.createElement('li');
            item.className = 'note-task-item' + (done ? ' done' : '');
            item.setAttribute('role', 'checkbox');
            item.setAttribute('aria-checked', String(done));
            const box = doc.createElement('span');
            box.className = 'note-task-box';
            box.setAttribute('aria-hidden', 'true');
            box.textContent = done ? '✓' : '';
            const content = doc.createElement('span');
            appendInlineMarkdown(content, match[2]);
            item.append(box, content);
            list.append(item);
            index += 1;
          }
          fragment.append(list);
          continue;
        }

        const orderedMatch = line.match(orderedRe);
        if (orderedMatch) {
          const list = doc.createElement('ol');
          const start = Number.parseInt(orderedMatch[1], 10);
          if (Number.isFinite(start) && start !== 1) list.start = start;
          while (index < lines.length) {
            const match = lines[index].match(orderedRe);
            if (!match) break;
            const item = doc.createElement('li');
            appendInlineMarkdown(item, match[2]);
            list.append(item);
            index += 1;
          }
          fragment.append(list);
          continue;
        }

        const bulletMatch = line.match(bulletRe);
        if (bulletMatch) {
          const list = doc.createElement('ul');
          while (index < lines.length) {
            if (taskRe.test(lines[index])) break;
            const match = lines[index].match(bulletRe);
            if (!match) break;
            const item = doc.createElement('li');
            appendInlineMarkdown(item, match[1]);
            list.append(item);
            index += 1;
          }
          fragment.append(list);
          continue;
        }

        const paragraphLines = [line];
        index += 1;
        while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
          paragraphLines.push(lines[index]);
          index += 1;
        }
        const paragraph = doc.createElement('p');
        appendMarkdownLines(paragraph, paragraphLines);
        fragment.append(paragraph);
      }

      return fragment;
    }

    return { buildMarkdownPreview, safeMarkdownUrl, safeNoteImageReference };
  }

  window.NotchNotesMarkdown = { createRenderer };
})();
