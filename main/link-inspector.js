function createLinkInspector({
  validatePublicHttpUrl,
  extractFaviconHref,
  extractPageTitle,
  extractPageDescription,
  readResponseText,
  getTranscriptionSettings,
  getLlmConfig,
  getAIService,
  crypto,
  fetchImpl = fetch,
  timeoutMs = 8000,
  maxRedirects = 3,
}) {
  async function fetchFaviconDataUrl(pageUrl, html) {
    let candidate;
    try {
      const href = extractFaviconHref(html) || '/favicon.ico';
      candidate = await validatePublicHttpUrl(new URL(href, pageUrl).toString());
    } catch (error) {
      candidate = null;
    }
    if (!candidate) return '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetchImpl(candidate, { signal: controller.signal, redirect: 'error' });
      const type = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
      if (!response.ok || !type.startsWith('image/')) return '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 160 * 1024) return '';
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch (error) {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  async function enrichLinkMetadata(url, title, description = '', ownerId = 'link-metadata') {
    const settings = getTranscriptionSettings();
    const config = getLlmConfig();
    const aiService = getAIService();
    if (settings.autoOrganizeLinks !== true || !config.apiKey || !config.model || !aiService) {
      return { title, category: '', tags: [] };
    }
    const sourceText = `URL: ${url}\n网页标题: ${title}${description ? `\n网页描述: ${description}` : ''}`;
    const result = await aiService.run(ownerId, {
      requestId: `link-${crypto.randomUUID()}`,
      action: 'nameLink',
      context: {
        sourceType: 'link',
        sourceId: url,
        sourceRevision: crypto.createHash('sha256').update(`link\0${url}\0${sourceText}`).digest('hex'),
        sourceTitle: title,
        text: sourceText,
      },
      referenceTime: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      categories: {},
    });
    return result?.ok
      ? { title: result.title || title, category: result.category || '', tags: Array.isArray(result.tags) ? result.tags : [] }
      : { title, category: '', tags: [] };
  }

  async function inspectLink(rawUrl, ownerId) {
    let current = await validatePublicHttpUrl(rawUrl);
    if (!current) return { ok: false, error: 'invalid_or_private_url' };
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
            'User-Agent': 'DynamicPanel/0.3 (+local bookmark metadata)',
          },
        });
      } catch (error) {
        clearTimeout(timeout);
        const icon = await fetchFaviconDataUrl(current.toString(), '');
        return {
          ok: true,
          url: current.toString(),
          title: '未命名',
          category: '',
          icon,
          warning: error && error.name === 'AbortError' ? 'timeout' : 'fetch_failed',
        };
      }
      clearTimeout(timeout);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirectCount >= maxRedirects) return { ok: false, error: 'too_many_redirects' };
        current = await validatePublicHttpUrl(new URL(location, current).toString());
        if (!current) return { ok: false, error: 'unsafe_redirect' };
        continue;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const fallback = current.hostname.replace(/^www\./, '');
      if (!response.ok || (!contentType.includes('text/html') && !contentType.includes('xhtml'))) {
        const [smart, icon] = await Promise.all([
          enrichLinkMetadata(current.toString(), fallback, '', ownerId),
          fetchFaviconDataUrl(current.toString(), ''),
        ]);
        return {
          ok: true,
          url: current.toString(),
          title: smart.title || '未命名',
          category: smart.category,
          description: '',
          tags: smart.tags || [],
          icon,
        };
      }

      const html = await readResponseText(response);
      const pageTitle = extractPageTitle(html, fallback);
      const description = extractPageDescription(html);
      const [smart, icon] = await Promise.all([
        enrichLinkMetadata(current.toString(), pageTitle, description, ownerId),
        fetchFaviconDataUrl(current.toString(), html),
      ]);
      return {
        ok: true,
        url: current.toString(),
        title: smart.title,
        category: smart.category,
        description,
        tags: smart.tags || [],
        icon,
      };
    }
    return { ok: false, error: 'too_many_redirects' };
  }

  return { fetchFaviconDataUrl, enrichLinkMetadata, inspectLink };
}

module.exports = { createLinkInspector };
