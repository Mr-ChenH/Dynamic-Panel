export async function discoveryRoutes(app) {
  app.get('/.well-known/dynamic-panel-sync', async () => {
    const instance = await app.identity.store.getInstance();
    return {
      instanceId: instance.instanceId,
      service: 'dynamic-panel-sync',
      protocol: { min: instance.protocolMin, max: instance.protocolMax },
      recordSchemas: { min: instance.recordSchemaMin, max: instance.recordSchemaMax },
      capabilities: ['push-pull', 'websocket-invalidation', 'multipart-objects', 'exports'],
      limits: app.config.limits,
      serverTime: new Date().toISOString()
    };
  });
}
