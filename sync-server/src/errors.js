export class ApiError extends Error {
  constructor(statusCode, code, message, { details, retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export const errors = {
  authentication: () => new ApiError(401, 'authentication_failed', 'Authentication failed.'),
  sessionExpired: () => new ApiError(401, 'session_expired', 'Session expired.'),
  csrf: () => new ApiError(403, 'csrf_failed', 'CSRF validation failed.'),
  recentAuth: () => new ApiError(403, 'recent_auth_required', 'Recent authentication required.'),
  notFound: () => new ApiError(404, 'resource_not_found', 'Resource not found.'),
  invalid: (details) => new ApiError(400, 'invalid_request', 'Request is invalid.', { details }),
  nameConflict: () => new ApiError(409, 'name_conflict', 'Name is already in use.'),
  rateLimited: () => new ApiError(429, 'rate_limited', 'Too many requests.', { retryable: true }),
  spaceLimit: (current, limit) => new ApiError(409, 'space_limit_reached', 'Active space limit reached.', { details: { current, limit } }),
  clientLimit: (current, limit) => new ApiError(409, 'client_limit_reached', 'Active client limit reached.', { details: { current, limit } })
};

export function installErrorHandler(app) {
  app.setErrorHandler((error, request, reply) => {
    const mapped = error.statusCode === 429 && !(error instanceof ApiError) ? errors.rateLimited() : error;
    const known = mapped instanceof ApiError;
    const statusCode = known ? mapped.statusCode : (mapped.validation ? 400 : 500);
    const code = known ? mapped.code : (mapped.validation ? 'invalid_request' : 'internal_error');
    const message = known ? mapped.message : (mapped.validation ? 'Request is invalid.' : 'An internal error occurred.');
    const body = { error: { code, message, retryable: known ? mapped.retryable : false }, requestId: request.id };
    if (known && mapped.details !== undefined) body.error.details = mapped.details;
    if (statusCode === 401 || request.headers.authorization || request.headers.cookie) reply.header('cache-control', 'no-store');
    request.log.error({ statusCode, errorCode: code, err: known ? undefined : mapped }, 'request failed');
    reply.code(statusCode).send(body);
  });
}
