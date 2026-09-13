<div align="center">
  <img src="build/to-do-panel-icon.png" width="112" alt="TO-DO Panel 图标" />
  <h1>TO-DO Panel</h1>
  <p><strong>Mac 与 Windows 的贴顶工作台。</strong></p>
  <p>待办、随笔记、链接、录音与本机 AI 提醒，始终贴顶待命。</p>
  <p>
    <a href="https://github.com/xiaopu-ai/TO-DO-Panel/releases/latest"><strong>下载 macOS 版</strong></a>
    ·
    <a href="https://github.com/xiaopu-ai/TO-DO-Panel/releases/latest"><strong>下载 Windows 版</strong></a>
    ·
    <a href="#从源码运行">从源码运行</a>
    ·
    <a href="#更新日志">更新日志</a>
    ·
    <a href="https://github.com/xiaopu-ai/TO-DO-Panel/issues">反馈问题</a>
  </p>
  <p>
    <img alt="Release" src="https://img.shields.io/github/v/release/xiaopu-ai/TO-DO-Panel?style=flat-square&color=7c8cff" />
    <img alt="macOS 13+ Apple Silicon" src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?style=flat-square&logo=apple" />
    <img alt="Windows 10/11 x64" src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4?style=flat-square" />
    <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-35c58b?style=flat-square" />
    <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron" />
  </p>
</div>

![TO-DO Panel 首页](docs/screenshots/home.png)

![TO-DO Panel 待办](docs/screenshots/todo.png)

## 它是什么

TO-DO Panel 是一个常驻 macOS / Windows 屏幕顶部的本地工作台。Mac 默认折叠成物理刘海大小；Windows 显示为贴顶的紧凑悬浮条，常态为 160 × 8 逻辑像素，鼠标移入时平滑增至 184 × 30，移出后自动恢复；原生输入区域只跟随当前可见岛体，周围透明画布不会拦截下方窗口，并避开顶部任务栏。连接多块屏幕时，折叠条会跟随鼠标当前所在屏并保持顶部居中；展开后固定在该屏，避免操作期间跳动。点击后从顶部展开。

| 页面 | 解决什么问题 |
| --- | --- |
| **首页** | 今日重点、继续工作、快速收集、城市天气、应用内音乐播放器和 AI 对话 |
| **待办** | 「学习与课程 / 内容与创作 / 产品与开发 / 生活与事务」四个可改名的责任领域，配合「今天 / 本周 / 以后 / 全部」智能时间视图；逾期任务置顶、完成项折叠，并在到期前一小时提醒 |
| **笔记** | 独立新建、自动保存、全文搜索，以及“分类 → 标签”两级整理；支持 Markdown 编辑与预览，以及粘贴、拖入或选择本地图片，附件随工作区保存 |
| **链接** | 保存公开网址，后台补全标题、图标和分组 |
| **录制** | 录音开始即创建实时记录，同步显示状态与转写，并可在页内配置 API |
| **密钥** | 使用系统安全存储加密账号、密码和 API Key |
| **设置** | 当菜单栏图标被刘海遮挡时，仍可在面板内配置 API、功能显示、默认展开页、快捷键、数据目录与开机启动 |

笔记页在宽窗口使用“分类与标签树 / 笔记列表 / 编辑器”三栏工作区：分类可折叠展开标签，行内管理动作只在悬停或键盘聚焦时出现；窄窗口会将分类树与笔记列表放在左侧上下分区，编辑器保持独立可用。分类、标签和全文搜索共同决定列表结果。

剪贴板历史默认关闭，可从菜单栏或面板「设置」的「显示功能」中按需启用；记录按本地日期组织为时间线，并可按文字、图片或收藏筛选。菜单栏入口与设置页读写同一份本机配置；即使状态栏图标过多、被物理刘海遮挡，也不影响调整。Codex、Claude Code 与 GPT 的本机完成事件也可以直接显示为不抢焦点的顶部提醒。

首页默认使用个人工作台：今日重点展示最多 3 条今天到期或逾期的未完成任务，继续工作展示最近编辑的 5 篇笔记，快速收集保存为独立笔记。天气需手动搜索并选择城市，不自动定位；首页显示当前天气、体感、未来 6 小时最高降雨概率、湿度和风，详情提供未来 12 小时与 7 天预报；使用 Open-Meteo 免费非商业接口，显示来源，15 分钟内复用缓存，失败时标记旧缓存。商业分发前须配置符合服务条款的接口。音乐由应用内播放器负责，不依赖系统媒体会话。设置页可选择一个或多个本地 MP3、M4A、AAC、WAV、OGG、Opus、FLAC 或 WebM，也可递归导入音乐文件夹，或保存公开 HTTPS 音频直链；首页提供来源、曲目、只读进度、上一首、播放/暂停和下一首，设置页可调整并记忆音量。文件夹导入忽略符号链接，最多扫描 10,000 个目录项和 20 层子目录；网络音频由主进程校验公网地址并限制为 128 MB 后加载，不支持需要登录的音乐平台页面或无限广播流。

首页 AI 对话复用「设置 → AI 与转写」中的默认内容模型；只在主动发送时调用，支持停止、清空、复制和最多最近 6 轮上下文，总输入仍限制 12,000 字符。对话仅保存在当前窗口内存，不自动读取工作区、联网搜索或执行操作，也不会自动保存到笔记。

旧版首页组件和「首页组件」设置入口已移除。升级不会主动清理原有速记、排列、尺寸或显隐偏好数据。

面板默认每次从首页展开。可在「设置 → 本机与唤出 → 默认展开页」改为任意当前可见的 Tab；若后续隐藏了被选中的功能，下次展开会自动回退到首页。

## 启动器（开发中，尚未发布）

通过面板顶栏「搜索」、设置中的「启动器设置」，或默认 Cmd+Space / Ctrl+Space 唤出。搜索本机应用、笔记、待办、链接和常用指令；方向键选择、Enter 执行，Cmd/Ctrl+K 打开动作面板。结果按收藏、最近使用和来源分组，应用显示系统图标；支持右键动作、唯一别名和在设置中集中移除收藏/别名记录。临时路径、直接输入的网址和动态扩展结果仅支持即时操作，不提供收藏或别名；需要长期保存的网址可先添加到链接页。旧常用指令仍然只复制文本。剪贴板文字搜索需要同时启用剪贴板功能与启动器对应来源。

搜索栏右侧 `.*` 按钮或 `Alt/Option+R` 切换正则模式：默认忽略大小写，支持 `^Code|笔记$` 或 `/^Code$/i`（标志 `i/m/s/u`）。正则最多 512 字符，在独立 Worker 中匹配，超过 500ms 会终止并提示；正则查询不会发送给动态扩展；选择扩展命令入口后会自动退出正则模式，进入该命令的普通查询。

选中应用后，`Enter` 普通打开；Windows `Ctrl+Shift+Enter` 以管理员身份运行（保留系统 UAC 确认），`Ctrl/Cmd+Enter` 请求新窗口，`Alt/Option+Enter` 切换已打开窗口。这些动作也在右键／动作菜单中。Windows 常见浏览器、编辑器及 Word/Excel 会附加新窗口参数，其他单实例应用可能复用原窗口；切换动作找不到匹配窗口时只提示，不额外启动。macOS 提供新实例和已有应用切换，没有通用 GUI 管理员启动入口。

「设置 → 搜索与启动器」统一管理全局快捷键、搜索来源、收藏/别名、本地扩展及数据导入导出。搜索页的「管理」按钮直接跳转到这一设置分类，不再打开独立配置页。可在其中更换或禁用全局快捷键、安装本地扩展目录、启用/禁用和卸载扩展。系统已占用默认快捷键时，请从界面入口设置其他组合。扩展支持声明式命令和 JSON Lines 进程协议，普通查询不会广播给进程扩展，需输入命令名称加空格进入。

进程扩展启用 Node 文件权限：只能直接读取自身代码并读写专属数据目录，不能直接读写工作区，不能派生进程、加载原生插件或创建 Worker。这不等于完整 OS 沙箱，网络仍无系统级隔离；只安装信任的扩展。安装前会展示作者、命令和声明权限。安装包、权限确认和快捷键配置仅在本机保存，迁移工作区不会自动安装扩展；收藏、别名和使用记录随工作区保留。详见 [扩展开发与样例](docs/launcher-extension-development.md)。输入本机绝对路径可打开目录及白名单中的文档、图片、音视频和文本数据文件；未知类型、网络/设备路径及脚本、可执行文件不走此入口，启动应用请使用应用搜索。扩展管理展示入口、最近运行时间和最近 20 条运行诊断；查询默认等待 800ms，可调整为 300–5000ms；执行默认 5000ms，可调整为 500–10000ms。声明写文件或 Shell 权限的动作执行前需确认。管理页可分别导出／导入扩展专属数据，导入会确认替换，不导入代码或授权。开关动效复用共享动效参数并支持系统“减少动态效果”。通过快捷键打开后，取消启动器会尝试恢复此前应用焦点；用户已切换到其他应用或已执行打开动作时不会抢回焦点。首版暂不提供商店、zip 导入、全盘搜索或完整 Windows MSIX 应用索引。

## AI 整理（开发中，尚未发布）

启动器提供「摘要文字 / 精简文字 / 翻译文字 / 从文字提取待办」，待办页可直接从文字生成候选，笔记和录音详情也提供就地整理入口。笔记、录音和链接还可手动生成名称或分类；内容先进入统一预览，用户检查、编辑后再复制、采用名称、另存笔记或加入待办。文本动作支持服务端 SSE 增量显示；普通搜索、打开页面和录音保存不会自动触发这些新整理请求。

待办候选必须包含可验证的原文摘录，并在用户补齐责任领域和未来截止时间后才能保存；可按现有规则选择今天、本周或以后的默认截止时间，相似已有任务和同批候选会先提示。一次批量写入原有 `notch-todo-data`，重复点击不会重复添加；本次会话内可以撤销，已被用户继续修改的项目会保留。笔记选区的精简或翻译也可撤销，原文变化时不会强行覆盖。

「设置 → AI 与转写」直接使用左侧服务/厂商列表和右侧配置区，不再打开二级对话框。实时转写继续使用阿里云百炼 Qwen3-ASR；内容整理可选择 DeepSeek、OpenAI、阿里云百炼、Kimi、智谱 GLM、SiliconFlow、Gemini、OpenRouter、Azure OpenAI、Anthropic 或自定义 OpenAI-compatible 服务。每个内容厂商可保存最多 12 个自由输入的模型并指定一个默认模型，界面提供随版本更新的推荐值；Anthropic 使用独立 Messages 协议，其余内容厂商按各自预设接入兼容协议。各厂商分别保留端点、超时、加密密钥、模型列表和逐模型验证状态，切换回来无需重复配置；已保存 Key 不会回显，首次配置或密钥失效时才需输入。

内容服务保留请求超时、文本与结构化能力验证、最近 50 条脱敏请求诊断，以及笔记、录音、链接三个独立自动命名开关。旧百炼与单模型内容配置会幂等迁移到版本 3，原模型成为对应厂商的默认模型，并保留原端点、加密密钥及环境变量行为。新整理单次最多处理 12000 字符；Key 不会进入工作区或渲染页面，但所选文字会发送到用户配置的服务商。录音音频仍先保存在本机，整理请求只发送已保存的转写文字。

## 下载与安装

> 当前稳定版本：**1.1.0** · **macOS 13.0+ Apple Silicon** / **Windows 10/11 x64（Intel / AMD 64 位）**

| 平台 | 在上方 GitHub Releases 下载对应安装包 |
| --- | --- |
| Mac | [TO-DO-Panel-1.1.0-arm64.dmg](https://github.com/xiaopu-ai/TO-DO-Panel/releases/download/v1.1.0/TO-DO-Panel-1.1.0-arm64.dmg) |
| Windows | [TO-DO-Panel-1.1.0-windows-x64-setup.exe](https://github.com/xiaopu-ai/TO-DO-Panel/releases/download/v1.1.0/TO-DO-Panel-1.1.0-windows-x64-setup.exe) |

### macOS

1. 前往 [GitHub Releases](https://github.com/xiaopu-ai/TO-DO-Panel/releases/latest) 下载 `TO-DO-Panel-*-arm64.dmg`。
2. 打开 DMG，将 `TO-DO Panel.app` 拖入「应用程序」。
3. 首次启动若被 macOS 拦截，前往「系统设置 → 隐私与安全性」，点击「仍要打开」。
4. 再次启动，根据需要授予辅助功能、屏幕录制或麦克风权限。

项目明确采用 GitHub Releases + ad-hoc 签名分发，不进行 Apple 公证，也不上架 Mac App Store。因此首次安装需要手动确认“仍要打开”；这是当前正式分发方式，不是待修复的发布缺陷。每次重新打包后，macOS 可能要求重新授权；由 `safeStorage` 加密的密钥也可能需要重新填写。

### Windows

下载 `TO-DO-Panel-*-windows-x64-setup.exe`，运行安装向导，再从桌面或开始菜单启动。默认仅安装给当前用户，无需管理员权限，卸载保留本机工作区数据。托盘菜单可设置功能或退出，面板设置中可开启开机启动。

安装包暂无商业代码签名，可能出现 SmartScreen 提示。请核对来源与 `.sha256` 校验码，确认后通过「更多信息 → 仍要运行」安装；企业策略可能需要管理员批准。

Windows 首版暂不显示「当前窗口」和「汽水音乐」组件；剪贴板点击复制后用 Ctrl+V 粘贴，AI 完成提醒暂不支持点击切回任务窗口。平台限制不覆盖原有组件偏好。结束录音后会立即释放麦克风；系统拒绝访问设备时，请检查 Windows 隐私设置中桌面应用的麦克风权限。

Windows 版在 GitHub Windows runner 上自动验证安装、启动、数据保存、加密、快捷键、模拟音视频设备、重新安装和卸载；物理设备、Windows 10 实机及多显示器硬件尚未人工验收。普通工作区可跨平台迁移，加密密钥需在新电脑重新输入。

## 更新日志

当前稳定版本为 **v1.1.0**。正在开发但尚未发布的改动会先记录在 `[未发布]`，正式发版时再归档到对应版本，避免 README 随版本增加而持续膨胀。

完整版本历史、修复内容与未发布改动见 [CHANGELOG.md](CHANGELOG.md)。

## 设计原则

- **贴顶但不打扰**：折叠态宽 200px，高度跟随菜单栏；展开与通知都不使用系统窗口动画。
- **设备按需启用**：麦克风只有主动录音时才开启，结束录音或退出应用后立即释放。
- **数据留在本机**：待办、笔记、链接、录音元数据和工作区设置保存在本地，无后端和云同步；笔记图片保存到工作区的 `note-images/`，正文只记录可迁移的相对路径。
- **权限边界清晰**：链接元数据抓取会阻止本机、内网地址和不安全重定向；窗口聚焦只接受最近扫描缓存中的 ID。
- **可迁移工作区**：可从菜单栏选择数据文件夹，换电脑时复制该文件夹继续使用。

## 本机 AI 完成提醒

TO-DO Panel 只在 `127.0.0.1:43821` 监听通知接口，来源限 `codex`、`claude` 与 `gpt`：

```bash
curl -X POST http://127.0.0.1:43821/notify/codex \
  -H 'Content-Type: application/json' \
  -d '{"title":"任务已完成","project":"my-project","task_id":"demo"}'
```

仓库已提供 [Codex 转发脚本](scripts/codex-notify.js) 和 [Claude Code 转发脚本](scripts/claude-notify.js)。通过 DMG 安装后，脚本路径为：

```text
/Applications/TO-DO Panel.app/Contents/Resources/app/scripts/codex-notify.js
/Applications/TO-DO Panel.app/Contents/Resources/app/scripts/claude-notify.js
```

Windows 安装后的两个脚本位于安装目录的 `resources/app/scripts/` 中，可用 Node.js 调用；应用本身无需用户安装 Node.js。

## 从源码运行

桌面端要求 Node.js 22.12.0+：

```bash
git clone https://github.com/xiaopu-ai/TO-DO-Panel.git
cd TO-DO-Panel
npm install
npm test
npm start
```

项目使用单一 Electron 架构，没有渲染层构建步骤，`npm start` 是完整运行路径。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 单元测试与 JavaScript 语法检查 |
| `npm start` | 启动 Electron 开发版 |
| `npm run pack` | 生成未安装的 `.app` |
| `npm run build` | 生成 Apple Silicon DMG |
| `npm run build:win` | 生成 Windows x64 EXE 安装包（建议 Windows 环境构建） |
| `npm run build:zip` | 生成 ZIP 分发包 |

官网位于 `website/`，要求 Node.js 22.13.0+：

```bash
cd website
npm install
npm run dev
```

## 项目结构

```text
.
├── main.js                 # Electron 主进程、窗口与系统服务
├── main-services.js        # 可测试的纯领域服务
├── preload.js              # contextBridge 安全桥
├── renderer/               # 桌面界面与交互
├── tests/                  # Node 单元测试
├── build/                  # 图标、签名与 DMG 配置
├── scripts/                # Codex / Claude Code 通知转发
├── docs/                   # 设计、ADR 与发布说明
└── website/                # React 19 + Vinext 官网
```

## 开发设计文档

[AI 使用方式研究与开发计划](docs/project-factory/ai-workflows/README.md) 整理了文字提取待办、录音整理、笔记动作和后续工作区问答的调研、交互、技术边界及分阶段任务；其中核心整理闭环已经实现，真实模型质量和双平台发布验收仍单独追踪。

## 发布

推送与 `package.json` 版本一致的 `v*.*.*` 标签后，GitHub Actions 并行测试、构建并校验 macOS DMG 和 Windows EXE。两个平台全部通过后，才创建同一个 Release 并上传两个安装包及各自 SHA-256 文件。完整流程见 [发布说明](docs/releasing.md)。

## License

[MIT](LICENSE) © 2026 [xiaopu-ai](https://github.com/xiaopu-ai)
