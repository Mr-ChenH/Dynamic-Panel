import { data } from './helpers.js';

export async function healthRoutes(app) {
  app.get('/api/v1/health/live', async (request, reply) => data(reply, request, { status: 'ok' }));
  app.get('/api/v1/health/ready', async (request, reply) => {
    const database = await app.readiness.database();
    const objects = await app.readiness.objects();
    const status = database === 'down' || objects === 'down' ? 'down' : database === 'degraded' || objects === 'degraded' ? 'degraded' : 'ok';
    if (status === 'down') reply.code(503);
    return data(reply, request, { status, components: { database, objects } });
  });
}
