<div align="center">
  <img src="build/to-do-panel-icon.png" width="112" alt="Dynamic Panel 图标" />
  <h1>Dynamic Panel</h1>
  <p><strong>贴在屏幕顶部的本地工作台</strong></p>
  <p>待办、笔记、链接、录制、行情与本机 AI，随时可用，数据留在本机。</p>
  <p>
    <a href="#源码构建"><strong>源码构建</strong></a>
    ·
    <a href="CHANGELOG.md">更新日志</a>
    ·
    <a href="https://github.com/Mr-ChenH/TO-DO-Panel/issues">反馈问题</a>
  </p>
  <p>
    <img alt="macOS 13+ Apple Silicon" src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?style=flat-square&logo=apple" />
    <img alt="Windows 10/11 x64" src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4?style=flat-square" />
    <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron" />
    <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-35c58b?style=flat-square" />
  </p>
</div>

![Dynamic Panel 首页](docs/screenshots/home.png)

## 目录

- [快速了解](#快速了解)
- [源码构建](#源码构建)
- [核心功能](#核心功能)
- [数据与权限](#数据与权限)
- [高级功能](#高级功能)
- [官网开发](#官网开发)
- [项目结构](#项目结构)
- [开发文档](#开发文档)

## 快速了解

Dynamic Panel 是一个常驻屏幕顶部的 Electron 工作台：

| 项目 | 说明 |
| --- | --- |
| 支持平台 | macOS 13+ Apple Silicon；Windows 10/11 x64 |
| 运行方式 | 本地桌面应用，无后端、无云同步 |
| 默认状态 | 折叠成顶部刘海/紧凑条，点击后展开工作区 |
| 数据位置 | LocalStorage、当前工作区目录和 Electron `userData` 目录 |
| 获取方式 | 本仓库不提供预编译安装包，需要克隆源码后自行运行或构建 |
| 许可证 | [MIT](LICENSE) |

macOS 折叠态贴合屏幕顶部，“小”档跟随菜单栏高度；Windows 使用宽 `160px` 的紧凑条。刘海高度可选择小、中、大或自定义，macOS 范围为 `24–64px`，Windows 为 `8–38px`；Windows 高度超过 `30px` 后不再执行鼠标悬停放大。展开工作区统一使用约 `1240 × 540` 的内容尺寸，窄屏和矮屏会保留安全边距。连接多块屏幕时，面板跟随当前屏幕并保持顶部居中。

## 源码构建

> 当前代码与原项目已经有较大差异，本仓库不提供 DMG、EXE 或其他预编译安装包。请审阅源码后在目标平台自行运行、测试和构建。

桌面端要求 Node.js 18+，使用 npm：

```bash
git clone https://github.com/Mr-ChenH/TO-DO-Panel.git
cd TO-DO-Panel
npm install
npm test
npm start
```

`npm start` 直接运行完整 Electron 应用，不需要渲染层构建步骤。需要生成本机安装包时，在对应操作系统执行：

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行单元测试、结构检查和 Electron 验收 |
| `npm start` | 启动桌面开发版 |
| `npm run pack` | 生成当前平台的未安装应用目录 |
| `npm run build` | 在 macOS 生成 Apple Silicon DMG |
| `npm run build:win` | 在 Windows 生成 x64 NSIS 安装包 |
| `npm run build:zip` | 在 macOS 生成 ZIP 包 |

构建输出位于 `dist.noindex/`。macOS 产物没有 Apple 公证，Windows 产物没有商业代码签名；系统可能显示安全提示。只运行自己审阅并构建的产物，权限按需授予。由 `safeStorage` 加密的密钥不保证能在不同电脑或重新打包的应用之间迁移。

Windows 构建不会启用 macOS 专属的「当前窗口」和「汽水音乐」组件；剪贴板点击后仅复制，需手动按 `Ctrl+V` 粘贴。

## 核心功能

| 页面 | 用途 |
| --- | --- |
| **首页** | 今日重点、最近笔记、快速收集、天气、应用内音乐和 AI 对话 |
| **待办** | 四个可改名责任领域、今天/本周/以后/全部视图、逾期置顶、完成项折叠和到期提醒 |
| **行情** | A 股、美股和加密市场总览、榜单、自选和按需 AI 快照解读；未配置数据源显示明确空态 |
| **笔记** | 自动保存、全文搜索、Markdown 编辑/预览、分类标签和本地图片附件 |
| **链接** | 保存公开网址，补全标题和图标，支持分组、标签、收藏、已读和稍后阅读 |
| **录制** | 录音、截图和录屏；截图可标注，录屏支持整屏、窗口和区域 |
| **密钥** | 使用系统安全存储保存账号、密码和 API Key |
| **设置** | 管理数据目录、功能显示、默认页、主题、刘海高度、快捷键、API 和开机启动 |

### 常用行为

- 面板默认从首页展开，可在「设置 → 通用」中更改默认页。
- 默认面板快捷键为 `Space`，启动器快捷键为 `Alt/Option + Space`。
- 截图、录屏和录音默认不占用全局快捷键，可在设置中配置或禁用。
- 剪贴板历史默认关闭，可从菜单栏或「设置 → 显示功能」开启。
- 主题支持深色和亮色，设置会立即保存；首次启动也会直接使用已保存的主题。
- 刘海高度提供「小 / 中 / 大」三档和自定义高度；macOS 自定义范围为 `24–64 px`，Windows 为 `8–38 px`，超出范围或非整数会被拒绝。
- 麦克风只在用户主动开始录音时启用，结束录音或退出应用后释放音频轨道。

> 状态说明：行情、截图录屏、启动器和 AI 整理仍在持续开发，实际可用能力以当前分支和应用内设置为准。

### 关键数据规则

- 待办内部继续使用 `P0`–`P3` 存储；界面默认显示四个责任领域名称，顶部的「今天 / 本周 / 以后 / 全部」由截止时间派生且互斥。逾期归入今天并置顶，完成项折叠，到期前一小时提醒。
- 笔记支持 Markdown 编辑/预览、自动保存、全文搜索、分类与标签；粘贴、拖入或选择的图片会压缩为 PNG，正文只保存工作区内的相对引用。
- 链接只保存公开 `http`/`https` 地址，标题、描述和图标由主进程安全补全；本机、内网和不安全重定向会被阻止。
- 剪贴板历史默认关闭；启用后由主进程轮询采集，文字、图片和收藏可以分别筛选，图片不会写入 LocalStorage。
- 首页天气需要手动搜索并选择城市，使用 Open-Meteo 免费接口并复用短时缓存；音乐由应用内 `<audio>` 播放器负责，不依赖系统媒体会话。

## 数据与权限

### 本地数据

应用不依赖后端和云同步。工作区数据、待办、笔记、链接、金融自选和会话保存在本机；录音、截图、录屏以及笔记图片保存在当前工作区或 `userData` 的专属目录中，正文只保存可迁移的相对路径。

AI 对话默认只存在当前窗口内存。只有用户确认保存后，才会写入当前工作区；保存内容包含资料文字快照，但不包含附件、图片、音频、API Key 或本地绝对路径。

### 安全边界

- 链接只允许公开 `http`/`https` 地址，主进程会阻止本机、内网和不安全重定向。
- 网络请求由主进程发起，并限制目标主机、超时、响应大小和重定向。
- 密钥只从环境变量或 Electron `safeStorage` 读取，不进入 LocalStorage 和工作区导出。
- 当前窗口聚焦只接受最近一次扫描缓存中的窗口 ID。
- 本地启动器扩展只能读自身代码、读写专属数据目录，不能派生子进程、加载原生插件或创建 Worker；这不等于完整的 OS 沙箱。

## 高级功能

<details>
<summary>行情与数据源</summary>

行情页与首页平级，渲染层只接收主进程规范化后的结果。A 股总览会显示「上证指数」基准及当前市场统计。

- 加密市场：CoinGecko 聚合数据或 Binance USDT 现货数据。
- 美股：Alpha Vantage 榜单、Alpaca IEX/SIP 快照，可选 Twelve Data 报价/搜索/历史和 SEC EDGAR 基本面。
- A 股：QuantDash API Key，以及可在设置中分别启用的腾讯、东方财富、新浪公开接口。
- 数据源失败时保留明确状态和可识别的缓存标记，不使用模拟价格或虚构指数。
- 资产搜索、自选分组、默认视图、榜单和刷新频率统一在「设置 → 金融与行情」管理。
- AI 解读只接收用户主动请求时的当前行情快照，不持久化，也不构成投资建议。

支持的环境变量包括：`COINGECKO_API_KEY`、`ALPHA_VANTAGE_API_KEY`、`ALPACA_API_KEY_ID`、`ALPACA_API_SECRET_KEY`、`TWELVE_DATA_API_KEY`、`SEC_EDGAR_CONTACT` 和 `QUANTDASH_API_KEY`。

</details>

<details>
<summary>截图、录屏与录音</summary>

打开「录制」页即可使用：

- 截图支持全屏覆盖框选、矩形、箭头、画笔、文字、马赛克、颜色、粗细和撤销/重做。
- 录屏支持整个屏幕、单个窗口和区域，默认无声，可配置麦克风、画质和 `0/3/5` 秒倒计时。
- 区域录屏会显示冻结画面和相对坐标输入，确认后用红色边框标示实际范围。
- 录音、截图和录屏互斥；锁屏、休眠或来源关闭时会停止采集，不会自动恢复。
- 截图与录屏二进制不写入 LocalStorage，分别保存到 `captures/screenshots/` 和 `captures/videos/`。

macOS 需要屏幕录制权限；麦克风只在主动使用时请求。`npm run test:capture` 使用生成画面验证采集流程，不代表真实设备权限验收。

</details>

<details>
<summary>本地启动器</summary>

启动器可搜索本机应用、笔记、待办、链接和常用指令，支持收藏、别名、最近使用记录、应用图标和动作菜单。

- `Enter`：打开选中项
- `Cmd/Ctrl + K`：打开动作面板
- `Alt/Option + Enter`：切换到已打开窗口
- `Ctrl/ Cmd + Enter`：请求新窗口
- `.*` 或 `Alt/Option + R`：切换正则搜索

启动器设置位于「设置 → 搜索与启动器」。扩展安装、启用、快捷键和专属数据只在本机保存，不会随工作区自动迁移。扩展开发说明见 [扩展开发与样例](docs/launcher-extension-development.md)。

</details>

<details>
<summary>AI 整理与对话</summary>

首页 AI 对话使用「设置 → AI 与转写」中的默认内容模型，只在用户主动发送时调用。

- 可显式选择最多 3 份笔记、录音、待办、链接或文字剪贴板资料。
- 不会自动附加工作区内容，也不会自动发送图片剪贴板。
- 支持安全 Markdown、代码复制、停止、重试、新建会话和保存为笔记。
- 单次问题、资料和历史合计不超过 12,000 个 UTF-16 code units；超大资料不会静默截断。
- 可从文字、笔记、录音和链接生成名称、分类或待办候选，用户确认后才会写入。
- 内容服务支持 DeepSeek、OpenAI、阿里云百炼、Kimi、智谱 GLM、SiliconFlow、Gemini、OpenRouter、Azure OpenAI、Anthropic 和自定义 OpenAI-compatible 服务。
- 实时转写使用阿里云百炼 Qwen3-ASR；录音音频保存在本机，整理请求只发送已保存的转写文字。

</details>

<details>
<summary>本机 AI 完成提醒</summary>

应用只监听 `127.0.0.1:43821`，来源限制为 `codex`、`claude` 和 `gpt`：

```bash
curl -X POST http://127.0.0.1:43821/notify/codex \
  -H 'Content-Type: application/json' \
  -d '{"title":"任务已完成","project":"my-project","task_id":"demo"}'
```

仓库提供 [Codex 转发脚本](scripts/codex-notify.js) 和 [Claude Code 转发脚本](scripts/claude-notify.js)。源码运行时可直接使用 `scripts/` 中的文件；自行打包后脚本位于应用的 `resources/app/scripts/`。

</details>

## 官网开发

官网位于 `website/`，要求 Node.js `22.13.0+`：

```bash
cd website
npm install
npm run dev
```

官网检查命令：

```bash
npm run lint
npm run build
```

## 项目结构

```text
.
├── main.js                 # Electron 主进程、窗口与系统服务
├── main-services.js        # 可测试的纯领域服务
├── preload.js              # contextBridge 安全桥
├── renderer/               # 桌面界面与交互
├── tests/                  # Node 单元测试和 Electron 验收
├── build/                  # 图标、签名与打包配置
├── scripts/                # Codex / Claude Code 通知转发
├── docs/                   # 设计、ADR、验收与发布说明
└── website/                # React 19 + Vinext 官网
```

## 开发文档

- [架构与边界说明](docs/architecture-audit-2026-09-18.md)
- [AI 使用方式研究与开发计划](docs/project-factory/ai-workflows/README.md)
- [金融行情扩展研究](docs/finance-extension-research.md)
- [实时数据源和全市场展示研究](docs/finance-market-data-and-display-research.md)
- [金融页 AI 解读研究](docs/finance-ai-interpretation-research.md)
- [启动器扩展开发](docs/launcher-extension-development.md)
- [完整更新日志](CHANGELOG.md)

## License

[MIT](LICENSE) © 2026 [Mr-ChenH](https://github.com/Mr-ChenH)
