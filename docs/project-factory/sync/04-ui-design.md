# Sync MVP v1 UI Design

> Status: implementation-ready interaction specification. API names refer to [03-interface-map.md](./03-interface-map.md); behavior and defaults refer to [02-requirements.md](./02-requirements.md).

## 1. Design principles

- **Local first:** every desktop save completes locally. Sync state is secondary feedback and never disables ordinary editing.
- **Identity before action:** instance, space, and client short IDs are visible before first upload and during errors.
- **Sensitive by consent:** clipboard, screenshots, AI sessions, location, and commands are off until explicitly enabled. Clipboard has exactly one switch.
- **State in text:** color supports but never replaces `最新`, `待处理`, `暂停`, `离线`, `冲突`, or `错误` labels.
- **High-risk actions are staged:** Key rotation/reset, remote category deletion, replacement sync, space deletion, export, and session revocation show impact and require recent authentication where specified.
- **No false security claims:** settings state that the server can read MVP business data; TLS and server-side storage encryption are not end-to-end encryption.

The desktop follows the existing dense settings page, design tokens, controls, and native HTML/CSS/JavaScript. The account console is a quiet work surface, not a marketing page: left navigation, compact tables, restrained status badges, and one primary action per view.

## 2. Desktop settings information architecture

Add a full-width `数据同步` settings section near `数据文件夹`, not inside credentials or AI settings. It has three renderer views in one section:

```text
Sync settings
├── Disconnected
│   ├── Server URL
│   ├── Client Key
│   └── Test connection
├── Setup
│   ├── Verified identity
│   ├── Category selection + local/remote estimate
│   ├── First-sync plan
│   └── Confirm and start
└── Connected
    ├── Identity and health
    ├── Queue / last sync / error
    ├── Category controls
    ├── Conflicts
    └── Pause / sync now / remove this device
```

The existing `workspace.json` / data-folder controls remain labeled as local snapshot and portable workspace. Sync copy must not rename them to cloud storage or imply replacement.

### 2.1 Connected summary

Compact header:

```text
数据同步                     [最新]
Work · MacBook Pro (8N4K2P)  sync.example.com
上次同步 10:31 · 待处理 0 条 / 0 个对象 · 冲突 0
[立即同步] [暂停] [更多]
```

- The server hostname is displayed without userinfo, query, or fragment.
- Space name is paired with a stable ID prefix in details, preventing confusion after rename.
- Status line never includes Key, local paths, payload text, full object digest, or account username.
- `更多` opens actions for diagnostics, remove local connection, and a link to the server Web console. Removing the local connection explicitly says local content remains and server access continues until the Key is revoked in the console.

### 2.2 Status model

| State | Visible behavior | Available actions |
| --- | --- | --- |
| `upToDate` | `最新`, last successful time | Sync now, pause |
| `pending` | Counts for records and objects; progress only for known totals | Sync now, pause |
| `syncing` | Current phase `上传记录/下载更改/校验对象`; cancel only current object transfer | Pause |
| `paused` | `已暂停`; queue retained | Resume |
| `offline` | `离线`; last success and next automatic retry | Retry, pause |
| `conflict` | Persistent conflict count, not a transient toast | Review conflicts |
| `authError` | Generic credential/binding failure; no existence disclosure | Test again, remove connection |
| `instanceChanged` | Blocking banner with old/new instance prefixes; push disabled | Review and rebind |
| `cursorExpired` | `需要完整对账`; outbox count explicitly retained | Start reconciliation |
| `storageError` | `服务器存储暂不可用`; local data retained | Retry later |
| `schemaError` | Names unsupported entity/schema and asks for upgrade | Open diagnostics |

Renderer receives this finite projection from `notchAPI.sync`; it does not infer state from HTTP strings.

## 3. Desktop setup flow

### Step 1: enter connection

Fields: server base URL and Client Key. Key is a password input with a temporary reveal icon and paste support, `autocomplete="off"`; it is never echoed after save. `测试连接` remains disabled until local URL syntax validation passes.

Inline validation rejects unsupported protocol, URL credentials, query, fragment, and production HTTP. A separate developer-mode toggle, hidden behind advanced settings, permits only loopback HTTP and includes a persistent warning.

### Step 2: verify identity

After `sync.testConnection`, show:

- Server hostname and instance ID prefix.
- Space name and ID prefix.
- Client display name and immutable short ID.
- Account/space/client state, protocol compatibility, server time skew, online/object storage health.
- A warning that this server can read synced data.

The Key stays only in main-process transient memory represented by an expiring test token. A mismatch with an existing binding blocks continuation and offers `返回` or the separate remove/rebind path.

### Step 3: choose categories

Each row has a checkbox/toggle, category name, sensitivity label, local count/bytes, remote count/bytes, and dependencies.

| Category | Initial state | UI rule |
| --- | --- | --- |
| Todo, notes with taxonomy/images, links, portable preferences | On | Core rows grouped first |
| Clipboard | Off | One switch controls text, URLs, favorites, and images; no nested per-type controls |
| Screenshots | Off | Only complete screenshots and PNG objects |
| Saved AI sessions, location, commands | Off | Separate sensitive rows |
| Finance, launcher favorites/aliases | Off unless product enables optional defaults later | Portable subset named explicitly |
| Audio recordings, transcripts, screen recordings | Disabled with `MVP 不支持` | Cannot enter outbox |

A disabled attachment child row explains that it follows its parent. Estimated bytes may say `正在计算` or `未知`; unknown is never displayed as zero.

### Step 4: select first-sync plan

The recommended action is selected automatically:

- Remote empty: upload enabled local categories.
- Local empty: download remote categories.
- Both nonempty: safe merge with conflict preservation.

A comparison table shows affected records and object bytes by category. Cancel returns to disconnected state without modifying local data or saving a completed binding.

`高级替换` is collapsed. Choosing local-wins or server-wins opens a separate impact dialog, creates a verified recovery point, and requires typing the space name plus a final confirmation. The action stays disabled until recovery point creation succeeds.

### Step 5: progress and completion

Progress is phase-based (`建立本地索引`, `上传对象`, `提交记录`, `下载更改`, `校验`) with independent record/object counters. Metadata remains responsive while images transfer. Closing settings continues background sync; pausing is explicit. Completion shows identity, category set, unresolved conflict count, and last successful timestamp.

## 4. Desktop category changes and conflict flows

### Disable a category

Turning a category off first shows: `停止这台设备后续上传和下载` and `不会删除本地或服务端已有数据`. The default button is `仅停止同步`. A separate destructive option `同时删除服务端此分类` displays server count/bytes and creates tombstones only after explicit confirmation.

If a transfer is active, new scheduling stops immediately; the current request is cancelled at a safe checkpoint. Resume metadata remains persisted but is unusable until the category is re-enabled.

### Conflict center

Open from the persistent count. Use a compact two-pane workspace:

```text
Conflict list                       Difference panel
[Note] Project plan                Current / incoming / manual
MacBook Pro · 10:21                changed fields and source clients
[Todo] Submit review               [Keep current] [Use incoming] [Merge]
```

- List rows show type/title, source client names/short IDs, server times, and changed fields.
- Note title/body displays both complete versions with an explicit `保存为冲突副本` result when chosen.
- Todo/link conflicts show per-field choices. Manual merge is schema validated before enablement.
- Closing or muting notification leaves the conflict unresolved and discoverable.
- Resolution submits a normal version; stale resolution refreshes both sides instead of overwriting.

### Tombstone restore

Deleted records appear in a `可恢复` filter until retention expiry, with deletion source/time and days remaining. Restore states that it creates a new version and synchronizes to enabled clients.

## 5. Account Web console information architecture

Routes are server-hosted under `/console`; static assets are same-origin and use the cookie API in [03-interface-map.md](./03-interface-map.md).

```text
/console/login
/console/spaces
/console/spaces/:spaceId/overview
/console/spaces/:spaceId/clients
/console/spaces/:spaceId/conflicts
/console/spaces/:spaceId/export
/console/usage
/console/audit
/console/security
```

Global shell:

- Header: product/service name, account name, session menu, logout.
- Sidebar: Spaces, Usage, Audit, Security.
- Space sub-navigation: Overview, Clients, Conflicts, Export.
- No global administrator or backup navigation is rendered or addressable for account users.
- Mobile uses a drawer; tables become labeled rows. Primary target is desktop administration at 1024px+, but all controls remain usable at 360px.

### 5.1 Login and security

Login has username, password, submit, generic error, and no registration/MFA links. Password managers are supported. Repeated failure shows a retry delay without revealing whether the username exists.

Security page contains password change, recent logins, active sessions, and `撤销其他会话`. Password change requires current password and reports the 12-character minimum without displaying server hash details. No MFA placeholder is shown in MVP.

Recent authentication dialog is reusable for Key rotation/reset, client revoke, space deletion, and export. It asks for the password and returns to the pending action; it never stores password text.

### 5.2 Spaces list and detail

Spaces list header: `空间 4 / 10` and `新建空间`. Each row shows name, stable ID prefix, status, active clients (`3 / 10`), record count, object bytes, conflicts, and last activity. Search filters only the authenticated account's loaded/queried spaces.

Create/rename uses a short dialog. Name conflict is explicit because it reveals only this account's data. Inactive spaces remain listed with `启用` and no sync activity.

Overview presents usage observations, enabled data categories seen in the space, sync cursor age, restore epoch prefix, conflicts, and client activity. It does not expose record bodies.

Delete flow:

1. Impact screen lists record count, object bytes, client names, and recoverability window.
2. Recent password authentication.
3. Type the normalized display name and press `删除空间`.
4. Space becomes `待清除` with `恢复` until retention permits purge.

### 5.3 Clients and one-time Key flow

Clients table shows name, immutable short ID, platform/app version, Key state, binding status, created/first connected/last seen, and status. Header shows `客户端 3 / 10`.

Create client asks only for a display name. Success replaces the dialog body with the one-time Key, a copy icon button, `我已保存` checkbox, and the client identity/space. Navigating away clears the DOM value; reopening the client never shows it.

Row actions:

- Rename: no identity change.
- Rotate Key: choose immediate or overlap duration (maximum 24 hours), reauthenticate, then one-time Key screen.
- Revoke: explain local data remains and other clients continue; reauthenticate.
- Reset installation binding: explain old Key and live connection are revoked, `clientId` remains, then show one-time new Key.

The UI never offers sharing one Key across clients or moving a client to another space.

### 5.4 Usage, audit, and export

Usage shows account aggregate and per-space records/object bytes/incomplete uploads with `无业务容量配额` explanatory text. It must not render quota progress bars for bytes or image counts; only the 10-space/10-client structural limits use limit meters.

Audit is a paginated table filterable by space, action, result, and time. It displays actor/target ID prefixes and redacted network context, never note text, clipboard text, URL query strings, Key material, password, or local path.

Export starts from a selected space, shows included record/object counts and excluded secrets, requires recent authentication, and displays queued/running/verified/failed. A download action appears only after verification and expires visibly.

## 6. Accessibility and responsive behavior

- All status badges include visible text; icons are supplementary.
- Toggles use native checkboxes; modal focus is trapped and restored; destructive dialogs focus cancel first.
- Tables have headers and responsive labeled-row equivalents. Pagination and conflict choices are keyboard accessible.
- Live regions announce connection test, queue progress at throttled intervals, conflict creation, and one-time Key copy result.
- Errors link to the offending field and use stable, localized messages. Raw stack traces and server text are never inserted.
- Minimum contrast follows WCAG AA; focus rings reuse existing tokens. Reduced motion removes progress interpolation and modal movement.
- Long names, hostnames, and IDs wrap or truncate with an accessible full-text label; no text overlaps controls.

## 7. UI state ownership

| State | Owner | Persistence |
| --- | --- | --- |
| Form drafts, open dialog, selected conflict | Renderer/browser memory | Never persisted unless ordinary non-secret preference |
| Desktop Key | Electron main secure storage | Never renderer/LocalStorage/`workspace.json` |
| Binding identity/category selection | Electron main sync store | Namespaced by workspace and remote identity |
| Queue/cursor/transfer/conflicts | Electron main durable sync store | Transactional; survives restart |
| Account session | Server + secure cookie | Browser cannot read token |
| One-time Key | Console response/view memory | Cleared on navigation; not browser storage |
| Server resources/jobs | PostgreSQL | Account/space scoped |

Desktop receives sanitized projections through `notchAPI.sync`. The Web console loads state from APIs and does not use LocalStorage for credentials, CSRF tokens, Key material, resource truth, or queued mutations.

## 8. Copy and error rules

Required copy:

- Privacy: `同步内容会通过加密连接传输并由服务器静态保护；当前版本不是端到端加密，服务器管理员能够读取业务数据。`
- Remove local binding: `只移除此设备的连接与同步状态，不删除本地内容。若要停止服务器访问，请在 Web 控制台吊销此客户端。`
- Disable category: `停止后续同步，不会自动删除两端已有内容。`
- Storage failure: `本地内容和传输进度已保留。服务器存储恢复后将按退避策略重试。`

Messages never say “backup complete” until manifest, object, checksum, and decryptability verification succeeds. Account users see export state, not global backup controls.

## 9. UI acceptance trace

| Flow | Requirements / acceptance |
| --- | --- |
| Connection and identity | `FR-012`-`FR-018`, `FR-046`, `FR-094`, `FR-119`; `AC-014`, `AC-020`, `AC-036`, `AC-059` |
| Category selection | `FR-019`-`FR-025`, `FR-079`-`FR-093`; `AC-012`-`AC-013`, `AC-019`, `AC-024`, `AC-057`, `AC-059` |
| First sync | `FR-047`-`FR-053`; `AC-001`, `AC-021`, `AC-023` |
| Conflict/recovery | `FR-054`-`FR-069`, `FR-080`; `AC-005`-`AC-007`, `AC-011`, `AC-058` |
| Console login/security | `FR-135`, `FR-138`-`FR-143`, `FR-151`; `AC-042`-`AC-047`, `AC-060` |
| Space/client console | `FR-005`, `FR-122`-`FR-131`, `FR-144`; `AC-041`, `AC-044`-`AC-045`, `AC-051`-`AC-056` |
| Usage/audit/export | `FR-095`, `FR-099`-`FR-100`, `FR-117`; `AC-049`-`AC-050`, `AC-057` |
| Accessibility | `NFR-012`, `SM-007` |
