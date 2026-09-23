# Dynamic Panel

一个常驻 macOS 屏幕顶部的本地工作台。默认折叠成物理刘海大小，点击从顶部展开，包含**首页 / 待办 / 笔记 / 链接 / 录制 / 密钥**等页面；剪贴板默认关闭、可从菜单栏「显示功能」启用；还可接收 Codex / Claude Code / GPT 的本机完成事件并关联当前窗口。

项目由默认本地优先的 Electron 桌面端和可选的 Node.js 自托管同步服务组成：折叠态、展开工作区、任务完成提醒与 Hover + Space 唤出都在 Electron 主进程和渲染层内实现，`npm start` 仍是唯一桌面运行路径；`sync-server/` 独立部署，不改变离线桌面行为。

> **文档准绳**：产品行为以 [README.md](README.md) 为唯一事实来源。本文与 README 冲突时以 README 为准。

## 技术栈

- 桌面端：Electron 44 + 原生 HTML/CSS/JavaScript，无渲染层构建步骤
- 官网：React 19 + Vinext + 原生 CSS，位于 `website/`
- 数据：默认 LocalStorage + `userData/clipboard-images/` + `userData/note-images/` + `userData/recordings/`；可选自托管同步使用 PostgreSQL + 文件系统/S3 对象存储，禁止同步项仍只留本机
- 同步服务：Node.js 22.13+ + Fastify + PostgreSQL，位于 `sync-server/`
- 包管理器：npm
- Node：桌面端使用 Node 18+；官网和同步服务要求 Node 22.13.0+

## 命令

- 桌面开发：`npm install && npm start`
- 桌面检查：`npm test`
- 桌面打包：`npm run build`（只在用户明确确认后执行）
- 官网开发：`cd website && npm install && npm run dev`
- 官网检查：`cd website && npm run lint && npm run build`

## 目录结构

```text
.
├── main.js                 # Electron 主进程：窗口、定位、菜单栏、剪贴板、媒体与通知服务
├── main-services.js        # 可单测的纯领域服务（无 Electron 依赖）
├── preload.js              # contextBridge 安全桥接
├── renderer/               # 桌面界面与交互（index.html / styles.css / app.js / workspace.js / notification.*）
├── build/                  # DMG 打包钩子、entitlements 与应用图标
├── scripts/                # Codex 与 Claude Code 的通知转发脚本
├── sync-server/            # 可选自托管同步服务、Web 控制台、管理 CLI、迁移与备份
├── tests/                  # Node 单元测试
├── docs/                   # 设计说明、ADR 与验收图
├── website/                # 官网 React/Vinext 源码
└── package.json
```

## 当前产品约束

- 双平台：macOS 13+ arm64 与 Windows 10/11 x64 共用代码及版本。Windows 使用 `npm run build:win` 生成 NSIS EXE；发布必须两个平台检查通过后汇总至同一 Release。
- Windows：折叠态为 200 × 38 DIP，贴工作区顶部居中并避开任务栏；隐藏当前窗口和已退役的汽水音乐组件，但不修改用户保存的显隐偏好；剪贴板只复制，提醒点击关闭。
- 便携媒体路径：LocalStorage / workspace.json 中新写入的录音、剪贴板图片与笔记图片使用 `/` 分隔的相对路径，系统加密密钥不保证跨电脑迁移。

- 折叠态：宽 200px，高度等于当前屏幕菜单栏高度，不得超出物理刘海
- 展开态：各页内容区统一 `1240 × 540`；窗口总高为 `76 + 540`，窄屏与矮屏保留 24px 安全距
- 待办：2 × 2 布局，一次回车新增，颜色为红 / 橙 / 绿 / 蓝。内部存储键仍是 `P0`–`P3`（`notch-todo-data` 结构不可变更），但界面显示名默认「学习与课程 / 内容与创作 / 产品与开发 / 生活与事务」且用户可改名（存 `notch-todo-category-names-v1`）；顶部以「今天 / 本周 / 以后 / 全部」从 `deadline` 自动派生互斥时间范围，逾期归入今天并置顶，完成项折叠。今天默认当天 23:30（过点后使用当天剩余时间），本周有剩余日期时默认明天 23:30，以后默认下周一 23:30；到期前一小时提醒
- 剪贴板：默认关闭（`DEFAULT_FEATURES.clip = false`），可在菜单栏「显示功能」中启用。历史记录由主进程轮询采集，不再占用任何全局快捷键（见 `clipboardServicePolicy`）
- 链接：只允许公开 http/https；主进程抓取标题时必须阻止本机、内网与不安全重定向
- 录制：音频写入 `userData/recordings/`，转写与元数据保存在 LocalStorage；可选百炼 Qwen3-ASR 实时转写，API Key 必须经 `safeStorage` 加密或环境变量读取
- AI 对话：默认仅使用当前窗口内存；每条消息可显式选择最多 3 份笔记、录音、待办、链接或文字剪贴板资料，发送后冻结快照并显示来源。不得自动附加工作区内容或图片剪贴板；问题、资料和成功历史合计不超过 12,000 UTF-16 code units。用户确认后可将会话保存到当前工作区的 `notch-ai-chat-sessions-v1`，保存内容包含资料文字快照但不得包含附件、图片、音频、API Key 或本地绝对路径；最多 30 个会话、单会话 512,000 字符、总计 2,000,000 字符，超限不得静默淘汰旧会话。长回答工作台只接收完整成功回复；待办提取不得自动截断超过 12,000 字符的全文，必须由用户显式选择合规范围
- 音乐：首页使用应用内 `<audio>` 播放器，不调用系统媒体会话；`userData/music-library.json` 使用兼容迁移的 schema v2 保存本地/网络曲目、当前来源/歌单及 go-music-dl 来源缓存。首页和设置页可切换来源与歌单，上一首、下一首和自动续播只能使用当前歌单队列。go-music-dl 还提供平台在线歌单的分类、推荐、搜索和详情浏览，在线结果只作为当前浏览/播放缓存，不写入“我的歌单”。本地来源仅经文件或文件夹选择器导入；文件夹递归扫描必须忽略符号链接并保持目录项、深度和曲目数上限。网络直链仅允许经主进程校验和有界下载的公开 HTTPS 音频；go-music-dl 仅允许无凭据的回环 HTTP 地址，固定连接本机并限制来源、歌单、曲目、JSON 和音频大小
- 当前窗口：通过 macOS 辅助功能枚举和聚焦，使用系统应用图标；同应用多窗口编号；隐藏项保存在 LocalStorage；聚焦 IPC 只接受最近扫描缓存中的窗口 ID
- 笔记：独立笔记页可直接新建、搜索、重命名、自动保存、Markdown 编辑/预览和删除；图片支持粘贴、拖入与文件选择，统一转为 PNG 写入 `workspace/note-images/<noteId>/`，正文只保存 `/` 分隔的相对引用。单图原始输入不超过 20 MB、最长边压到 2400px；删除笔记时删除其专属附件目录
- 启动器：复用主窗口 launcher 模式，默认 Alt/Option+Space，可在顶栏搜索或设置中进入；收藏/别名/usage 使用 `notch-launcher-*-v1`，原有数据结构保持不变。扩展安装、启用与快捷键仅本机保存；进程扩展启用 Node 文件权限，仅直接读自身代码、读写专属 storagePath，禁止子进程/原生插件/Worker；网络无系统级隔离，仍只安装可信代码，不称为 OS 沙箱。专属数据可逐个导出/导入，代码与授权不得自动迁移。跨应用焦点适配位于 `launcher/focus.js`，使用 koffi 调用本机 API。运行代码在 `launcher/`、界面在 `renderer/launcher.js`，详见 `docs/launcher-extension-development.md`。
- 动效：窗口边界变更不使用系统动画；视觉动效由渲染层完成，并支持 `prefers-reduced-motion`
- 通知：独立 `400 × 96` 无焦点窗口；HTTP 只监听 `127.0.0.1:43821` 的 `/notify/<source>`，来源白名单 `codex` / `claude` / `gpt`；Codex 与 Claude Code 分别由 `scripts/codex-notify.js`、`scripts/claude-notify.js` 转发，子代理结束与云端会话不弹提醒

## 代码规范

- 主进程文件 camelCase，常量大写下划线
- 渲染逻辑放在 `renderer/`，与主进程隔离
- IPC 必须通过 `preload.js` 的 contextBridge 暴露
- 视觉取值集中在 CSS 自定义属性中

## GitHub 推送与发布联动

- 任何产品更新推送到 GitHub 前，必须联动检查版本号、`CHANGELOG.md`、README 当前稳定版本与下载入口、GitHub Pages 下载按钮。
- 正式发布必须保证 `package.json` 与 `package-lock.json` 版本一致，推送匹配的 `v*.*.*` 标签，并在 GitHub Actions 完成后验证 Release 的 DMG / SHA-256 资产与 Pages 实际下载指向。
- 官网下载按钮分别从 GitHub `releases/latest` 动态解析当前版本的 `arm64.dmg` 与 `windows-x64-setup.exe`，不得留下过期固定链接或跨平台误下载。验证两个安装包及各自 SHA-256。

## NEVER

- NEVER 在渲染进程直接 `require('electron')`
- NEVER 让窗口可被拖出刘海位置；显示与模式切换必须贴顶居中
- NEVER 在用户未主动点击时启动麦克风；结束录音或退出应用时必须释放音频 track
- NEVER 把剪贴板图片 dataURL 存入 LocalStorage
- NEVER 提交 `node_modules` 或 `dist`
- NEVER 在没有用户确认时打包或发布桌面应用

## 压缩指令

执行 `/compact` 时必须保留：

- 当前窗口行为与样式细节
- LocalStorage 数据结构
- 已知 macOS、多屏与菜单栏适配问题
