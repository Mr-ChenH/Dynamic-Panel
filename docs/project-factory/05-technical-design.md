# Technical Design

## Architecture Overview

```text
Global Shortcut (main)
        │
        ▼
Launcher Window Mode (main + renderer)
        │
        ├── Built-in Index Providers (renderer-safe snapshots)
        │     ├── Applications (platform adapter/main)
        │     ├── Workspace items (LocalStorage snapshot)
        │     └── Optional clipboard source
        │
        ├── Extension Registry (main)
        │     └── Extension Host Manager
        │           ├── Declarative manifests
        │           └── One utility/child process per active extension
        │                 └── JSON Lines request/response protocol
        │
        └── Host Action Gateway (main)
              ├── safe URL/path/app open
              ├── clipboard write
              └── workspace navigation event
```

主进程拥有快捷键、窗口、扩展目录、进程和高权限动作；renderer 拥有搜索输入、结果状态和纯 UI。扩展进程不获得 renderer DOM 或任意 Electron IPC。

## Tech Stack

- Electron 44、Node.js、原生 HTML/CSS/JavaScript。
- `utilityProcess` 优先用于 JavaScript 扩展；若验证后发现跨平台打包限制，再封装 `child_process`/可执行文件适配器。
- Node `readline` 风格 JSON Lines 通讯；每个请求带 request ID。
- 现有 `main-services.js` 承载可单测的 manifest 校验、结果排序、权限和协议纯函数。
- LocalStorage 继续作为用户工作区数据入口；扩展 registry 和运行时诊断使用独立数据键。
- 不引入 React、构建器或远程依赖加载。

## Project Structure

建议新增：

```text
launcher/
├── domain.js              # 结果模型、模糊搜索、排序、别名/收藏纯函数
├── extension-schema.js    # manifest、result、action、permission 校验
├── extension-host.js      # renderer 无关的协议和进程生命周期
└── platform-providers.js  # 应用发现、路径/图标平台适配
renderer/
└── launcher.js            # launcher DOM、键盘状态、动作面板
scripts/
└── sample-launcher-extension.js
main.js                    # 快捷键、窗口模式、IPC、动作网关
preload.js                 # 最小 launcher API
tests/
├── launcher-domain.test.js
├── extension-schema.test.js
├── extension-host.test.js
└── launcher.electron.js
```

如果实现阶段发现文件粒度过大，应按当前仓库风格拆分，但不要把扩展执行代码放回 renderer。

## Data Model

### LauncherResult

```js
{
  id: 'note:note-123',
  kind: 'note',
  title: '项目研究',
  subtitle: '笔记 · 最近更新',
  keywords: ['研究', 'project'],
  source: { type: 'builtin', id: 'notes', label: '笔记' },
  icon: { type: 'builtin', name: 'note' },
  actions: [
    { id: 'open', title: '打开', risk: 'safe' }
  ],
  target: { noteId: 'note-123' },
  searchable: true,
  favorite: false,
  usage: { count: 2, lastUsedAt: 0 }
}
```

结果传给 renderer 前必须删除文件系统绝对路径、密钥、扩展进程对象和内部诊断字段。动态结果的 `target` 只允许受限字符串字段。

### ExtensionManifest

```js
{
  schemaVersion: 1,
  id: 'example.weather',
  name: 'Example Weather',
  version: '0.1.0',
  description: 'Search weather by city',
  author: 'local',
  icon: 'assets/icon.png',
  runtime: { type: 'node', entry: 'index.js' },
  permissions: ['network'],
  commands: [
    {
      id: 'search',
      title: 'Search Weather',
      description: 'Search weather by query',
      mode: 'process',
      keywords: ['weather']
    }
  ]
}
```

`id` 只能使用小写字母、数字、点、短横线和下划线；入口必须是扩展根目录内的相对文件；权限只能来自 allowlist；命令 ID 在扩展内唯一。

### Launcher Settings

```js
{
  schemaVersion: 1,
  shortcut: 'CommandOrControl+Space',
  sources: { apps: true, workspace: true, clipboard: false, extensions: true },
  closeOnBlur: true,
  maxResults: 50
}
```

## API Design

### Preload bridge

只暴露业务动作，不暴露 `ipcRenderer`：

- `openLauncher()` / `closeLauncher()`。
- `onLauncherRequest(cb)`：主进程快捷键通知 renderer。
- `queryLauncher(payload)`：请求内置和扩展结果，payload 含 query、requestId、source filters。
- `cancelLauncherQuery(requestId)`。
- `runLauncherAction(resultId, actionId, payload)`。
- `setLauncherPreference(key, value)`。
- `listExtensions()`、`installExtension(path)`、`setExtensionEnabled(id, enabled)`、`uninstallExtension(id)`。
- `onExtensionStatus(cb)`：转发启动/停止/错误状态。

所有 IPC handler 验证 event.sender 为主窗口，并限制 payload 长度和枚举值。

### Extension JSON Lines protocol

宿主发送：

```json
{"type":"query","requestId":"r1","commandId":"search","query":"tokyo","context":{"platform":"win32"}}
```

扩展返回：

```json
{"type":"result","requestId":"r1","items":[{"id":"tokyo","title":"Tokyo","subtitle":"Weather","action":{"type":"host","name":"open-url","url":"https://example.test/tokyo"}}]}
```

执行阶段由宿主发送：

```json
{"type":"execute","requestId":"r2","commandId":"search","itemId":"tokyo","actionId":"open"}
```

协议要求：一行一个 JSON、单行最大 256KB、request ID 必须匹配、结果最多 100 条、结果字段严格 schema 校验。未知消息丢弃并记录诊断；重复/过期响应不更新 UI。

## State Management

- `launcherMode`：closed/opening/open/closing。
- `queryState`：idle/searching/ready/empty/error。
- `results`：按 requestId 管理，内置结果和扩展结果分别到达后合并排序。
- `selectedResultId`：只使用稳定 ID，结果刷新后保留或回退。
- `actionPanelState`：closed/open/confirming。
- `extensionRuntimeState`：disabled/starting/ready/busy/failed/stopped。
- 搜索 query 不写 LocalStorage；收藏、别名、使用记录和设置才持久化。

## Authentication And Authorization

MVP 无账号和远程授权。扩展安装由本机用户确认。运行时通过 Node 文件权限限制直接 IO：只读扩展代码及 runner，读写专属 storagePath；禁止派生进程、原生插件、Worker 和 inspector。writeFiles/shell 声明的执行动作需要二次确认。网络没有系统级隔离，不声称这是完整 OS 沙箱。当前交付与验证详见 `15-remaining-requirements-delivery.md`。

如果扩展需要 token，后续通过宿主 secure storage API 保存；首版不允许扩展把密钥写进 manifest 或日志。

## Background Jobs

- 应用发现：启动时后台扫描，平台适配器返回标准化结果；变化时增量刷新。
- 扩展进程：按需启动；空闲一段时间可关闭；关闭 launcher 时取消未完成查询。
- 使用统计：成功动作后异步合并，限制记录数和存储大小。
- 不使用轮询网络更新；在线商店属于后续版本。

## Error Handling

- manifest 错误：安装前拒绝，展示字段级错误。
- 进程启动失败：扩展标记 failed，其他来源继续显示。
- 查询超时：结束当前 request，保留旧结果或显示扩展局部错误。
- 输出非法：丢弃该行，计入诊断并限制连续错误次数。
- 动作失败：主进程返回稳定错误码，renderer 显示中文用户提示。
- 关闭/卸载：先 cancel 请求，再 terminate 进程，设定强制回收时间。

## Observability

扩展诊断只记录：扩展 ID、命令 ID、事件类型、耗时、退出码和截断后的错误摘要；不记录查询全文、token、密码或完整路径。

设置页提供最近 20 条扩展错误和“复制诊断信息”。主进程使用现有 console 日志格式，不增加远程遥测。

## Security Considerations

1. 保持 renderer `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
2. 不允许扩展直接发送 Electron IPC；所有宿主动作由主进程按扩展权限和动作 schema 校验。
3. 安装目录必须位于应用数据目录或用户选择的受控扩展目录；拒绝 `..`、绝对入口、符号链接逃逸和 zip symlink。
4. 图标只允许扩展目录内的图片，禁止远程图标默认加载。
5. URL 复用现有公开 HTTP/HTTPS 和内网阻止规则；文件路径必须经过平台 allowlist。
6. 子进程设置 stdout/stderr 上限、查询/执行超时和并发限制；扩展不能影响主进程事件循环。
7. 明确告知用户：process 扩展是本机代码，manifest 权限是宿主动作权限，不等于完整 OS 沙箱。
8. 生产发布前需要代码签名、安装包完整性和扩展来源验证；当前 MVP 不发布在线扩展。

## Testing Strategy

- 纯函数：模糊排序、别名冲突、收藏和 usage、manifest schema、路径检查、结果 schema、协议解析。
- 主进程单测：快捷键占用回退、扩展进程超时/退出/取消、动作权限 allowlist。
- Electron 场景：快捷键唤出、自动聚焦、搜索内置结果、键盘执行、动作面板、失焦关闭、扩展安装和隔离。
- 回归：现有 121 项 Node/Electron 检查全部保持通过。
- 安全测试：非法 manifest、超长 JSON、路径穿越、符号链接、未知 action、旧响应覆盖新响应。

## Deployment Plan

MVP 不改变发布命令；`npm test` 通过后再按用户明确授权运行 `npm run pack` 或平台打包。安装包需要把 launcher 运行时代码和样例扩展排除/包含策略写入 electron-builder files，并禁止把用户安装的扩展打进应用资源。

## Migration Plan

- 新键缺失时使用默认设置，不迁移旧设置。
- 从现有 LocalStorage 即时构造内置索引，绝不复制或重写原始对象。
- `notch-home-commands` 只映射为 `copy-text` 结果。
- `workspace.json` 增加新键快照；老版本读取时忽略未知键。
- 选择性迁移通过管理页逐扩展导出/导入 `storage/<extensionId>/` 完成；用户在目标电脑先安装同 ID 扩展，再确认替换数据。归档只含数据，不迁移代码、安装授权或日志。

## Technical Risks

- Electron utility process 的打包和跨平台行为需要在 macOS/Windows runner 实测。
- Node 文件权限已限制直接工作区 IO，但网络与整个操作系统没有完整隔离；若未来需要第三方商店，必须先增加签名、审核或更强隔离。
- 应用发现与图标索引可能影响启动时间；必须先缓存再展示。
- 复用当前 BrowserWindow 的模式状态可能与启动器“失焦关闭”冲突，需要状态机测试。
- `CommandOrControl+Space` 可能被输入法占用，设置页必须支持替代快捷键。
