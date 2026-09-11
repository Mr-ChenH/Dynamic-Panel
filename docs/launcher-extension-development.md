# 本地启动器扩展

首版支持 `manifest.json` 声明式命令和 Node.js 进程命令，不兼容 Raycast API。无需另外安装 Node；扩展使用应用附带的 Electron Node 运行模式。扩展目录中的 `.git`、`node_modules` 不安装，依赖需预先打包为 JavaScript。

## 体验样例

1. 启动 `npm start`，点击面板顶栏「搜索」，或使用 Cmd+Space / Ctrl+Space。
2. 打开「管理 → 从目录安装扩展」，选择仓库 `examples/launcher/local-tools/`。
3. 查看名称、作者、权限和执行代码说明后安装。
4. 返回搜索，搜索「复制问候」并回车，验证声明式复制。
5. 输入「大写转换 hello」，选择 `HELLO` 回车，验证动态查询、执行和复制。

默认快捷键被系统占用时，从顶栏搜索或「设置 → 启动器设置」修改。留空可禁用。扩展只在显式输入命令标题或 ID 加空格时查询，普通搜索不会向所有扩展广播文本。

## Manifest

参见 [样例 manifest](../examples/launcher/local-tools/manifest.json)。`schemaVersion` 为 1；`id`、命令 ID 使用小写字母、数字、点、下划线或短横线；版本为三段数字。命令模式为 `declarative` 或 `process`。进程入口为目录内相对 `.js` 文件。

声明式 `action` 支持：

- `{ "type": "copy-text", "text": "..." }`，需要声明 `clipboard`。
- `{ "type": "open-url", "url": "https://..." }`，由宿主校验为公开 HTTP/HTTPS 后打开。
- `{ "type": "open-path", "path": "本机绝对路径" }`，需要 `readFiles`；宿主检查真实路径、文件存在及类型；只打开目录与白名单数据文件，拒绝未知类型、网络/设备路径和脚本/可执行文件。白名单为 txt/md/markdown/pdf/png/jpg/jpeg/gif/webp/bmp/tiff/mp3/wav/m4a/ogg/flac/mp4/mov/mkv/webm/csv/json/log。
- `{ "type": "navigate", "tab": "notes", "id": "note-id" }`，tab 仅支持 `home/notes/todo/links`，id 可选；工作区校验目标存在及功能已启用后导航。

权限字段接受 `network/readFiles/writeFiles/shell/clipboard`。宿主以 Node `--permission` 启动进程：只允许读取扩展代码/内部 runner，读写 `context.storagePath`；没有派生进程、原生插件、Worker 或 inspector 授权。即使声明 readFiles/writeFiles/shell，也不会解锁任意文件读写或 Shell；readFiles 允许受校验的宿主 open-path 动作，clipboard 允许复制动作，writeFiles/shell 会使执行动作需要二次确认。

网络声明用于展示，当前 Node 运行时没有网络权限开关，网络没有系统级隔离。Node 权限控制不能替代恶意代码 OS 沙箱，仍只安装信任的扩展。环境不会继承 API Key 或 NODE_OPTIONS。旧扩展如果写入代码目录或调用子进程，现在会失败；请将数据改写到 storagePath，并使用宿主动作。

## JSON Lines 协议

stdin 每行一个请求，stdout 每行一个响应；stderr 可用于诊断，但宿主不向 UI 暴露原始日志。

```json
{"type":"query","requestId":"opaque-id","commandId":"upper","query":"hello","context":{"platform":"win32"}}
```

```json
{"type":"result","requestId":"opaque-id","items":[{"id":"uppercase","title":"HELLO","subtitle":"Enter 转换并复制","action":{"type":"execute"}}]}
```

执行时会启动新进程，发送 `type: execute` 以及相同 `commandId/query` 和选中的 `itemId`。因此不要依赖查询进程的内存状态。执行响应必须返回一个结果，其 action 必须是 `copy-text`、`open-url`、`open-path` 或 `navigate`，不能再返回 execute。

每次查询/执行均独立启动并在响应后回收。请求额外包含 `extensionId`；`context.storagePath` 指向本机 `userData/launcher/storage/<extensionId>/`，用于扩展持久化自己的数据。此路径不随工作区迁移，卸载保留数据。Node 权限限制直接读取其他用户路径及写入工作区。查询超时默认 800ms，可在启动器设置中调整为 300–5000ms，执行默认超时 5000ms，可调整为 500–10000ms；stdout/stderr 合计上限 256KiB；结果最多 100 项；同一查询最多运行 3 个匹配命令。查询变化、关闭、禁用和卸载会取消当前与排队请求；运行时就绪后，取消会尽力发送 `{type:"cancel", requestId, commandId, extensionId}`，随后仍终止进程；扩展不能依赖 cancel 必然送达。内部引导程序处理 ready 握手，Node 启动上限 1500ms，运行时就绪后才开始查询/执行计时，扩展无需实现 ready。运行诊断在本机保留最近 20 条，包含时间、操作、耗时与状态，不记录 query 或输出正文；宿主打开/复制失败也会记录。导航先标记 pending-navigation，收到工作区执行结果后更新成功或失败。动态结果仅支持即时执行，不提供收藏和别名；扩展命令入口仍可配置。需要长期运行或复杂 UI 的扩展暂不支持。

## 安装和数据

本地目录先复制至暂存区，拒绝符号链接、特殊文件、超过 500 文件或 20MiB 的包；用户确认后移至本机 `userData/launcher/extensions/<id>/`。重复 ID 拒绝安装，需要先卸载。卸载确认后删除该目录，包括扩展自己生成的数据。

快捷键、来源和安装状态保存在本机；收藏、别名和使用次数存于工作区 LocalStorage 并进入 `workspace.json`。迁移工作区不会自动启用或运行另一台电脑的扩展，需要重新安装。

在扩展管理中可逐个“导出数据”，目标电脑安装同 ID 扩展后“导入数据”。文件为版本化 JSON + Base64，仅包含专属数据，最多 500 个文件、20MiB 原始内容；拒绝 symlink/junction、设备名、大小写重名、路径穿越和错误扩展 ID。导入在确认后用暂存目录替换，失败保留旧数据；其他扩展不受影响。代码、授权和诊断日志不会导入。

## 当前限制

没有在线商店、zip 安装、签名分发、自动更新、Raycast SDK 兼容或系统沙箱。应用索引支持 macOS 应用目录与 Windows 开始菜单/桌面的 `.lnk`；未覆盖全部 MSIX/AUMID 应用。文件夹内容索引、完整拼音检索、复杂参数页面和扩展密钥存储 API 为后续工作；直接输入本机绝对路径已支持。
