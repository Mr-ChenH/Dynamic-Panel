# Sync Server Deployment

## Network and TLS

Expose the service only through HTTPS. Direct TLS requires both `TLS_CERT_FILE` and `TLS_KEY_FILE`. Behind a reverse proxy, set `TRUST_PROXY` to the smallest trusted proxy address/range and ensure the proxy overwrites `Forwarded` and `X-Forwarded-*` headers. Production rejects requests whose trusted protocol is not HTTPS.

The account console authenticates only with the `HttpOnly`, `Secure`, `SameSite=Lax` session cookie and requires Origin plus CSRF checks on mutations. Sync, object, and realtime routes authenticate only `Authorization: ClientKey ...`. Do not translate one credential type into the other at the proxy.

## Docker Compose

Create secret files and `.env` from the examples, then run:

```bash
docker compose -f compose.example.yml config
docker compose -f compose.example.yml up --build
```

The example binds the API to loopback so a host TLS proxy can front it. It deliberately uses different volumes for online objects and backups. Filesystem backup health reports a same-fault-domain warning until `DP_BACKUP_INDEPENDENT_MEDIA=true` is set after the operator has verified that the backup mount is independent.

## PostgreSQL

Run `npm run migrate` before each new server version. Migrations are transactional and tracked in `schema_migrations`. The server never runs migrations implicitly. Use a restricted application database role in production and gate PostgreSQL integration tests behind an operator-provided test URL.

## S3-compatible storage

Set `DP_OBJECT_TARGET=s3` and/or `DP_BACKUP_TARGET=s3`, along with the matching bucket, region, endpoint, and prefix variables. AWS credentials come from the standard AWS SDK credential chain and must not be stored in this repository. Use distinct online and backup buckets; the health service warns when both aliases resolve to the same bucket.

MinIO and other S3-compatible systems may require path-style addressing. Validate multipart/object size limits and lifecycle rules in a staging environment before enabling cleanup. S3/PostgreSQL integration tests are optional and must run only when their explicit environment variables are present.

## Backup and recovery

Backups and exports are encrypted before leaving the process. `DP_BACKUP_MASTER_KEY` must be a base64-encoded 32-byte key, preferably supplied through `DP_BACKUP_MASTER_KEY_FILE` with owner-only permissions. Losing the key makes backups unrecoverable; storing it with the backup defeats fault-domain separation.

Useful commands:

```bash
npm run cli -- backup run
npm run cli -- backup verify MANIFEST_ID
npm run cli -- backup status
npm run cli -- restore stage MANIFEST_ID --dry-run
npm run cli -- restore drill MANIFEST_ID
npm run cli -- restore apply STAGE_ID --account ACCOUNT_ID --space SPACE_ID --confirm RESTORE
npm run cli -- import stage EXPORT_MANIFEST_ID --dry-run
npm run cli -- import apply STAGE_ID --account ACCOUNT_ID --space SPACE_ID --confirm IMPORT
npm run cli -- doctor
```

A restore or import is staged and verified before activation. Activation requires an explicit scope and exact confirmation, creates a pre-restore backup unless intentionally disabled by trusted code, increments affected restore epochs, and invalidates connected clients. Practice recovery against an isolated database and object store.

Destructive desktop first-sync and optional remote category clearing use the same configured backup target. The server creates and verifies a space-scoped encrypted recovery point before issuing an expiring impact-bound plan; if backup creation or verification is unavailable, the destructive action is rejected without changing records.

## Shutdown and monitoring

`SIGTERM` and `SIGINT` stop accepting traffic, close WebSockets, and drain Fastify before the PostgreSQL pool closes. Give the container a termination grace period longer than the 30-second request timeout. Monitor readiness, backup freshness, failed verification, database saturation, object storage errors, and disk capacity separately.
