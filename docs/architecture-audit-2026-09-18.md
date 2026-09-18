# Dynamic Panel 项目架构与缺陷审核报告

日期：2026-09-18

## 审核范围

本次审核覆盖桌面端主进程、preload、renderer、领域服务、Electron 测试脚本、打包配置和官网检查入口，重点关注：

- 高耦合、低内聚
- 单文件规模过大
- 领域服务与 Electron 生命周期混杂
- IPC 和 preload 契约维护成本
- 测试覆盖与发布配置缺陷
- 浅色主题残留深色样式
- 已知可复现的功能问题

## 规模概览

当前主要大文件：

| 文件 | 行数 | 主要问题 |
| --- | ---: | --- |
| `main.js` | 3879 | 主进程总装配器，混合窗口、IPC、媒体、AI、财务、工作区和扩展系统 |
| `renderer/styles.css` | 6185 | 多模块样式和主题覆盖集中，存在重复覆盖和加载顺序依赖 |
| `renderer/app.js` | 5052 | shell、待办、剪贴板、笔记、首页和拖拽状态混合 |
| `renderer/workspace.js` | 3515 | 设置、财务、音乐、录音、密钥、AI 和 workspace 混合 |
| `finance-service.js` | 2212 | 多 provider、缓存、并发取消和结果归一化集中 |
| `tests/notch-focus.electron.js` | 1524 | 面板交互和大量场景验收混在一个 Electron 测试文件 |
| `tests/domain.test.js` | 1032 | 多领域 renderer domain 测试集中 |
| `tests/startup.electron.js` | 881 | 启动、首页、聊天、天气、音乐、设置、剪贴板和 launcher 混合 |
| `tests/finance-service.test.js` | 886 | 多 provider 和取消场景集中 |

## 高优先级问题

### 1. electron-builder 遗漏 `main/` 目录

`main.js` 运行时依赖以下模块：

- `main/window-geometry.js`
- `main/network-security.js`
- `main/link-inspector.js`
- `main/workspace-files.js`
- `main/clipboard-service.js`
- `main/task-notification-server.js`
- `main/task-notification-domain.js`
- `main/task-notification-queue.js`
- `main/task-notification-timers.js`
- `main/task-notification-window-state.js`
- `main/task-notification-window.js`
- `main/task-notification-controller.js`

`package.json` 的 electron-builder `files` 白名单当前没有 `main/**/*.js`。开发环境可以正常运行，打包后可能因模块不存在而启动失败。

修复方式：

```json
"main/**/*.js"
```

同时增加静态覆盖测试，验证每个运行时 `require()` 目标都被打包规则覆盖。

### 2. `npm test` 没有检查 `main/*.js`

`scripts/test-desktop.js` 的 `--check` 文件列表没有包含新拆出的 `main/*.js`。应自动扫描 `main` 目录，避免新增模块绕过语法检查。

### 3. 完整测试仍有面板收起失败

`tests/notch-focus.electron.js` 当前存在失败：

```text
展开后点击顶部中央空白必须收起；最终状态 expanded / aria-hidden=false
```

需要确认点击命中缓冲区、`window:keep-open`、renderer aria 状态同步和测试等待时间之间的关系。

## 中优先级架构问题

### 4. `main.js` 仍然过大且低内聚

剩余高耦合区域：

#### 转录服务

`main.js` 中转录代码同时维护 API 配置、WebSocket、session、连接超时、PCM 数据、interim/final 文本、finish 超时和 renderer 事件。

建议拆分：

```text
main/transcription-config.js
main/transcription-session.js
main/transcription-service.js
```

#### 财务后台刷新

`main.js` 中财务后台刷新同时维护 generation、requestId、timer、active 状态、取消、provider warning 和 renderer 推送。

建议拆分：

```text
main/finance-background-refresh.js
```

#### IPC 注册

当前超过 100 个 IPC handler 集中在 `main.js`。建议按领域拆分注册文件：

```text
main/ipc/window.js
main/ipc/settings.js
main/ipc/workspace.js
main/ipc/finance.js
main/ipc/recordings.js
main/ipc/notes.js
main/ipc/capture.js
main/ipc/launcher.js
main/ipc/ai.js
```

保持现有 IPC 通道名和返回结构不变。

### 5. renderer 文件低内聚

`renderer/app.js` 同时处理 shell、Tab、待办、剪贴板、笔记、首页布局、主题、launcher 和拖拽。

`renderer/workspace.js` 同时处理设置、财务、音乐、录音、密钥、AI、快捷键和 workspace。

建议建立显式 renderer context，再按领域拆分：

```text
renderer/shell.js
renderer/todo.js
renderer/clipboard.js
renderer/notes.js
renderer/settings.js
renderer/recordings.js
renderer/music.js
renderer/credentials.js
renderer/finance-settings.js
```

### 6. `renderer/styles.css` 过大

当前约 6185 行，存在重复选择器、末尾追加修正、主题覆盖分散和 CSS 加载顺序依赖。

建议拆分：

```text
renderer/shell.css
renderer/todo.css
renderer/clipboard.css
renderer/notes.css
renderer/recordings.css
renderer/settings.css
renderer/theme.css
```

截图编辑器、录屏覆盖层和独立通知窗口保持深色属于产品约束，可以保留。

### 7. preload API 过大

`preload.js` 暴露约 150 个跨领域方法。建议未来按领域提供分组对象，同时保留旧方法作为过渡兼容层：

```js
notchAPI.window
notchAPI.finance
notchAPI.home
notchAPI.capture
notchAPI.recordings
notchAPI.notes
notchAPI.launcher
notchAPI.settings
```

## 已发现的功能和测试缺陷

### 8. 财务取消错误匹配过宽

当前 IPC 取消判断同时检查 `error.code` 和错误消息中的 `cancel`。按文本匹配可能把真实错误误判为取消。

建议只接受：

```js
error?.code === 'cancelled'
error?.name === 'AbortError'
```

### 9. 财务 renderer 取消结果需要明确忽略

主进程现在把取消转换为：

```js
{ ok: false, error: 'cancelled' }
```

renderer 的 overview、ranking、quotes、history、fundamentals 和 search 都应明确忽略该结果，避免把正常取消显示成行情不可用。

### 10. 通知生命周期仍缺少真实 Electron 集成测试

已有 controller fake window 测试，但仍缺少真实 BrowserWindow ready、hover、dismissed、renderer 崩溃、窗口关闭恢复和队列耗尽销毁的 Electron 测试。

## 浅色主题风险

天气、录音和剪贴板已补充浅色覆盖，但扫描仍发现工作台内有大量深色专用值，重点包括：

- 链接侧栏和分组头
- 财务行情卡片和设置页
- 音乐发现浮层
- 番茄钟设置弹层
- 待办日期选择器
- 密钥编辑卡
- AI 设置迁移提示
- launcher 管理面板

独立截图、录屏和通知窗口保持深色；工作台内模块需要继续逐模块实机验证。

特别关注：

- `styles.css` 中的 `color-scheme: dark`
- `rgba(255,255,255,...)` 交互背景
- 深色硬编码 `#151519`、`#050505`、`#030303`

## 测试结构问题

以下测试文件也已经过大：

- `tests/notch-focus.electron.js`
- `tests/domain.test.js`
- `tests/startup.electron.js`
- `tests/finance-service.test.js`

建议按领域拆分 Electron 验收和 domain 测试，降低单个 UI 改动的回归范围。

## 建议重构顺序

1. 修复 `package.json`，加入 `main/**/*.js`
2. 自动将 `main/*.js` 纳入语法检查
3. 增加打包内容完整性测试
4. 修复 `notch-focus.electron.js` 的收起失败
5. 提取 `main/transcription-service.js`
6. 提取 `main/finance-background-refresh.js`
7. 拆分 `main.js` 的 IPC 注册
8. 拆分 `renderer/app.js` 的 shell、待办和剪贴板
9. 拆分 `renderer/workspace.js` 的设置、录音、音乐和密钥
10. 将 `renderer/styles.css` 拆成模块样式和统一主题层
11. 增加通知真实 Electron 生命周期测试
12. 最后进行全模块浅色主题实机验收

## 当前结论

目前最高风险已从打包模块遗漏和启动顺序回归下降为 renderer 大文件维护成本、通知真实生命周期覆盖不足，以及 launcher/待办提醒 IPC 仍集中在 `main.js`。核心 Electron 启动、面板收起、工作区保留和 capture 验收当前均已通过。

本报告之后的第一阶段重构应只处理发布完整性和检查覆盖，完成后再进入转录服务拆分，保证每一步可以独立回归和定位。

## 实施进度

### 已完成：发布完整性

提交：`bf23c3f refactor: cover extracted main modules in packaging checks`

- electron-builder 增加 `main/**/*.js`
- 桌面语法检查自动扫描 `main/`
- 新增 `tests/build-integrity.test.js`
- 验证 `main.js` 中的 `./main/*.js` 引用都能解析

### 已完成：转录会话服务拆分

提交：`f0d03ae refactor: extract transcription session service`

- 新增 `main/transcription-service.js`
- 提取 WebSocket session、音频帧、interim/final 文本、finish 超时和关闭清理
- 保留原有 `transcription:start`、`transcription:audio`、`transcription:finish` 和 `transcription:event`
- 新增 `tests/transcription-service.test.js`

### 已完成：财务后台刷新拆分

提交：`20fc653 refactor: extract finance background refresh`

- 新增 `main/finance-background-refresh.js`
- 提取 timer、generation、requestId、取消、payload 归一化和 renderer 快照推送
- 保留财务刷新 IPC、启动预热、配置变更和退出清理行为
- 新增 `tests/finance-background-refresh.test.js`

相关定向检查当前通过 44 项测试，且 `main.js`、新模块和桌面检查脚本均通过 `node --check`。

### 已完成：财务 IPC 注册拆分

本阶段提交包含：

- 新增 `main/ipc/finance.js`
- 将 14 个 `finance:*` IPC handler 移出 `main.js`
- 保留请求 ID 按 sender 隔离、主窗口来源校验、取消结果归一化和 provider 验证持久化
- 新增 `tests/finance-ipc.test.js`
- `main/` 语法检查改为递归扫描，覆盖 `main/ipc/` 等嵌套目录

### 已完成：录音 IPC 注册拆分

- 新增 `main/ipc/recordings.js`
- 将 `recordings:save`、`recordings:read`、`recordings:delete` 和 `recordings:reveal` 移出 `main.js`
- 通过依赖注入保留工作区路径校验和系统文件管理器定位行为
- 新增 `tests/recordings-ipc.test.js`
- 保持录音文件只通过 `workspaceFiles.getSafeRecordingPath()` 暴露

### 已完成：笔记图片 IPC 注册拆分

- 新增 `main/ipc/notes.js`
- 将 `notes:save-image`、`notes:choose-images`、`notes:read-image` 和 `notes:delete-images` 移出 `main.js`
- 保留单图 20MB 输入限制、最多 12 个文件、PNG 回读上限和笔记目录边界校验
- 删除笔记图片时继续拒绝符号链接根目录、符号链接笔记目录和越界路径
- 新增 `tests/notes-ipc.test.js`

### 已完成：剪贴板 IPC 注册拆分

- 新增 `main/ipc/clipboard.js`
- 将 `clipboard:readImage`、`clipboard:deleteImages`、`clipboard:write` 和 `clipboard:paste` 移出 `main.js`
- 保留图片路径边界校验、系统剪贴板写入、辅助功能权限降级和回到原应用粘贴流程
- 将面板收起、原应用目标和粘贴执行器作为依赖注入，避免 IPC 模块持有窗口全局状态
- 新增 `tests/clipboard-ipc.test.js`

### 已完成：AI IPC 注册拆分

- 新增 `main/ipc/ai.js`
- 将 `ai:run`、`ai:cancel`、`ai:test-provider`、诊断读取/清理和迁移确认移出 `main.js`
- AI service、provider 配置解析、验证持久化和密钥处理通过依赖注入保留在主进程领域层
- 保留 sender ID 隔离、provider stale context 检查、诊断失败返回和迁移保存失败处理
- 新增 `tests/ai-ipc.test.js`

### 已完成：转录配置与流式 IPC 拆分

- 新增 `main/ipc/transcription.js`
- 将 `transcription:get-config`、`transcription:set-config`、`transcription:start`、`transcription:audio` 和 `transcription:finish` 移出 `main.js`
- 保留 schema v3、旧字段兼容、模型列表去重、HTTPS endpoint 校验、safeStorage 密钥加密和 workspace ID 校验
- 配置变更继续取消 AI 请求，并在转录配置变化时关闭实时转录 session
- 新增 `tests/transcription-ipc.test.js`
- 修复 `before-quit` 仍调用已删除 `clearFinanceBackgroundTimer()` 的退出路径缺陷，改由 `financeBackgroundService.dispose()` 统一清理
- 全部 Node 单元测试为 297 项：296 通过，1 项按平台跳过

### 已完成：首页天气与音乐 IPC 拆分

- 新增 `main/ipc/home.js`
- 将天气查询、天气详情、音乐库、播放来源、在线目录浏览、本地导入和音频/封面读取等 20 个 `home:*` handler 移出 `main.js`
- 保留拥有主窗口的文件选择器、音频扩展名过滤、取消返回结构和文件夹导入入口
- 天气与音乐领域规则继续由 `home-services.js` 和 `home-media.js` 负责
- 新增 `tests/home-ipc.test.js`

### 已完成：系统能力 IPC 拆分

- 新增 `main/ipc/system.js`
- 将麦克风权限、公共外部 URL、本地绝对路径和隐私设置面板 IPC 移出 `main.js`
- 隐私设置 URL 由 `privacySettingsPanesFor(platform)` 固定生成，renderer 输入只能作为枚举键查询
- 公共 URL 继续经过 DNS 与私网地址校验，本地路径继续要求绝对路径
- macOS 麦克风权限仍通过既有 TCC 前台协调器请求
- 新增 `tests/system-ipc.test.js`

### 已完成：工作区 controller 与 IPC 拆分

- 新增 `main/workspace-controller.js` 和 `main/ipc/workspace.js`
- 将工作区根路径、目录迁移、portable snapshot 读写、媒体路径归一化和五个 `workspace:*` handler 移出 `main.js`
- 保留 `workspace.json` schema v1、8MB 上限、未变化快照跳过写盘以及 `/` 分隔的录音和剪贴板图片相对路径
- 更换工作区时继续阻止活动录音/录屏，先迁移截图与媒体资产，再更新设置并通知 renderer、capture service 和托盘
- 新增 `tests/workspace-controller.test.js`
- 完整 Node 测试为 304 项：303 通过，1 项按平台跳过

### 已完成：应用设置 controller 与 IPC 拆分

- 新增 `main/settings-controller.js` 和 `main/ipc/settings.js`
- 将功能显隐、默认 Tab、主题、开机启动和五类全局快捷键的六个 `settings:*` handler 移出 `main.js`
- 快捷键继续执行“注册新值、持久化、保存失败恢复旧值”的事务；占用、无效输入和保存失败的返回结构不变
- 主题写入继续校验主窗口 sender，功能显隐继续联动剪贴板采集服务和托盘菜单
- 新增 `tests/settings-controller.test.js`
- 完整 Node 测试为 307 项：306 通过，1 项按平台跳过
- 完整 `npm test` 随后仍因既有 `tests/notch-focus.electron.js:406` 顶部空白点击未收起断言失败，重试结果相同

### 已完成：全局快捷键服务拆分

- 新增 `main/shortcut-service.js`
- 将面板、启动器、截图、录屏和录音快捷键的注册状态、冲突检测、系统注册失败恢复移出 `main.js`
- 将 Hover + Space 的轮询 timer、鼠标命中检测和临时 Space 注册统一纳入快捷键服务
- Electron 窗口显示、启动器焦点捕获和采集动作继续由 `main.js` 以回调注入，服务不直接持有 BrowserWindow 或 capture service
- 保留 `shortcut:hover-space-status` 返回结构、快速连按 Space 收起和 `will-quit` 清理行为
- 新增 `tests/shortcut-service.test.js`，并更新 renderer 结构测试以检查迁移后的职责边界
- 完整 Node 测试为 310 项：309 通过，1 项按平台跳过

### 后续收尾：面板折叠与装配顺序修复

- 修复分栏 Tab 容器横跨顶栏时，中央空白点击不能收起面板的问题；点击保护范围改为各个实际可见 Tab 按钮的矩形
- 修复 `networkSecurity` 在 `registerSystemIpc` 之后初始化导致的启动期 TDZ `ReferenceError`
- 为网络安全服务初始化顺序增加打包完整性回归测试
- `notch-focus.electron.js` 和 `startup.electron.js` 当前均通过

### 已完成：财务取消与密钥库、链接 IPC 拆分

- 财务 IPC 仅把 `code === 'cancelled'` 或 `name === 'AbortError'` 归一化为取消，不再按错误消息文本猜测
- 财务 renderer 的 overview、ranking、quotes、history、fundamentals 和 search 明确忽略结构化取消结果
- 新增 `main/credentials-vault.js`、`main/ipc/credentials.js`，迁移安全存储、原子写盘、公开字段映射和五个 `credentials:*` handler
- 新增 `main/ipc/links.js`，迁移 `links:inspect` 和 `smart:organize-material`
- 新增 `tests/credentials-vault.test.js` 和 `tests/links-ipc.test.js`
- `main.js` 当前约 2980 行

### 已完成：窗口 IPC 注册拆分

- 新增 `main/ipc/window.js`，迁移 `window:set-mode`、`window:begin-collapse`、`window:set-collapsed-hover`、`window:metrics`、`window:keep-open`、`window:set-tab` 和 `shortcut:hover-space-status`
- 所有窗口 IPC 统一验证主窗口 sender；实际 BrowserWindow、几何、模式和快捷键状态通过依赖注入保留在主进程装配层
- 新增 `tests/window-ipc.test.js`
- `main.js` 当前约 2969 行，直接 `ipcMain` 注册降至窗口/窗口扫描等剩余领域

### 已完成：当前窗口 IPC 注册拆分

- 新增 `main/ipc/windows.js`，迁移 `windows:list` 和 `windows:focus`
- 窗口扫描、macOS JXA、图标缓存和最近扫描窗口 ID 仍由主进程领域代码管理；IPC 注册仅负责委托
- 新增 `tests/windows-ipc.test.js`
- 新增 `main/ipc/task-notification.js`，迁移待办提醒、番茄钟、通知历史、hover、dismissed 和激活 IPC
- 新增 `tests/task-notification-ipc.test.js`
- 新增 `main/ipc/launcher.js`，迁移 launcher 的 14 个 IPC 通道；service、扩展数据、图标缓存、动作执行和 sender 校验均通过依赖注入
- 新增 `tests/launcher-ipc.test.js`
- 新增 `renderer/app-shell.js`，迁移工作区快照同步、恢复和全局 Toast；新增 `renderer/todo-data.js`，迁移待办 LocalStorage 规范化和提醒同步
- 新增 `renderer/workspace-commands.js`，迁移常用指令列表、批量选择、编辑、复制和删除逻辑；workspace 主 IIFE 不再持有指令状态
- 新增 `renderer/dock-effects.js`，迁移当前窗口 Dock 悬浮缩放与回位动效；`app.js` 不再持有无状态视觉动效实现
- 新增 `renderer/clipboard-domain.js`，迁移剪贴板日期键、日期/相对时间格式化和按日分组；剪贴板 UI 通过 `NotchClipboardDomain` 调用纯数据逻辑
- 新增 `renderer/workspace-windows.js`，迁移当前窗口枚举、聚焦、隐藏窗口存储、长按拖出隐藏、权限提示和轮询；`workspace.js` 通过 `NotchWorkspaceWindows` 保持兼容接口
- 新增 `renderer/workspace-credentials.js`，迁移本机密钥库的加载、保存、编辑、复制、删除和选择状态；`workspace.js` 不再持有密钥库私有状态
- 新增 `renderer/panel-controller.js`，迁移 `NotchPanel` 公共导航控制器；`app.js` 仅通过 `NotchPanelHost` 注入内部模式、Tab 和目标校验能力
- `scripts/test-desktop.js` 已将新增 renderer 模块纳入语法检查
- `main.js` 当前约 2840 行，直接 `ipcMain` 注册仅剩待办提醒控制器边界
- 完整 `npm test` 当前为 321 项：320 通过，1 项按平台跳过；面板、保留工作区、startup 和 capture 四个 Electron 验收全部通过
