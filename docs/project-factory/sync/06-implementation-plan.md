# Sync MVP v1 Implementation Plan

> Status: phased delivery plan. It implements [03-interface-map.md](./03-interface-map.md), [04-ui-design.md](./04-ui-design.md), and [05-technical-design.md](./05-technical-design.md) without changing the confirmed product boundary in [02-requirements.md](./02-requirements.md).

## 1. Delivery rules

- Documentation approval is the gate before runtime work. API/error/entity schemas are versioned fixtures shared across tracks.
- `workspace.json`, existing LocalStorage keys, current IPC names, and user behavior remain compatible. New sync state is additive.
- Server and desktop ship sync disabled until all P7 gates pass on macOS and Windows.
- No phase may introduce self-registration, MFA, E2EE claims, object/image business quotas, audio/recording sync, or broad setting sync.
- Every tenant/object endpoint receives positive and negative object-level authorization tests in the same change.
- Destructive replacement/restore remains unavailable until verified recovery point and staged restore exist.
- Desktop packaging/release is run only with explicit user authorization under the repository release policy.

## 2. Workstream ownership

| Code | Primary owner | Boundary |
| --- | --- | --- |
| `ARCH` | Protocol/architecture | Versioned schemas, error registry, compatibility, cross-track decisions |
| `ID` | Server identity/security | Account, session, CSRF, spaces, clients, Keys, binding, RLS, audit |
| `SYNC` | Server replication | Operations, records, versions, cursors, conflicts, tombstones, realtime |
| `OBJ` | Object storage | Multipart transfer, digest verification, references, lifecycle, usage |
| `DESK` | Electron desktop | Main sync client, preload/IPC, IndexedDB, adapters, settings/conflict UI |
| `WEB` | Account console | Same-origin vanilla console, login/security, spaces/clients/audit/export UI |
| `OPS` | Operations/data protection | CLI, jobs, health, export/import, backup, verification, restore, migrations |
| `QA` | Verification/security | Cross-scope tests, fault injection, performance, accessibility, platform regression |

Owners are accountable for implementation and tests. `QA` reviews every phase; `ARCH` reviews contract/schema changes; `ID` reviews any route containing an account/space/client/object/backup identifier.

## 3. Phase graph

```text
P0 Contracts and scaffold
  ├─> P1 Identity, isolation, console shell ─┐
  ├─> P2 Record/change engine ──────────────┼─> P5 Reconciliation, realtime, conflicts
  ├─> P3 Desktop local foundation ──────────┤
  └─> P4 Object transfer ───────────────────┘
                                                ├─> P6 Backup/export/restore
                                                └─> P7 Security, acceptance, release gate
```

P1-P4 can proceed in parallel after P0. P5 requires the P1 authentication context and P2/P3 contracts; attachment-complete flows also require P4. P6 can build manifest primitives earlier but destructive restore integration waits for P5 epochs/reconciliation. P7 is not a cleanup phase: each earlier phase must already include unit/integration tests for its scope.

## 4. Phased work

### P0 - Contracts, scaffold, and test infrastructure

**Owners:** `ARCH` primary; `ID`, `SYNC`, `OBJ`, `DESK`, `OPS`, `QA` reviewers.

Deliverables:

1. Create independent `sync-server/` Node 22 package, environment validation, Fastify composition, structured/redacted error model, migrations runner, and `node:test` entry points.
2. Freeze protocol v1 fixtures for discovery, common errors, account/session, typed records, push/pull cursors, objects, backup manifest, and audit.
3. Define technical limits: 32 KiB headers, 1 MiB JSON, 100 push operations, 500 pull changes, 8 MiB parts, four client transfers, 10,000 parts, bounded timeouts.
4. Add disposable PostgreSQL and S3-compatible integration environment. CI does not contact public services.
5. Add compatibility matrix and migration metadata; server refuses unsupported schema state.
6. Add secret/log fixture scanner before any credential endpoint exists.

Exit evidence:

- Discovery/error schema golden tests pass.
- Migration up/down compatibility check (down means refusal/documented rollback, not destructive automatic downgrade) passes.
- A sample secret in every header/body/error location is absent from captured logs.
- Existing desktop `npm test` remains unchanged and green.

### P1 - Identity, isolation, and account console shell

**Owners:** `ID` server, `WEB` console, `DESK` connection preflight; `QA` authorization matrix.

Deliverables:

1. Accounts/admin CLI create/list/disable/enable/delete/reset-password; Argon2id password policy and forced password change.
2. Cookie sessions, idle/absolute expiry, session fixation prevention, CSRF + Origin checks, recent reauthentication, revoke other sessions, generic/rate-limited failures. No registration or MFA routes/UI.
3. Account/space/client/Key tables, RLS, compound ownership constraints, normalized unique space names, race-free 10 active spaces / 10 active clients.
4. 256-bit one-time Client Keys, lookup fingerprint + Argon2id verifier, immediate/<=24-hour rotation, revoke, connection close.
5. Stable random installation ID, atomic first binding, mismatch audit, reset binding with preserved `clientId` and one-time new Key.
6. Console login/security/spaces/clients/usage/audit shell. One-time Key remains view-memory only and all credential responses are no-store.
7. Desktop URL/TLS policy, connection test, secure-store/session-only mode, identity confirmation, and binding tuple validation.
8. Account/space/client lifecycle invalidations and audit events; no business payload in logs/audit.

Exit evidence:

- Full cross-account/cross-space/cross-client ID substitution matrix returns scoped not-found/auth failures without timing/body existence leaks.
- Concurrent creates cannot exceed 10/10; limits return current/limit and do not affect another scope.
- Key create/rotate/reset is visible once, absent after refresh, absent from database/log/browser storage/backup fixture.
- Disable/revoke/inactivate closes correct sessions/connections only.
- CSRF, CSP, cookie flags, recent-auth, generic login failure, no-registration, and no-MFA browser tests pass.

### P2 - Typed record, cursor, conflict, and deletion engine

**Owners:** `SYNC` primary; `ID` scope review; `ARCH` schema review; `QA` concurrency/fault tests.

Deliverables:

1. Record schema registry and strict validators for all MVP included/optional entity types; explicit forbidden-field/path scanner.
2. Per-space sequence, signed opaque cursor/epoch, stable page upper bound, 90-day default change retention, explicit cursor expiry.
3. Transactional push with operation request hash/idempotency, server-derived origin/time/revision, per-operation result, and source audit.
4. Pull/reconcile/stats APIs with account/space scope, category filters, and schema negotiation/quarantine behavior.
5. Version history, field merge, note body/title conflict copy, todo/link field conflicts, preference server-order LWW, stable item sort keys.
6. Tombstone, stale-edit conflict, retained restore, and deterministic cleanup guards with 30-day minimum.
7. PostgreSQL notifications containing only scope/sequence invalidations.

Exit evidence:

- 100 identical operation replays create one result; reused ID with changed request fails.
- Concurrent write/pull paging never skips a sequence; expired cursor never returns a partial delta.
- Source is always authenticated client even when payload forges another client.
- Concurrent note/delete/restore fixtures retain all versions through policy.
- RLS and route checks reject record/cursor/conflict/object-ID substitution across every boundary.

### P3 - Desktop durable queue, adapters, and settings

**Owners:** `DESK` primary; `ARCH` adapter schemas; `QA` crash/platform tests.

Deliverables:

1. `main/sync/` authenticated HTTP/WebSocket service, safeStorage credential envelope, generation cancellation, retry/backoff, sanitized status.
2. `main/ipc/sync.js` plus frozen `notchAPI.sync`; existing APIs and channels stay intact.
3. IndexedDB binding/mirror/outbox/inbox/cursor/conflict/object/transfer/quarantine stores, namespaced by instance/space/client/workspace.
4. Crash-safe inbox projection and durable outbox; periodic mirror scan recovers local changes created before enqueue.
5. Adapters for todo/category, notes/taxonomy, links/groups, portable preference allowlist, and optional clipboard/screenshot/AI/finance/command/launcher/location categories.
6. Explicit exclusion of secrets, paths, recordings/transcripts, video/partial captures, music, extensions, caches, diagnostics, drafts, shortcuts, workspace path, and device state.
7. Settings disconnected/setup/connected/status/category flows, one clipboard switch, unsupported media rows, privacy copy, pause/remove behavior.
8. First-sync local inventory and plan UI scaffold; execution is enabled in P5.

Exit evidence:

- Existing LocalStorage/workspace fixtures remain byte/semantically compatible; `workspace.json` is never uploaded.
- Once UI says queued, restart preserves operation and causality.
- Injected crash around each inbox projection boundary safely replays or completely applies, never advances past missing data.
- Switching A->B cannot send A outbox, cursor, conflict, or object map under B.
- Scan of operations/logs/diagnostics contains no secret, absolute path, recording, video, or forbidden setting.
- Renderer cannot read persisted Client Key; safeStorage unavailable persists no plaintext.

### P4 - Object transfer and attachment integrity

**Owners:** `OBJ` server, `DESK` transfer/local files; `QA` corruption/backpressure/security.

Deliverables:

1. Space-local object authorization, server-generated keys, multipart session/part/complete/cancel/resume APIs.
2. Streaming SHA-256/length/MIME verification; PNG allowlist; no client filename/storage key.
3. Desktop temp-file download + verify + atomic rename; resumable upload/download checkpoints and limited concurrency.
4. Parent completeness gate for note images, clipboard images, and complete screenshots. No audio/video/partial capture path.
5. 24-hour incomplete cleanup, reference-aware/retention-aware garbage collection, and observation-only usage rollups.
6. Cross-scope digest probing tests and optional dedupe abstraction with identical logical responses.
7. Separate metadata/object schedulers and renderer progress throttling.

Exit evidence:

- Interrupted/replayed parts do not duplicate data; corrupt length/digest is rejected.
- Parent never appears complete before every object verifies; failed download cannot replace valid local file.
- Same digest in two accounts/spaces creates no observable existence/download/timing authorization channel.
- Storage exhaustion preserves local object/checkpoint, returns retryable storage error, and backs off.
- No account/space bytes, image count, or full-image business quota exists; technical part/request boundaries are enforced/documented.

### P5 - First sync, realtime, reconciliation, and conflict UX

**Owners:** `SYNC` server, `DESK` client/UI; `QA` end-to-end/fault tests.

Deliverables:

1. First-sync stats/plan/execute: remote-empty upload, local-empty download, default safe merge.
2. Recovery-point-gated local-wins/server-wins advanced flow with impact and explicit confirmation; cancellation changes nothing.
3. WebSocket invalidation with header authentication and scoped connection index; revoke/disable/restore close behavior.
4. Startup/wake/network/reconnect/30-second reconciliation; missed/coalesced notifications cannot lose changes.
5. Conflict center and tombstone restore UI with source client/time/differences, stale-resolution handling, keyboard/accessibility.
6. Category stop vs confirmed remote tombstone deletion; active transfers stop at safe checkpoint.
7. Full reconcile after cursor expiry or restore epoch change while retaining local outbox.
8. Status/diagnostics projection and p95 latency instrumentation without payloads.

Exit evidence:

- Two-device online/offline/concurrent/delete scenarios pass with no silent loss.
- At least 95/100 metadata edits appear on connected peer within 3 seconds under reference load.
- Dropped realtime notification is repaired by polling; revoke affects only targeted Key/client.
- Destructive first sync cannot run without verified recovery point and typed confirmation.
- Cursor expiry/restore preserves unsent operations and applies normal conflict rules.
- All UI status/conflict actions are keyboard operable and not color-only.

### P6 - Backup, restore, export/import, and operations

**Owners:** `OPS` primary; `ID` scoped authorization; `SYNC` epoch/reconcile; `QA` recovery drills.

Deliverables:

1. Admin CLI stable commands/JSON/exit codes for accounts, limits, usage, audit, backup, restore, migration, and doctor; secrets via env/file/interactive input only.
2. Logical repeatable-read backup, immutable object lease, AES-256-GCM envelope encryption, separately stored master-key reference, manifest/commit marker.
3. S3-compatible target configuration and production fault-domain validation/warnings.
4. Daily scheduler and verified-point retention selector for minimum 7 daily/4 weekly/12 monthly; no prune after failed/unverified point.
5. Non-destructive verify, isolated staged restore, schema/reference/object report, quarterly automated drill support.
6. Scoped account/space formal restore with pre-restore backup, affected-scope lock, affected-space epoch increments only, invalidation/audit.
7. Space export and staged import using manifest primitives and first-sync merge/replace confirmations.
8. Component health, backup health/export, alerts, cleanup jobs, and migration compatibility checks.

Exit evidence:

- Every successful point re-reads/decrypts/verifies manifest and required objects; deliberate corruption fails.
- Failed backup preserves last valid point and cannot trigger prune.
- Retention fixture always keeps at least 7/4/12 verified points.
- Staged restore mutates no online data. One-space restore changes only that space epoch/data; other cursors continue.
- Restored clients cannot use old cursor and preserve outbox for full reconcile.
- Backup/database/export scan finds no plaintext password/Client Key/backup credential/business-excluded secret.
- Reference restore meets documented 4-hour target excluding external bottleneck; daily schedule documentation states 24-hour RPO, not PITR.

### P7 - Cross-cutting hardening and release gate

**Owners:** `QA` primary; every workstream fixes findings; `ARCH` approves scope/compatibility.

Deliverables:

1. Full requirement/acceptance matrix execution, including every negative authorization endpoint test.
2. Abuse/resource/backpressure tests; renderer responsiveness with concurrent images; stable redacted error code coverage.
3. Threat review against [05-technical-design.md](./05-technical-design.md), dependency audit, lockfile review, and production deployment runbook.
4. macOS 13+ arm64 and Windows 10/11 x64 desktop tests; server Node 22/PostgreSQL/S3 matrix.
5. Accessibility and responsive review for desktop settings/conflicts and Web console.
6. Upgrade/rollback rehearsal, schema compatibility rejection, restore drill, and backup alert exercise.
7. Documentation update gate: README behavior, administrator/deployment guide, privacy disclosure, changelog, version/download policy if release is authorized.

Release exit:

- `SM-001`-`SM-008` have captured evidence.
- `AC-001`-`AC-060` pass or the release is blocked; no waiver permits isolation, credential, silent-loss, or restore-integrity failures.
- Existing desktop test suite plus server/unit/integration/Electron/security suites pass on both platforms.
- Sync remains opt-in and off by default for existing installations until connection setup is completed.

## 5. Functional requirement ownership

Ranges below are inclusive and collectively cover every `FR-001` through `FR-151`. “Primary phase” is where behavior becomes usable; prerequisite schema may appear earlier.

| Requirements | Primary phase | Owner | Verification focus |
| --- | --- | --- | --- |
| `FR-001` | P0 | `ARCH` | Discovery/compatibility |
| `FR-002`-`FR-011` | P1 | `ID` | Multi-account scope, password/Key separation, header-only origin |
| `FR-012`-`FR-018` | P1/P3 | `DESK` | URL/TLS/secure storage/binding/removal |
| `FR-019`-`FR-025` | P3/P5 | `DESK` | Category defaults, single clipboard switch, stop/delete distinction |
| `FR-026`-`FR-037` | P2/P3 | `SYNC` | Typed operations, idempotency, cursor atomicity, adapters |
| `FR-038`-`FR-046` | P5 | `SYNC` + `DESK` | Invalidation, polling, durable offline status |
| `FR-047`-`FR-053` | P5 | `SYNC` + `DESK` | First-sync plans/recovery point/cancel/reconcile |
| `FR-054`-`FR-063` | P2/P5 | `SYNC` + `DESK` | Merge/conflict preservation/resolution UI |
| `FR-064`-`FR-069` | P2/P5/P6 | `SYNC` | Tombstone/restore/GC/purge |
| `FR-070`-`FR-080` | P4 | `OBJ` + `DESK` | Multipart/integrity/no business quota/media state |
| `FR-081`-`FR-093` | P3/P4 | `DESK` | Entity semantics, allowlists, excluded paths/media/secrets |
| `FR-094`-`FR-100` | P1/P4/P7 | `ID` | Disclosure, redaction, abuse bounds, audit |
| `FR-101`-`FR-116` | P6 | `OPS` | Encrypted verified S3 backup, 7/4/12, scoped restore |
| `FR-117`-`FR-121` | P6/P7 | `OPS` | Export/import/diagnostics/health/upgrade guard |
| `FR-122`-`FR-131` | P1 | `ID` + `WEB` | Client/Key/account/space lifecycle and limits |
| `FR-132` | P2/P5 | `SYNC` | Shared space data, isolated stream/source |
| `FR-133` | P3 | `DESK` | Binding namespaces/safe switching |
| `FR-134` | P6 | `OPS` + `SYNC` | Restore affects only selected epoch |
| `FR-135`-`FR-144` | P1 | `ID` + `WEB` | Account console/password/session/CSRF/recent auth/names |
| `FR-145`-`FR-146` | P6 | `OPS` | CLI coverage, exit codes, secret-safe output |
| `FR-147`-`FR-150` | P1/P3 | `ID` + `DESK` | Random installation binding/mismatch/reset |
| `FR-151` | P1/P7 | `ID` + `WEB` | No MFA API or UI |

## 6. Data requirement ownership

Ranges collectively cover every `DR-001` through `DR-021`.

| Requirements | Primary phase | Owner | Evidence |
| --- | --- | --- | --- |
| `DR-001`-`DR-003` | P2 | `ARCH` + `SYNC` | Stable IDs, UTC, strict bounded schemas |
| `DR-004`-`DR-005` | P3/P4 | `DESK` + `OBJ` | Reference graph and digest object IDs |
| `DR-006`-`DR-007` | P3/P7 | `DESK` | Local compatibility and future-schema quarantine |
| `DR-008`-`DR-010` | P2/P6 | `SYNC` + `OPS` | Separate retention classes, 30/90-day minima |
| `DR-011`-`DR-014` | P4/P6 | `OBJ` + `OPS` | 24-hour uploads, storage errors, explicit resource codes, no eviction |
| `DR-015`-`DR-018` | P1/P2 | `ID` | Traceable ownership, credential-derived scope, name identity |
| `DR-019` | P1/P4 | `ID` + `OBJ` | Observed usage without quota rejection |
| `DR-020`-`DR-021` | P1/P3 | `ID` + `DESK` | Immutable client origin and random non-hardware installation ID |

## 7. Non-functional requirement ownership

Ranges collectively cover every `NFR-001` through `NFR-020`.

| Requirements | Primary phase | Owner | Gate |
| --- | --- | --- | --- |
| `NFR-001`-`NFR-004` | P2/P3/P5 | `SYNC` + `DESK` | Offline saves, durable queues/acks, idempotent replay |
| `NFR-005`-`NFR-007` | P1/P7 | `ID` | TLS, secret handling, tenant isolation matrix |
| `NFR-008`-`NFR-009` | P0/P4/P7 | `ARCH` + `OBJ` | Documented finite technical bounds and nonblocking media |
| `NFR-010`-`NFR-012` | P0/P5/P7 | `ARCH` + `QA` | Compatibility, redacted error codes, accessibility |
| `NFR-013`-`NFR-015` | P6 | `OPS` | 24-hour RPO, 4-hour reference RTO, verified restore |
| `NFR-016` | P3/P7 | `DESK` | New sensitive categories default off |
| `NFR-017` | P1/P2/P4/P6/P7 | `ID` | Fault/restore isolation under load/failure |
| `NFR-018` | P1-P7 | `ID` + `QA` | Object-level authorization test on every ID endpoint |
| `NFR-019` | P1/P7 | `ID` + `WEB` | Session/CSRF/CSP/headers/no shared cache |
| `NFR-020` | P1/P2/P7 | `ID` + `SYNC` | Server-authenticated origin never rewritten |

## 8. Acceptance condition ownership

Ranges collectively cover every `AC-001` through `AC-060`. QA owns final execution; the listed owner supplies fixtures and fixes.

| Acceptance | Phase | Implementation owner | Test suite |
| --- | --- | --- | --- |
| `AC-001`-`AC-004` | P2/P3/P5 | `SYNC` + `DESK` | First sync, offline restart, idempotency |
| `AC-005`-`AC-009` | P2/P5 | `SYNC` + `DESK` | Conflict/delete/restore/realtime loss/crash injection |
| `AC-010`-`AC-011` | P4 | `OBJ` + `DESK` | Resume/digest/completeness |
| `AC-012`-`AC-013` | P3/P5 | `DESK` | Category defaults and stop/delete behavior |
| `AC-014`-`AC-016` | P1/P6/P7 | `ID` + `OPS` | HTTPS and credential storage/log/backup scan |
| `AC-017`-`AC-018` | P1/P5 | `ID` | Targeted revoke/rotation and connection closure |
| `AC-019`-`AC-020` | P1/P3 | `DESK` | Forbidden payload scan and instance mismatch block |
| `AC-021`-`AC-024` | P3/P4/P5 | `DESK` + `OBJ` | Cursor expiry, schema quarantine, storage backoff, partial exclusion |
| `AC-025`-`AC-030` | P6 | `OPS` + `SYNC` | Backup completeness/failure/prune/dry-run/staged restore/epoch |
| `AC-031` | P7 | `DESK` + `QA` | Existing Electron/storage compatibility suite |
| `AC-032`-`AC-035` | P1/P2 | `ID` + `SYNC` | Multi-account/space/client and forged scope matrix |
| `AC-036` | P3 | `DESK` | Binding state isolation |
| `AC-037`-`AC-038` | P1/P5 | `ID` + `SYNC` | Account/space lifecycle fault isolation |
| `AC-039` | P6 | `OPS` + `SYNC` | Scoped restore leaves other epochs unchanged |
| `AC-040` | P4/P7 | `OBJ` + `QA` | Cross-account digest probe/timing test |
| `AC-041` | P1 | `ID` | Concurrent 10/10 structural limits |
| `AC-042`-`AC-047` | P1 | `ID` + `WEB` | Protected console, local login, names, one-time Key, sessions, CSRF |
| `AC-048` | P6 | `OPS` | Scripted CLI/exit/secret-safe output |
| `AC-049`-`AC-050` | P2 | `SYNC` | Distinct authenticated origins and forged origin rejection |
| `AC-051`-`AC-056` | P1 | `ID` | Unique Keys, binding reset, immutable origins, exact 10/10 limits |
| `AC-057` | P4 | `OBJ` | No business quota; technical re-chunk response |
| `AC-058` | P2/P6 | `SYNC` + `OPS` | 30-day recovery and 7/4/12 manifests |
| `AC-059` | P3 | `DESK` | Only theme/features/default page synchronize |
| `AC-060` | P1/P7 | `ID` + `WEB` | No MFA in login/password/reset/session flows |

## 9. Milestone test matrix

| Test layer | P0 | P1 | P2 | P3 | P4 | P5 | P6 | P7 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Schema/unit | Required | Required | Required | Required | Required | Required | Required | Full |
| PostgreSQL/S3 integration | Scaffold | Identity/RLS | Records | Contract mocks | Objects | End-to-end | Backup/restore | Full |
| Browser console | Scaffold | Required | - | - | - | Conflicts as applicable | Export state | Full/a11y |
| Electron Node tests | Baseline | Connection | Adapter fixtures | Required | Required | Required | Restore response | Full |
| Electron macOS/Windows | Baseline | Smoke | - | Queue/setup | Transfer | Two-device | Restore epoch | Full |
| Security/authorization | Redaction | Full scope | Full IDs | IPC/secret | Object probe | Realtime | Backup/restore | Full |
| Fault/crash injection | - | Session revoke | DB concurrency | IndexedDB | Storage | Network/realtime | Backup/restore | Full |
| Performance | Baseline | Auth limits | Push/pull | Renderer queue | Backpressure | 3-second p95 | RTO fixture | Full |

## 10. Rollout and migration

1. Deploy server with sync disabled externally; run migrations and `doctor` against PostgreSQL, online S3, backup S3, TLS origin, and secrets.
2. Create administrator-owned test accounts via CLI; run backup + verify + staged restore before user data.
3. Ship desktop code behind a local feature flag/off state. Existing installations see no network behavior until setup.
4. Pilot one account/two spaces/two clients with core categories only. Validate rollback by pausing/removing binding while local content remains usable.
5. Enable image categories, then opt-in sensitive categories. Audio/recording/video remain impossible at schema and UI layers.
6. Run 30-day retention cleanup simulation, quarterly restore-drill automation, and both-platform acceptance.
7. Only after P7 evidence, expose sync normally and update release documentation/version artifacts under explicit release authorization.

Server rollback is application-version rollback only while its supported database compatibility range includes the current schema. Destructive migration rollback is never automatic; pre-upgrade verified backup and staged restore are the recovery path. Desktop rollback leaves existing LocalStorage/`workspace.json` readable and ignores additive IndexedDB/preload features.

## 11. Definition of done

Sync MVP v1 is done only when:

- Every row in Sections 5-8 has implementation, automated evidence, and an accountable owner.
- Account and space isolation includes records, objects, cursors, realtime, usage, audit, export, backup restore, caches, errors, and metrics.
- Key origin and installation binding are server-enforced; no plaintext Key/password appears in storage, logs, URLs, exports, or backups.
- Offline operations, conflicts, tombstones, object checkpoints, and restore-epoch reconciliation survive restart/fault tests without silent loss.
- Production backup retains at least 7 daily/4 weekly/12 monthly verified points and completes a staged restore drill.
- Existing local persistence and desktop behavior remain compatible, and both supported OS suites pass.
