# Implementation Plan

## Phase 1: Foundation

目标：建立不会影响现有工作台的 launcher 状态、结果模型和测试边界。

### TASK-001: 建立 launcher 领域模型

- Goal：定义 `LauncherResult`、来源、动作、权限、排序和状态的纯函数。
- Inputs：`02-requirements.md`、现有 `renderer/domain.js` 和 LocalStorage 结构。
- Files/areas：新增 `launcher/domain.js`、必要时扩展 `renderer/domain.js`、`tests/launcher-domain.test.js`。
- Steps：实现文本标准化、标题/别名/关键词匹配、精确/前缀/模糊排序、稳定选择回退和 usage 衰减。
- Acceptance criteria：同一 query 下排序稳定；精确别名优先；重复结果去重；不修改原始工作区对象。
- Suggested owner：Implementation Agent。
- Dependencies：无。
- Parallel：适合与 TASK-002、TASK-003 并行。

### TASK-002: 设计新增存储与迁移

- Goal：定义 launcher 设置、收藏、别名、usage、扩展 registry 的数据键和工作区快照规则。
- Inputs：现有 workspace persistence 和 `05-technical-design.md`。
- Files/areas：`renderer/workspace.js`、`main.js`、测试及文档。
- Steps：增加 schemaVersion、大小上限、损坏回退、工作区迁移和旧键只读映射。
- Acceptance criteria：旧工作区可读；新键缺失使用默认值；`notch-home-commands` 仍只生成复制结果。
- Suggested owner：Technical Lead/Implementation Agent。
- Dependencies：TASK-001 的结果模型命名。
- Parallel：适合与 TASK-003 并行。

### TASK-003: 定义扩展 manifest/result/protocol 校验

- Goal：让扩展输入在进入运行时前可验证、可限制。
- Inputs：Raycast manifest/Alfred JSON 研究、需求 FR-025 至 FR-035。
- Files/areas：新增 `launcher/extension-schema.js`、`tests/extension-schema.test.js`。
- Steps：实现 manifest、命令、权限、结果、动作和 JSON Lines 行的长度/字段校验。
- Acceptance criteria：非法 ID、绝对入口、未知权限、超长字段、路径穿越和未知 action 均拒绝。
- Suggested owner：Security/Technical Lead。
- Dependencies：TASK-001。
- Parallel：适合并行。

## Phase 2: Core Product

目标：完成内置统一搜索和启动器交互闭环。

### TASK-004: 建立内置来源提供器

- Goal：把应用、笔记、待办、链接和旧常用指令转换为统一结果。
- Inputs：现有 `renderer/app.js`、`renderer/workspace.js`、平台限制。
- Files/areas：新增 `launcher/providers.js`、`platform.js`、主进程应用发现、测试。
- Steps：读取可公开的工作区快照；应用由平台适配器扫描；建立 source/kind/target 映射；复用安全打开动作。
- Acceptance criteria：两个平台生成一致结果模型；不存在资源有可解释状态；旧指令只提供 copy-text。
- Suggested owner：Implementation Agent。
- Dependencies：TASK-001、TASK-002。
- Parallel：应用扫描和工作区 provider 可拆分。

### TASK-005: 实现 launcher UI 和键盘状态机

- Goal：完成搜索框、结果列表、焦点、空状态、错误状态和动作面板入口。
- Inputs：`03-interface-map.md`、`04-ui-design.md`。
- Files/areas：`renderer/index.html`、新增 `renderer/launcher.js`、`renderer/styles.css`。
- Steps：加入 launcher root；实现 query debounce、结果更新、键盘导航、Enter、Escape、Cmd/Ctrl+K 和 aria 语义。
- Acceptance criteria：快捷键后搜索框自动 focus；仅键盘可完成主路径；长文本无溢出；reduced motion 可用。
- Suggested owner：UI Agent/Implementation Agent。
- Dependencies：TASK-001、TASK-004。
- Parallel：UI 可先使用 mock provider。

### TASK-006: 接入全局快捷键和窗口模式

- Goal：将 launcher 与当前 Electron 窗口状态机安全接通。
- Inputs：现有 `main.js` 快捷键、Windows shape 和多屏逻辑。
- Files/areas：`main.js`、`preload.js`、`renderer/app.js`、`platform.js`。
- Steps：新增独立快捷键注册/回退；打开时定位并扩大 launcher 输入区域；关闭时恢复原 mode；处理失焦和正在执行状态。
- Acceptance criteria：不覆盖旧工作台快捷键；快捷键占用有提示；Windows 透明区域不吞底层点击；跨屏打开固定目标屏。
- Suggested owner：Electron Implementation Agent。
- Dependencies：TASK-005。
- Parallel：不建议与另一个窗口状态任务并行。

### TASK-007: 实现动作网关

- Goal：让结果的主动作和动作面板动作通过主进程安全执行。
- Inputs：现有 shell、clipboard、workspace IPC。
- Files/areas：`main.js`、`preload.js`、`renderer/launcher.js`、测试。
- Steps：实现 open-app/open-path/open-url/copy-text/navigate-workspace 等 allowlist 动作；增加确认等级和错误码。
- Acceptance criteria：renderer 不能传任意 IPC；非法目标拒绝；成功执行写 usage；失败不提升排名。
- Suggested owner：Security/Implementation Agent。
- Dependencies：TASK-004、TASK-006。

## Phase 3: Extension Runtime And Workflow Completion

目标：加入本地扩展安装、发现、独立进程查询和动作执行。

### TASK-008: 实现扩展安装与 registry

- Goal：支持本地目录安装、校验、启用/禁用、卸载和受控数据目录。
- Inputs：manifest schema、安全要求、设置 UI。
- Files/areas：`main.js`、新增 `launcher/extension-registry.js`、`renderer/workspace.js`、设置 DOM/CSS、测试。
- Steps：选择目录；读取 manifest；拒绝 symlink/路径穿越；复制或登记受控目录；保存 registry；卸载前停止进程。
- Acceptance criteria：安装审查显示 manifest/权限；无效包拒绝；启用状态实时生效；卸载清理可控数据。
- Suggested owner：Implementation Agent。
- Dependencies：TASK-003、TASK-002。

### TASK-009: 实现独立扩展 host

- Goal：使用 utility process 或受控子进程执行 process 扩展。
- Inputs：协议定义、Electron 44 API、超时和输出限制。
- Files/areas：新增 `launcher/extension-host.js`、`main.js`、`tests/extension-host.test.js`、样例扩展。
- Steps：按扩展懒启动；发送 query/execute/cancel；解析 JSON Lines；限制并发/输出；超时终止；报告状态。
- Acceptance criteria：样例扩展可查询/执行；崩溃、超时、非法 JSON 只影响自身；旧响应不会覆盖新结果。
- Suggested owner：Electron/Technical Implementation Agent。
- Dependencies：TASK-003、TASK-008。
- Parallel：协议纯函数可先行，真实 Electron host 需串行集成。

### TASK-010: 加入扩展结果和扩展管理 UI

- Goal：在 Root Search 中显示扩展命令，并在设置中管理扩展。
- Inputs：`03-interface-map.md`、`04-ui-design.md`、TASK-008/009。
- Files/areas：`renderer/launcher.js`、`renderer/index.html`、`renderer/styles.css`、`renderer/workspace.js`。
- Steps：合并异步扩展结果；显示权限/来源；实现安装审查、启用/禁用、错误状态和诊断复制。
- Acceptance criteria：扩展无结果时不破坏内置结果；局部 loading；权限和错误清楚；安装确认可键盘完成。
- Suggested owner：UI/Implementation Agent。
- Dependencies：TASK-005、TASK-008、TASK-009。

### TASK-011: 制作样例扩展和开发说明

- Goal：让扩展作者能从样例理解 manifest、查询和动作。
- Inputs：protocol、manifest、安全说明。
- Files/areas：`scripts/sample-launcher-extension.js`、`docs/launcher-extension-development.md`、package/mise 命令（如需要）。
- Steps：实现静态/动态两个命令；记录安装、调试、日志和权限；加入本地开发循环。
- Acceptance criteria：全新用户按文档可在 3 分钟内安装样例并运行。
- Suggested owner：Documentation/Implementation Agent。
- Dependencies：TASK-009。

## Phase 4: Quality, Testing, And Release

### TASK-012: 完成 Electron 主路径测试

- Goal：覆盖从快捷键唤出到动作执行的真实窗口流程。
- Inputs：所有 MVP acceptance criteria。
- Files/areas：新增 `tests/launcher.electron.js`，更新 `scripts/test-desktop.js`。
- Steps：测试 focus、搜索、键盘导航、动作面板、失焦关闭、内置结果、扩展查询和错误回收。
- Acceptance criteria：macOS 开发环境通过；Windows runner 的平台场景通过；现有测试无回归。
- Suggested owner：QA Agent。
- Dependencies：TASK-006、TASK-007、TASK-010。

### TASK-013: 安全和迁移回归

- Goal：证明扩展输入和旧工作区数据边界可靠。
- Inputs：安全风险和迁移规则。
- Files/areas：tests、`main-services.js`、工作区迁移代码。
- Steps：覆盖 zip/目录穿越、symlink、协议注入、输出洪泛、未知权限、损坏 LocalStorage、旧命令映射。
- Acceptance criteria：所有非法输入被拒绝或隔离；旧数据保留；无敏感信息进入日志。
- Suggested owner：Security/QA Agent。
- Dependencies：TASK-003、TASK-008、TASK-009。

### TASK-014: 文档、性能和发布检查

- Goal：完成用户说明、开发文档、性能基线和发布前审查。
- Inputs：实现结果和测试报告。
- Files/areas：README、AGENTS、CHANGELOG、docs、mise/npm scripts。
- Steps：记录启动器设置和扩展警告；测量首屏输入延迟、内置查询和扩展超时；确认打包文件列表；更新验收报告。
- Acceptance criteria：文档与行为一致；`npm test` 通过；未经明确确认不运行桌面打包。
- Suggested owner：Project Manager/QA Agent。
- Dependencies：TASK-012、TASK-013。

## Backlog

- 在线扩展目录、签名、审核、更新和回滚。
- 全盘文件索引和最近打开文件。
- Calculator、网页搜索、剪贴板、emoji 和系统动作 provider。
- 参数化命令和多页扩展 UI。
- secure storage API、网络权限代理和更强 OS sandbox。
- 扩展作者 CLI、TypeScript SDK 和模板生成器。
- 结果 ranking 的更完整 frecency 模型和跨设备同步。

## Dependencies

- TASK-001/003 的统一模型和 schema 是后续所有任务的基础。
- TASK-006 必须在现有窗口状态机上集成，不能独立复制一套窗口逻辑。
- TASK-009 需要先在 Electron 44 的 macOS/Windows 目标环境验证 utility process 打包行为。
- TASK-012/013 完成前不得宣称 MVP 可发布。

## Risks

- 独立进程并不自动等于完整沙箱，产品文案必须准确表达信任边界。
- 应用索引和扩展查询同时进入搜索时，旧响应竞争可能造成选择跳动；request ID 和稳定 result ID 是必需的。
- 全局快捷键与输入法冲突无法由应用完全解决，需要可见配置和失败回退。
- 现有工作区数据结构较多，索引 provider 必须只读派生，避免迁移副作用。
