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
| `main.js` | 1760 | 主进程装配器仍混合 provider service、IPC 装配和部分平台实现；JSON 文件读写、密钥解密、响应体读取、窗口匹配与布局指标已下沉 |
| `renderer/styles.css` | 3734 | 共享 shell 和跨模块覆盖仍集中，主题、平台与多个领域基础样式已迁移 |
| `renderer/app.js` | 860 | 主 shell 装配和少量待办兼容入口仍在此处；待办数据、业务变更、交互、时间范围、AI facade 和快捷键录制已迁移 |
| `renderer/notes-controller.js` | 1148 | 笔记实体、列表、AI 和兼容 facade；editor 生命周期、分类/标签 taxonomy 已迁移 |
| `renderer/home.js` | 236 | 首页 dashboard、列表刷新和 Chat/快速收集 controller 装配；天气、音乐、资料选择、生成、快速收集、长回答工作台和会话持久化已迁移 |
| `renderer/workspace.js` | 605 | 已退化为链接/录音/设置控制器装配器，录音 UI 投影已迁移 |
| `finance-service.js` | 1031 | 领域编排与兼容 facade；provider-specific adapter、parser 和各 provider normalizer 已继续下沉 |
| `renderer/finance.js` | 1505 | overview / ranking / watchlist / settings projection 已下沉，AI / coordinator 仍集中 |
| `main/finance-provider-adapters.js` | 815 | provider 请求、测试探针、缓存和 provider 适配边界 |
| `tests/notch-focus.electron.js` | 1524 | 面板交互和大量场景验收混在一个 Electron 测试文件 |
| `tests/domain.test.js` | 652 | 录音、窗口、待办、credentials 和 notes 等多领域 renderer domain 测试仍集中 |
| `tests/domain-links-clipboard.test.js` | 175 | 剪贴板与链接纯领域测试已独立 |
| `tests/home-layout-domain.test.js` | 183 | 首页布局、widget 尺寸和网格覆盖纯契约已独立 |
| `tests/startup.electron.js` | 881 | 启动、首页、聊天、天气、音乐、设置、剪贴板和 launcher 混合 |
| `tests/finance-service.test.js` | 705 | provider 请求、缓存、service facade 和取消场景集中 |
| `tests/finance-normalizers.test.js` | 211 | finance normalizer/parser/provider-state 纯契约已独立 |

## 已关闭的高优先级问题

### 1. electron-builder 与递归语法检查

已在 electron-builder `files` 白名单中加入 `main/**/*.js`，并由 `tests/build-integrity.test.js` 验证主进程模块引用和打包完整性。`scripts/test-desktop.js` 现在会递归检查 `main/`，新增主进程模块不会绕过语法检查。

### 2. Electron 面板收起回归

当前 `notch-focus`、`retained-workspace`、`startup`、`task-notification` 和 `capture` Electron 验收均通过。最近一次完整回归为 454 项测试，453 项通过，1 项按平台跳过，0 项失败。

## 中优先级架构问题

### 4. `main.js` 仍然过大且低内聚

已完成的主进程拆分包括转录 session、财务后台刷新、各领域 IPC 注册和 finance provider 的配置/请求/adapter/normalizer 边界。当前剩余高耦合区域主要是 `main.js` 的 Electron 装配与平台生命周期；这些边界需要保留初始化顺序和窗口共享状态，不适合机械拆分：

#### AI / 转录 provider 配置

`main.js` 仍需要装配配置读取、safeStorage 解密、环境变量回退、验证 revision、诊断和 provider 探测。配置领域已迁移到：

```text
main/ai-provider-config.js
```

`main.js` 只保留 Electron 依赖注入、AI service、transcription service 和 IPC wiring。

#### 金融 provider service

`finance-service.js` 仍保留 normalizer、历史/基本面领域编排和兼容 facade。normalizer/parser 纯契约已迁移到 `tests/finance-normalizers.test.js`，共享请求缓存与 request-id 取消已迁移到：

```text
main/finance-request-cache.js
```

provider 请求与市场 fallback 已开始迁移到：

```text
main/finance-provider-adapters.js
```

当前 adapter 已承接 CoinGecko、Binance、Alpha Vantage、Alpaca/Twelve Data quote fallback、QuantDash、腾讯/东方财富/新浪公开行情、A 股 ranking、历史请求和 SEC fundamentals；finance provider 的纯 parser/normalizer 已继续迁移到独立模块。当前没有必须继续拆分的 provider helper，后续只需保持 `createFinanceService` facade、provider identity、legacy asset ID 和返回结构不变。

#### IPC 兼容层

各领域 IPC 已经位于 `main/ipc/*.js`。后续只需保持现有 channel 名称和返回结构，不再重复拆分 `main.js` 中已经完成的注册逻辑。

### 5. renderer 文件低内聚

`renderer/app.js` 已将 shell、面板公共控制器、无状态 Dock 动效、笔记控制器、剪贴板控制器、番茄钟、首页布局、待办列表/范围投影、日期编辑器、待办业务变更、时间范围控制、AI facade 和快捷键录制 controller 下沉；目前主要保留主 shell 状态与兼容入口。

`renderer/workspace.js` 已通过显式 host 注入拆出当前窗口、密钥、链接、录音生命周期、转写、AI 设置和通用应用设置；剩余主要职责是录音 UI 投影和模块装配。

财务 view projection 和 notes editor 边界已按稳定契约拆分；当前 renderer 侧剩余工作主要是 shell 兼容层维护和大型测试文件的领域化。

### 6. `renderer/styles.css` 过大（P1 已完成可行拆分）

当前约 3734 行。已将共享设计 token 迁移到 `renderer/shell.css`，将待办核心行、复选框、删除和新增输入样式迁移到 `renderer/todo.css`；二者均在 `styles.css` 前加载。主题、平台、待办日期浮层、录制资料库、剪贴板、待办四象限、待办规划器、待办列表、待办编辑器和 notes 页面基础样式仍由各自模块负责，跨模块后置覆盖继续由 `styles.css` 维护。

截图编辑器、录屏覆盖层和独立通知窗口保持深色属于产品约束，可以保留。

### 7. preload API 过大（P1 已完成兼容分组）

`preload.js` 仍保留约 150 个扁平方法以兼容现有 renderer，同时新增冻结的领域命名空间：

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

分组对象复用原 IPC 方法，不改变 channel、参数、返回结构或动态 `window.notchAPI` 解析；`tests/renderer-structure.test.js` 对分组与扁平兼容契约设有门禁。

## 已发现的功能和测试缺陷

### 8. 财务取消错误匹配过宽（已关闭）

当前 finance IPC 只接受以下两种取消信号：

```js
error?.code === 'cancelled'
error?.name === 'AbortError'
```

文本中的 `cancel` 不再作为取消依据，已有 `tests/finance-ipc.test.js` 和 request-controller 测试覆盖。

### 9. 财务 renderer 取消结果（已关闭）

`renderer/finance-request-controller.js` 统一识别 `{ ok: false, error: 'cancelled' }`，overview、ranking、quotes、history、fundamentals 和 search 不会把正常取消显示为行情错误。

### 10. 通知真实 Electron 生命周期（已关闭）

`tests/task-notification.electron.js` 已覆盖真实 HTTP `/notify/<source>`、生产 `BrowserWindow` 创建、页面投影、非焦点/置顶策略、dismiss IPC 和窗口销毁。

## 浅色主题风险与验收

工作台浅色主题已完成 Windows packaged-app 实机验收：`scripts/smoke-app.js` 在真实 unpacked/NSIS 应用中切换 `light`，遍历首页、待办、金融、笔记、链接、录音和设置页面，保存截图并检查横向无溢出。现有截图显示工作台表面、文字、输入控件和状态色均已切换到浅色体系；独立截图、录屏和通知窗口仍按产品约束保持深色。

仍保留的深色硬编码主要属于深色默认主题或独立采集窗口，不应仅凭静态颜色扫描判定为缺陷。macOS 实机视觉验收仍需在 macOS runner 上执行。

## 测试结构边界

以下文件仍然较大，但已按生命周期和兼容边界完成取舍：

- `tests/notch-focus.electron.js`
- `tests/domain.test.js`
- `tests/startup.electron.js`
- `tests/finance-service.test.js`

已按领域拆分可安全独立的 Electron/domain 契约，降低单个 UI 改动的回归范围。`tests/renderer-structure.test.js` 中的 CSS 资源所有权与加载顺序契约已迁移到 `tests/renderer-styles-structure.test.js`；原文件保留 renderer 行为、控制器、IPC 和页面结构契约。`notch-focus.electron.js` 与 `startup.electron.js` 继续作为连续 Electron 生命周期场景，不做会破坏共享窗口和 profile 状态的机械拆分。

## 建议重构顺序

1. 保持 `renderer/app.js` 和 `renderer/workspace.js` 作为稳定装配/兼容边界，避免继续机械拆分
2. finance normalizer/export 兼容边界已通过 `tests/finance-compatibility.test.js` 固化；normalizer/parser 行为已迁移到独立的 `tests/finance-normalizers.test.js`，provider 请求与 service 集成继续保留在 `tests/finance-service.test.js`。
3. 已按纯领域和契约边界拆分可安全独立的测试；`notch-focus.electron.js` 与 `startup.electron.js` 保留为连续 Electron 生命周期场景，避免拆分后丢失共享窗口、profile、LocalStorage、preload 和 debugger 状态
4. macOS DMG 实机验收（Windows NSIS 已完成；macOS 需 macOS runner）

## 当前结论

目前最高风险已从打包模块遗漏、启动顺序回归、通知窗口生命周期、浅色主题覆盖和 finance 兼容入口遗漏下降为 macOS 目标平台产物/实机验收。AI/provider 配置、金融 provider adapter、金融共享请求缓存、finance renderer request/view、provider test probe、finance normalizer/export 兼容契约、首页 Chat 生成和快速收集、notes editor、剪贴板样式、待办四象限基础样式、待办日期浮层、主题样式、平台样式、shell/todo CSS 所有权、preload 分组兼容层、通知真实 Electron 生命周期、renderer 入口资源完整性、Windows unpacked/NSIS 产物 smoke 和浅色主题真实产物 smoke 已完成。核心 Electron 启动、面板收起、工作区保留、saved AI sessions、首页音乐/资料选择/Chat 生成/快速收集/长回答工作台、金融解读和 capture 验收当前均已通过。

后续继续保持一次一个领域、独立提交和完整回归；运行时拆分、finance/renderer/domain 测试拆分、通知真实 Electron 生命周期、Windows unpacked/NSIS 安装器验收和 Windows 浅色主题实机验收已完成。`notch-focus.electron.js` 与 `startup.electron.js` 的连续生命周期边界已保留并记录，不再进行会降低验收保真度的机械拆分。剩余发布验收仅为在 macOS runner 上执行 DMG 构建、安装启动和浅色主题截图。`tests/launcher.test.js` 和 `launcher/extension-host.js` 的现有用户修改继续保持不动。

## P2 拆分进度

### 已完成：finance renderer 持久化边界

- 新增 `renderer/finance-store.js`，承接金融观察列表、资产身份归一化、偏好迁移/归一化和 LocalStorage 写入事件
- 保留 `notch-finance-watchlists-v1`、`notch-finance-view-preferences-v1`、旧市场/排序别名、fixture 行清理、`notch-workspace-mutated` 事件和原有返回结构
- `renderer/finance.js` 只通过兼容委托调用 store；动态 `window.notchAPI` 和行情请求生命周期不变
- 新增 `tests/finance-store.test.js`，覆盖资产身份、观察列表迁移、偏好归一化和持久化事件
- 定向结构/完整性测试与完整 `npm test` 已通过

### 已完成：finance renderer 纯展示域

- 新增 `renderer/finance-view-domain.js`，承接价格/报价/紧凑数字/百分比/时间格式化、状态文案、市场状态 fallback、错误文案、图表 canvas 标记和序列变化计算
- `renderer/finance.js` 保留兼容别名，行情请求生命周期、DOM 事件、AI 请求和 controller 装配不变
- 新增 `tests/finance-view-domain.test.js`，覆盖格式化边界、市场 provider fallback、图表标记和序列变化
- `renderer/finance.js` 从约 1657 行降至约 1505 行

### 已完成：finance service 公开行情 parser 边界

- 新增 `main/finance-public-parsers.js`，承接腾讯、新浪、东方财富报价与 K 线 parser
- `finance-service.js` 保留原 parser 导出和 `createFinanceService` facade；`main/finance-provider-adapters.js` 的依赖注入、错误结构和数据字段保持不变
- 新增 `tests/finance-public-parsers.test.js`，并继续通过既有 finance normalizer、compatibility、adapter 和 service 测试
- `finance-service.js` 从约 1707 行降至约 1625 行

### 已完成：finance service 市场 normalizer 边界

- 新增 `main/finance-market-normalizers.js`，承接通用数值/时间序列采样、freshness 计算，以及 CoinGecko、Binance、Alpha Vantage 和 Alpaca 的纯 normalizer
- `finance-service.js` 继续保留原 normalizer、采样函数和 `freshnessFor` 导出；provider adapter 注入、provider identity、返回字段和错误语义保持不变
- 新增 `tests/finance-market-normalizers.test.js`，并通过既有 normalizer、compatibility、adapter 和 service 回归
- `finance-service.js` 从约 1625 行降至约 1377 行

### 已完成：finance service provider normalizer 边界

- 新增 `main/finance-provider-normalizers.js`，承接 Twelve Data、SEC、QuantDash 和公开 A 股的 normalizer、响应校验、资产 ID 解析与 provider 错误映射
- `finance-service.js` 继续保留原 facade 导出；`finance-service` 到 `finance-provider-adapters` 的依赖注入、provider identity、legacy asset ID、错误码和取消行为保持不变
- 新增 `tests/finance-provider-normalizers.test.js`，并通过既有 normalizer、compatibility、adapter 和 service 回归
- `finance-service.js` 从约 1377 行降至约 1031 行

### 已完成：main JSON 文件存储边界

- 新增 `main/json-file-store.js`，承接 JSON 配置读取、目录创建、临时文件写入、原子 rename 和失败清理
- `main.js` 保留 Electron `app.getPath('userData')` 路径解析及原有依赖注入，只通过 `createJsonFileStore` 获取读写函数
- 新增 `tests/json-file-store.test.js`，覆盖嵌套目录、fallback、原子临时文件和失败清理
- `main.js` 从约 1821 行降至约 1802 行

### 已完成：main 存储密钥解密边界

- 新增 `main/secret-decryptor.js`，承接 safeStorage 可用性判断、Base64 解码、解密异常隔离和空值处理
- `main.js` 继续注入 Electron `safeStorage` 和 Node `Buffer`，所有 provider/service 仍接收原 `decryptStoredSecret` 函数
- 新增 `tests/secret-decryptor.test.js`，覆盖可用、不可用和解密失败路径
- `main.js` 从约 1802 行降至约 1796 行

### 已完成：main 有界响应体读取边界

- 新增 `main/response-text-reader.js`，承接 response body reader、UTF-8 分块拼接、最大字节限制和超限取消
- `main.js` 保留链接 inspector 的注入接口及 `LINK_FETCH_MAX_BYTES` 策略，只将读取实现通过工厂注入
- 新增 `tests/response-text-reader.test.js`，覆盖分块读取、缺失 body、超限取消和参数校验
- `main.js` 从约 1796 行降至约 1781 行

### 已完成：main 任务通知窗口匹配边界

- 新增 `main/task-window-matcher.js`，承接任务项目与当前窗口标题的纯评分规则
- `main.js` 保留窗口扫描、候选排序、聚焦和通知 dismiss 生命周期；匹配权重和原有标题兼容规则不变
- 新增 `tests/task-window-matcher.test.js`，覆盖精确、前缀、包含、app name fallback 和空值路径
- `main.js` 从约 1781 行降至约 1770 行

### 已完成：window geometry layout metrics 边界

- 扩展 `main/window-geometry.js`，承接 `stripHeight`、`menuBarHeight`、`chromeY` 和 `tabSizes` 的布局指标投影
- `main.js` 保留窗口 IPC sender 校验、模式切换和窗口状态，仅注入 `windowGeometry.getLayoutMetrics`
- 新增 `tests/window-geometry.test.js`，覆盖 macOS 菜单栏高度和 Windows 固定折叠高度
- `main.js` 从约 1770 行降至约 1760 行

### 已完成：task notification layout 边界

- 新增 `main/task-notification-layout.js`，承接通知窗口宽度约束、屏幕边距和居中 bounds 投影
- `main.js` 保留通知窗口 factory、controller、display 变化和 dismiss 生命周期，只注入布局工厂的 `getBounds`
- 新增 `tests/task-notification-layout.test.js`，覆盖常规 display 和窄屏最小宽度
- 任务通知窗口创建、controller 和 display 变化共用同一个布局实现

### 下一批候选边界

1. 评估 `main.js` 中仍可独立测试的装配辅助逻辑，保留单一 Electron 生命周期和跨服务初始化顺序，不做机械拆分
2. 检查 finance 相关模块的跨模块重复常量和注入契约，只有能降低耦合且不改变 facade 时才继续抽象
3. 继续检查 P2 运行时性能和跨平台发布证据，不把结构拆分替代目标平台验收

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

### 已完成：P0 AI/provider 配置边界

- 新增 `main/ai-provider-config.js`
- 提取 AI diagnostics、safeStorage 解密后的配置解析、环境变量回退、provider verification revision、验证持久化、公共配置投影和转录 provider 连接测试
- 保留 schema v3、legacy 配置、环境变量优先级、verification 结构、WebSocket URL 和现有 IPC 返回结构
- 新增 `tests/ai-provider-config.test.js`

### 已完成：P0 金融请求缓存与取消边界

- 新增 `main/finance-request-cache.js`
- 提取 finance cache、pending request 合并、stale fallback、quota rate-limit、request-id cancellation 和嵌套 operation signal
- `finance-service.js` 继续保留 `createFinanceService` facade 和 provider 返回结构
- 新增 `tests/finance-request-cache.test.js`

### 已完成：P0 finance renderer 请求边界

- 新增 `renderer/finance-request-controller.js`
- 提取 finance request ID、generation、批量取消和结构化 cancellation 判断
- `renderer/finance.js` 的 API 调用通过动态 `window.notchAPI` 代理解析，保留运行时能力替换兼容性
- 新增 `tests/finance-request-controller.test.js`，并验证脚本加载顺序

### 已完成：P0 finance provider adapter 第一阶段

- 新增 `main/finance-provider-adapters.js`
- 将 CoinGecko / Binance 市场和批量报价、Alpha Vantage movers、Alpaca/Twelve Data quote fallback、QuantDash、腾讯/东方财富/新浪公开行情、A 股 ranking 与 provider cache state 从 service 的主调用路径迁移到 adapter
- 保留 `createFinanceService`、legacy asset IDs、provider identity、分页结构、stale fallback、request-id cancellation 和原有 normalizer 导出
- `finance-service.js` 的公开 `history` / `fundamentals` 和 `testProvider` 均通过 adapter facade 调用，继续保留 overview/search 编排、normalizer 导出和兼容 facade；未使用的 `legacyFundamentals` 已删除
- history 的 force 刷新、stale fallback、取消和 Eastmoney kline parser 依赖已补齐并通过直接 adapter 测试
- 新增 `tests/finance-provider-adapters.test.js`，覆盖 CoinGecko / Binance / QuantDash / Eastmoney / Twelve Data history、SEC EDGAR fundamentals、headers、缓存、stale fallback、缺失概念和取消
- 所有 finance service、provider adapter、IPC、background refresh 和 request cache 测试通过

### 已完成：P0 finance settings view 第一阶段

- 新增 `renderer/finance-settings-controller.js`
- 提取 finance 偏好、自选列表和搜索结果的 DOM 投影
- 通过 `window.NotchFinanceSettings.createController()` 注入 state、elements 和格式化 helper，保留 classic-script 加载顺序
- 保留原有 finance LocalStorage、DOM ID、搜索选择和自选列表事件契约
- 新增 renderer structure contract，并纳入桌面递归语法检查

### 已完成：P0 finance overview / ranking / watchlist view 第一阶段

- 新增 `renderer/finance-overview-controller.js`，迁移 overview 榜单去重、市场摘要、三市场 mover 和空状态投影
- 新增 `renderer/finance-ranking-controller.js`，迁移分页、provider 状态、榜单摘要、spotlight 和表格投影
- 新增 `renderer/finance-watchlist-controller.js`，迁移自选列表选择、排序、选中资产/报价解析和报价列表投影
- 通过显式 host 注入保留原格式化函数、canvas renderer、详情 callback 和 state 访问边界
- 保留 finance DOM IDs、点击事件、watchlist LocalStorage、详情请求和取消语义
- `renderer/finance.js` 当前主要保留 provider mutation、请求 coordinator、详情请求和模块装配；LocalStorage、资产身份、格式化和 AI facts/result projection 已迁移到独立模块

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
- `main.js` 当前约 1760 行

### 已完成：窗口 IPC 注册拆分

- 新增 `main/ipc/window.js`，迁移 `window:set-mode`、`window:begin-collapse`、`window:set-collapsed-hover`、`window:metrics`、`window:keep-open`、`window:set-tab` 和 `shortcut:hover-space-status`
- 所有窗口 IPC 统一验证主窗口 sender；实际 BrowserWindow、几何、模式和快捷键状态通过依赖注入保留在主进程装配层
- 新增 `tests/window-ipc.test.js`
- `main.js` 当前约 1760 行，直接 `ipcMain` 注册降至窗口/窗口扫描等剩余领域

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
- 新增 `renderer/credentials.css`，迁移密钥库布局、编辑态和亮色覆盖；`styles.css` 不再持有密钥库主样式块
- 新增 `renderer/todo-quadrants.css`，迁移待办四象限基础网格、标题、优先级标记、计数和列表滚动容器；日期弹层、响应式和 line-sidebar 覆盖继续留在 shell 覆盖层
- 新增 `renderer/todo-planner.css`，迁移待办时间范围规划栏、范围计数和逾期跳转样式；日期弹层、响应式和 line-sidebar 覆盖继续留在 shell 覆盖层中
- 新增 `renderer/todo-list.css`，迁移待办列表文字、截止时间、逾期重排、添加行和已完成折叠样式；四象限边框与日期弹层覆盖继续保留在 shell 覆盖层中
- 新增 `renderer/todo-editor.css`，迁移截止时间触发器、日期编辑器、快捷日期、日历网格和时间选择基础样式；文件在 `styles.css` 前加载，保留后续紧凑弹层覆盖
- 新增 `renderer/workspace-links-domain.js`，承接 `notch-link-groups` 的规范化、链接上下文和 AI 对话资料行生成
- 新增 `renderer/workspace-links-renderer.js`，通过显式 host 注入迁移链接列表渲染、筛选侧栏、分组分页和行操作控件
- 新增 `renderer/workspace-links-controller.js`，迁移链接筛选重置、侧栏导航、全部折叠、顶部新增和批量删除监听；链接编辑、拖拽和 AI 操作继续由协调器处理
- 新增 `renderer/workspace-links-actions.js`，迁移链接分组重命名、分组内新增、Shift 多选、收藏/已读切换、删除、编辑和打开链接动作；拖拽排序继续留在协调器以保持 document 指针事件生命周期
- 新增 `renderer/workspace-links-drag.js`，迁移链接长按拖拽、落点标记、跨组移动和补发 click 抑制；通过 host 注入排序、持久化和渲染回调
- 新增 `renderer/workspace-links-api.js` 与 `renderer/workspace-recordings-api.js`，分别承接链接和录音的公共 API、资料上下文、AI 命名与撤销；`workspace.js` 仅组装兼容的 `NotchWorkspace` facade
- 新增 `renderer/workspace-recordings-view.js`，迁移录音列表、详情、选择/删除事件和音频 Object URL 生命周期
- 新增 `renderer/workspace-transcription-pipeline.js`，统一管理百炼 PCM/WebAudio 链路、连接缓冲、转写事件和浏览器 SpeechRecognition 回退，并集中释放相关资源
- 新增 `renderer/workspace-recording-lifecycle.js`，统一管理麦克风 reservation、MediaRecorder、暂停/恢复/停止、草稿提升、保存事务、录音快捷键和退出清理；`workspace.js` 只注入转写、持久化、渲染与 UI 投影依赖
- 新增 `tests/workspace-recording-lifecycle.test.js`，覆盖草稿成功提升、暂停/恢复、保存失败回滚以及退出资源释放
- 新增 `renderer/workspace-ai-settings.js`，迁移 AI 厂商导航、模型草稿、配置加载与保存、连接验证、诊断、迁移确认和录音配置跳转；录音生命周期与转写管线通过 getter 读取当前配置
- 新增 `renderer/workspace-app-settings.js`，迁移功能显隐、首页组件、五类快捷键、主题、默认页、工作区和开机启动设置；AI 配置和录音状态通过显式回调接入
- 新增 `renderer/notes-controller.js`，迁移笔记实体、资料库列表、AI 命名、预览和 `NotchNotes` facade；editor 生命周期由 `notes-editor-controller.js`、LocalStorage 由 `notes-store.js`、分类/标签由 taxonomy controller 负责，IPC 和公共 API 保持兼容
- 新增 `renderer/notes-markdown.js`，迁移无状态 Markdown 预览、安全笔记图片引用和 HTTP/HTTPS 链接校验；通过注入 document 与图片读取能力服务首页和详情预览，保留经典脚本与原控制器调用兼容
- 新增 `renderer/notes-attachments-controller.js`，迁移图片 Markdown 引用插入、最多 12 个图片文件筛选、IPC 保存/选择/删除、编辑器保存刷新和状态提示；通过动态 API getter 保留 preload 替换兼容
- 新增 `renderer/notes-store.js`，迁移笔记 archive/categories LocalStorage 读取、归一化、分类/标签引用清理、边界写入和名称查询；通过注入 storage、domain 与 key 保留测试和兼容能力
- 新增 `renderer/notes-taxonomy-controller.js`，迁移分类/标签筛选、树状 taxonomy 投影、展开状态、增删改确认、数量统计和工作区同步；通过 store、domain、DOM 和 editor/list lifecycle host 保留 `notch-note-archive-v1`、`notch-note-categories-v1` 与筛选行为
- 新增 `tests/notes-store.test.js`，覆盖损坏 JSON、分类/标签引用清理、归一化写入和自定义存储 key
- 新增 `renderer/clipboard-store.js`，迁移剪贴板历史/收藏 LocalStorage、规范化、FIFO 淘汰、图片缓存与清理、变更版本和 `onNewClipEntry` 订阅；通过兼容访问器保持旧测试和 renderer 事件行为
- 新增 `renderer/clipboard-controller.js`，迁移剪贴板历史时间线、首页收藏投影、筛选/清空工具栏、复制/收藏/删除事件和 `NotchClipboard` facade；store 通过显式 host 注入，旧渲染函数和状态访问器继续作为兼容入口
- 新增 `renderer/pomodoro-controller.js`，迁移番茄钟 LocalStorage、输入校验、倒计时、进度渲染、重置和完成通知；通过显式 host 注入 `showStatusToast` 与 `notchAPI`
- 新增 `renderer/home-layout-controller.js`，迁移首页 Bento 顺序/尺寸/显隐持久化、布局校验、动效、长按拖拽、录音保护和 `NotchHome` facade；通过 host 注入提示和录音活动状态
- 新增 `renderer/home-weather-controller.js`，迁移天气位置存储、城市搜索、当前天气、小时/七日预报、详情视图和刷新失效生命周期；通过 host 注入 DOM、LocalStorage、天气 IPC 和首页视图切换
- 新增 `renderer/home-music-controller.js`，迁移首页音乐状态、音量/当前曲目持久化、应用内 audio 播放、队列/随机播放、音频与封面 Blob URL、go-music-dl 在线发现、歌单切换、音乐设置和 pagehide 资源清理；通过 host 注入 DOM、storage、动态 notchAPI、导航和文本更新
- 新增 `renderer/home-chat-reader-controller.js`，迁移长回答阅读工作台的长文分析、目录生成、选区操作、复制、待办提取、保存笔记、inert 状态和焦点恢复；通过 host 注入 ChatReader、渲染、AI/剪贴板操作和 Chat 状态回调，并由首页保留 `window.NotchChatReaderView` 兼容 facade
- 新增 `renderer/home-chat-generation-controller.js`，迁移 Chat request id、流式 delta、取消、重试/版本、消息状态、上下文 history、保存笔记动作和安全 Markdown 事件；通过 host 注入动态 API、session/context/reader controller 和 DOM 投影，保留会话快照与返回结构
- 新增 `renderer/home-quick-capture-controller.js`，迁移首页草稿、自动/笔记/链接模式、公开链接保存、笔记保存、错误状态和列表刷新；通过动态 Notes/Workspace getter 保留运行时能力替换
- 新增 `renderer/home-chat-session-controller.js`，迁移 Chat 会话 LocalStorage 读取/写入、容量错误映射、会话标题、搜索、打开、重命名、删除、工作区同步和会话面板事件；通过 host 注入消息重建、生成取消、临时会话重置、工作区同步和 DOM 操作，保留 `notch-ai-chat-sessions-v1` 数据结构
- 新增 `renderer/home-chat-context-controller.js`，迁移 Chat 资料目录、来源分类/搜索、最多 3 份资料选择、12,000 字符约束、chips、弹层焦点、键盘导航和外部点击关闭；通过 host 注入资料目录、状态更新和会话面板关闭能力
- 新增 `renderer/workspace-recording-projection.js`，迁移录音状态标签、按钮状态、实时转写、草稿行/详情同步和录音状态事件；录音生命周期、波形资源和列表 view 继续由 workspace 模块装配
- 新增 `main/todo-reminder-service.js`，迁移待办提醒列表、到期判断、定时器重排、通知入队和主窗口事件
- 新增 `main/transcription-settings-store.js`，迁移转写配置当前/旧目录读取、迁移和 600 权限原子写入
- 新增 `main/current-window-service.js`，迁移 macOS JXA 窗口枚举、焦点缓存、应用图标缓存和目标聚焦；Windows 等平台保持 unsupported 返回
- 新增 `main/finance-settings-store.js`，迁移财务 provider 配置 schema 归一化和持久化委托；safeStorage 解密和 provider service 仍由主进程装配
- 新增 `main/finance-provider-settings.js`，迁移金融 provider 白名单、凭据校验、safeStorage 加密写入、保存失败处理和缓存失效回调；通过依赖注入保留原更新返回结构
- 新增 `main/finance-http-client.js`，迁移金融请求的 origin 白名单、固定 DNS endpoint、GET/POST 边界、取消/超时、响应类型和请求/响应大小限制；通过依赖注入网络实现
- 扩展 `main/finance-provider-adapters.js`，承接 CoinGecko/Binance/QuantDash/Eastmoney/Twelve Data 的历史数据请求，以及 SEC EDGAR ticker/concept fundamentals 请求、缓存、限界和取消传播；`finance-service.js` 的公开 `history` / `fundamentals` 仅保留 operation facade，返回结构保持兼容
- 新增 `main/system-app-icon-service.js`，迁移当前窗口应用图标的 ICNS PNG 解析、macOS JXA fallback、并发队列和超时；当前窗口 service 通过 host 注入图标读取能力
- 新增 `main/paste-target-service.js`，迁移剪贴板自动粘贴的前台应用识别、内部 bundle 排除、JXA 粘贴和目标状态；快捷键与剪贴板 IPC 通过 host 访问
- 新增 `main/tray-icon.js`，迁移托盘刘海 PNG 编码、抗锯齿形状生成和 Windows/macOS 图标工厂；通过单测覆盖 PNG 输出和平台资源选择
- 新增 `main/permission-service.js`，迁移 macOS 辅助功能/屏幕录制权限自检、无缩略图探测、跳过标记和隐私设置跳转；通过依赖注入保留未知状态 fail-open 行为
- 新增 `main/app-settings-service.js`，迁移应用设置默认值、快捷键/主题/默认 Tab 归一化、公开投影和原子写入；设置变更事务仍由 `main/settings-controller.js` 负责
- 新增 `main/launcher-settings-store.js`，迁移 launcher 设置文件的大小边界、source/超时默认值、快捷键归一化和写入路径；launcher IPC 继续负责输入校验及快捷键回滚
- 新增 `renderer/theme.css`，迁移工作台浅色主题变量、surface、状态色、跨模块主题投影和 Windows 浅色覆盖；作为最后一个工作台 stylesheet 加载，确保主题覆盖晚于全部模块基础样式
- 新增 `renderer/platform.css`，迁移 Windows 收起态、关闭态和透明画布的 compositor-only 覆盖；在主题之后加载，保留固定 160 × 8 收起尺寸和 Hover + Space 命中区域
- 新增 `renderer/shell.css`，迁移共享设计 token；在所有领域基础样式前加载，保留 `styles.css` 作为 shell 结构和跨模块覆盖层
- 新增 `renderer/todo.css`，迁移待办核心行、复选框、删除和新增输入样式；在 `styles.css` 前加载并通过样式结构测试约束所有权
- `preload.js` 新增冻结的 `window`、`finance`、`home`、`capture`、`recordings`、`notes`、`launcher`、`settings` 分组，同时保留完整扁平兼容 API；结构契约测试已覆盖
- 新增 `renderer/todo-deadline-popover.css`，迁移待办日期浮层定位、紧凑日历投影、象限内锚定和层级覆盖；文件在 `styles.css` 后加载，保留 shell 与响应式修正规则的最终优先级
- 新增 `renderer/recordings.css`，迁移录制资料库、详情、实时录音和录音编辑器基础样式；文件在 `styles.css` 前加载，保留 shell、Bento 和响应式覆盖
- 新增 `renderer/clipboard.css`，迁移剪贴板 Tab 时间线、卡片、工具栏、筛选、图片缩略图、操作按钮和浅色覆盖；文件在 `styles.css` 前加载，shell 仅保留跨模块圆角和变量定义
- 新增 `renderer/notes.css`，迁移 notes 页面、taxonomy、列表和编辑器基础样式；文件在 `styles.css` 前加载，保留模块布局覆盖
- 新增 `renderer/notes-editor-controller.js`，迁移首页 Markdown 编辑、详情自动保存、模式切换、焦点/选区恢复、格式化、列表续写和编辑器附件事件；通过显式 host 协调 notes 主控制器，保留 DOM、LocalStorage 和 `NotchNotes` 兼容入口
- 新增 `renderer/todo-list-controller.js`，迁移待办列表 HTML、截止时间投影、时间范围统计、完成项折叠、排序动效和范围规划器；通过 getter 注入数据、范围、选中和编辑状态，保留 `renderList` / `renderTodoPlanner` 兼容入口
- 新增 `renderer/todo-editor-controller.js`，迁移截止日期日历、快捷日期、时间选择、弹层生命周期和默认截止时间刷新；通过 getter 注入数据、范围、保存和列表重渲染依赖，保留旧编辑器函数入口
- 新增 `renderer/todo-mutation-controller.js`，迁移待办新增、编辑、完成切换、删除撤销、批量删除、范围选择和行/输入事件绑定；通过 host 注入数据、持久化、日期编辑器和渲染依赖
- 新增 `renderer/todo-scope-controller.js`，迁移今天/本周/以后/全部切换、键盘导航、逾期跳转、选中状态清理和草稿截止时间刷新；通过 host 注入待办状态和渲染依赖
- 新增 `renderer/todo-api-controller.js`，迁移 `NotchTodo` 快照、聊天上下文、AI 批量新增与撤销，并保留原 facade 返回结构
- 新增 `renderer/shortcut-recorder-controller.js`，迁移快捷键录制浮层的按键解析、修饰键校验、IPC 保存、Toast、焦点和事件生命周期；`app.js` 通过注入 `setMode` 和 Toast 保留外部行为
- `renderer/app.js` 当前约 860 行，保留主 shell 装配和兼容入口；`renderer/todo-list-controller.js` 约 236 行，`renderer/todo-editor-controller.js` 约 238 行，`renderer/todo-mutation-controller.js` 约 287 行，`renderer/todo-scope-controller.js` 约 74 行，`renderer/todo-api-controller.js` 约 88 行，`renderer/shortcut-recorder-controller.js` 约 120 行，`renderer/home-layout-controller.js` 约 475 行，`renderer/home-weather-controller.js` 约 239 行，`renderer/home-music-controller.js` 约 359 行，`renderer/home-quick-capture-controller.js` 约 95 行，`renderer/home-chat-generation-controller.js` 约 287 行，`renderer/home-chat-context-controller.js` 约 188 行，`renderer/home-chat-session-controller.js` 约 344 行，`renderer/home-chat-reader-controller.js` 约 204 行，`renderer/clipboard-controller.js` 约 473 行，`renderer/pomodoro-controller.js` 约 163 行，`renderer/home.js` 约 236 行，`renderer/notes-taxonomy-controller.js` 约 507 行，`renderer/notes-controller.js` 当前约 1148 行，`renderer/notes-markdown.js` 约 293 行，`renderer/notes-store.js` 约 71 行，`renderer/notes-attachments-controller.js` 约 67 行，`renderer/recordings.css` 约 75 行，`renderer/notes.css` 约 349 行`
- `renderer/workspace.js` 当前约 605 行，保留链接/录音生命周期/设置控制器装配
- `renderer/finance-ai-controller.js` 当前约 211 行，承接金融 AI 快照 facts、证据/信号分组、结果投影、错误文案和旧结果保留；`finance.js` 保留请求、revision、取消和 API 协调
- `main.js` 当前约 1760 行；当前窗口、待办提醒、转写存储、应用设置、launcher 设置、财务存储、provider 更新、金融 HTTP 请求、系统应用图标读取、自动粘贴目标、托盘图标和权限自检已通过独立 service 装配
- 新增 `tests/renderer-styles-structure.test.js`，承接 credentials、todo、recordings、clipboard、notes、theme 和 platform stylesheet 的资源所有权、加载顺序与迁移断言；`tests/renderer-structure.test.js` 保留行为与页面结构契约
- 新增 `tests/domain-links-clipboard.test.js`，承接剪贴板历史、公开 URL 安全归一化、首页快速收集分类和链接分组/查询/拖拽纯函数契约
- 新增 `tests/home-layout-domain.test.js`，承接首页布局、widget 尺寸、隐藏模块和网格覆盖纯函数契约；`tests/domain.test.js` 保留录音、窗口、待办、credentials 和 notes 测试，文件由约 1000 行降至约 652 行
- `scripts/test-desktop.js` 已将新增 renderer 模块纳入语法检查，包括 `renderer/todo-mutation-controller.js`, `renderer/home-music-controller.js`, `renderer/home-quick-capture-controller.js`, `renderer/home-chat-context-controller.js`, `renderer/home-chat-generation-controller.js`, `renderer/home-chat-session-controller.js`, `renderer/home-chat-reader-controller.js`, `renderer/notes-markdown.js`, `renderer/notes-store.js`, `renderer/notes-attachments-controller.js`, `renderer/notes-taxonomy-controller.js` 和 `renderer/home-weather-controller.js`
- `main.js` 直接 `ipcMain.handle/on` 注册已降为 0，领域 IPC 均由独立注册器装配
- 新增 `tests/finance-normalizers.test.js`，承接 CoinGecko、Binance、Alpha Vantage、Alpaca、Twelve Data、SEC、QuantDash 和公开 A 股 normalizer/parser/provider-state 契约；`tests/finance-service.test.js` 保留 provider 请求、缓存、service facade 和取消集成测试，文件由约 863 行降至约 705 行
- `scripts/smoke-app.js` 已增加真实产物浅色主题验收：切换 `light` 后遍历当前可见工作台 tab，校验主题应用和横向无溢出，并保存各 tab 截图证据；fresh profile 与 retained profile smoke 均通过
- `npm run pack` 已生成 Windows unpacked 产物 `dist.noindex/win-unpacked/Dynamic Panel.exe`；`scripts/smoke-app.js` fresh profile 与 retained profile 均通过，覆盖真实启动、IPC、剪贴板复制、凭据加密、录音资源释放、通知和设置；并确认新增 renderer/main runtime 模块进入 `resources/app`
- `npm run build:win` 已生成 Windows NSIS 安装器；`scripts/verify-windows.ps1` 在本机完成静默安装、真实安装目录启动、重装保留工作区、卸载和 SHA-256 验证。`npm run build` 的 macOS DMG 目标在 Windows 主机上被 electron-builder 拒绝，需在 macOS runner 执行，不能在本机宣称完成
- 新增 `renderer/home-layout-domain.js`，将首页布局槽位、widget 尺寸、显隐归一化、网格求解/校验和 Todo 分类名称迁移从 `renderer/domain.js` 下沉；保留 `NotchDomain` 经典脚本 facade 与 Node `require` 兼容，`renderer/domain.js` 由 1314 行降至约 1049 行
- 新增 `main/finance-domain.js`，将 provider 状态投影、金融错误归一化和取消错误构造从 `finance-service.js` 下沉；保留 `createFinanceService`、provider identity、normalizer/export 和返回结构兼容
- 新增 `tests/finance-domain.test.js`，覆盖主进程金融领域模块与原 facade 的委托契约
- 完整 `npm test` 当前为 454 项：453 通过，1 项按平台跳过；面板、保留工作区、startup、task-notification 和 capture 五个 Electron 验收全部通过
