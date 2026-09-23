# Sync MVP v1 Technical Design

> Status: implementation baseline. Interfaces are fixed in [03-interface-map.md](./03-interface-map.md), UI behavior in [04-ui-design.md](./04-ui-design.md), and product requirements in [02-requirements.md](./02-requirements.md).

## 1. Architectural decisions

### 1.1 Deployment shape

Use a separate `sync-server/` Node.js 22.13+ application in this repository. It is not imported by Electron and does not change the existing `npm start` path.

```text
Desktop renderer                       Account browser
  LocalStorage + IndexedDB                vanilla console JS
          | narrow IPC                         | cookie + CSRF
          v                                    v
Electron main sync client -------- HTTPS/WSS -------- Fastify API
  safeStorage Key + object files                    |
                                           domain services / jobs / CLI
                                             |                 |
                                        PostgreSQL 17     S3-compatible store
                                             |                 |
                                             +-- encrypted backup target
```

- One API process handles discovery, console, sync HTTP, and WebSocket invalidations.
- A worker process from the same package handles cleanup, backup, export, and staged restore jobs. PostgreSQL advisory locks prevent duplicate scheduled jobs when more than one process is running.
- PostgreSQL is the metadata/source-of-truth store. Supported images are immutable objects in S3-compatible storage; development may use a filesystem adapter rooted outside the application source.
- Production TLS terminates at a documented reverse proxy or load balancer. The application still validates forwarded scheme/host only from explicitly trusted proxy addresses.
- The MVP is server-readable. Deployers must provide encrypted PostgreSQL volumes, S3 server-side encryption for online objects, TLS, and an external secret store/file permissions. Application-level envelope encryption is mandatory for backup artifacts.

### 1.2 Conservative Node 22 stack

The server uses ESM JavaScript with JSDoc types and `node:test`, matching this repository's low-build-tool approach while setting `engines.node >=22.13.0`. A later TypeScript migration is not required for MVP correctness.

| Dependency | Choice and reason |
| --- | --- |
| HTTP | `fastify@5`: maintained Node 22 support, bounded parsers, schema hooks, structured logging, and a small operational surface |
| HTTP plugins | `@fastify/cookie`, `@fastify/csrf-protection`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/websocket`: standard same-framework integrations; versions pinned and upgraded together |
| Validation | `zod@4`: one explicit schema registry shared by route and domain tests; Fastify JSON schemas can be generated or kept at the boundary, but domain validation always uses Zod |
| Database | `pg@8` with handwritten SQL migrations: PostgreSQL transactions, JSONB, partial unique indexes, advisory locks, and row-level security remain visible; an ORM would obscure the isolation-critical SQL |
| Password/Key verification | `argon2`: Argon2id adaptive hashes with encoded parameters; Node crypto HMAC supplies indexed Key lookup fingerprints |
| Object storage | AWS SDK v3 `@aws-sdk/client-s3` and `@aws-sdk/lib-storage`: works with S3-compatible endpoints and multipart upload without committing to AWS hosting |
| CLI | `commander`: stable parsing/help/exit handling; domain services are called directly, never through loopback HTTP |
| Scheduling | `croner`: timezone-aware schedules; PostgreSQL job rows/advisory locks provide durability and singleton execution |
| Archive streaming | `tar-stream` plus built-in `node:zlib` and `node:crypto`: streaming logical backup chunks without loading a space into memory |
| Logging | Fastify/Pino built-in structured logger with a mandatory redaction serializer; no second logging framework |
| Desktop durable sync state | Browser IndexedDB, no new native module: available in Electron renderer, transactional, and avoids cross-platform native rebuild risk |
| Testing | `node:test`, `undici`/Fastify injection, and disposable PostgreSQL/S3 services in CI; no paid/cloud dependency |

Deliberately excluded: Redis (PostgreSQL `LISTEN/NOTIFY` and advisory locks suffice), GraphQL (the operation model is already explicit), an ORM, a frontend framework for the console, service workers, Kafka, and end-to-end encryption. Fewer moving parts are more appropriate for self-hosting and the confirmed scale.

## 2. Proposed repository boundaries

```text
sync-server/
├── package.json
├── migrations/             # numbered SQL, forward-only with compatibility metadata
├── src/
│   ├── server.js           # Fastify composition only
│   ├── config.js           # validated env/file configuration
│   ├── routes/             # discovery, account, spaces, clients, sync, objects
│   ├── auth/               # sessions, CSRF, ClientKey, recent auth
│   ├── domain/             # records, conflicts, lifecycle, quotas, errors
│   ├── db/                 # pools, scoped transactions, migrations
│   ├── objects/            # S3/filesystem adapters and multipart verification
│   ├── realtime/           # scoped connection registry + PG notifications
│   ├── jobs/               # cleanup, export, backup, restore
│   ├── backup/             # manifest, encryption, retention, staged restore
│   ├── cli/                # commands and stable exit mapping
│   └── console/            # same-origin static HTML/CSS/JS assets
└── test/

main/sync/                   # Electron networking, secure Key, transfer coordinator
main/ipc/sync.js             # narrow validated IPC
renderer/sync/               # adapters, IndexedDB, setup/status/conflict UI
```

`main.js` only composes the service, consistent with current extracted IPC/service modules. Existing `workspace:*` IPC, flat preload APIs, LocalStorage keys, and [`main/workspace-controller.js`](../../../main/workspace-controller.js) remain intact.

## 3. Server request scope and transactions

Authentication creates an immutable context:

```js
{
  requestId,
  actorType: 'account' | 'client' | 'admin',
  accountId,
  spaceId: null | '...',
  clientId: null | '...',
  sessionId: null | '...',
  keyGenerationId: null | '...'
}
```

Route handlers cannot accept a replacement context from request JSON. Every tenant database operation runs through one of:

- `withAccountTx(context, fn)` sets `SET LOCAL app.account_id`.
- `withSpaceTx(context, fn)` also sets `app.space_id` and, for client auth, `app.client_id`.
- `withAdminTx(adminContext, fn)` uses a separate DB role and requires an audited CLI operation.

The application role has no `BYPASSRLS`; tenant tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`. Policies compare rows with `current_setting('app.account_id', true)` and `app.space_id`. Foreign keys include scope columns where feasible, preventing a valid ID from being reattached across spaces. API authorization tests remain mandatory because RLS is defense in depth, not the only check.

Error mapping occurs after transaction rollback and removes database identifiers/constraint names. Logs receive only request ID, actor/target prefixes, route template, status, duration, and stable error code.

## 4. PostgreSQL model

All timestamps are `timestamptz`; IDs are UUIDv7 generated server-side except stable client-created entity/operation IDs, validated as UUID/ULID. Payload byte length is recorded from canonical UTF-8 JSON.

### 4.1 Identity and management tables

| Table | Key fields and constraints |
| --- | --- |
| `server_instance` | singleton `instance_id`, protocol/schema min/max, `created_at` |
| `accounts` | `account_id`, normalized unique username, Argon2id password hash, `active|disabled|deleting`, `must_change_password`, timestamps; no password history plaintext |
| `account_sessions` | hashed random token, account, CSRF secret hash, created/seen/absolute expiry, `recent_auth_at`, revoked time, coarse client metadata |
| `spaces` | `(account_id,space_id)`, display/normalized name, `active|inactive|deleting`, `restore_epoch`, per-space `next_sequence`, timestamps, deletion deadline |
| `clients` | `(account_id,space_id,client_id)`, mutable name, immutable short ID, status, installation binding hash/value, platform/version, first/last seen |
| `client_key_generations` | keyed lookup fingerprint unique globally, Argon2id verifier, client scope, created/expiry/revoked; at most two active rows per client enforced in service transaction |
| `audit_events` | account, optional space/client, actor, allowlisted action/target/result/error, request ID, server time; no payload or credential |
| `structural_limits` | server defaults/overrides for active spaces and clients; production validation refuses values above product contract for MVP unless a later protocol revision defines behavior |

A partial unique index on `(account_id, normalized_name)` applies while a space is not purged. Count checks lock the owning account/space row before insert, making the 10/10 limit race-free. Disabling an account increments `auth_epoch`; sessions and Client Keys cache that epoch and fail on next request. Pub/sub closes existing connections.

Installation binding stores the random installation UUID (optionally a keyed hash for log-safe comparison), never hardware identifiers. Reset occurs in one transaction: revoke generations, clear binding, add fresh verifier, write audit/outbox notification.

### 4.2 Record and change tables

| Table | Key fields and purpose |
| --- | --- |
| `records` | unique `(space_id,entity_type,entity_id)`; current schema/revision/payload/deleted, origin client, server time, last sequence |
| `record_versions` | one row per accepted revision; base revision, payload/deletion snapshot, origin, sequence; retained for conflict/delete recovery |
| `operations` | unique `(space_id,client_id,operation_id)`; canonical request hash and serialized result for idempotency |
| `changes` | unique `(space_id,sequence)`; event kind, entity/revision/conflict/object reference, origin and server time |
| `conflicts` | space/entity, base/current/incoming revisions and payloads or changed-field set, origins, status/resolution revision, retain-until |
| `space_stream_floors` | space/epoch and minimum available sequence; used to reject expired cursors |
| `category_state` | per space category presence/clear generation for previews and category tombstone operations |

Mutation transaction:

1. Authenticate and lock space/client; reject inactive scope or changed epoch.
2. Find operation by scoped ID. Same request hash returns saved result; different hash fails.
3. Validate entity schema and committed space-local object references.
4. Lock current record. If `baseRevision` is current, allocate `revision+1`; otherwise run the entity merge policy using retained base/current.
5. Allocate exactly one sequence by incrementing the locked `spaces.next_sequence` for every accepted revision/conflict/tombstone event.
6. Write version/current/conflict/change, operation result, usage deltas, and audit where required in one transaction.
7. Commit, then publish `{spaceId,sequence,restoreEpoch}` through PostgreSQL `NOTIFY`. Missed notifications are harmless because pull is authoritative.

`updatedAt` and `originClientId` are always server values. Preference LWW uses server acceptance sequence, not client time. Sortable entities store per-item fractional `sortKey`; moving one item does not replace a collection.

Change history defaults to 90 days and is configurable longer. Cleanup never advances the stream floor beyond retained tombstones/unresolved conflicts needed by policy. Tombstones and unresolved conflicts have a production minimum of 30 days; audit minimum/default is 90 days. Cursor below the floor receives `cursor_expired`.

### 4.3 Object and transfer tables

| Table | Key fields and purpose |
| --- | --- |
| `physical_objects` | internal object ID, digest, bytes, MIME, encrypted/opaque storage key, verification state; not directly tenant-queryable |
| `space_objects` | `(account_id,space_id,object_id)`, physical object pointer, digest/bytes/MIME/purpose, committed time; unique digest inside space only |
| `object_refs` | scoped record revision -> object ID and logical field; drives completeness/refcounts |
| `upload_sessions` | scoped upload/client, expected digest/bytes/MIME/purpose, multipart ID, expiry/status |
| `upload_parts` | upload/part number, length, digest, storage ETag/status; unique and idempotent |
| `object_usage_rollups` | account/space observed counts and referenced bytes; statistics, never a rejection quota |

S3 keys are generated from server random IDs such as `online/v1/<shard>/<opaque-id>`, never user filenames, digest alone, account names, or paths. Input cannot select a bucket/key. Filesystem development storage opens files with no-follow semantics under a resolved root and rejects symlinks.

Deduplication is optional. The safe default is physical reuse only inside a space. A deployment may globally reuse verified ciphertext/bytes, but all API lookup, completion, timing normalization, authorization, references, and usage operate through `space_objects`; no endpoint answers “does digest exist?” outside the authenticated scope.

Completion streams the stored multipart result through SHA-256 and byte counting before setting committed. A parent record may reference only committed rows. Downloads include digest/length and support bounded Range requests; desktop writes temp, verifies, then atomically renames. Incomplete sessions expire after 24 hours by default. Record deletion removes references only after tombstone/conflict retention; physical garbage collection additionally waits beyond all backup retention points.

There is no user byte/image/full-image quota. Protocol ceilings (1 MiB JSON, 100 operations, 500 changes, 8 MiB chunks, 10,000 chunks, four concurrent object transfers/client) protect memory and abuse and are returned in discovery.

## 5. Entity adapters and existing local data

### 5.1 `workspace.json` remains the local snapshot

[`renderer/app-shell.js`](../../../renderer/app-shell.js) continues its full LocalStorage snapshot to `workspace.json`; startup continues filling only missing LocalStorage keys. Sync never uploads that file or treats it as a revision.

For each supported domain, a renderer adapter:

1. Reads the existing LocalStorage key/current store API.
2. Normalizes existing entries and assigns stable IDs only where absent, preserving public shapes and meanings.
3. Emits typed records using the schema registry.
4. Applies remote records through the existing domain store, preserving `P0`-`P3`, note/link formats, and existing user behavior.
5. Emits `notch-workspace-mutated` / requests snapshot persistence as existing modules expect.

Adapter metadata is stored in IndexedDB, not inserted into arbitrary LocalStorage values unless the existing entity already supports a stable ID. Legacy duplicate detection is conservative: uncertain same-content items remain separate rather than being silently merged.

### 5.2 Desktop IndexedDB model

Database name is derived from a local workspace identity, not a path sent to the server. Object stores:

| Store | Purpose |
| --- | --- |
| `bindings` | server instance/space/client/workspace IDs, restore epoch, categories; no plaintext Key |
| `entityMirror` | last canonical remote/local entity revision and payload hash for diff/recovery |
| `outbox` | immutable operation ID, base revision, category, canonical payload, state/retry |
| `inboxBatches` | pulled batch and apply state until fully projected |
| `cursors` | cursor/upper cursor/epoch updated with inbox apply marker |
| `conflicts` | sanitized conflict data needed offline |
| `objectMap` | logical object ID to relative local reference/digest/status |
| `transfers` | upload/download part checkpoints and retry state |
| `quarantine` | unknown entity/schema with reason; never silently discarded |

Local save remains authoritative and immediate. The adapter transactionally writes an outbox entry before the UI labels it `待同步`. A periodic reconciliation compares existing LocalStorage entities/object indexes to `entityMirror`, recovering a local save that occurred before an outbox transaction.

Remote apply cannot make LocalStorage and IndexedDB one native transaction. It uses a crash-safe projection protocol:

1. Store the complete validated batch in `inboxBatches` with `applying`, without advancing committed cursor.
2. Apply records idempotently through adapters, recording each projected entity marker.
3. In one IndexedDB transaction, update mirror/conflicts/object map, set cursor, and mark batch complete.
4. Request normal `workspace.json` snapshot persistence. Failure is reported/retried but does not enqueue remote changes as local mutations.
5. On crash, replay the incomplete batch; stable revisions and projection markers make replay idempotent.

This satisfies “record and cursor together” at the sync-state boundary while retaining the current local snapshot design. Tests inject crashes before/after every step.

### 5.3 Main-process sync service

Electron main owns:

- `installationId` in a local settings file generated from cryptographic randomness.
- Client Key encrypted with Electron `safeStorage`; if unavailable it exists only in memory for that session.
- URL/TLS validation, HTTP/WebSocket connections, bounded retries, status projection, and live connection teardown.
- Reading/writing supported image files only through safe workspace/capture services.
- Transfer streams and digest verification outside renderer to avoid UI stalls.

The renderer sends validated operation/object descriptors through narrow IPC. The main process ignores any renderer-provided origin/account scope and accepts server scope only from authenticated responses. Binding generation tokens prevent late responses from client A being applied after switching to client B.

## 6. Conflict and deletion algorithms

- If `baseRevision == currentRevision`, accept directly.
- If base is retained, compare base/current/incoming per schema field. Fields changed on one side merge; equal edits coalesce; distinct edits produce a conflict row.
- Note title/body conflict never discards text. Current remains deterministic (higher server sequence); incoming becomes a recoverable conflict version/copy.
- Todo/link use the same deterministic current plus per-field conflict values. Resolution supplies the current revision as base and creates a normal new version.
- Preference fields use server acceptance sequence LWW and retain the prior version in version history.
- A delete creates a revision with a tombstone snapshot and sequence. Any operation based before that tombstone becomes a retained conflict, never resurrection.
- Restore references the tombstone/current revision and writes a new active revision. Early purge is a separately authorized and audited operation.

Cleanup runs per scope in small batches. It can remove version/conflict/tombstone material only after policy deadlines, no active references, and backup retention permits it. It never evicts current user data to free capacity.

## 7. Realtime, retry, and performance

PostgreSQL `LISTEN/NOTIFY` carries only space/sequence/epoch invalidations. Each API process indexes live sockets by account, space, client, and key generation. Account disable, space deactivate, client revoke, Key expiry, and restore publish close events. The client then authenticates normal pull; socket data is not trusted as replication content.

Desktop reconciliation runs at startup, wake, network recovery, WebSocket invalidation, after push, and every 30 seconds while online. Retries use full-jitter exponential backoff (initial 1 s, cap 5 min) and honor `Retry-After`. Authentication, schema, validation, installation, and structure-limit errors stop automatic retry. Metadata and object queues have separate concurrency, so image transfer cannot starve records.

The 3-second p95 metadata target is measured from committed push on client A to applied record on an already connected client B. Instrumentation records redacted durations for push commit, notification, pull, and apply, keyed by request/operation IDs only.

## 8. Backup model

### 8.1 Backup point format

A backup is an application-level logical point, not a copy of live directories. The job:

1. Opens a PostgreSQL `REPEATABLE READ, READ ONLY` transaction and records each included space's `restoreEpoch` and `nextSequence`.
2. Streams account/space/client identity metadata, Key verifier state (never plaintext), records, versions needed for retention, changes, conflicts, tombstones, references, audit, and configuration into bounded NDJSON chunks.
3. Reads the immutable committed object set referenced by that transaction. Objects created later are excluded; referenced committed objects cannot be garbage-collected while the backup lease exists.
4. Encrypts every chunk/object using a random data key and AES-256-GCM. The data key is wrapped by a backup master key supplied from a secret file/KMS adapter separate from the target bucket. Client Keys are never encryption keys.
5. Uploads encrypted entries under a temporary backup prefix. Each entry records plaintext digest, ciphertext digest, bytes, nonce, tag, and schema.
6. Writes and encrypts the manifest last, verifies it by re-read/decrypt/checksum, then atomically publishes a small committed marker containing manifest ciphertext digest.
7. Marks the point `verified`; only then may retention pruning run.

Manifest logical fields:

```json
{
  "formatVersion":1,
  "manifestId":"0195...",
  "instanceId":"0195...",
  "createdAt":"...",
  "scope":{"type":"server"},
  "databaseSchema":1,
  "protocol":1,
  "spaces":[{"accountId":"...","spaceId":"...","restoreEpoch":3,"sequence":840}],
  "entries":[{"path":"records/000001.ndjson.enc","kind":"records","plainBytes":0,"cipherBytes":0,"plainSha256":"...","cipherSha256":"..."}],
  "objects":{"count":31,"bytes":73400320},
  "encryption":{"algorithm":"AES-256-GCM","keyId":"backup-key-2026-01"}
}
```

Production target is S3-compatible and must be a different fault domain. A filesystem target is allowed only in development or on an explicitly acknowledged independently mounted backup medium; `doctor` and status warn otherwise. Bucket versioning/object lock is recommended, not assumed.

### 8.2 Scheduling and retention

Default schedule creates daily points and promotes verified points into 7 daily, 4 weekly, and 12 monthly slots. A production configuration cannot reduce any class below this baseline. Selection uses configured timezone but all manifest times are UTC. Failed or unverified points never displace a valid point or trigger pruning.

With daily verified points, declared worst-case RPO is 24 hours. The design does not claim sub-day point-in-time recovery until a future WAL/object-version capture mode is implemented and tested. Restore target for a documented reference data set is four hours excluding external transfer bottlenecks.

Backup job states are `queued|running|verifying|verified|failed`; fields include start/end, bytes, target alias, manifest ID, and redacted error. Credential values never enter database job payloads/logs.

### 8.3 Verification and restore

`backup verify` reads/decrypts the manifest, validates GCM tags and both digest layers, samples or fully verifies entries per mode, checks every referenced object, schema compatibility, and relational ownership. Automated production verification fully checks manifests and metadata every run; object verification is full for new entries and periodic full-set according to policy.

`restore stage` always writes to a new staging schema and staging object prefix/database. It never mutates online tables. It reports account/space counts, missing/corrupt objects, incompatible schemas, and target point. A quarterly automated drill starts a disposable server against staged data and runs reference integrity queries.

Formal scoped restore:

1. Require admin confirmation and verified staging result; create a pre-restore backup if source is readable.
2. Lock only affected account/space mutations. Unaffected scopes continue.
3. In one transaction replace/merge the selected account or space tables from staging, preserving ownership and assigning the affected space `restoreEpoch + 1`; allocate a new stream generation/floor.
4. Promote staged objects/references, then commit database activation only when required objects are readable.
5. Publish epoch-change invalidations to affected sockets and write audit. Other spaces retain epochs/cursors.
6. Clients preserve outboxes but must full-reconcile against the new epoch; stale operations enter normal conflict rules.

Account restore repeats this per owned space under one account-level operation. Single-record restore is deferred.

## 9. Export/import model

A space export reuses the backup manifest/chunk primitives but excludes password hashes, session rows, Key verifiers, backup settings, and global audit. It includes records, retained origins/client display metadata, conflicts/tombstones, object list/data, and checksums. Export encryption is either a user-supplied passphrase derivation or server-generated one-time download protection defined before implementation; no unencrypted persistent export is retained.

Import validates/decrypts into staging, then uses first-sync merge or verified destructive replacement. No import writes online rows before manifest/schema/reference validation.

## 10. Threat boundaries

| Boundary / threat | Required control |
| --- | --- |
| Browser account vs another account | Server session scope, object-level checks, forced RLS, scoped cache keys, indistinguishable not-found responses |
| Client Key vs management API | Separate authentication schemes/route hooks; Client Key cannot create/list spaces/clients or query account usage |
| One space vs another in same account | Space context derived/checked on every record/object/cursor/realtime/export/restore operation; space-local sequence and object authorization |
| Client impersonation | 256-bit unique Key, lookup fingerprint + Argon2id verifier, server-derived origin, stable installation binding, per-client revoke/rotation |
| Credential leakage | Header/cookie only, log serializers redact authorization/cookie/CSRF/password/Key and sensitive URLs; secure storage/no-store; backup excludes plaintext |
| Compromised renderer | Context isolation and narrow IPC keep Key/network policy in main; renderer can access displayed business data and request allowed sync operations, so this is containment, not complete protection |
| SSRF / malicious base URL | Desktop rejects credentials/query/fragment, production HTTP, certificate bypass, and redirect credential forwarding; DNS/connect address validation prevents loopback/private rebinding except explicit loopback dev mode |
| Object path/content attack | Server-generated keys, PNG MIME/signature validation, no filenames, symlink/path traversal rejection, digest/length verification, temp+atomic local commit |
| Digest existence probing | No global exists endpoint; constant response shape and space-local authorization; global physical dedupe never changes logical response |
| Replay/race | Operation uniqueness + request hash, part idempotency, row locks, scoped counters, restore epoch/cursor generation, binding generation tokens |
| CSRF/XSS/session theft | HttpOnly/Secure/SameSite cookie, Origin + CSRF token, CSP/Helmet, output via `textContent`, no inline script, session rotation/revocation |
| Password attacks | Argon2id, >=12 chars, generic failures, per-IP/account keyed throttles without permanent lockout, audited reset forcing change |
| Resource exhaustion | Bounded headers/JSON/batches/chunks/concurrency/connections, streaming, timeouts/backpressure, rate limits by IP and credential, job locks |
| Malicious/old schema | Per-entity strict validators, compatibility negotiation, quarantine, no silent unknown-field rewrite |
| Operator/server compromise | Not prevented by MVP E2EE; minimize secrets, encryption at rest/TLS, separate backup key/fault domain, audit, documented server-readable disclosure |
| Backup deletion/corruption | Encrypted checksummed manifest, commit marker last, verification before prune, versioned/locked target recommendation, staged drills |
| Restore blast radius | Staged validation, pre-restore backup, scoped locks/transactions, affected-space epoch only, audited explicit confirmation |
| Logs/metrics/diagnostics leakage | No payloads, note/clipboard text, local paths, query values, full digests, credentials; bounded redacted error summaries |

Admin CLI is a host-level trust boundary. It requires local process/secret access and a separate database role; exposing it through the account console is prohibited. S3/PostgreSQL administrators can read server-readable data and are inside the trusted operator boundary.

## 11. Configuration and secret handling

Configuration loads from environment plus an optional root-owned config file and is validated at startup. Secrets may be indirect file references (`*_FILE`) or a future KMS adapter. Required production values include database URL, cookie signing secret, Key lookup HMAC secret, console public origin, trusted proxies, S3 online/backup credentials, backup master-key reference, schedule/timezone, and retention.

Startup refuses:

- Default/short signing secrets.
- Non-TLS public origin or wildcard trusted proxy.
- Production backup retention below 7/4/12.
- Tombstone/conflict retention below 30 days or audit below 90 days.
- Same local directory for online and backup data without explicit development mode.
- Database schema newer/older than the supported migration compatibility range.

Credential rotation is versioned: cookie/key-fingerprint/backup key IDs permit an overlap while new writes use the newest key. Rotation never rewrites historical `originClientId`.

## 12. Observability and operations

- Structured application logs: timestamp, level, service/version, request ID, route template, status, duration, actor/space/client prefixes, stable error code. Redaction is tested with fixtures.
- Metrics: request counts/latency by route template/status, active WebSockets, push outcomes, cursor age, queue/job state, object bytes, backup age/result. Labels never use account names, entity IDs, digests, URLs, or payloads.
- Health separates liveness, database readiness, online object readiness, and backup health. Public endpoints reveal no tenant counts.
- Admin alerts: repeated auth/binding failures, storage unavailable, failed/old backup, verification mismatch, restore failure, cleanup failure, low underlying storage reported by adapters.
- Schema migration uses expand/migrate/contract releases. The server rejects unsupported downgrade/upgrade, and old clients cannot write schemas outside the advertised window.

## 13. Testing design

- **Pure domain:** schema allowlists, normalized names, merge/conflict/delete, cursor signing, idempotency request hashes, retention selection, manifest cryptography.
- **Database integration:** RLS and object-level negative matrix for every ID endpoint, 10/10 races, operation replay, paginated concurrent writes, scoped restore epoch.
- **Object integration:** multipart resume/replay/corruption, cross-space digest probing, storage failures, incomplete expiry, reference/GC constraints.
- **Desktop unit:** LocalStorage adapters, forbidden-field/path scan, IndexedDB crash protocol, binding namespace switch, backoff/status reducer.
- **Electron:** secure-store unavailable session mode, URL/TLS policy, setup/category/conflict UI, no renderer Key exposure, existing workspace compatibility.
- **Realtime:** lost/coalesced notification, revoke/disable closure, 30-second poll fallback.
- **Backup/restore:** injected missing/corrupt entries, failed verify prevents prune, 7/4/12 retention, staged dry run, one-space restore leaves others byte/logically unchanged.
- **Security:** generic authentication timing/shape, CSRF, CSP, session fixation, redaction, request bounds, header-only Key, cross-account/space/client authorization.
- **Performance:** metadata p95 target under reference load, object transfer does not block metadata/renderer, streaming memory ceilings.

No test depends on a public cloud or real user data. Existing `npm test` remains the desktop regression gate; server tests run from the new package, and both macOS and Windows Electron acceptance are required before release.

## 14. Design traceability

| Design section | Requirement groups |
| --- | --- |
| Architecture/stack/scope | `FR-001`-`FR-018`, `FR-122`-`FR-151`; `DR-015`-`DR-021`; `NFR-005`-`NFR-007`, `NFR-010`, `NFR-017`-`NFR-020` |
| Record/desktop model | `FR-019`-`FR-069`, `FR-081`-`FR-093`, `FR-132`-`FR-133`; `DR-001`-`DR-010`; `NFR-001`-`NFR-004`, `NFR-012`, `NFR-016`, `NFR-020` |
| Object model | `FR-070`-`FR-080`, `FR-096`-`FR-098`; `DR-004`-`DR-005`, `DR-011`-`DR-014`, `DR-017`, `DR-019`; `NFR-008`-`NFR-009` |
| Threat/config/observability | `FR-094`-`FR-100`, `FR-119`-`FR-121`; `NFR-005`-`NFR-012`, `NFR-016`-`NFR-020` |
| Backup/export/restore | `FR-101`-`FR-118`, `FR-134`, `FR-145`-`FR-146`; `NFR-013`-`NFR-015`, `NFR-017` |

Phase ownership for every numbered requirement and acceptance group is in [06-implementation-plan.md](./06-implementation-plan.md).
