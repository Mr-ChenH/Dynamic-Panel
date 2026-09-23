# Sync Research Notes

## 1. Research Scope

本调研回答以下问题：

- Dynamic Panel 当前有哪些持久化数据，哪些适合跨设备同步？
- 为什么不能直接把 `workspace.json` 当作实时同步协议？
- 客户端 Key、安装绑定、实时通道、冲突、删除、附件和离线行为应具备哪些产品语义？
- 定时备份如何与同步区分，并达到可验证、可恢复的最低标准？

调研依据包括仓库现状和外部官方资料。本文只形成产品与需求建议，不落地服务端架构。

## Confirmed Product Decisions

- 服务端支持多个账号；每个账号可以创建多个隔离空间，同一空间内允许多台客户端同步。
- 账号仅由服务端管理员创建，使用服务端本地用户名/密码认证；MVP 不开放自助注册或 OIDC。
- 账号用户通过精简 Web 控制台管理空间、客户端、客户端 Key、用量和审计；服务端管理员使用管理 CLI。
- 同一账号内空间名称唯一，空间的稳定 ID 不因重命名改变；每个账号最多 10 个活动空间，每空间最多 10 个活动客户端。
- 服务端不设置对象总字节、图片数量或单图大小的业务配额，但传输分块、请求和并发仍有技术安全边界。
- 剪贴板文字、收藏和图片使用同一个同步开关，不拆分类别。
- 删除/冲突保留期确认为 30 天；备份保留确认为 7 个每日、4 个每周、12 个每月恢复点。
- 默认同步设置只包括主题、功能显隐和默认页；本地账号首版不支持 MFA。
- 账号认证负责空间管理；账号用户在空间内预先添加客户端，服务端为每个客户端生成唯一 Key。
- 客户端 Key 同时限定账号、空间和来源客户端；同一空间的客户端不得共享 Key，Key 首次连接时绑定客户端安装 ID，变更来源由服务端认证上下文决定。
- MVP 采用服务端可读模型，通过 TLS、服务端静态加密和访问控制保护数据；端到端加密延后。
- MVP 媒体只同步笔记图片、剪贴板图片和截图；音频录音与屏幕录制延后。
- 生产定时备份以 S3 兼容对象存储为主要目标；本地目录只用于开发或独立备份挂载盘。
- 首次同步默认安全合并，同时提供建立恢复点并二次确认后的高级“以本机/服务端为准”。

## 2. Existing Data Boundary

### 2.1 LocalStorage and workspace snapshot

[`renderer/app-shell.js`](../../../renderer/app-shell.js) 每 2 秒枚举全部 LocalStorage，并通过现有 IPC 保存到 `workspace.json`。启动时只把本机缺失的键从工作区快照补入 LocalStorage，不会覆盖已有键，也没有记录级版本、删除墓碑或冲突信息。

[`main/workspace-controller.js`](../../../main/workspace-controller.js) 将快照限制在 8 MiB，并只对录音和剪贴板图片路径做便携化。切换工作区时复制 `workspace.json`、`recordings/`、`clipboard-images/` 和 `note-images/`。

结论：它适合本机持久化和便携目录迁移，不适合作为多设备同步协议。全量覆盖会丢失并发修改；“仅补缺失键”无法传播更新与删除；任意 LocalStorage 键还会把设备状态和临时草稿混入同步范围。

### 2.2 User content presently stored in LocalStorage

| Data | Current key | Notes |
|---|---|---|
| Todo items | `notch-todo-data` | 四象限结构，必须保持兼容 |
| Todo category names | `notch-todo-category-names-v1` | 用户内容配置 |
| Notes | `notch-note-archive-v1` | 最多 200 条，正文可引用图片 |
| Note categories/tags | `notch-note-categories-v1` | 与笔记存在引用关系 |
| Legacy/current note selection | `notch-home-note`, `notch-note-active-archive-v1` | 前者可能含正文，后者是设备 UI 状态 |
| Link groups and URLs | `notch-link-groups` | 分组、标题、标签、收藏、已读和备注 |
| Recording metadata | `notch-recordings` | 音频文件在独立目录 |
| Clipboard history/favorites | `notch-clip-history`, `notch-clip-favorites` | 图片仅保存文件引用；历史当前上限 100 |
| AI saved sessions | `notch-ai-chat-sessions-v1` | 包含资料文字快照，敏感且有既有限额 |
| Finance watchlists/preferences | `notch-finance-watchlists-v1`, `notch-finance-view-preferences-v1` | 不含行情缓存 |
| Home commands | `notch-home-commands` | 用户自定义命令可能含敏感参数 |
| Home layout | `notch-home-order-v3`, `notch-home-widget-sizes-v2`, `notch-home-hidden-modules-v1` | 可跨设备但屏幕差异可能导致布局不适配 |
| Weather/location | `notch-home-weather-v1` | 位置隐私数据 |
| Music UI state | `notch-home-music-*` | 当前曲目、音量等多为设备状态 |
| Launcher favorites/aliases/usage | `notch-launcher-*-v1` | 收藏/别名可同步，usage 更适合设备本地或聚合 |
| Active tab/drafts/window state | `notch-active-tab`, `notch-home-capture-v1`, `notch-hidden-windows` | 临时或设备专属状态 |
| Pomodoro duration | `dynamic-panel-pomodoro-duration-v3` | 可同步的轻量偏好 |

### 2.3 Files and indexed media

- [`main/workspace-files.js`](../../../main/workspace-files.js) 管理录音、笔记图片和剪贴板图片。新路径使用相对路径，但旧数据可能仍含绝对路径。
- [`captureStorage.js`](../../../captureStorage.js) 单独管理 `captures/index.json`、`captures/screenshots/*.png` 和 `captures/videos/*.{webm,partial}`。截图最大 32 MiB，录屏最大 4 GiB，索引最多 5000 条。
- 录音单文件当前最大 200 MiB；笔记图片原始输入最大 20 MiB，并转换为 PNG、最长边压至 2400 px。
- `music-library.json` 包含本地绝对路径、网络来源和在线缓存。本地音乐文件不在工作区便携资产目录中。

结论：附件必须按对象同步，并在元数据中使用稳定逻辑引用。不能上传本机绝对路径，也不能只同步索引而忽略文件完整性。

### 2.4 Settings and secrets

`userData` 下还存在：

- `app-settings.json`：功能显隐、主题、默认页、面板/截图/录制快捷键、刘海高度。
- `launcher-settings.json`：启动器快捷键、来源开关和超时。
- `finance-settings.json`：刷新间隔、供应商开关、验证状态及 `safeStorage` 加密凭据。
- `transcription-settings.json`：转写配置，可能包含凭据。
- `credentials.vault.json`：由 Electron `safeStorage` 加密的密钥库。
- `workspace-settings.json`：本机工作区绝对路径。
- `capture-settings.json`：采集设备/录制偏好，可能引用本机设备。
- `music-library.json`：本地路径、回环服务 URL、在线缓存。
- `ai-diagnostics.json`：诊断信息，不是用户业务数据。

[`main/credentials-vault.js`](../../../main/credentials-vault.js) 表明凭据保险库密文依赖本机 `safeStorage`。将密文复制到另一台设备不保证可解密。因此“同步配置”必须拆成可携带偏好、平台偏好、设备专属设置和禁止同步的秘密四类。

## 3. Data Classification Recommendation

| Class | MVP recommendation | Data examples | Rationale |
|---|---|---|---|
| Core content | Default on | Todo, todo category names, notes, note taxonomy, links | 用户明确创建，体积可控，跨设备价值最高 |
| Core attachments | Follow parent content | Note images, link-owned future attachments | 父实体可见前必须保证附件可获取 |
| Sensitive history | Explicit opt-in, default off | Clipboard text/favorites/images as one category, screenshots as another | 可能包含密码、令牌、个人或工作机密 |
| Large media | Future scope, not MVP | Audio recordings, completed screen recordings | 带宽、容量和隐私成本高，待图片同步稳定后再设计 |
| Optional content | Per-category opt-in | Saved AI sessions, custom commands, finance watchlists, launcher favorites/aliases | 有价值但敏感性或语义更复杂 |
| Portable preferences | Default on | Theme, enabled features, default tab | 仅同步已确认的三项允许列表设置 |
| Platform-aware preferences | Default off or per-platform | Home layout, notch height | Windows/macOS 与屏幕尺寸不同，需按平台命名空间 |
| Device-only | Never sync | Global shortcuts, auto-launch, workspace path, active tab, active note, hidden windows, current music track/volume, capture device | 受本机资源和 OS 约束 |
| Secrets | Never sync in MVP | Sync Key, credential vault, AI/transcription/finance API keys | 本机加密不可移植；泄露影响大 |
| Derived/cache/diagnostics | Never sync | Market data cache, music discovery cache, AI diagnostics, temporary capture files | 可重建或只对本机排障有意义 |
| Executable/extensions | Never auto-sync | Launcher extension code, permissions and extension storage | 执行代码和授权必须保持显式信任边界 |

## 4. External Findings

### 4.1 Replication and conflicts

Apache CouchDB 官方文档把双向复制描述为从源到目标的复制组合，并通过 changes feed 判断差异；并发版本可能形成冲突，复制层不能把“所有请求成功”误认为“业务冲突已解决”。这支持以下要求：

- 同步必须有增量 changes/cursor，而不是周期性全量覆盖。
- 每个可编辑实体必须有稳定 ID 和版本前提。
- 冲突版本需要保留并可被确定性处理，不能静默丢弃。

Sources:

- https://docs.couchdb.org/en/stable/replication/intro.html
- https://docs.couchdb.org/en/stable/replication/conflicts.html

### 4.2 Client-side durable queues

MDN 将 IndexedDB 定位为可保存大量结构化数据和 Blob 的客户端存储，并指出 Web Storage 更适合较小数据。这不强制本项目采用 IndexedDB，但说明继续把同步 outbox、游标和附件状态塞入 LocalStorage 不合适。同步状态需要一个可事务提交、可恢复的本地持久层。

Source: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

### 4.3 Access credential transport

OWASP REST Security Cheat Sheet 明确指出密码、安全令牌和 API Key 不应出现在 URL 中，因为 URL 可能进入服务器日志；同时建议使用 HTTPS、限制方法和内容类型、校验请求大小并对错误响应避免泄露细节。

Implications:

- Key 只能通过授权请求头传输，不能放入 query string、WebSocket URL 或日志。
- 生产连接必须使用 TLS，并设置请求大小、速率、并发和失败重试限制。
- 服务端只保存 Key 的不可逆摘要，Key 明文只在创建/轮换时展示。

Source: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

### 4.4 Backups and point-in-time recovery

PostgreSQL 官方文档说明基础备份配合持续归档日志可恢复到基础备份之后的指定时间点。这说明“每日复制一次当前数据库”只能提供较大的恢复点目标，无法覆盖当天误删或损坏。

Source: https://www.postgresql.org/docs/current/continuous-archiving.html

### 4.5 Object history and deletion recovery

Amazon S3 官方文档说明对象版本控制可保留同一对象的多个版本，删除通常写入 delete marker，而不是立即销毁旧版本。这支持附件对象使用版本/保留策略来防止客户端误删或覆盖立即传播为不可恢复的数据损失。

Sources:

- https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html

### 4.6 Multi-account and space isolation

OWASP API Security 将对象级授权缺失列为首要 API 风险：任何接收对象 ID 并执行操作的端点，都必须验证当前身份是否有权访问该对象。OWASP Multi-Tenant Security 进一步要求租户上下文贯穿认证、缓存、存储、日志和后台任务，而不能把随机 ID 当作权限控制。

Implications:

- 账号身份只能管理其拥有的空间，客户端 Key 只能代表一个空间中的一个预建客户端。
- 账号 ID、空间 ID 和来源客户端 ID 必须由认证上下文确定或校验，不能信任客户端传入值。
- 记录、对象、游标、缓存、实时主题、用量、结构限制、审计、导出和恢复都必须以空间为隔离边界。
- 同一账号下的空间也不能因对象去重、错误消息或用量接口泄露彼此数据。

Sources:

- https://owasp.github.io/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

## 5. Product Directions Considered

### Direction A: Replicate the latest workspace snapshot

Server stores one latest `workspace.json` plus asset directory. Clients periodically upload/download full snapshots.

Benefits: smallest initial implementation.

Problems: no reliable concurrent editing, deletion propagation, idempotency, per-category privacy control, resumable media transfer or efficient large-data sync. A stale device can overwrite newer data. This direction is not recommended.

### Direction B: Typed change log plus attachment objects

Each user-visible item is a typed record with stable ID and revision. The service scopes every record, cursor, object and realtime notification to an account-owned space. Clients push an idempotent outbox and pull changes after that space's server cursor. A realtime channel only signals that new changes exist; normal authenticated HTTP performs reconciliation. Media is uploaded separately by content hash and referenced from records.

Benefits: supports offline use, incremental transfer, tombstones, conflict handling, auditability and reliable backup boundaries. It can adapt existing LocalStorage schemas without breaking them.

Cost: requires an explicit sync model and migration/adapter layer.

Recommendation: use this as the MVP product model.

### Direction C: Revision tree with end-to-end encrypted payloads

Clients encrypt and decrypt all business payloads and preserve a full revision tree. The server stores opaque records and objects.

Benefits: strongest privacy against the server operator.

Cost: key recovery, metadata leakage, search, deduplication, migrations, conflict UX and backup restoration become substantially more complex. A lost encryption key makes valid backups unusable.

Recommendation: treat as a future security mode. The confirmed MVP uses a server-readable model.

## 6. Recommended MVP Boundary

Include:

- Multiple administrator-created local accounts per server, multiple isolated uniquely named spaces per account and multiple pre-created clients per space.
- A compact account Web console for spaces, clients, per-client Keys, usage and audit, plus a server-administrator CLI.
- Separate account-management authentication and client-scoped sync Keys; every accepted mutation is attributed from the authenticated client identity.
- Todo, notes, note taxonomy/images, links and portable preferences.
- Opt-in clipboard text/favorites/images through one clipboard switch, plus a separate screenshot switch.
- Screenshot metadata and complete PNG objects when the screenshot category is enabled.
- Durable incremental synchronization, realtime invalidation, polling fallback and offline queue.
- Conflict preservation, deletion tombstones and a 30-day recovery window.
- S3-compatible scheduled production backups, configurable retention, checksums, status reporting and staged restore.

Defer:

- Accounts with public self-registration, email login, OIDC, teams, sharing and fine-grained roles.
- End-to-end encryption and cross-device secret synchronization.
- Audio recording and completed screen-recording synchronization.
- Local music file replication.
- Executable launcher extension replication.
- Peer-to-peer sync and LAN discovery.
- Collaborative rich-text editing or per-keystroke note merging.
- Server-side full-text indexing of user content.

## 7. Main Risks

| Risk | Impact | Requirement response |
|---|---|---|
| Cross-account or cross-space authorization gap | Privacy breach affecting other users | Derive account/space scope from credentials and enforce it in every data, object, cache, realtime and admin operation |
| A client Key is copied to another installation | Source attribution becomes ambiguous and the copied client can impersonate the original | One Key per pre-created client, first-use installation binding, secure local storage, immediate per-client revoke/reset and independent rotation |
| A stale device overwrites new content | Silent data loss | Base revisions, conflict copies, tombstones and first-sync preview |
| Sensitive clipboard/screenshots upload unexpectedly | Privacy incident | Category opt-in, clear item counts/size, pause and immediate revoke |
| Key appears in logs or config exports | Full workspace compromise | Header-only transport, redaction, safe local storage, hashed server storage |
| LocalStorage snapshot fights with remote changes | Oscillation or overwrite | Sync adapters operate on typed entities; origin tagging suppresses echo |
| Attachment metadata arrives before bytes | Broken notes/captures | Two-phase object commit and hash verification before record visibility |
| Large video saturates disk/network | Service outage | Deferred from MVP; retain storage monitoring, resumable chunks and backpressure for supported images |
| Backup is successful but unrestorable | False assurance | Manifest/checksum validation and scheduled restore drills |
| Delete propagates to every device and backup | Irrecoverable mistake | Tombstone retention, object versions and staged recovery |
| Schema differs between app versions | Corruption or sync loop | Versioned record schemas, compatibility window and quarantine |
| Two servers share the same URL incorrectly | Data cross-contamination | Server instance ID and sync-space ID binding checked on every connection |

## 8. Search Log

- `Apache CouchDB replication conflicts official documentation`
- `PostgreSQL continuous archiving point in time recovery official docs`
- `OWASP REST Security Cheat Sheet API keys headers TLS rate limiting`
- `MDN IndexedDB blobs structured data official`
- `Amazon S3 versioning delete markers restore official docs`
- `OWASP API Security Broken Object Level Authorization multi tenant isolation official`
