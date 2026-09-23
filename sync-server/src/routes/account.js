import { accountContext, data, protectedAccountContext, strictObject } from './helpers.js';

const password = { type: 'string', minLength: 1, maxLength: 1024 };

export async function accountRoutes(app) {
  app.post('/api/v1/account/login', {
    schema: { body: strictObject({ username: { type: 'string', minLength: 1, maxLength: 128 }, password }, ['username', 'password']) }
  }, async (request, reply) => {
    if (request.headers.origin !== app.config.consoleOrigin) throw app.errors.csrf();
    const result = await app.identity.login({ username: request.body.username, password: request.body.password, userAgent: request.headers['user-agent'], requestId: request.id });
    reply.setCookie('dp_session', result.token, {
      httpOnly: true,
      secure: app.config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(app.config.sessionAbsoluteMs / 1000)
    });
    return data(reply, request, { account: result.account }, { noStore: true });
  });

  app.get('/api/v1/account/session', async (request, reply) => {
    const context = await accountContext(request);
    const recentAuthUntil = context.session.recentAuthAt ? new Date(Date.parse(context.session.recentAuthAt) + app.config.recentAuthMs).toISOString() : null;
    return data(reply, request, {
      account: { accountId: context.account.accountId, username: context.account.username, status: context.account.status, mustChangePassword: context.account.mustChangePassword },
      csrfToken: app.identity.csrfFor(context.token),
      expiresAt: context.session.absoluteExpiresAt,
      idleExpiresAt: context.session.idleExpiresAt,
      recentAuthUntil
    }, { noStore: true });
  });

  app.delete('/api/v1/account/session', async (request, reply) => {
    const context = await protectedAccountContext(request);
    await app.identity.logout(context, request.id);
    reply.clearCookie('dp_session', { path: '/' });
    return data(reply, request, { loggedOut: true }, { noStore: true });
  });

  app.get('/api/v1/account/sessions', async (request, reply) => data(reply, request, await app.identity.listSessions(await accountContext(request)), { noStore: true }));

  app.delete('/api/v1/account/sessions/others', async (request, reply) => {
    const context = await protectedAccountContext(request);
    app.identity.assertRecent(context);
    await app.identity.revokeOtherSessions(context);
    return data(reply, request, { revoked: true }, { noStore: true });
  });

  app.post('/api/v1/account/reauthenticate', {
    schema: { body: strictObject({ password }, ['password']) }
  }, async (request, reply) => data(reply, request, await app.identity.reauthenticate(await protectedAccountContext(request), request.body.password), { noStore: true }));

  app.put('/api/v1/account/password', {
    schema: { body: strictObject({ currentPassword: password, newPassword: password }, ['currentPassword', 'newPassword']) }
  }, async (request, reply) => {
    const context = await protectedAccountContext(request);
    await app.identity.changePassword(context, request.body.currentPassword, request.body.newPassword);
    return data(reply, request, { changed: true }, { noStore: true });
  });

  app.get('/api/v1/usage', async (request, reply) => {
    const context = await accountContext(request);
    const spaces = await app.identity.listSpaces(context);
    return data(reply, request, { observedAt: new Date().toISOString(), records: 0, objects: 0, referencedBytes: 0, spaces: spaces.spaces.map((space) => ({ spaceId: space.spaceId, records: 0, objects: 0, referencedBytes: 0 })) });
  });

  app.get('/api/v1/audit', {
    schema: { querystring: strictObject({ spaceId: { type: 'string', format: 'uuid' }, action: { type: 'string', maxLength: 128 } }) }
  }, async (request, reply) => {
    const context = await accountContext(request);
    const rows = await app.identity.store.listAudit(context.accountId, request.query);
    return data(reply, request, rows.map(({ accountId, clientId, ...row }) => row));
  });
}
