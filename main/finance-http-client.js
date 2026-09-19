function createFinanceHttpClient({
  allowedOrigins,
  resolvePinnedEndpoint,
  fetchPinnedEndpoint,
  timeoutMs = 10000,
  maxResponseBytes = 2 * 1024 * 1024,
  maxRequestBytes = 32 * 1024,
}) {
  function error(message, code, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
  }

  async function readBody(response, maxBytes) {
    const reader = response.body?.getReader();
    if (!reader) throw error('invalid_response', 'invalid_response');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw error('response_too_large', 'response_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  async function readErrorRetryAfter(response) {
    try {
      const bytes = await readBody(response, maxResponseBytes);
      const body = JSON.parse(bytes.toString('utf8'));
      return Number.isFinite(Number(body?.retry_after_ms)) ? Number(body.retry_after_ms) : null;
    } catch (error) {
      return null;
    }
  }

  async function requestJson(value, options = {}) {
    let url;
    try { url = new URL(value); } catch (cause) { throw error('invalid_endpoint', 'invalid_endpoint'); }
    if (!allowedOrigins.has(url.origin) || url.username || url.password) {
      throw error('unsafe_endpoint', 'unsafe_endpoint');
    }
    const method = options.method === 'POST' ? 'POST' : 'GET';
    if (options.method && !['GET', 'POST'].includes(options.method)) {
      throw error('invalid_request', 'invalid_request');
    }
    const body = method === 'POST' ? String(options.body || '') : '';
    if (Buffer.byteLength(body, 'utf8') > maxRequestBytes) throw error('invalid_request', 'invalid_request');
    if (options.signal?.aborted) throw error('cancelled', 'cancelled');
    const endpoint = await resolvePinnedEndpoint(url.toString());
    if (options.signal?.aborted) throw error('cancelled', 'cancelled');
    if (!endpoint) throw error('unsafe_endpoint', 'unsafe_endpoint');

    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (options.signal?.aborted) onExternalAbort();
    else options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchPinnedEndpoint(endpoint, {
        method,
        headers: options.headers,
        body: body || undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfterMs = await readErrorRetryAfter(response);
        throw error(`http_${response.status}`, `http_${response.status}`, { retryAfterMs });
      }
      const responseType = options.responseType === 'text' ? 'text' : 'json';
      const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
      if (responseType === 'json' && contentType && !contentType.includes('application/json')) {
        try { await response.body?.cancel(); } catch (cause) {}
        throw error('invalid_response_type', 'invalid_response');
      }
      const bytes = await readBody(response, maxResponseBytes);
      if (responseType === 'text') {
        try { return new TextDecoder(options.encoding || 'utf-8').decode(bytes); }
        catch (cause) { throw error('invalid_response', 'invalid_response'); }
      }
      try { return JSON.parse(bytes.toString('utf8')); }
      catch (cause) { throw error('invalid_response', 'invalid_response'); }
    } catch (cause) {
      if (options.signal?.aborted && !timedOut) throw error('cancelled', 'cancelled');
      if (cause?.name === 'AbortError' || timedOut) throw error('timeout', 'timeout');
      throw cause;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  return Object.freeze({ requestJson });
}

module.exports = { createFinanceHttpClient };
