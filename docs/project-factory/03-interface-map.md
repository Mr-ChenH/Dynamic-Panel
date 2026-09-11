# Interface Map

## Navigation Model

启动器是一个覆盖在当前屏幕顶部的临时模式，路径如下：

```text
全局快捷键
  └─ Launcher Root Search
       ├─ 输入查询 → 统一结果列表
       ├─ ↑ / ↓ → 选择结果
       ├─ Enter → 主动作
       ├─ Tab / → → 参数或子页面（后续）
       ├─ Cmd/Ctrl+K → Action Panel
       │    ├─ 执行
       │    ├─ 收藏/取消收藏
       │    ├─ 设置别名
       │    ├─ 复制目标
       │    └─ 打开所属页面
       └─ Escape → 返回 / 关闭
```

启动器关闭后，原有工作台状态不被重置。启动器内跳转到待办、笔记或链接页面时，先关闭 launcher 状态，再进入普通展开工作区。

## Screens

1. **Launcher Root Search**：搜索框、收藏/最近结果、来源分组和键盘提示。
2. **Launcher Action Panel**：当前结果可执行动作列表。
3. **Launcher Empty/Error State**：无结果、禁用来源或扩展异常的反馈。
4. **Launcher Extension Manager**：设置中的扩展列表、安装、启用/禁用、卸载和诊断。
5. **Launcher Alias/Favorite Management**：设置中集中查看和修改快捷入口。
6. **Extension Install Review**：安装前的 manifest、权限和风险确认弹层。

## Shared Components

- Launcher shell：固定宽度、聚焦、退场和窗口状态。
- Search input：查询输入、清除、来源前缀和 loading 状态。
- Result group：来源标题、数量和折叠状态。
- Result row：图标、标题、副标题、来源、别名徽标、收藏状态和主动作键提示。
- Action panel：命令式动作列表、危险动作确认和快捷键提示。
- Status line：结果数量、运行状态、超时和错误提示。
- Extension permission badge：网络、文件、shell 等权限等级。
- Settings list row：扩展启用状态、版本、错误状态和管理动作。

## Screen Details

### Screen: Launcher Root Search

- Purpose：从任意应用搜索和执行内置/扩展命令。
- Entry points：启动器全局快捷键；设置中的“测试启动器”。
- Main modules：搜索输入、结果列表、选中结果摘要。
- Secondary modules：收藏区、最近区、查询来源筛选、底部快捷键提示。
- User actions：输入、上下选择、Enter 执行、Cmd/Ctrl+K 打开动作、Escape 关闭。
- Data shown：标题、subtitle、图标、来源、别名、执行状态。
- Linked screens：动作面板、参数页（后续）、对应工作区页面。
- Validation and errors：空查询显示收藏/最近；无结果显示清空/管理来源；结果失效显示刷新或移除入口。

### Screen: Launcher Action Panel

- Purpose：发现当前结果的次要动作。
- Entry points：选中结果后 Cmd/Ctrl+K 或动作按钮。
- Main modules：动作列表和当前对象摘要。
- Secondary modules：危险操作确认、快捷键说明。
- User actions：选择动作、返回结果、确认/取消危险操作。
- Data shown：动作名称、快捷键、风险等级和执行结果。
- Linked screens：设置别名、扩展管理、原 Tab。
- Validation and errors：不支持的动作不显示；执行失败保留上下文并展示错误。

### Screen: Launcher Extension Manager

- Purpose：管理本地扩展生命周期。
- Entry points：设置 → 启动器 → 扩展；扩展异常提示中的“管理扩展”。
- Main modules：已安装扩展列表、导入入口、启用状态。
- Secondary modules：权限摘要、命令数、版本、诊断信息。
- User actions：安装目录、安装 zip（若纳入 MVP）、启用、禁用、卸载、查看日志。
- Data shown：扩展 manifest、路径、权限、最后错误、最后运行时间。
- Linked screens：安装审查、扩展设置、启动器搜索。
- Validation and errors：manifest 无效、版本不兼容、目录不可读和进程残留均有可理解提示。

### Screen: Extension Install Review

- Purpose：在执行本地扩展代码前让用户了解来源和权限。
- Entry points：选择本地扩展目录或 zip 后。
- Main modules：名称、作者、版本、命令清单、入口文件。
- Secondary modules：权限分级、文件来源、风险警告。
- User actions：确认安装、取消、打开目录查看。
- Data shown：manifest 原文摘要和校验结果。
- Linked screens：扩展管理。
- Validation and errors：禁止路径穿越、未知字段可忽略但未知权限拒绝、缺少必填字段拒绝。

## Cross-Screen Interactions

- 启动器执行工作区结果时，将目标 ID 传给现有 Tab 页面并定位对应条目。
- 收藏、别名和最近使用更新后，Root Search 立即刷新，不等待重启。
- 禁用扩展后，其所有结果从 Root Search 消失，正在运行的查询被取消。
- 卸载扩展前关闭其进程；确认后删除安装目录，扩展私有数据按用户选择清理。
- 设置中修改启动器快捷键后，旧注册先释放；新注册失败时保留旧值并提示原因。
- 失焦关闭只适用于 Root Search；安装审查和危险动作确认期间不自动关闭。

## State And Loading Behavior

- `idle`：空查询，显示收藏/最近。
- `searching`：输入变化，内置结果先同步展示，扩展结果异步补充。
- `ready`：有稳定选择项，可执行。
- `empty`：没有匹配结果，保留查询和来源建议。
- `running`：主动作执行中，按钮禁用并显示进度。
- `success`：执行完成后按动作类型关闭或跳转。
- `error`：保留结果上下文，显示可理解错误和重试/禁用扩展动作。
- `action-panel`：动作面板接管键盘焦点。
- `install-review`：安装确认接管焦点，Escape 取消。

## Empty States

- 没有收藏：提示按 Cmd/Ctrl+K 或使用动作菜单添加收藏。
- 没有最近项目：提示先搜索应用、链接或工作区内容。
- 没有扩展：提示从设置安装本地扩展，并提供样例扩展说明。
- 没有启用来源：提示到设置开启应用、工作区或剪贴板来源。

## Error States

- 快捷键注册失败：显示失败原因并保留原快捷键。
- 应用/文件不存在：显示“目标已不存在”，提供移除收藏。
- 扩展超时：显示“扩展响应超时”，提供重试和禁用。
- 扩展崩溃：显示“扩展已退出”，提供查看诊断和禁用。
- 权限不足：说明对应系统权限或 manifest 权限，不暴露堆栈。
- 结果协议非法：丢弃非法结果，记录诊断，不影响其他来源。

## Accessibility Notes

- 搜索框使用可见 label 或 aria-label，并在打开后自动 focus。
- 结果列表使用 `role=listbox`，结果项使用 `role=option` 和 `aria-selected`。
- 动作面板使用 `role=menu`/`menuitem`，危险动作需要明确文本。
- 所有操作支持键盘；颜色只用于辅助状态，不能单独传达权限或错误。
- 支持系统 reduced motion；焦点环和文字对比度沿用当前面板规范。
