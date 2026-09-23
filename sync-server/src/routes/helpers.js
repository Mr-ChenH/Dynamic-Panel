export const strictObject = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const idParams = (...names) => strictObject(Object.fromEntries(names.map((name) => [name, { type: 'string', format: 'uuid' }])), names);

export function data(reply, request, value, { noStore = false } = {}) {
  if (noStore) reply.header('cache-control', 'no-store');
  return { data: value, requestId: request.id };
}

export function getSessionToken(request) {
  return request.cookies?.dp_session;
}

export async function accountContext(request) {
  const context = await request.server.identity.authenticateSession(getSessionToken(request));
  request.auth = context;
  return context;
}

export async function protectedAccountContext(request) {
  const context = await accountContext(request);
  request.server.identity.assertCsrf(context, request.headers['x-csrf-token'], request.headers.origin);
  return context;
}
