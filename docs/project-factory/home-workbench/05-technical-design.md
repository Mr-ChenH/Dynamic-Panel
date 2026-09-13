# 技术与界面设计

## 界面
默认首页为工作台，上方今日重点和继续工作，下方快速收集、天气、音乐与 AI 入口。AI展开后使用独立对话区域，不挤占录音和旧工具。工具切换在首页内完成；经典首页 DOM 与原存储键保留。

## 文件与接口
- renderer/home.js / home.css：独立首页控制器，局部更新列表，编辑框不随轮询重建。
- home-services.js：天气固定 HTTPS API 请求与缓存；音乐平台适配独立模块，可测试，Electron IPC 只转发白名单参数。
- preload.js / main.js：home:weather-search / home:weather / home:media-status / home:media-control。
- ai/schema.js / prompts.js / service.js：新增 chat 文本动作及有界 role/content 历史，OpenAI 与 Anthropic 适配均传递真实角色消息。
- 首页天气位置使用独立 LocalStorage 键，AI 对话仅内存，草稿独立保存；沿用笔记归档与任务数据。

## 安全与生命周期
天气搜索参数编码，不接受任意 URL；超时与响应限制；错误脱敏；不自动定位。媒体命令只接受枚举，禁止拼接用户 Shell。AI沿用安全传输、全应用并发与取消；工作区/配置变更使当前对话请求过期，不自动读取本地资料。清空会话取消请求，迟到回复不回填。

## 验证
领域单测覆盖天气输入/缓存/错误、聊天历史与角色边界；Electron场景覆盖导航、收集保存、天气假服务、AI fake provider、取消和布局。Windows本地媒体接口调用与macOS实体播放器分别记录，不能用假服务代替真实验收。
