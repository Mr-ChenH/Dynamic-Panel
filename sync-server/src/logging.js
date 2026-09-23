export const REDACT_PATHS = [
  'req.headers.authorization', 'req.headers.cookie', 'req.headers.x-csrf-token',
  'request.headers.authorization', 'request.headers.cookie', 'request.headers.x-csrf-token',
  '*.password', '*.currentPassword', '*.newPassword', '*.clientKey', '*.csrfToken',
  'body.password', 'body.currentPassword', 'body.newPassword', 'res.headers.set-cookie'
];

export function loggingOptions(enabled = true) {
  if (!enabled) return false;
  return {
    level: 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req(request) {
        return { method: request.method, route: request.routeOptions?.url, requestId: request.id };
      }
    }
  };
}
