# UI Design

## Design Direction

启动器延续 Dynamic Panel 的黑灰贴顶工作台风格，但视觉重心从“浏览页面”转为“快速决策”。界面应让用户在打开后的第一眼看到搜索框和当前选项，减少装饰、层级和鼠标移动。

设计关键词：快速、安静、可预测、可回退。结果项用清晰的图标和副标题区分来源，选中态使用现有蓝色焦点 token；危险动作使用现有红色状态色，并用文字明确风险。

## Information Architecture

```text
Launcher Shell
├── Search Header
│   ├── Search input
│   ├── Clear / source hint
│   └── mode / close affordance
├── Result Body
│   ├── Favorites
│   ├── Recent
│   ├── Built-in sources
│   └── Extensions
├── Selection Preview
│   ├── title / subtitle
│   ├── source and permission badge
│   └── primary action hint
└── Footer
    ├── result count / status
    └── keyboard shortcuts
```

动作面板是同一 shell 内的侧向或覆盖层，根据可用空间选择位置；它不创建第二个 BrowserWindow。

## Layout System

- 桌面目标宽度：640px，最小 480px，最大 760px；结果区域最大高度 520px。
- macOS 和 Windows 均以当前显示器可用区域为边界，水平居中，顶部保留安全距。
- 搜索框高度 52px，结果行 48px，分组标题 28px，底部状态栏 28px。
- 空查询只展示有限的收藏/最近项目，避免初次打开出现长列表。
- 结果过多时仅结果列表滚动，搜索框和底部快捷键保持固定。
- 选中结果的预览信息优先放在结果行内；只有扩展提供详细信息时才打开后续页面。
- 安装审查和危险确认使用紧凑对话层，宽度不超过启动器主体。

## Visual System

沿用 `renderer/styles.css` 的 CSS 自定义属性：

- 背景：`--bg-base`、`--surface-1`、`--surface-2`、`--surface-3`。
- 文字：`--text-1` 到 `--text-4`。
- 焦点：`--focus-ring`、`--accent-blue`。
- 状态：`--accent-green` 表示成功，`--accent-orange` 表示等待，`--p0` 表示危险/错误。
- 圆角：复用 `--r-panel`、`--r-tile`、`--r-input`、`--r-pill`。
- 间距：使用 `--s-1` 至 `--s-6`，不新增不成体系的间距值。
- 动画：使用现有 `--d-fast`、`--d-base`、`--ease-out`；启动器打开、结果更新和动作面板切换不超过 260ms。

图标优先使用项目内联 SVG 或系统应用图标。扩展 manifest 的图标只能读取安装目录内的受控相对路径，失败时显示来源首字母。

## Components

### Launcher Shell

拥有 `data-launcher-state` 属性管理 idle/searching/action-panel/running/error 状态。展开时设置页面 inert，关闭时恢复此前工作台状态。窗口层级和点击外关闭逻辑由主进程/renderer 状态机共同维护。

### Search Input

- 打开后自动 focus。
- placeholder：`搜索应用、待办、笔记、链接和命令`。
- 支持清除按钮和可选查询前缀提示。
- IME 输入期间不触发重复执行；按 Enter 只在 compositionend 后生效。

### Result Row

- 左侧 28px 图标。
- 中间标题单行省略，副标题显示来源、路径或命令摘要。
- 右侧显示别名、收藏和主动作提示。
- `aria-selected=true` 时显示蓝色细描边/背景；hover 不覆盖键盘选中态。
- 结果行不直接展示扩展的原始 HTML 或 Markdown。

### Action Panel

- Cmd/Ctrl+K 打开，动作按主动作、管理动作、危险动作分组。
- 每项显示名称、快捷键和风险标记。
- 只呈现当前 result 的合法动作；扩展无法动态注入未声明动作。

### Extension Manager

延续现有设置页的列表密度。每行显示名称、版本、命令数量、启用开关、权限徽标和错误状态。安装按钮使用文件选择器，不接受远程 URL。

## Interaction Patterns

- `↑/↓`：移动选择；`Home/End`：跳到首/尾。
- `Enter`：执行主动作。
- `Cmd/Ctrl+K`：打开动作面板。
- `Tab`：在搜索框、结果列表和动作区域间移动；当命令有参数时，后续阶段再使用 Tab 切换参数。
- `Escape`：动作面板返回列表，列表关闭启动器，确认层取消。
- `Cmd/Ctrl+P`：后续用于来源筛选，不作为 MVP 必需快捷键。
- 鼠标点击结果等价于选择，双击不执行第二次动作。
- 扩展运行中的结果显示局部 loading，不阻塞内置结果。

## Responsive Behavior

- 低于 760px 可用宽度时，启动器使用左右 16px 安全距并填充剩余宽度。
- 低于 520px 高度时，隐藏非必要预览摘要，结果列表保留滚动。
- Windows 任务栏在顶部时以 `workArea` 定位；macOS 以屏幕 bounds 顶部定位并避开菜单栏交互约束。
- reduced motion 下取消 shell 缩放和结果位移动画，仅保留 opacity 或直接切换。

## Accessibility

- 使用 `role=dialog`、`aria-modal=true`、`aria-label` 标识启动器。
- 搜索框与列表之间通过 `aria-controls` 和 `aria-activedescendant` 连接。
- 结果项使用 `role=option`，动作项使用 button/menuitem 语义。
- 文本与焦点对比度达到现有 WCAG AA 目标；收藏、权限和错误同时显示文字/图标。
- 扩展错误、超时和权限等级通过 live region 通知，但不连续播报每次结果变化。
- 安装确认必须可用键盘完成，默认焦点在取消或安全操作上，避免误安装。

## Implementation Notes

- 先把 launcher DOM 放入现有 `renderer/index.html`，以独立 root 容器控制显示；不要把启动器结果混入现有首页 Bento DOM。
- 搜索逻辑放入可测试的纯模块，渲染层只负责状态和事件绑定。
- launcher 打开前由主进程切换到 launcher window mode，确保 Windows 形状覆盖整个启动器；关闭后再恢复 collapsed/expanded 工作台模式。
- 结果图标加载失败时不能阻塞列表；远程 favicon 不作为默认能力。
- UI 状态必须允许无扩展运行，以便测试和用户首次安装时保持完整。

## UI Review Checklist

- [ ] 快捷键后搜索框是否在首帧可输入。
- [ ] 空查询是否提供收藏、最近和清晰空状态。
- [ ] 结果标题、副标题、来源和选中态是否容易扫描。
- [ ] 只用键盘是否可以完成搜索、执行、动作面板和关闭。
- [ ] 动作面板是否只展示当前对象可用动作。
- [ ] 扩展权限、错误和确认信息是否清晰且不隐藏在 tooltip 中。
- [ ] 长标题、长路径、无图标和扩展异常是否无溢出。
- [ ] macOS/Windows 顶部定位、低分辨率和 reduced motion 是否可用。
