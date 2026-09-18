const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinkInspector } = require('../main/link-inspector');

function response({ status = 200, contentType = 'text/html', location = '', body = '<title>Example</title>' } = {}) {
  const bytes = Buffer.from(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-type') return contentType;
        if (key === 'location') return location || null;
        return null;
      },
    },
    body: {
      getReader() {
        let consumed = false;
        return {
          async read() {
            if (consumed) return { done: true };
            consumed = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

function createInspector(fetchImpl) {
  return createLinkInspector({
    validatePublicHttpUrl: async (value) => {
      const url = new URL(value);
      return url.hostname === 'public.test' ? url : null;
    },
    extractFaviconHref: () => '',
    extractPageTitle: (html, fallback) => html.includes('<title>Example</title>') ? 'Example' : fallback,
    extractPageDescription: () => 'Description',
    readResponseText: async (value) => {
      const reader = value.body.getReader();
      const chunk = await reader.read();
      return Buffer.from(chunk.value).toString('utf8');
    },
    getTranscriptionSettings: () => ({ autoOrganizeLinks: false }),
    getLlmConfig: () => ({}),
    getAIService: () => null,
    crypto: require('node:crypto'),
    fetchImpl,
    timeoutMs: 100,
    maxRedirects: 2,
  });
}

test('link inspector follows safe redirects and extracts bounded page metadata', async () => {
  const calls = [];
  const inspector = createInspector(async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? response({ status: 302, location: 'https://public.test/final' })
      : response();
  });

  const result = await inspector.inspectLink('https://public.test/start', 'test-owner');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://public.test/final');
  assert.equal(result.title, 'Example');
  assert.equal(result.description, 'Description');
  assert.deepEqual(calls, [
    'https://public.test/start',
    'https://public.test/final',
    'https://public.test/favicon.ico',
  ]);
});

test('link inspector rejects unsafe redirect targets without fetching them', async () => {
  let calls = 0;
  const inspector = createInspector(async () => {
    calls += 1;
    return response({ status: 302, location: 'http://private.test/' });
  });

  const result = await inspector.inspectLink('https://public.test/start', 'test-owner');
  assert.deepEqual(result, { ok: false, error: 'unsafe_redirect' });
  assert.equal(calls, 1);
});
