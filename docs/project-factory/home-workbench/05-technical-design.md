# 技术与界面设计

## 界面
默认首页为工作台，上方今日重点和继续工作，下方快速收集、天气、音乐与 AI 入口。AI展开后使用独立对话区域，不挤占录音和旧工具。工具切换在首页内完成；经典首页 DOM 与原存储键保留。

## 文件与接口
- renderer/home.js / home.css：独立首页控制器，局部更新列表，编辑框不随轮询重建。
- renderer/workspace.js / domain.js：链接保留旧 `notch-link-groups` 结构并向记录追加描述、标签、收藏、已读、备注和时间戳；搜索支持普通关键词与 `tag:`、`domain:`、`is:`、`in:`、`before:`、`after:` 操作。
- home-services.js：天气固定 HTTPS API 请求与缓存。home-media.js：以兼容迁移的 schema v2 持久化 `music-library.json`，管理本地/网络曲目、音乐源、歌单、当前队列、去重、路径与 URL 校验、有界读取/下载以及公开元数据映射。go-music-dl adapter 读取 `/healthz`、`/collections?include_imported=1`、`/collections/:id/songs`，并通过 `/api/playlist/sources`、`/api/playlist/categories`、`/api/playlist/recommend`、`/api/playlist/user`、`/api/playlist/search`、`/api/playlist/category`、`/api/playlist/songs` 浏览平台在线歌单和个人收藏夹，最后通过 `/download?stream=1` 取得音频。
- preload.js / main.js：天气使用 `home:weather-search` / `home:weather`；音乐除原有 `home:music-library` / `home:music-mode` / `home:music-choose-files` / `home:music-add-network` / `home:music-remove` / `home:music-load` 外，增加 `home:music-select-playlist` / `home:music-refresh-source` / `home:music-add-source` / `home:music-remove-source` / `home:music-browse-categories` / `home:music-search-playlists` / `home:music-browse-category` / `home:music-browse-recommend` / `home:music-browse-user-playlists` / `home:music-select-online-playlist`。渲染层通过 `<audio>` 和 Blob URL 播放，不接触本地路径、网络直链或聚合源实际播放 URL。
- `renderer/chat-context.js` / `renderer/chat-sessions.js` / `renderer/chat-reader.js` / `ai/schema.js` / `prompts.js` / `service.js`：共享资料规范、消息封装、工作区会话 schema，以及长回答资格、标题大纲和待办来源边界；chat 使用有界 role/content 历史，OpenAI 与 Anthropic 适配均传递真实角色消息。
- 首页天气位置使用独立 LocalStorage 键，当前音乐曲目 ID 使用 `notch-home-music-track-v1`，音量使用 `notch-home-music-volume-v1`，曲目清单位于主进程 `userData/music-library.json`。AI 对话默认仅存在内存；用户确认后以 `notch-ai-chat-sessions-v1` 保存到当前工作区，包含消息、回答、失败/停止状态、请求上下文和已选资料冻结文字。最多 30 个会话和每会话 30 个回复，单会话 512,000 字符、总计 2,000,000 字符。

## 安全与生命周期
天气搜索参数编码，不接受任意 URL；超时与响应限制；错误脱敏；不自动定位。音乐文件或文件夹由系统对话框授权，支持扩展名、大小和普通文件校验；文件夹按稳定顺序递归扫描，忽略符号链接，限制为 10,000 个目录项和 20 层；网络音乐仅允许无凭据的公开 HTTPS URL，拒绝本机/私网解析和重定向，请求绑定验证后的公网地址并按流限制 128 MB。go-music-dl 来源只接受无凭据的 `localhost` / `127.0.0.1` / `::1` HTTP 地址，连接固定到回环接口且不跟随重定向；最多 8 个来源、每来源 100 个歌单、当前歌单 1,000 首曲目、JSON 2 MB、音频 128 MB。切换设置页配置面板不停止当前播放；显式切换歌单时若正在播放则加载新队列第一首继续播放，暂停状态只切换队列。删除当前曲目、切歌、切换歌单或页面卸载时停止旧音频并撤销 Blob URL。来源配置区在桌面端保持稳定高度，首页离场时暂停均衡器装饰动画。AI 沿用安全传输、全应用并发与取消；工作区/配置变更使当前对话请求过期，不自动读取本地资料。用户选择的最多 3 份文字资料经 `context.sources` 传入主进程，schema 校验类型、ID、去重和总长度；提示词将资料序列化为 JSON，并明确其为不可执行的不可信参考数据。问题、资料封装和历史合计不超过 12,000 UTF-16 code units，超限资料不截断。发送后 turn 保存来源快照，停止/失败不写入 `history`，重试复用原快照；仅完整成功轮次将带资料的用户消息写入后续历史。流式阶段以纯文本追加，完整成功后由 `renderer/markdown.js` 通过 DOM API 渲染受限 Markdown，不解析模型 HTML；模型链接交由主进程 `validatePublicHttpUrl()` 阻止凭据、本机、内网和私有 DNS。新建对话或返回工作台取消活动请求，迟到回复不回填。流式状态不持久化；成功、停止或失败结算后，已保存会话通过共享 schema 规范化并自动写入 LocalStorage 和现有 `workspace.json`。首次保存前展示资料副本范围，存储不包含附件、图片、音频、API Key 或本地绝对路径；写入或容量失败后保留内存状态并阻止静默切换，历史数据不自动淘汰。长回答入口只由完整成功 turn 创建，阅读视图仍使用 `renderer/markdown.js`，大纲从安全 DOM 的 `textContent` 生成。保存笔记与原消息共享 `savedNote` 和互斥状态；待办来源优先使用正文内显式选区，全文超过 12,000 字符时拒绝且不截断，再通过 `NotchAI.open({ action: 'extractTodos' })` 进入既有校验、预览、保存和撤销链路。

## 验证
领域单测覆盖天气输入/缓存/错误、音乐库 v1→v2 迁移、嵌套文件夹导入、重复与符号链接过滤、公开网络边界、go-music-dl 回环限制、歌单/歌曲规范化、切换持久化和播放请求；Electron 场景覆盖导航、收集保存、天气假服务、应用内 WAV 加载/播放、聚合来源与双歌单切换、AI fake provider、资料选择/冻结/重试、取消、长回答阅读/大纲/复制/笔记/待办预览和布局。真实本地格式、远程服务器和模型资料理解质量需实机验收，不能用假服务代替。
