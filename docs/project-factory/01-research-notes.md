# Research Notes

研究时间：2026-09-11。资料以产品官方手册或官方技术文档为主，结合当前仓库实现检查。

## Comparable Products

### Raycast

- [Search Bar](https://manual.raycast.com/search-bar)：Root Search 是统一入口，应用、命令、文件和目录可以出现在同一结果流中；空搜索展示最近项目，输入后实时过滤。
- [Quickstart](https://manual.raycast.com/quickstart)：核心学习路径是搜索、动作面板、Quicklink、快捷键/别名和扩展。
- [Quicklinks](https://manual.raycast.com/quicklinks)：Quicklink 不只保存网页，也支持文件、目录、deep link 和带占位符的搜索 URL；创建后直接进入 Root Search。
- [Command Aliases & Hotkeys](https://manual.raycast.com/command-aliases-and-hotkeys)：别名适合键入后精确直达，Hotkey 适合从任意应用直接执行命令；设置可以从动作面板完成。
- [Manifest](https://developers.raycast.com/information/manifest)：一个扩展可包含多个 command，命令声明标题、描述、图标、模式和偏好。
- [Security](https://developers.raycast.com/information/security)：Raycast 的扩展可访问 Node 文件和网络能力，扩展通过单独子进程和受控 RPC 与宿主交互；资料也明确说明其扩展并没有完整的文件系统/网络沙箱。
- [How the Raycast API and extensions work](https://www.raycast.com/blog/how-raycast-api-extensions-work)：扩展被设计成宿主中的一等命令，而不是嵌入一个第二套网页应用；一个扩展可以提供多个命令和复杂页面。

可借鉴：统一结果模型、别名和收藏、动作面板、扩展包含多个命令、搜索与命令执行分离。

不直接照搬：Raycast 的 React/TypeScript 原生 UI、在线商店和账号/自动更新体系超出当前 Electron 项目首版范围；其扩展权限模型也不能直接视为安全沙箱。

### Alfred

- [Script Filter](https://www.alfredapp.com/help/workflows/inputs/script-filter/)：脚本可以根据查询实时生成结果，支持队列/终止策略和查询延迟，适合慢网络请求。
- [Script Filter JSON](https://www.alfredapp.com/help/workflows/inputs/script-filter/json/)：结果使用结构化 JSON，包含 `uid`、`title`、`subtitle`、`arg`、`icon`、`valid`、`autocomplete` 等字段；`uid` 还可帮助排序学习。

可借鉴：扩展返回标准化结果，宿主统一渲染；为慢扩展定义取消、超时和查询节流；结果项明确区分展示文本与执行参数。

### PowerToys Command Palette

- [Overview](https://learn.microsoft.com/en-us/windows/powertoys/command-palette/overview)：采用紧凑搜索框，支持应用、命令、文件、网页、计算器、剪贴板和系统工具；支持 `>`、`??`、`=` 等查询前缀。
- [Extensibility overview](https://learn.microsoft.com/en-us/windows/powertoys/command-palette/extensibility-overview)：扩展独立进程运行，通过 WinRT API 注册；可提供顶层命令、fallback command、上下文动作以及 list/detail/form/markdown/grid 页面。
- [Finding and installing extensions](https://learn.microsoft.com/en-us/windows/powertoys/command-palette/finding-and-installing-extensions)：安装、启用、设置、更新和卸载都是独立生命周期，Gallery 通过缓存保持搜索响应。

可借鉴：紧凑模式、结果前缀、扩展独立进程、安装生命周期、扩展设置和动作的分层。

### Flow Launcher

- [plugin.json](https://github.com/Flow-Launcher/docs/blob/main/plugin.json.md)：插件通过 manifest 声明语言、入口文件、关键词、图标和版本；支持 Python、JavaScript、TypeScript 和可执行文件。
- 插件使用 JSON-RPC/结构化结果与宿主通讯，适合跨语言扩展，但也意味着宿主必须处理进程生命周期和协议错误。

可借鉴：manifest 入口和语言无关协议；首版可以先支持 JavaScript/TypeScript，协议预留其他可执行程序。

## User Expectations

1. 唤出后焦点必须立即在搜索框，输入结果应在按键后快速出现。
2. 结果需要有明确的标题、来源/副标题、图标和快捷键提示。
3. 空搜索不能是空白黑框，应显示收藏和最近使用项目。
4. Enter 的主动作必须可预测；其他动作放入 `Cmd/Ctrl+K` 动作面板。
5. 用户应能通过别名直接命中常用命令，并能在不离开当前上下文的情况下配置。
6. 慢扩展、坏扩展和无结果状态需要有可理解的反馈，不能卡住整个启动器。
7. 安装扩展前应知道扩展来源、版本、入口和权限；卸载应可清理其缓存和数据。

## Current Repository Findings

- 面板快捷键已经在主进程注册，默认值是 `Space`，并有设置页录入和占用失败回退逻辑。
- 主窗口采用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；新增扩展执行不能把 Node API 暴露给 renderer。
- 当前工作区数据通过 `workspace.json` 保存 LocalStorage 快照，已有待办、笔记、链接、录音和密钥的独立键/目录约束。
- 首页“常用指令”存储为 `notch-home-commands`，目前提供复制文本和编辑，不具备执行语义；迁移时必须保持原行为。
- 链接模块已有公开 HTTP/HTTPS 校验和主进程安全抓取逻辑；启动器打开链接应复用安全 URL 路径。
- Windows 目前不提供当前窗口和汽水音乐，但启动器的通用来源、链接、笔记、待办和应用入口仍可跨平台工作。
- 项目目前没有文件索引服务、扩展目录、命令结果统一类型、执行审计或专用 launcher 窗口。

## Recommended Scope

### 推荐方向：Launcher Mode + Trusted Local Extensions

- 在现有主窗口内新增启动器模式，复用现有折叠/展开和贴顶定位能力。
- 首版内置来源优先覆盖本地应用、工作区项目、链接、笔记、待办和旧常用指令。
- 首版扩展使用本地 manifest；声明式命令可直接由宿主执行，动态命令通过独立进程 JSON Lines 协议返回结果。
- 首版安装仅接受本地目录或 zip，安装前显示 manifest 和权限，默认禁用网络/写文件等高风险能力。
- 先做一个“扩展管理”设置页和开发样例扩展，暂不建设在线商店、账号和自动更新。

### 明确放入后续

- 全盘实时文件索引。
- 在线商店、签名验证、自动更新和社区审核。
- AI 对话、复杂表单、多页原生扩展 UI。
- 完整跨平台应用窗口管理和系统级命令集合。
- 完全不可逃逸的第三方代码沙箱。

## Technical Options

| 方案 | 优点 | 风险 | 建议 |
| --- | --- | --- | --- |
| 所有扩展直接在 renderer 执行 | 开发简单 | 破坏 sandbox/contextIsolation，任意代码可接触 UI 和桥接 | 禁止 |
| 所有扩展直接在 main 执行 | IPC 少 | 扩展崩溃或阻塞会影响整个应用；主进程权限过高 | 禁止 |
| 每个扩展独立 child/utility process，JSON Lines | 崩溃隔离、跨语言、协议可测试 | 仍需面对进程权限和 npm 依赖风险；要做超时和清理 | 推荐 |
| 仅支持声明式 manifest | 最容易审计和跨平台 | 不能满足动态搜索和网络 API 扩展 | 作为首版基础层 |
| iframe/webview 扩展 UI | 可做复杂界面 | 导航、网络、权限和视觉一致性复杂 | 后续评估 |

## Risks

- **安全风险**：本地扩展本质上可能执行任意代码。安装、更新和启动必须有来源/权限提示，不能把 manifest 权限误称为完整沙箱。
- **搜索性能**：输入每个字符都触发扩展进程会造成抖动。需要内置来源同步快速过滤，扩展查询节流、取消和超时。
- **快捷键冲突**：`CommandOrControl+Space` 可能与输入法或系统快捷键冲突，必须支持录入、检测失败和关闭启动器快捷键。
- **数据迁移**：不能改变已有 LocalStorage 结构；统一索引应从现有数据派生，不能建立第二份可被用户直接编辑的副本。
- **跨平台差异**：应用发现、路径打开、文件图标和权限提示需由 platform adapter 处理。
- **窗口交互**：启动器显示时要避免复用 Windows 折叠形状导致点击穿透错误，也不能让启动器退场时挡住其他应用。
- **生态负担**：没有商店和稳定 SDK 前，扩展数量有限；因此首版必须让内置来源本身足够有用。

## Recommendations

1. 把 launcher 当作新的产品模式和统一结果协议建设，而不是把首页常用指令改造成脚本执行器。
2. 先完成内置来源、搜索/排序、动作面板和快捷键，再接扩展运行时；这样即使用户没有安装扩展，功能仍然完整。
3. 结果模型采用 `id/title/subtitle/icon/source/kind/action`，扩展协议只允许返回该模型的受限版本。
4. 首版将扩展分为 `declarative` 和 `process` 两类，并在界面显示来源与权限等级。
5. 所有高风险动作必须通过主进程 allowlist；扩展不能直接请求任意 IPC、任意路径或任意外部 URL。
6. 用一个可复现的本地样例扩展验证开发体验，再决定是否继续做 CLI、在线目录和复杂 UI。
