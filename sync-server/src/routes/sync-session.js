import { data, strictObject } from './helpers.js';

const installationId = { type: 'string', format: 'uuid', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' };

function clientKeyHeader(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('ClientKey ')) return null;
  return authorization.slice('ClientKey '.length);
}

export async function syncSessionRoutes(app) {
  app.post('/api/v1/sync/session', {
    schema: {
      headers: {
        type: 'object',
        additionalProperties: true,
        properties: {
          authorization: { type: 'string' },
          'dp-installation-id': installationId,
          'dp-protocol-version': { type: 'string', const: '1' },
          'dp-app-version': { type: 'string', minLength: 1, maxLength: 64 },
          'dp-platform': { type: 'string', minLength: 1, maxLength: 64 }
        },
        required: ['dp-installation-id', 'dp-protocol-version', 'dp-app-version', 'dp-platform']
      },
      body: strictObject({})
    }
  }, async (request, reply) => {
    const context = await app.identity.authenticateClient(clientKeyHeader(request));
    const client = await app.identity.bindClient(context, request.headers['dp-installation-id'], { platform: request.headers['dp-platform'], appVersion: request.headers['dp-app-version'] }, request.id);
    app.recordRepository?.seedSpace?.(context);
    const [instance, recordStats, objectUsage, databaseState, objectState] = await Promise.all([
      app.identity.store.getInstance(),
      app.records.stats(context),
      app.objectService.usage(context),
      app.readiness.database(),
      app.readiness.objects()
    ]);
    return data(reply, request, {
      instance: { instanceId: instance.instanceId, serverTime: new Date().toISOString() },
      identity: {
        accountIdPrefix: `acct_${context.accountId.slice(0, 6)}`,
        spaceId: context.spaceId,
        spaceName: context.space.name,
        clientId: context.clientId,
        clientShortId: client.shortId,
        clientName: client.name
      },
      state: { account: context.account.status, space: context.space.status, client: client.status, restoreEpoch: context.space.restoreEpoch },
      protocol: { selected: 1, recordSchemaMax: 1 },
      limits: app.config.limits,
      usage: { recordCount: recordStats.records, objectCount: objectUsage.objectCount, objectBytes: objectUsage.objectBytes },
      categoryCounts: recordStats.categories,
      storage: { database: databaseState, objects: objectState },
      clockSkewSeconds: 0
    }, { noStore: true });
  });
}
