# Sync MVP v1 Requirement Traceability

> Status: implemented repository traceability for Sync MVP v1. The matrix retains all 313 unique requirement IDs exactly once and is paired with the current outcome classification in section 7. No environment-gated result is promoted to PASS without an artifact.

## 1. Scope and method

- Requirement source: `docs/project-factory/sync/02-requirements.md`.
- Implemented runtime sources: `main/sync/`, `renderer/sync/`, `main/ipc/sync.js`, `preload.js`, `sync-server/`, and focused tests under `tests/` and `sync-server/test/`.
- The primary matrix in section 8 contains all 313 unique requirement IDs exactly once. IDs remain grouped by capability; section 7 records the current implementation and verification outcomes for those groups.
- **Baseline evidence** identifies local application contracts preserved by the implementation. **Implementation evidence** identifies the final module ownership; **verification evidence** identifies deterministic tests or an explicit external gate.
- `workspace.json` remains a whole-LocalStorage portability snapshot and compatibility input only. It is never the sync wire schema.

## 2. Persistence inventory

### 2.1 LocalStorage keys

`renderer/app-shell.js` enumerates every LocalStorage entry every two seconds and sends it through `workspace:save-data`; `main/workspace-controller.js` stores the strings under `workspace.json.localStorage`. Consequently unknown/future keys may exist even though the known first-party keys are inventoried here.

| Key | Observed value/schema | Sync disposition | Source |
|---|---|---|---|
| `notch-todo-data` | `{P0: Todo[], P1: Todo[], P2: Todo[], P3: Todo[]}` | Default on; preserve buckets and IDs | `renderer/todo-data.js` |
| `notch-todo-category-names-v1` | `{P0:string,P1:string,P2:string,P3:string}` | Default on | `renderer/app.js`, `renderer/home-layout-domain.js` |
| `notch-note-archive-v1` | `Note[]` | Default on | `renderer/notes-store.js`, `renderer/domain.js` |
| `notch-note-categories-v1` | `NoteCategory[]` | Default on | `renderer/notes-store.js`, `renderer/domain.js` |
| `notch-home-note` | Current editor text cache | Never sync separately; derived/legacy editor state | `renderer/notes-controller.js` |
| `notch-note-active-archive-v1` | Active note ID | Local UI state | `renderer/notes-controller.js` |
| `notch-link-groups` | `LinkGroup[]` | Default on | `renderer/workspace.js`, `renderer/workspace-links-domain.js` |
| `notch-clip-history` | `ClipboardEntry[]`, maximum 100 in current controller | Default off as one clipboard category | `renderer/clipboard-store.js` |
| `notch-clip-favorites` | `string[]` entry IDs | Default off with clipboard category | `renderer/clipboard-store.js` |
| `notch-ai-chat-sessions-v1` | `{schemaVersion:1,sessions: ChatSession[]}` (legacy bare array accepted) | Default off | `renderer/chat-sessions.js` |
| `notch-finance-watchlists-v1` | `{schemaVersion:1,lists,assets}` | Optional portable subset | `renderer/finance-store.js` |
| `notch-finance-view-preferences-v1` | Portable display fields | Selected fields only | `renderer/finance-store.js` |
| `notch-home-weather-v1` | Selected location object | Default off | `renderer/home-weather-controller.js` |
| `notch-home-commands` | `Command[]` | Default off | `renderer/workspace-commands.js`, `renderer/domain.js` |
| `notch-launcher-favorites-v1` | `string[]` | Optional | `renderer/launcher.js` |
| `notch-launcher-aliases-v1` | `{[resultId]: string}` | Optional | `renderer/launcher.js` |
| `notch-launcher-usage-v1` | `{[resultId]:{count,lastUsedAt}}` | Local only | `renderer/launcher.js` |
| `notch-recordings` | `Recording[]` containing transcript and audio path | Never sync in MVP | `renderer/workspace.js`, `renderer/domain.js` |
| `notch-active-tab` | Tab name | Local only; app `defaultTab` is the portable preference | `renderer/app.js` |
| `notch-hidden-windows` | Window IDs | Local only | `renderer/workspace-windows.js` |
| `notch-home-order-v3` | Widget ID order array | Local/platform-sensitive | `renderer/home-layout-controller.js` |
| `notch-home-widget-sizes-v2` | `{[widgetId]: mini|small|medium|large}` | Local/platform-sensitive | `renderer/home-layout-controller.js` |
| `notch-home-hidden-modules-v1` | Hidden widget ID array | Local/platform-sensitive | `renderer/home-layout-controller.js` |
| `notch-home-layout-v2` | Legacy layout object, read for migration | Local only; do not rewrite by sync | `renderer/home-layout-controller.js` |
| `notch-home-capture-v1` | Quick-capture draft string | Never sync (draft) | `renderer/home-quick-capture-controller.js` |
| `notch-home-music-discovery-filter-v1` | Discovery filter object | Never sync | `renderer/home-music-controller.js` |
| `notch-home-music-shuffle-v1` | Shuffle state | Never sync | `renderer/home-music-controller.js` |
| `notch-home-music-track-v1` | Current local track ID | Never sync | `renderer/home-music-controller.js` |
| `notch-home-music-volume-v1` | Numeric string, 0-100 | Never sync | `renderer/home-music-controller.js` |
| `dynamic-panel-pomodoro-duration-v3` | Pomodoro duration parts | Local only (not in preference allowlist) | `renderer/pomodoro-controller.js` |

No sync implementation may infer eligibility from a key prefix or from presence in `workspace.json`. New/unknown keys are denied until explicitly classified.

### 2.2 App settings and other JSON files

| File/location | Exact observed fields | Sync disposition | Source |
|---|---|---|---|
| settings `app-settings.json` | `features.{home,todo,finance,notes,links,recordings,credentials,clip}`, `shortcut`, `shortcuts.{screenshot,screenRecording,audioRecording}`, `defaultTab`, `theme`, `notchHeight.{mode,custom}` | Allow only `features`, `defaultTab`, `theme`; all other fields local | `main/app-settings-service.js`, `main-services.js` |
| public app-settings projection | Stored fields plus `shortcuts.launcher`, `autoLaunch` | `shortcuts.launcher` and `autoLaunch` local only | `main/app-settings-service.js` |
| settings `workspace-settings.json` | `{path:absolutePath}` | Never sync | `main/workspace-controller.js` |
| workspace `workspace.json` | `{version:1,updatedAt:number,localStorage:{[key]:string}}` | Never transmit wholesale; local compatibility snapshot only | `main/workspace-controller.js`, `renderer/app-shell.js` |
| settings `launcher-settings.json` | `shortcut`, `sources.{apps,workspace,clipboard,extensions}`, `queryTimeoutMs`, `executeTimeoutMs` | Local only | `main/launcher-settings-store.js` |
| settings `finance-settings.json` | `schemaVersion`, `refreshSeconds`, providers including encrypted credentials and verification | Never sync; credentials/diagnostics forbidden | `main/finance-settings-store.js` |
| settings `transcription-settings.json` | Provider/model configuration and encrypted credential material | Never sync | `main.js`, `main/ai-provider-config.js` |
| settings `ai-diagnostics.json` | Provider diagnostics/migration state | Never sync | `main/ai-provider-config.js` |
| settings `credentials.vault.json` | Encrypted credential vault | Never sync, including ciphertext | `main.js`, `main/ipc/credentials.js` |
| settings `capture-settings.json` | `screenshot`, `video`, `quality`, `audio`, `countdown`, remembered region/display data | Local/device only | `captureService.js`, `renderer/capture.js` |
| settings `music-library.json` | Local/network music library and cache | Never sync | `main.js`, `home-media.js` |
| workspace `captures/index.json` | `{version:1,items: CaptureItem[]}` | Only complete screenshot records and PNG objects; video/incomplete excluded | `captureStorage.js` |
| launcher extension tree | registry, manifests, extension code, permissions, per-extension storage | Never sync automatically | `launcher/service.js`, `launcher/extension-host.js` |

### 2.3 Workspace/media paths

| Path (relative to workspace root) | Existing contract | Sync treatment | Source |
|---|---|---|---|
| `workspace.json` | LocalStorage snapshot, max 8 MiB serialized by controller default | Local only; parse through compatibility adapters | `main/workspace-controller.js` |
| `note-images/<noteId>/image-<uuid>.png` | `/` separators; note ID 6-80 alphanumeric/hyphen; source <=20 MiB; PNG output; max edge 2400 | Objectize by digest; parent note dependency; never send path | `main-services.js`, `main/workspace-files.js` |
| `clipboard-images/clip-<id>.png` | Portable relative path; safe basename and no symlink | Default-off clipboard object; never send path | `main/workspace-files.js`, `main/clipboard-service.js` |
| `recordings/recording-<id>.(webm|m4a|ogg|wav)` | Portable relative path referenced by recording row | Entire record/audio/transcript excluded in MVP | `main/workspace-files.js`, `renderer/domain.js` |
| `captures/index.json` | Atomic index, up to 5000 rows | Local index remains canonical locally; adapter selects eligible screenshots | `captureStorage.js` |
| `captures/screenshots/<uuid>.png` | Complete PNG screenshot | Default-off screenshot object | `captureStorage.js` |
| `captures/videos/<uuid>.webm` | Complete screen recording | Excluded | `captureStorage.js` |
| `captures/videos/<uuid>.partial` | Incomplete recording | Excluded | `captureStorage.js` |

`main/workspace-controller.js` currently copies only recordings, clipboard images, note images, `workspace.json`, and separately delegates capture copying. Sync must not reuse directory-copy semantics; media paths become digest/object references at the boundary and are restored to valid portable relative paths after verified download.

## 3. Existing entity schemas to preserve

### 3.1 Todo

```text
TodoData = { P0: Todo[], P1: Todo[], P2: Todo[], P3: Todo[] }
Todo = {
  id: string,
  text: string,
  done: boolean,
  createdAt: number,
  deadline: ISO-8601 string | "",
  remindedAt: non-negative number
}
TodoCategoryNames = { P0: string, P1: string, P2: string, P3: string }
```

Source: `renderer/todo-data.js`, with create/update behavior in `renderer/domain.js`. Legacy string items are upgraded locally to generated IDs. Current todos have no `updatedAt`; field-level sync therefore needs adapter-owned revision/base metadata without mutating the stored Todo shape.

### 3.2 Notes and taxonomy

```text
Note = { id, title, titleSource: ""|"model"|"user", categoryId, tagId,
         content, createdAt, updatedAt }
NoteCategory = { id, name, tags: NoteTag[] }
NoteTag = { id, name }
```

Source: `renderer/domain.js`, `renderer/notes-store.js`. Limits include 200 notes, 40 categories, 30 tags/category, title 80 code points, category/tag names 24 code points, and IDs up to 80 code points in normalizers. Markdown image references are the relative note-image form above. Synchronizing a note requires validating every referenced object; deletion currently removes the note's attachment directory through notes IPC.

### 3.3 Links

```text
LinkGroup = { id, name, collapsed, links: Link[] }
Link core = { id, url, title, description, tags:string[], favorite:boolean,
              read:boolean, note, createdAt, updatedAt, lastOpenedAt? }
```

Source: `renderer/workspace-links-domain.js`, `renderer/workspace-links-actions.js`, `renderer/domain.js`. Normalization deliberately spreads unknown fields on both groups and links. The sync payload must allowlist the core fields, retain stable group/link IDs, treat `collapsed` as local presentation unless explicitly approved, and continue public HTTP/HTTPS inspection rules through `main/ipc/links.js` and the network security helpers.

### 3.4 Clipboard

```text
ClipboardEntry = {
  id: string,
  type: "text"|"url"|"image",
  text: string|null,
  imagePath: string|null,
  timestamp: number
}
ClipboardFavorites = string[]  // ClipboardEntry IDs
```

Source: `renderer/clipboard-store.js`. History currently rolls at 100 entries and deletes evicted image files; favorite IDs do not presently exempt an entry from history eviction. A single sync switch must gate entries, favorite relationships, and image objects together. The favorite-eviction rule is an unresolved product/data blocker because remote retention cannot safely copy the current local eviction behavior.

### 3.5 Screenshots and recordings

```text
CaptureIndex = { version: 1, items: CaptureItem[] }
Screenshot = { id:uuid, kind:"screenshot", title, createdAt, path,
               mimeType:"image/png", status:"complete", bytes, width, height }
Video = { id:uuid, kind:"video", title, createdAt, path, mimeType,
          audio:"none"|"microphone", status:"complete"|"incomplete",
          width, height, bytes?, durationMs? }
Recording = { id, createdAt, durationMs, transcript, audioPath, mimeType,
              title, category }
```

Source: `captureStorage.js` and `renderer/domain.js`. Only screenshot rows with `status:"complete"` and verified PNG objects are eligible. Videos, `.partial` files, `notch-recordings`, audio, transcripts, capture activity and remembered regions are forbidden.

### 3.6 Saved AI sessions

```text
ChatStore = { schemaVersion:1, sessions: ChatSession[] }
ChatSession = { id, title, createdAt, updatedAt, records:ChatRecord[], history:History[] }
ChatRecord = { id, groupId, prompt, sources:SourceSnapshot[], context:History[],
               answer, state:"complete"|"stopped"|"error", detail, createdAt }
SourceSnapshot = { sourceType, sourceId, sourceTitle, sourceRevision,
                   text, detail, updatedAt }
History = { role:"user"|"assistant", content }
```

Source: `renderer/chat-sessions.js`, `renderer/chat-context.js`. Existing limits are 30 sessions, 30 records/session, 512,000 serialized characters/session and 2,000,000 total. History is normalized to alternating pairs and 12,000 total content characters. The schema contains textual source snapshots only; adapters must additionally reject attachments, image/audio bytes, API keys and absolute paths before enqueue.

### 3.7 Finance, commands, launcher and location

- Finance watchlist: `{schemaVersion:1,lists:[{id,name,assetIds}],assets:{[id]:{id,provider,providerAssetId,market,type,symbol,name,exchange,currency,addedAt}}}`. Only this identity/list data is eligible; selected view fields are `defaultView`, `defaultMarket`, `defaultSource`, `defaultRanking`, `refreshSeconds`. Provider settings, encrypted values, verification and fetched quote/cache data are forbidden (`renderer/finance-store.js`, `main/finance-settings-store.js`).
- Command: `{id,text,createdAt}` (`renderer/domain.js`, `renderer/workspace-commands.js`), default off.
- Launcher portable candidates: favorites `string[]` and aliases map only. Usage, settings, extension code/permissions/storage are local (`renderer/launcher.js`, `main/launcher-settings-store.js`, `launcher/`).
- Weather location is the selected search result object persisted at `notch-home-weather-v1`, default off. A dedicated allowlist still needs definition; arbitrary provider response fields cannot be accepted (`renderer/home-weather-controller.js`).

## 4. IPC and trust boundaries

### 4.1 Existing boundary

`preload.js` is the sole main-renderer bridge and exposes `window.notchAPI` through `contextBridge`; grouped namespaces are aliases over the stable flat API. `capturePreload.js` separately exposes `window.captureAPI` to the capture worker, and `renderer/recordingOverlayPreload.js` exposes only stop/discard/state to the recording overlay. Main handlers are split under `main/ipc/`, except capture handlers registered in `captureService.js`; its `mainOnly`, `captureOnly`, and `overlayOnly` guards bind each capture channel to the intended `webContents`. A sync client must follow the same boundary: renderer UI requests policy/status/actions; main process owns secrets, network, durable outbox/cursor files and filesystem objects.

Relevant existing channels to preserve/reuse:

| Boundary | Channels | Security significance |
|---|---|---|
| Workspace snapshot | `workspace:get`, `workspace:load-data`, `workspace:save-data`, `workspace:open`, `workspace:choose` | Current API accepts a whole string map; it must not become a remote upload endpoint. |
| App settings | `settings:get`, `settings:set-feature`, `settings:set-default-tab`, `settings:set-theme`, `settings:set-notch-height`, `settings:set-auto-launch`, `settings:set-shortcut` | Sync adapter projects only theme/features/default tab; local setters remain validators. |
| Note objects | `notes:save-image`, `notes:choose-images`, `notes:read-image`, `notes:delete-images` | Main process validates note IDs, paths, symlinks, image decoding and limits. |
| Clipboard objects | `clipboard:readImage`, `clipboard:deleteImages`, `clipboard:write`, `clipboard:paste` | Main process validates safe image paths; renderer never receives arbitrary file access. |
| Screenshots | Main renderer: `captures:list`, `captures:preview`, `captures:rename`, `captures:delete`; capture worker: `capture:init`, `capture:sources`, `capture:select`, `capture:image`, `capture:replace-image`, `capture:begin`, `capture:append`, `capture:finish` and related lifecycle channels; overlay: `capture-overlay:stop`, `capture-overlay:discard` | Sender guards in `captureService.js` must remain; sync may read only complete library items through a new main-owned adapter and must not reuse capture-worker byte channels. |
| Local recordings | `recordings:save`, `recordings:read`, `recordings:delete`, `recordings:reveal` | Explicitly excluded from sync. |
| Credentials/providers | `credentials:*`, `transcription:*`, `ai:*`, `finance:get-settings`, provider setters/tests | Never expose credential ciphertext to sync payload construction. |
| Link inspection | `links:inspect`, `smart:organize-material` | Existing public-network validation and bounded fetch rules remain authoritative. |
| Launcher/extensions | `launcher:*` | Extension install/code/data/permissions remain local; only renderer-owned favorite/alias records may be adapted. |

Planned sync IPC must use narrowly typed channels such as settings/status, estimate, connect/test, pause/resume, reconcile, conflict resolution and explicit object transfer. It must reject calls from non-main-window senders, validate all payloads in main, never return the client Key, and never accept filesystem paths or caller-supplied account/space/origin identity as authority.

### 4.2 Forbidden sync fields and sources

The following are denylisted even when encrypted locally or nested inside another object:

- Client Key, account password, Web session/cookie/CSRF values, password reset material and backup credentials.
- Credential vault rows and payloads; every `encryptedApiKey`, `encryptedKeyId`, `encryptedSecretKey`, `encryptedContact`, transcription/LLM secret, provider credential and safeStorage ciphertext.
- Absolute paths, workspace root/path, local filenames as object identity, music paths/files, application paths, window IDs/titles and extension storage paths.
- `shortcut`, all `shortcuts.*`, launcher shortcut/settings, `autoLaunch`, `notchHeight`, capture settings/regions/input/source selection and current tab.
- `notch-recordings`, audio bytes, transcript text, screen recordings, `.partial` files, live capture state and device media streams.
- Music library/current track/volume/discovery cache, finance quotes/history/fundamentals/provider diagnostics, AI diagnostics and weather response cache.
- Launcher extension code, manifests, permissions and per-extension storage; launcher usage history; hidden-window state.
- Draft/editor/session UI state (`notch-home-capture-v1`, active note ID, `notch-home-note` duplicate cache), logs, telemetry and ordinary error payloads.
- Saved-AI attachments, images, audio, API keys and any local absolute path embedded in prompt, answer, source snapshot or detail.
- Unknown LocalStorage keys, unknown entity fields, unknown future schema versions and arbitrary files under the workspace.

A recursive path/secret scanner is necessary but not sufficient: every entity serializer must build a fresh allowlisted payload rather than clone-and-delete fields.

## 5. Compatibility adapter contract

1. Read current keys/files through their existing normalizers; do not rename keys, rewrite all snapshots, or add sync metadata to business rows.
2. Assign sync metadata (`entityType`, `entityId`, schema version, base revision, operation ID, object digests, tombstone and remote source) in a separate binding-local store keyed by immutable remote instance/space/client identity.
3. Convert portable media references to digest/object descriptors before enqueue; convert verified objects back to valid `/`-separated relative paths only at local commit.
4. Apply a remote record and advance its cursor in one durable main-process transaction. Suppress local mutation capture while applying that batch.
5. Preserve unknown future local fields untouched locally, but quarantine unsupported remote entity/schema versions.
6. Do not use local timestamps for global ordering. Existing `createdAt`, `updatedAt`, `deadline`, `timestamp` and `remindedAt` retain current UI semantics only.
7. Keep each binding's Key, `clientId`, cursor, outbox, conflict records and attachment map separate. One workspace has at most one active binding.

## 6. Current boundaries and open gates

| Status | Finding | Outcome / evidence |
|---|---|---|
| Implemented | Typed sync must not reuse arbitrary `workspace.json` replication. | `renderer/sync/adapters.js` builds allowlisted records; `renderer/sync/scanner.js` rejects secrets and paths; `main/sync/local-store.js` owns sidecar state. |
| Implemented | LocalStorage and cursor persistence cannot form one storage-engine transaction. | `main/sync/projection-bridge.js` requires renderer ACK before the main-process cursor advances; durable inbox markers make projection replayable after every tested crash boundary. |
| Implemented | Todo and collection schemas cannot carry sync revisions without compatibility breakage. | IndexedDB entity mirrors and the main-process outbox retain revisions, ranks, conflicts, and operation IDs without changing existing LocalStorage rows. |
| Implemented | Media paths are device-local and cannot be protocol identity. | `main/sync/media-path.js` confines purpose-owned PNG paths; object IDs replace paths on the wire; `workspace-object-transfer.js` verifies bytes before atomic commit. |
| Implemented | Clipboard favorites must survive rolling history. | The clipboard store now exempts favorite entries from automatic history eviction; the one clipboard category controls entries, favorites, and images. |
| Implemented | A workspace switch must cancel stale asynchronous work. | Per-workspace v2 buckets, generation fencing, connection teardown, and workspace-root resolution isolate binding, cursor, outbox, conflict, and transfer state. |
| Implemented | Destructive first sync requires more than a confirmation dialog. | Scoped encrypted server recovery, local typed recovery inventory with SHA-256 readback, signed impact plans, exact phrases, revision recheck, outbox rebase/discard, projection ACK, and full reconciliation are required. |
| Implemented | Optional server category deletion after disabling sync requires an independent destructive workflow. | Disabling immediately stops transfer and cancels matching media checkpoints; optional deletion creates and verifies a recovery point, displays impact, requires a second confirmation plus `DELETE SERVER CATEGORY DATA`, and writes scoped tombstones. |
| Implemented | Delayed media must never appear as a broken local path. | MVP uses eager verified object projection: the parent record is not acknowledged or made current until download, PNG verification, and atomic commit succeed; transfer failure remains replayable. |
| Implemented | Polling defaults to 30 seconds and must be configurable without exceeding the required fallback. | `reconcileIntervalMs` is dependency-injected and validated to `1,000–30,000 ms`; realtime failure still converges through polling. |
| Deferred from MVP | Early permanent purge before normal tombstone/conflict retention is intentionally unavailable. | Space/account deletion enters a recoverable deleting state and ordinary GC honors retention. A separately confirmed irreversible early-purge operation remains unimplemented because its backup and object-reference semantics require an explicit product/security decision; no current UI or CLI claims this capability. |
| Environment gate | Live PostgreSQL, S3, Docker, load/soak, and macOS checks are unavailable here. | See `08-server-acceptance.md`; production latency, documented recovery objectives, quarterly restore-drill metrics, and live backup/RLS integration remain gated. |

## 7. Actual evidence and outcomes

### 7.1 Implementation ownership

| Capability | Actual code evidence | Actual verification evidence | Outcome |
|---|---|---|---|
| Desktop binding, credentials, status, retry, workspace isolation | `main/sync/binding.js`, `credential-envelope.js`, `local-store.js`, `retry.js`, `status.js`, `sync-service.js` | `tests/sync-security.test.js`, `sync-state.test.js`, `sync-service.test.js`, `sync-integration.test.js` | Deterministic PASS |
| Desktop adapters and projection | `renderer/sync/categories.js`, `adapters.js`, `scanner.js`, `projection.js`, `runtime.js`, `indexeddb-store.js` | `tests/sync-adapters.test.js`, `sync-state.test.js`, `sync.electron.js` | Deterministic PASS |
| Desktop IPC/UI | `main/ipc/sync.js`, `preload.js`, `renderer/sync/controller.js`, `view.js`, `renderer/settings.js` | `tests/sync-ipc.test.js`, `sync-ui.test.js`, `sync.electron.js` | Deterministic PASS |
| Object transfer and path ownership | `main/sync/object-transfer.js`, `media-path.js`, `workspace-object-transfer.js`; `sync-server/src/objects/**` | Desktop object/path tests and server object/fault suites | Deterministic PASS; live S3 gated |
| Identity/account/space/client/Key | `sync-server/src/auth/**`, `routes/account.js`, `spaces.js`, `clients.js`, migrations `0001`, `0004`, `0005` | Identity, security authorization, acceptance, and fault-injection suites | Deterministic PASS; live PostgreSQL gated |
| Typed records, conflicts, cursors, realtime | `sync-server/src/records/**`, `routes/sync.js`, `routes/realtime.js` | Record replication, authorization, fault, real two-client loopback, conflict tests | Deterministic PASS |
| First-sync recovery and replacement | `routes/sync.js`, `records/service.js`, `backup/service.js`, desktop `sync-service.js` | Signed-impact unit tests and real local-wins HTTP loopback test | Deterministic PASS |
| Backup/restore/export/import | `sync-server/src/backup/**`, `cli/**`, `jobs/**`, operational routes | Backup/CLI/fault-injection suites | Deterministic PASS; live PostgreSQL/S3 and quarterly drill gated |
| Web console | `sync-server/src/console/**`, account/space/client/operations routes | Console static security and Fastify injection suites | Deterministic PASS |
| Production composition and RLS | `sync-server/src/server.js`, `db/**`, migrations, Docker/Compose examples | Configuration and lifecycle tests | Static/deterministic PASS; live PostgreSQL and Docker gated |
| Existing Electron compatibility and Windows packaging | Existing renderer/main modules and stable preload facades; `scripts/smoke-app.js`, `scripts/verify-windows.ps1` | Root `npm test`: 495 pass, 1 gated skip, all Electron suites pass. Windows NSIS fresh install, launch, reinstall retention, uninstall, screenshots, and SHA-256 verification pass. | PASS on Windows environment |

### 7.2 ID outcome policy

- IDs in section 8 inherit the outcome of their capability row above unless explicitly listed in section 6 as partial or environment-gated.
- Negative-goal IDs pass when the forbidden route, payload, media type, credential flow, or MFA/registration surface is absent and covered by a negative test.
- Success metrics requiring elapsed production operation are not considered complete from unit tests alone. The online latency metric needs load evidence; the quarterly recovery metric needs a dated staged-restore drill artifact.
- macOS-specific acceptance and production deployment evidence remain release gates even though shared deterministic behavior passes.
- Exact current aggregates and skipped gates are recorded in `08-server-acceptance.md`.

## 8. Primary 313-ID traceability matrix

Each ID occurs in exactly one row below. The matrix column labels are retained for review continuity: “Existing” means baseline compatibility evidence, while “Planned code/test evidence” now means the implemented ownership and verification target interpreted through section 7. A row is not a PASS when section 6 or 7 marks its ID partial or environment-gated.

### 8.1 Product boundary and user outcomes

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Goals: local-first, latency, recoverability, user control, secret isolation, tenancy, backup | `G-001`, `G-002`, `G-003`, `G-004`, `G-005`, `G-006`, `G-007` | Local persistence and platform support in `renderer/app-shell.js`, `main/workspace-controller.js` | `sync/client/*`, `sync/server/*`, `sync/backup/*` | Client/server/e2e/backup suites plus latency and loss injection |
| Explicit non-goals and trust boundary | `NG-001`, `NG-002`, `NG-003`, `NG-004`, `NG-005`, `NG-006`, `NG-007`, `NG-008`, `NG-009` | Credential/media boundaries in app services and README contract | Protocol capability flags and denylist adapters | Negative payload, route and feature-presence tests |
| Account/space/client stories | `US-001`, `US-002`, `US-003`, `US-004`, `US-005`, `US-006`, `US-007`, `US-008`, `US-009`, `US-010`, `US-011`, `US-012` | No current sync UI/server | `sync/web/*`, `sync/client/*`, `sync/admin/*`, `sync/backup/*` | Role-based e2e journeys, offline/first-sync/conflict/recovery |

### 8.2 Identity, account, space and client lifecycle

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Instance identity and account/space ownership | `FR-001`, `FR-002`, `FR-003`, `FR-004`, `FR-005`, `FR-006` | None | Server instance metadata, password account store, space service | Protocol range, no-registration, password hash, cross-account authz |
| Client creation and Key authentication | `FR-007`, `FR-008`, `FR-009`, `FR-010`, `FR-011` | `safeStorage` patterns exist for provider secrets | Client credential hash/auth middleware and one-time result | Entropy/uniqueness, no plaintext, header-only, spoofed-origin tests |
| Client inventory, revocation and rotation | `FR-122`, `FR-123`, `FR-124`, `FR-125` | None | Client lifecycle service, connection revocation, auth throttling | Single-client revoke/rotate overlap and indistinguishable failures |
| Account/space disable and destructive lifecycle | `FR-126`, `FR-127`, `FR-128`, `FR-129` | None | Freeze/retention state machines and recent-auth confirmations | Scope isolation, restore point, concurrent backup/delete tests |
| Object-level authorization and structural limits | `FR-130`, `FR-131`, `FR-132`, `FR-136`, `FR-137` | Existing local IDs are not authorization | Auth-derived context, 10/10 limits, scoped stores/queries | ID substitution, enumeration, timing, limit/fault isolation tests |
| Binding isolation and password/session management | `FR-133`, `FR-135` | Workspace is singular; no remote binding | Binding state machine, account session revocation/password service | A/B binding isolation, password reset and session invalidation |

### 8.3 Desktop connection and installation binding

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| URL, identity and capability preflight | `FR-012`, `FR-013`, `FR-014`, `FR-015`, `FR-017`, `FR-018` | Public URL validation patterns in `main-services.js`; no sync URL API | Main-process URL validator/test-connection/binding confirmation | HTTPS/loopback policy, TLS failure, instance mismatch, remove-local-only |
| Secure Key storage and installation identity | `FR-016`, `FR-147`, `FR-148`, `FR-149`, `FR-150` | Electron safeStorage use for app secrets | OS-backed Key record, random installation ID, atomic first bind/reset | Unavailable secure store, cloned install, one-time reset Key, unchanged history |
| Password-only MVP account auth | `FR-151` | No sync account auth | Web password/session flow without MFA surface | Assert no MFA route/UI/challenge and correct revocation |

### 8.4 Category policy and schema compatibility

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Category estimates/defaults/dependencies | `FR-019`, `FR-020`, `FR-021`, `FR-022`, `FR-023`, `FR-024`, `FR-025` | Inventoried keys/media and feature settings | Category registry with per-device policy, estimate and clear workflow | Default-on/off matrix, clipboard atomic switch, parent dependency, disable behavior |
| Typed records and compatibility adapters | `FR-026`, `FR-027`, `FR-028`, `FR-029`, `FR-030`, `FR-031`, `FR-032`, `FR-033`, `FR-034`, `FR-035`, `FR-036`, `FR-037` | Current keys/normalizers; `workspace.json` snapshot | Typed envelopes, operation ledger, cursor transaction, schema quarantine | Idempotency, pagination race, crash boundaries, unknown version, legacy fixtures |

### 8.5 Realtime, offline and first synchronization

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Realtime hints, polling and reconciliation | `FR-038`, `FR-039`, `FR-040`, `FR-041` | No current remote channel | Authenticated space notifications plus <=30s poll/reconcile scheduler | Lost hint, revoked socket, wake/network recovery, wrong-space subscription |
| Durable local outbox, retry and status | `FR-042`, `FR-043`, `FR-044`, `FR-045`, `FR-046` | Local operations currently do not wait for network | Main-owned outbox/backoff/pause/status store | Restart durability, retry classes/jitter, pause preservation, secret-free status |
| First-sync decision and safe reset | `FR-047`, `FR-048`, `FR-049`, `FR-050`, `FR-051`, `FR-052`, `FR-053` | Existing local data inventories are measurable | First-sync planner, recovery point and index reset | Empty-side defaults, two-sided merge, cancel no-op, destructive confirmation |

### 8.6 Conflict, deletion and object lifecycle

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Merge and conflict policy | `FR-054`, `FR-055`, `FR-056`, `FR-057`, `FR-058`, `FR-059`, `FR-060`, `FR-061`, `FR-062`, `FR-063` | Stable content IDs mostly exist; ordering is array based | Entity merge strategies, sidecar rank, conflict store/UI | Field/base matrices, note body preservation, resolve-as-new-version, accessible UI |
| Tombstone and restoration lifecycle | `FR-064`, `FR-065`, `FR-066`, `FR-067`, `FR-068`, `FR-069` | Current local deletes are immediate | Tombstone retention, restore version, object ref/GC service | 30-day boundaries, stale resurrection, shared refs, explicit purge |
| Object descriptors and transfer | `FR-070`, `FR-071`, `FR-072`, `FR-073`, `FR-074`, `FR-075`, `FR-076`, `FR-077`, `FR-078`, `FR-080` | Safe media paths and image validation in `main/workspace-files.js`, `captureStorage.js` | Digest object store, resumable chunks, staging/atomic commit, scoped auth | Digest/length corruption, resume/cancel, cross-space probe, GC and storage failures |
| Excluded recordings and live media | `FR-079` | Recording/video/partial paths inventoried | Adapter deny rules | Assert no outbox entry under every category configuration |

### 8.7 Entity adapters and privacy controls

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Todo, note and link adapters | `FR-081`, `FR-082`, `FR-083` | `renderer/todo-data.js`, notes store/domain, links domain | `sync/adapters/todo`, `notes`, `links` | Legacy fixture round trips, bucket semantics, reference completeness, URL validation |
| Clipboard, screenshot, audio and AI adapters | `FR-084`, `FR-085`, `FR-086`, `FR-087`, `FR-088` | Clipboard/AI/capture schemas in sections 2-3 | Allowlisted adapters and object dependencies | Atomic clipboard switch, favorite retention decision, complete screenshots only, AI limits/exclusions |
| Finance and portable app preferences | `FR-089`, `FR-090`, `FR-091`, `FR-092`, `FR-093` | Finance store and app settings service | Finance projection, exact settings allowlist, path-to-object conversion | Credentials/cache absent, only three setting groups propagate, platform/local exclusions |
| Privacy disclosure, redaction and schema validation | `FR-094`, `FR-095`, `FR-096`, `FR-097`, `FR-098`, `FR-099`, `FR-100` | Existing path/symlink and public-network guards | Disclosure UI, redactor, limits, entity validators, audit service | Secret/body/path leak scans, traversal/content confusion, audit scope/payload absence |

### 8.8 Backup, export and operations

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Backup target, schedule and consistency | `FR-101`, `FR-102`, `FR-103`, `FR-104`, `FR-105`, `FR-106`, `FR-107`, `FR-108`, `FR-109`, `FR-110` | No server backup system | S3 target, scheduler, consistent snapshot/manifest, encryption, verified retention | Fault-domain warnings, 7/4/12 floor, consistency and failure retention tests |
| Backup verification and scoped recovery | `FR-111`, `FR-112`, `FR-113`, `FR-114`, `FR-115`, `FR-116`, `FR-134` | None | Verify/dry-run/staging restore, per-space epoch and drills | Corruption/missing object, no dry-run mutation, scoped restore and unaffected cursors |
| Export/import, diagnostics, health and upgrades | `FR-117`, `FR-118`, `FR-119`, `FR-120`, `FR-121` | Existing app diagnostics are provider-specific and excluded | Scoped export manifest/import validator, sync diagnostics, layered health, migration gate | Secret-free export, invalid import no-op, health degradation and version matrix |

### 8.9 Web console and admin CLI

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Console roles and password sessions | `FR-138`, `FR-139`, `FR-140`, `FR-141`, `FR-142` | No current server console | `sync/web/*` auth/session/CSRF/rate-limit | No registration, 12-char policy, hash upgrade, cookie/CSRF/session fixation tests |
| High-risk operations and normalized names | `FR-143`, `FR-144` | None | Recent-auth middleware, one-time Key view, normalized uniqueness | Refresh cannot recover Key; Unicode/trim/case collision cases |
| Admin CLI coverage and secret-safe output | `FR-145`, `FR-146` | Existing app has no server admin CLI | `sync/admin/*` stable commands/output codes | Scripted lifecycle/backup flows and stdout/stderr leak scans |

### 8.10 Data invariants

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Entity/time/schema/object reference invariants | `DR-001`, `DR-002`, `DR-003`, `DR-004`, `DR-005`, `DR-006`, `DR-007`, `DR-008` | Current stable IDs/time fields/path schemas | Protocol validators, adapter compatibility, retention classes | ID/path independence, UTC/deadline semantics, depth/size/reference/future-field fixtures |
| Retention and storage failure behavior | `DR-009`, `DR-010`, `DR-011`, `DR-012`, `DR-013`, `DR-014` | Local limits exist but no server retention | Retention scheduler and classified resource errors | Boundary clocks, full storage, no silent eviction, auditable cleanup |
| Ownership, object isolation and stable identity | `DR-015`, `DR-016`, `DR-017`, `DR-018`, `DR-019`, `DR-020`, `DR-021` | Local IDs are data only | Tenant foreign keys/policies, auth context, normalized name and installation services | Cross-tenant mutation/probe, rename invariants, observable usage without quota, no fingerprint |

### 8.11 Non-functional requirements

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Availability, latency, durability and idempotency | `NFR-001`, `NFR-002`, `NFR-003`, `NFR-004` | Local-first writes today | Durable queues/operation ledger and measurement hooks | Offline use, p95 latency, process restart and replay load tests |
| Transport, secrets, tenancy, bounds and backpressure | `NFR-005`, `NFR-006`, `NFR-007`, `NFR-008`, `NFR-009`, `NFR-010`, `NFR-011` | Electron validation patterns; no sync transport | TLS client/server, secure storage, limits, streaming scheduler, error catalog | TLS downgrade/hostname, leak scan, isolation matrix, renderer responsiveness, compatibility |
| Accessibility, backup objectives and sensitive defaults | `NFR-012`, `NFR-013`, `NFR-014`, `NFR-015`, `NFR-016` | Existing controls generally labeled; no sync UI | Accessible status/conflict UI, documented backup SLOs, category registry default | Keyboard/text-state audit, RPO/RTO drill, restore validation, new-sensitive-category gate |
| Multi-tenant failure/auth/source integrity | `NFR-017`, `NFR-018`, `NFR-019`, `NFR-020` | No server | Fault-isolated workers/stores, object authz, Web headers/encoding, auth-derived origin | Noisy tenant/recovery isolation, endpoint ID matrix, Web security scan, spoof/rename/rotate history |

### 8.12 Edge cases

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Offline expiry, edit/delete and Key misuse | `EC-001`, `EC-002`, `EC-003`, `EC-004`, `EC-005` | No sync behavior | Reconcile/conflict/binding/rotation/instance guard | Expired cursor with outbox, edit-delete race, cloned install, in-flight rotation, changed instance |
| Object/transaction/category/storage/path migration | `EC-006`, `EC-007`, `EC-008`, `EC-009`, `EC-010`, `EC-011`, `EC-012` | Portable path migration exists only for recordings/clipboard | Object commit state, cursor journal, category cancellation, legacy identity importer | Metadata/object split failures, every crash point, storage full, absolute/missing paths, duplicate legacy, clock skew |
| Backup/recovery and local retention edge cases | `EC-013`, `EC-014`, `EC-015`, `EC-016`, `EC-017`, `EC-018` | Capture preserves incomplete rows; clipboard rolls at 100 | Backup validator, recovery epoch reconciliation, favorite policy, exclusion/auth handling | Full/corrupt target, old schema, restored-vs-outbox conflict, favorite boundary, partial exclusion, offline revoke |
| Name/binding/account/delete/object isolation | `EC-019`, `EC-020`, `EC-021`, `EC-022`, `EC-023`, `EC-024`, `EC-025` | No tenancy | Normalized names, binding transition, frozen accounts, consistent backup/delete, scoped object/restore/key rotation | Cross-space outbox, disable/re-enable, backup race, digest oracle, single-space restore, leaked-key attribution |

### 8.13 Success metrics

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Data safety, latency, idempotency and backup verification | `SM-001`, `SM-002`, `SM-003`, `SM-004`, `SM-005` | No sync metrics | CI chaos/latency/backup drill reports | Required metric thresholds and quarterly staged restore artifact |
| Leak/source audit, understandable status and isolation | `SM-006`, `SM-007`, `SM-008` | Existing settings/status UI and contextBridge | Automated payload/log/export scanner, status UI, authz matrix | Zero forbidden findings, user-visible categorization, all cross-boundary requests denied |

### 8.14 Acceptance scenarios

| Capability | Primary IDs | Existing evidence | Planned code evidence | Planned test evidence |
|---|---|---|---|---|
| Core local-first replication and conflict/delete recovery | `AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`, `AC-008`, `AC-009`, `AC-010`, `AC-011` | Current local entity/media fixtures | Client/server/object/conflict implementation | Multi-device fixtures, 100-edit latency, 100 replays, crash injection, corrupt/resume object |
| Category, transport, Key and payload exclusions | `AC-012`, `AC-013`, `AC-014`, `AC-015`, `AC-016`, `AC-017`, `AC-018`, `AC-019`, `AC-020`, `AC-021`, `AC-022`, `AC-023`, `AC-024` | Current keys and media exclusions inventoried | Category registry, TLS/auth, secure storage, compatibility/storage handlers | Switch matrix, packet/log/storage scan, revoke/rotate, instance/cursor/schema/storage/partial cases |
| Backup and existing-app compatibility | `AC-025`, `AC-026`, `AC-027`, `AC-028`, `AC-029`, `AC-030`, `AC-031` | Existing `npm test` baseline | Backup/restore and compatibility adapters | Manifest/failure/retention/dry-run/staged restore; full existing test suite |
| Multi-account/space/client authorization | `AC-032`, `AC-033`, `AC-034`, `AC-035`, `AC-036`, `AC-037`, `AC-038`, `AC-039`, `AC-040`, `AC-041` | No server tenancy | Auth-derived scoped services and binding isolation | Two-account/two-space, ID tamper, Key privilege, A/B binding, disable/restore, digest oracle, 11th limits |
| Web console and admin CLI security | `AC-042`, `AC-043`, `AC-044`, `AC-045`, `AC-046`, `AC-047`, `AC-048` | No Web/admin surfaces | Web sessions/CSRF/recent auth/one-time Key and CLI | Protected/no-registration, indistinguishable login, name normalization, storage leak, revoke, CSRF, exit codes |
| Authenticated source identity and per-client independence | `AC-049`, `AC-050`, `AC-051`, `AC-052`, `AC-053`, `AC-054`, `AC-055`, `AC-056` | No remote source model | Key-to-client mapping, installation reset, 10/10 enforcement | Different origins, forged origin, independent Keys, install mismatch/reset, rename history, exact structural limits |
| Object quota boundary, retention/defaults and no-MFA | `AC-057`, `AC-058`, `AC-059`, `AC-060` | Local input limits and app settings fields known | Protocol technical limits, retention policies, settings projection, password-only UI | Rechunk vs business quota, day-30 and 7/4/12, only three portable preferences, no MFA flows |

## 9. Verification gate

Before this document is accepted or regenerated:

```sh
# Requirement source and this primary mapping must each have the same 313-ID set.
rg -o "(G|NG|US|FR|DR|NFR|EC|SM|AC)-[0-9]{3}" docs/project-factory/sync/02-requirements.md | sort -u > requirements.ids
rg -o "(G|NG|US|FR|DR|NFR|EC|SM|AC)-[0-9]{3}" docs/project-factory/sync/07-requirement-traceability.md | sort > traceability.ids
diff -u requirements.ids traceability.ids

# No ID may occur twice in the traceability document.
uniq -d traceability.ids

git diff --check -- docs/project-factory/sync/07-requirement-traceability.md
```

Temporary ID files are validation artifacts only and must not be committed.
