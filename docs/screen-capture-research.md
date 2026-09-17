# 截图与录屏功能研究

> 调研日期：2026-09-16。2026-09-17 已实现首版，并扩展固定区域截图与录屏；系统声音和 MP4 转码仍未实现。下文保留调研时的设计依据。
> 基于仓库代码、已安装的 Electron 44.0.0 类型声明及 Electron / MDN 官方文档；未进行实际屏幕采集、麦克风采集或双平台录屏实测。本文不替代 README 中的现有产品行为。

## 建议结论

适合添加，优先采用 Electron 自带的 `desktopCapturer`、`getDisplayMedia` 和 `MediaRecorder`，首版不引入 FFmpeg、额外原生模块或系统音频驱动。把现有“录制”页扩展为“录音 / 截图 / 录屏”，保持顶栏数量和内容区尺寸不变。

首版目标为整屏、窗口、单屏区域截图，以及整屏、窗口录屏；录屏默认无声，可由用户主动开启麦克风。系统声音分平台验证后开放。区域录屏、滚动长截图、标注编辑和 MP4 转码放在后续阶段。

最需要先验证的不是按钮布局，而是采集窗口的用户激活、隐藏后的持续编码、多屏像素映射及 macOS 系统声音。

## 现有代码能复用什么

| 位置 | 已有能力 | 新功能的处理方式 |
| --- | --- | --- |
| `renderer/workspace.js` 的 `startRecordingAttempt`、`finalizeRecording` | 用户点击后采集麦克风，音频录制、暂停、转写，停止后释放轨道 | 保留现有音频行为；录屏不自动接入转写 |
| `main.js` 的 `recordings:save` / `recordings:read` | 完整音频一次性传输、写入和读取，保存上限 200 MiB | 不直接用于视频；视频采用持续写入和流式播放 |
| `main.js` 的 `requestMacMediaAccess` | 请求权限时临时调整置顶层级，避免系统提示被挡住 | 复用前台权限协调；屏幕授权不能调用 `askForMediaAccess('screen')` |
| `main.js` 的 `hasScreenRecordingAccess` | 为当前窗口列表检查屏幕权限，避免首次启动主动触发采集 | 保持启动策略；仅用户进入采集流程后枚举和请求来源 |
| `main.js` 的 `workspaceRoot`、`chooseWorkspaceFolder` | 工作区目录、媒体复制、切换通知 | 新增采集目录迁移；录制中不能直接切换根目录 |
| `preload.js` | 安全的媒体 IPC 桥接 | 新增专用采集接口，不向页面开放任意文件写入 |
| `package.json` | Electron 44、macOS 13+、Windows 10/11 | 当前没有 `NSAudioCaptureUsageDescription`；启用 Mac 系统声音前需补充并验证 |

当前代码虽然导入了 `desktopCapturer`，但没有截图/录屏工作流，也没有 `setDisplayMediaRequestHandler`。原录音会累积所有 `audioChunks`，结束后构造完整 Blob，再传入主进程；照搬到长视频会同时增加渲染层、IPC 和主进程内存压力。

## 用户体验

- “录制”页内选择录音、截图或录屏。截图/录屏各自使用左侧文件列表、右侧预览和详情，支持重命名、导出、打开所在文件夹和删除；截图额外支持复制图片。录音保留现有界面和数据。
- 设置页增加“截图与录屏”分类，沿用左侧设置列表、右侧配置：默认截图方式、录屏画质、音频来源、倒计时和可选快捷键。首版快捷键默认不注册，避免抢占已有系统及应用快捷键。
- 截图：选择屏幕或窗口 → 隐藏采集选择器与主面板 → 获取有效画面 → 整图保存，或在冻结画面上框选 → 保存 PNG。Esc 取消，取消不产生文件。
- 录屏：选择来源与声音 → 点击开始 → 3 秒倒计时 → 录制 → 停止并保存。默认 1080p 上限、30 fps，保持比例，不放大小画面；最终尺寸以实际轨道为准。
- 折叠、切换页签不终止录屏。托盘菜单持续显示状态与“停止录屏”，主面板打开时也显示时长和停止按钮；可选状态条必须明确可能入镜。
- 首版同时最多一个采集任务；原有录音与录屏互斥，避免麦克风争用、双重转写和退出状态不一致。

主窗口继续贴顶居中。来源选择、截图框选可以使用专用辅助窗口，不改变主面板的固定展开尺寸，也不让主面板可拖离顶部。

## 技术路径与兼容性

| 能力 | Windows 10/11 | macOS 13–14.1 | macOS 14.2+ |
| --- | --- | --- | --- |
| 整屏/窗口画面 | Electron 采集路线；需要真机验证受保护、最小化窗口 | 需要屏幕录制授权；需要真机验证 | 同左 |
| 麦克风 | 用户主动开启，受系统隐私设置影响 | 现有麦克风授权流程 | 同左 |
| 系统声音 | 官方 session 文档列出 `loopback`；需录制回放验证 | 首版不承诺，单独验证或显示暂不支持 | 官方说明涉及 CoreAudio Tap 和用途声明；仍须验证具体调用路径 |
| 原生来源选择器 | 使用应用内选择器 | 使用应用内选择器 | macOS 15+ 可选实验性 `useSystemPicker`，不是所有 14.2+ 均有 |
| 输出格式 | 运行时检测 WebM 编码器 | 同左 | 同左 |

Electron 官方文档存在需要实测消解的边界：`desktopCapturer` 文档说明 Mac 系统音频采集要求，而 `session` 文档及本地 44.0.0 类型仍将字符串 `loopback` 标为 Windows 专用。因此不能把 Windows 示例直接视为所有 Mac 版本的可用实现。

macOS 14.2+ 的系统音频需要 `NSAudioCaptureUsageDescription`。官方还说明，缺少该声明可能得到没有有效声音的音轨而不报错；“有 audio track”不代表系统音频成功。验证应播放已知测试音并检查输出回放，开发启动与签名应用分别验收。正常静音不能被简单判定为权限失败。

选中系统声音后若初始化失败，提示用户改用无声或麦克风，不能静默切换。混录在验证后通过 Web Audio 合成单条音轨，并负责释放 AudioContext、节点和所有源轨道。

### 来源选择与用户激活

主进程通过 `desktopCapturer.getSources` 获取显示器/窗口列表，向专用采集页发送有界缩略图和临时来源标识。排除本应用的采集辅助窗口，限制枚举数量、缩略图尺寸和刷新频率。

`getDisplayMedia` 要求活跃、聚焦页面中的用户瞬时激活。因此建议让同一个专用采集窗口承载来源确认按钮和后续 MediaRecorder：用户点击时发起采集，获得流后才隐藏或缩成控制界面。不能假设主面板的一次点击可以通过异步 IPC 将激活转移给隐藏窗口。隐藏后持续编码与后台节流必须在技术验证阶段通过，否则先保留可见的采集控制窗口。

采集页使用独立 session、最小 preload、`contextIsolation` 和 sandbox，不开放导航或任意远程页面。在该 session 注册 `setDisplayMediaRequestHandler`，验证请求 frame、主框架身份、窗口身份以及一次性授权状态。来源选择记录绑定任务与 webContents，设置短有效期，只接受本次缓存中的来源；来源关闭或失效时重新选择，不能自动改录另一屏。

首版使用自定义选择器。后续启用 macOS 15+ 系统选择器时，必须单独设计分支：该选择器可绕过自定义 handler，不能假设 handler 中的来源校验和逻辑仍会执行。

### 截图清晰度与多屏

`DesktopCapturerSource.thumbnail` 用于来源预览。官方明确不保证它等于所请求的 `thumbnailSize`，不能仅通过设置大缩略图就承诺原生分辨率截图。

建议获取选中来源的视频流，等到画面有效、采集界面隐藏完成且取得后续新帧，再按 `videoWidth` / `videoHeight` 将帧绘制到 canvas 导出 PNG；保存后立即停止所有轨道。不能复用录屏的 1080p 上限来截图，也不能只用固定延迟推断画面就绪。实际原生像素是否保留纳入验收，不把 API 请求尺寸当成结果。

区域截图首版只在一个显示器内选择：先冻结全屏画面，再显示框选层并裁剪，避免框线入镜。框选坐标转换为相对该画面内容矩形的坐标，分别乘以“实际帧宽/显示内容宽”和“实际帧高/显示内容高”，处理留白、取整和边界裁切。不能把全局桌面坐标统一乘一个 `scaleFactor`。覆盖负坐标显示器、125%/150%/200% 缩放及不同 DPI 的组合；跨屏区域拼接后置。

录屏首版只支持整屏/窗口。区域录屏需要持续 canvas 裁剪与再编码，增加 GPU/CPU 开销及后台节流风险，独立验证后再做。

### 面板自身入镜

截图前隐藏主面板和采集选择器，采完恢复原模式、原屏幕与贴顶位置。录屏默认隐藏主面板，用户主动展开时允许其入镜；托盘保留停止入口。不能承诺“全部悬浮控件永不入镜”。

`setContentProtection(true)` 只能作为经过验证的增强：Windows 10 2004+ 与旧系统行为不同，旧系统可能录成黑块；Mac 上采用 ScreenCaptureKit 的采集方可能仍录到该窗口。不能把它作为跨平台排除自身的唯一保障。

### 编码与持续保存

用 `MediaRecorder.isTypeSupported` 选择 `video/webm;codecs=vp9,opus` 或 VP8/Opus 等实际可用组合，并捕获创建、启动及运行时错误；无声音时选择对应视频编码组合。容器、扩展名必须跟随最终 `MediaRecorder.mimeType`。首版以可验证的 WebM 为目标，不把改成 `.mp4` 后缀当成转码。

主进程维护录制会话和写入队列，渲染层发送有序小块，主进程写完后回 ACK；任务必须包含归属窗口、递增序号、固定目标工作区、累计大小和状态。建议初始限制为单次 IPC 不超过 4 MiB、待写队列不超过 32 MiB、单次录屏不超过 60 分钟或 4 GiB，以先达到者为准；这些是待实测调优的产品上限。

`MediaRecorder.start(1000)` 不能保证每秒返回，也不能保证 Blob 大小。大的 Blob 按有界切片依次传输，保留原始字节顺序；对尚未传输的 Blob 也计入内存预算，不能只计算已发送消息。超过预算或写入持续落后时停止采集并说明原因，不能无界缓存。首版不承诺内存绝对固定，因为浏览器编码器内部缓冲不受应用完全控制。

先写随机命名的 `.partial` 文件。停止时等待最后一次 `dataavailable`、全部写入 ACK 和文件关闭，再完成重命名与元数据提交。时间使用单调时钟累计，不能以块数计算时长。崩溃后的残留文件不冒充成功视频，也不自动删除；列为未完成文件，允许用户导出尝试恢复或主动删除。MediaRecorder 单个块不保证独立可播放，不能声称追加写入天然解决崩溃恢复或 WebM 索引问题。

回放使用受限本地媒体协议或等效流式读取，支持正确的 Range / Content-Type，只允许索引中已完成的采集文件。不沿用 `recordings:read` 全文件加载。长视频的 seek、时长和结束完整性需要实际验证；如必须修复 WebM 索引，再评估专用容器处理方案，FFmpeg 作为后续选项。

## 文件与生命周期

建议使用以下新增结构，不修改 `notch-recordings`：

```text
<workspace>/captures/
  index.json                 # version: 1，由主进程维护的截图/视频元数据
  screenshots/<id>.png
  videos/<id>.webm
  videos/<id>.partial
```

索引记录 id、kind、title、createdAt、相对 path、mimeType、width、height、bytes，以及视频 durationMs 和实际音频模式。路径统一 `/` 分隔，不保存临时 source ID、本地绝对路径或图片/视频二进制。LocalStorage 只保存筛选、选中项等界面偏好；主进程索引可在主面板关闭时独立完成保存。

新增目录和索引需要纳入 `copyWorkspaceAssets`，复制失败不得静默切换。录制/保存中请求切换工作区时，提示先停止并完成保存再切换，保证一个任务的全部文件归属同一个根目录。IPC 由主进程生成文件名，验证调用者、尺寸、MIME、序号和上限；读取、导出、删除按索引 ID 查找，拒绝路径穿越、符号链接及越界目标。

会话状态建议为 `idle → selecting → countdown → recording → stopping → saving → idle`，取消及错误进入统一清理流程。处理来源关闭、设备拔出、屏幕变化、权限撤回、磁盘写入失败、渲染进程崩溃和重复停止。首版锁屏/休眠时停止并尽力保存，不在解锁后自动恢复采集。

现有 `before-quit` 不会等待新的视频任务收尾，需加入有界退出流程：正常退出先阻止退出、停止任务、等待最终落盘，再退出；异常强制结束只保留 partial，不保证可恢复。成功、取消、报错和超时路径均释放屏幕及麦克风轨道、计时器和临时授权，恢复面板位置及权限提示前的置顶状态。

## 分阶段实施与验收

1. **技术验证**：在 Electron 44.0.0 验证专用采集页的用户激活、隐藏后持续录制、窗口/显示器枚举、原生像素截图及 WebM seek。记录 Windows 10/11、Mac 13、14.2+、15+ 的结果；无法获得的测试环境明确标为未验证。Mac 系统声音不作为无声录屏的前置条件。
2. **截图闭环**：整屏、窗口、单屏区域、PNG 保存/复制/预览/导出/删除，权限拒绝与取消，混合 DPI、Esc、面板恢复。保持原有剪贴板历史默认关闭。
3. **录屏闭环**：整屏/窗口、倒计时、无声/主动麦克风、停止保存、任务状态、持续写入、回放与工作区迁移；支持切换页面和折叠时继续录制。
4. **声音与增强**：先验证 Windows 系统声音，再独立验证 Mac 系统声音及混录；按实际能力显示可用选项。随后评估暂停续录、区域录屏、标注、MP4 导出。

自动化测试聚焦纯状态机、坐标转换、路径边界、分块乱序/重复、队列限额、磁盘错误、最终数据先于完成确认、重复停止和退出清理；Electron 测试模拟拒绝、取消、来源消失和主面板切页。真机必须验证长录制的内存走势、音画同步、输出回放/seek、混合 DPI、TCC 对话框可见性、没有未经点击启动麦克风，以及停止后设备指示确实消失。

首版实现位于 `captureService.js`、`captureStorage.js`、`capturePreload.js`、`renderer/captureWindow.*` 和 `renderer/capture.*`，并已纳入 `build.files`。固定区域扩展使用原始帧坐标，支持拖动和数字输入；预设绑定显示器、缩放、旋转及实际帧尺寸。区域录屏通过 canvas 持续裁剪并以 30 fps 请求帧，只编码矩形内部；采集窗口关闭后台节流，变化时停止，麦克风在确认区域后才申请。`npm run test:capture` 使用生成的 canvas 画面验证截图、区域记忆、隐藏窗口区域录屏、WebM 时长和 seek、Range 回放以及权限和录音互斥；不会读取真实桌面或麦克风。系统声音、不同 macOS TCC 状态及真实多屏 DPI 仍需在目标设备验收。桌面打包、签名应用验证及发布仍需用户明确确认。

## 官方依据

以下在线文档读取于 2026-09-16。`latest` 文档可能新于当前安装版本，应以 Electron 44.0.0 实际行为验证结论。

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)：来源获取、macOS 屏幕授权、系统音频用途声明与 CoreAudio Tap 限制。
- [Electron DesktopCapturerSource](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source)：缩略图尺寸不保证、display_id 可能为空。
- [Electron session](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts)：display media handler、Windows loopback、macOS 15+ 实验性系统选择器。
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows)：窗口内容保护的平台差异及 ScreenCaptureKit 限制。
- [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)：用户瞬时激活、活跃聚焦上下文、权限与可选音频。
- [MDN MediaRecorder dataavailable](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)：数据块、停止时最后的数据、timeslice 不准确及大块风险。

本地 API 对照：`node_modules/electron/electron.d.ts` 的 `DesktopCapturer`、`Session.setDisplayMediaRequestHandler`、`Streams`。上述源码位置均按函数或 IPC 名称定位，避免后续重构导致行号失效。
