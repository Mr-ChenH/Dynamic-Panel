# Dynamic Panel Sync Server

Self-hosted synchronization service for Dynamic Panel. It composes the account console, client sync protocol, object transfer, PostgreSQL persistence, realtime invalidations, encrypted exports/backups, restore tooling, and scheduled backup worker.

## Local smoke run

Node.js 22.13 or newer is required.

```bash
cd sync-server
npm ci
npm test
npm run cli -- --help
npm start
```

Development mode uses in-memory identity, records, and object metadata unless adapters are injected. It is for protocol/UI testing only and must not be treated as durable storage.

## Production order

1. Set unique `COOKIE_SECRET`, `KEY_LOOKUP_SECRET`, and `CURSOR_SECRET` values of at least 32 characters.
2. Configure PostgreSQL and persistent filesystem or S3 object storage.
3. Configure encrypted backup storage on a separate fault domain and a base64-encoded 32-byte backup master key.
4. Run `npm run migrate` as a one-shot deployment step.
5. Start the API with `npm start` and optionally the scheduler with `npm run worker`.
6. Create the first account through `npm run cli -- account create --username NAME`, supplying the password through `DP_ADMIN_PASSWORD` or `DP_ADMIN_PASSWORD_FILE`.

Production startup rejects missing database, TLS/proxy trust, persistent object storage, backup target, or backup key configuration. The console is served under `/console/`; liveness and dependency readiness are `/api/v1/health/live` and `/api/v1/health/ready`.

See [deployment.md](docs/deployment.md) for proxy, Docker, PostgreSQL, S3, backup, and recovery details.
