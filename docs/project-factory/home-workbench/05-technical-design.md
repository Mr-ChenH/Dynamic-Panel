# 技术与界面设计

## 界面
默认首页为工作台，上方今日重点和继续工作，下方快速收集、天气、音乐与 AI 入口。AI展开后使用独立对话区域，不挤占录音和旧工具。工具切换在首页内完成；经典首页 DOM 与原存储键保留。

## 文件与接口
- renderer/home.js / home.css：独立首页控制器，局部更新列表，编辑框不随轮询重建。
- home-services.js：天气固定 HTTPS API 请求与缓存。home-media.js：持久化 `music-library.json`，管理本地/网络曲目、来源模式、去重、路径与 URL 校验、有界读取/下载以及公开元数据映射。
- preload.js / main.js：天气使用 `home:weather-search` / `home:weather`；音乐使用 `home:music-library` / `home:music-mode` / `home:music-choose-files` / `home:music-add-network` / `home:music-remove` / `home:music-load`。渲染层通过 `<audio>` 和 Blob URL 播放，不接触本地路径或远程 URL。
- ai/schema.js / prompts.js / service.js：新增 chat 文本动作及有界 role/content 历史，OpenAI 与 Anthropic 适配均传递真实角色消息。
- 首页天气位置使用独立 LocalStorage 键，当前音乐曲目 ID 使用 `notch-home-music-track-v1`，音量使用 `notch-home-music-volume-v1`，曲目清单位于主进程 `userData/music-library.json`；AI 对话仅内存，草稿独立保存；沿用笔记归档与任务数据。

## 安全与生命周期
天气搜索参数编码，不接受任意 URL；超时与响应限制；错误脱敏；不自动定位。音乐文件或文件夹由系统对话框授权，支持扩展名、大小和普通文件校验；文件夹按稳定顺序递归扫描，忽略符号链接，限制为 10,000 个目录项和 20 层；网络音乐仅允许无凭据的公开 HTTPS URL，拒绝本机/私网解析和重定向，请求绑定验证后的公网地址并按流限制 128 MB。设置页浏览的本地/网络来源与 `loadedMusicId` 对应的实际播放来源解耦，切换配置面板不停止或清空音频；仅删除当前曲目、主动切歌或页面卸载时停止音频并撤销 Blob URL。来源配置区在桌面端保持稳定高度，首页离场时暂停均衡器装饰动画。AI沿用安全传输、全应用并发与取消；工作区/配置变更使当前对话请求过期，不自动读取本地资料。清空会话取消请求，迟到回复不回填。

## 验证
领域单测覆盖天气输入/缓存/错误、音乐库持久化、嵌套文件夹导入、重复与符号链接过滤和网络边界、聊天历史与角色边界；Electron场景覆盖导航、收集保存、天气假服务、应用内 WAV 加载/播放、AI fake provider、取消和布局。真实本地格式和远程服务器兼容性需实机验收，不能用假服务代替。
