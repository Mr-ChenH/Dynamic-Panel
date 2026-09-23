const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clientKey(request) {
  const header = request.headers.authorization;
  return typeof header === 'string' && header.startsWith('ClientKey ') ? header.slice('ClientKey '.length) : null;
}

export async function realtimeRoutes(app, options = {}) {
  const registry = options.registry ?? app.invalidations;
  if (!registry) throw new TypeError('realtimeRoutes requires an invalidation registry');

  app.get('/api/v1/sync/events', { websocket: true }, async (socket, request) => {
    let unregister = () => {};
    try {
      const context = await app.identity.authenticateClient(clientKey(request));
      const installationId = request.headers['dp-installation-id'];
      if (!INSTALLATION_ID.test(String(installationId || '')) || context.client.installationId !== installationId || request.headers['dp-protocol-version'] !== '1') throw new Error('authentication_failed');
      unregister = registry.register(context, {
        send(value) { if (socket.readyState === 1) socket.send(JSON.stringify(value)); },
        close() { socket.close(1008, 'authorization revoked'); }
      });
      socket.send(JSON.stringify({ type: 'ready', pollingFallbackMs: 30_000 }));
      socket.on('message', (body) => {
        let message;
        try { message = JSON.parse(String(body)); } catch { socket.close(1008, 'invalid message'); return; }
        if (message?.type === 'ping' && Object.keys(message).length === 1) socket.send(JSON.stringify({ type: 'pong' }));
        else socket.close(1008, 'invalid message');
      });
    } catch {
      socket.close(1008, 'authentication failed');
      return;
    }
    socket.once('close', unregister);
    socket.once('error', unregister);
  });
}
