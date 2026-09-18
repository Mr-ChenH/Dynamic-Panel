function createTaskNotificationServer({
  http,
  host,
  port,
  sources,
  bodyLimit,
  normalize,
  enqueue,
  onAvailabilityChange,
  logger = console,
}) {
  let server = null;
  let available = false;

  function send(response, statusCode, body) {
    if (response.headersSent) return;
    const json = JSON.stringify(body);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
    });
    response.end(json);
  }

  function setAvailability(next) {
    available = next;
    onAvailabilityChange?.(available);
  }

  function start() {
    if (server) return;
    const target = http.createServer((request, response) => {
      let requestUrl;
      try {
        requestUrl = new URL(request.url || '/', `http://${host}`);
      } catch (error) {
        send(response, 400, { ok: false, error: 'invalid_url' });
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        send(response, 200, { ok: true });
        return;
      }

      const sourceMatch = /^\/notify\/([a-z0-9-]{1,32})$/i.exec(requestUrl.pathname);
      const requestedSource = sourceMatch ? sourceMatch[1].toLowerCase() : '';
      const source = sources.has(requestedSource) ? requestedSource : null;
      if (request.method !== 'POST' || !source) {
        send(response, 404, { ok: false, error: 'not_found' });
        return;
      }
      const contentType = String(request.headers['content-type'] || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/json') {
        send(response, 415, { ok: false, error: 'application_json_required' });
        return;
      }

      const chunks = [];
      let bodyLength = 0;
      let bodyTooLarge = false;
      request.on('data', (chunk) => {
        bodyLength += chunk.length;
        if (bodyLength > bodyLimit) {
          bodyTooLarge = true;
          chunks.length = 0;
          return;
        }
        if (!bodyTooLarge) chunks.push(chunk);
      });
      request.on('end', () => {
        if (bodyTooLarge) {
          send(response, 413, { ok: false, error: 'body_too_large' });
          return;
        }
        let payload;
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8').trim();
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (error) {
          send(response, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          send(response, 400, { ok: false, error: 'invalid_payload' });
          return;
        }
        const result = enqueue(normalize(payload, source));
        send(response, 202, { ok: true, result });
      });
      request.on('error', () => {
        if (!response.headersSent) send(response, 400, { ok: false });
      });
    });
    server = target;
    target.on('clientError', (error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    target.once('listening', () => {
      if (server !== target) return;
      setAvailability(true);
    });
    target.on('error', (error) => {
      if (server === target) server = null;
      setAvailability(false);
      logger.warn(`Task notification server unavailable: ${error.message}`);
    });
    target.listen(port, host);
  }

  function stop() {
    const target = server;
    server = null;
    setAvailability(false);
    if (target) target.close();
  }

  return {
    start,
    stop,
    isAvailable: () => available,
    address: () => server?.address() || null,
  };
}

module.exports = { createTaskNotificationServer };
