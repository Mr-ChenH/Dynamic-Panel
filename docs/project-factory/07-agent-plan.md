# Agent Plan

## Roles

### Project Manager Agent

负责范围、文档一致性、阶段门禁、开放问题和最终验收报告。实现过程中维护任务状态，不直接改动无关产品代码。

### Research/Product Agent

负责竞品证据、用户故事、MVP 边界、成功指标和验收标准；发现 Raycast/Alfred/PowerToys 模型与当前项目冲突时提出决策。

### UI Agent

负责 interface map、UI design、launcher DOM/CSS、键盘可达性、reduced motion 和 Electron 场景的视觉检查。

### Technical Lead/Security Agent

负责结果 schema、扩展 manifest、IPC、路径校验、进程生命周期、权限文案和跨平台风险审查。

### Implementation Agent

负责内置 provider、launcher 状态机、动作网关和扩展 registry/host 的具体实现；每个任务只改自己的文件边界。

### QA Agent

负责纯函数、Electron 主路径、安全输入、工作区迁移、超时崩溃和平台回归测试，并维护 acceptance report。

## Agent Creation Plan

1. 规划阶段：Research/Product 与 Technical Lead 并行审阅 `01-research-notes.md` 和 `02-requirements.md`，Project Manager 汇总冲突。
2. Foundation 阶段：Domain Agent、Schema/Security Agent、Storage Agent 并行实现纯模块和单测。
3. Core Product 阶段：UI Agent 可以用 mock provider 先做界面；Electron Agent 串行接入主窗口状态和快捷键；Action Agent 接着接动作网关。
4. Extension 阶段：Registry Agent 与 Protocol Agent 可并行；真实 host 集成由一个 Electron Agent 负责，避免多个进程生命周期实现互相覆盖。
5. QA 阶段：QA Agent 先运行纯测试，再运行 Electron 场景；Technical Lead 复查安全边界；Project Manager 更新验收和后续任务。

每个代理必须读取本项目 `AGENTS.md`、相关设计文档和当前 `git status`，不得回滚其他任务的改动。实现代理需要报告修改文件、测试结果、未解决风险和是否需要人工验收。

## Worktree Strategy

- 文档和只读审查代理使用当前工作区。
- Foundation 纯模块若文件边界清晰，可以使用独立 worktree 并按任务合并。
- `main.js`、`preload.js`、`renderer/app.js`、`renderer/index.html` 和 `renderer/styles.css` 的窗口/IPC/UI 改动容易冲突，禁止多个实现代理同时编辑同一文件；按 TASK-005 → TASK-006 → TASK-007 串行。
- 扩展 host 使用独立 worktree 开发，先提交纯协议测试，再合并到主工作区做 Electron 集成。
- 不提交 `node_modules`、`dist` 或用户扩展目录；每次合并前运行 `git diff --check`。

## Communication Rules

每个代理交付时必须说明：

- 完成了哪个 TASK。
- 修改了哪些文件。
- 运行了哪些命令和结果。
- 与其他任务的接口假设。
- 已知问题、风险或需要主 Agent 决策的开放问题。

发现需求冲突时先停在任务边界并写明冲突，不要自行改变已确认的存储键、快捷键策略或安全 allowlist。任何扩展执行能力的扩大都需要 Technical Lead 复核。

## Review Gates

- Gate 1：`02-requirements.md`、`05-technical-design.md`、`06-implementation-plan.md` 完整且命名一致。
- Gate 2：结果模型、manifest schema、存储键和 IPC API 有纯函数测试。
- Gate 3：窗口模式和快捷键集成后，现有面板/Windows 点击穿透测试仍通过。
- Gate 4：样例扩展成功、超时、崩溃、非法 JSON 和取消均有真实场景覆盖。
- Gate 5：安全审查确认扩展不能任意调用宿主 IPC、绕过路径/URL 校验或把敏感数据写进日志。
- Gate 6：完整 `npm test`、语法检查和文档检查通过后，才进入用户验收；打包仍需用户明确确认。

## Merge/Integration Plan

1. 先合并文档，不改产品代码。
2. 合并 `launcher/domain.js`、schema 和 storage 纯模块及测试。
3. 合并内置 provider 和 mock 数据接口。
4. 合并 launcher UI，再由主 Agent 接入现有 Electron 窗口状态。
5. 合并动作网关和全局快捷键，运行现有全部测试。
6. 合并 registry、host、样例扩展和设置 UI。
7. 运行完整回归和安全场景，更新 `08-acceptance-report.md`。
8. 用户批准实现后，按原子任务提交 Git；未经明确授权不打包、不发布、不推送。

## Review Artifacts

- 每个阶段保留测试输出和决策记录。
- 发生关键取舍时新增 `docs/adr/` 条目，例如“扩展独立进程但不承诺完整沙箱”或“启动器复用主窗口而非第二窗口”。
- 实现结束时补充 `docs/project-factory/08-acceptance-report.md`，记录完成任务、验收标准、测试结果、已知问题和下一阶段 backlog。
