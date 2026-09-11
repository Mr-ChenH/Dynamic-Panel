# AI 使用方式调研

> 2026-09-11，代码基线 `f6e56d5`。通过 Brave Search 搜索并提取公开官方文档；以下区分外部证据、代码事实与项目建议。没有试用竞品付费功能，也没有测量其准确率或延迟。

## 1. 研究问题

- 顶部常驻面板怎样使用 AI，能减少操作步骤并形成实际结果？
- 现有自动命名能否延伸为待办、笔记、录音之间的协作？
- 哪些做法适合 Electron 双平台和本地工作区，哪些需要后置？
- 如何让用户知道处理了什么、结果是否可靠、保存到哪里？

## 2. 搜索记录

| 查询或直接访问 | 目的 | 主要证据 |
| --- | --- | --- |
| `site.raycast.com AI commands selected text quick AI privacy` | 快捷命令、上下文、触发方式 | S01、S02、S03、S04 |
| `site.notion.com help AI meeting notes action items source citations enterprise search` | 录音后处理、来源限定和问答引用 | S05、S06 |
| `site.todoist.com help Task Assist AI Assistant break down tasks` | 任务生成与人工采纳 | S07 |
| `site.todoist.com help Ramble voice tasks review dates AI` | 语音生成结构化待办 | S08 |
| `site.support.apple.com Mac Writing Tools review changes replace text Apple Intelligence` | 文本改写的比较、复制与撤销 | S09 |
| `site.api-docs.deepseek.com json output structured output empty content max_tokens` | 结构化输出的边界 | S10 |
| `site.alibabacloud.com help qwen3-asr-flash-realtime timestamp speaker diarization` | 实时转写和文件识别能力差异 | S11 |
| 直接提取 `https://docs.ollama.com/api/openai-compatibility` | 本机模型适配范围 | S12 |
| `site.microsoft.com research guidelines human AI interaction make clear system can do efficient correction` | 不确定结果的纠正原则 | S13 |

搜索结果中的发布时间、营销转化率、二手模型榜单均未作为决策依据。提取工具对搜索正文有长度限制，以下只引用可见内容。微软论文 PDF 提取为乱码，没有使用该 PDF 的细节，改引用官方项目概览。Todoist 的一条历史发布页未提取出功能正文，改用现行帮助文档 S08。

## 3. 来源清单与证据

全部来源访问于 2026-09-11；网页会持续更新。

| ID | 官方来源 | 本次读到的证据 | 对本项目的推导 |
| --- | --- | --- | --- |
| S01 | [Raycast AI Commands](https://manual.raycast.com/ai/ai-commands) | 将重复提示词做成命令；可处理选中文字，输出到 Raycast 或替换选区；支持不同命令使用不同模型 | 用少量具体动作代替要求用户反复写提示词；选区替换需要另做系统适配 |
| S02 | [Raycast Quick AI](https://manual.raycast.com/ai/quick-ai) | 从 Root Search 显式进入，同窗呈现结果；上下文附件、复制/粘贴和转入长对话 | 可借用启动器入口与紧凑结果；本项目已有 Tab 导航和 Enter 动作，不照搬其键位 |
| S03 | [Raycast AI Privacy & Security](https://manual.raycast.com/ai/raycast-ai-privacy-security) | 强调显式触发与 opt-in 自动化；区分本地数据和服务端处理；描述其与供应商的约定 | 明示本次上下文和服务商；Raycast 的不训练/保留政策不能移植成自带 Key 模式的承诺 |
| S04 | [Raycast Screen Awareness](https://manual.raycast.com/ai/screen-awareness) | 捕获窗口内容、选区、截图等独立来源；可查看捕获内容；涉及辅助功能、屏幕录制与浏览器配套能力 | 功能投入远超“读窗口标题”，后置；先使用用户粘贴和面板内选择 |
| S05 | [Notion AI Meeting Notes](https://www.notion.com/help/ai-meeting-notes) | 转写、关键点和行动项；停止后生成摘要；区分麦克风与系统音频采集，支持部分音频文件上传 | 重点是录制结束后的内容整理；当前项目只录麦克风，不能宣传为完整线上会议捕获 |
| S06 | [Notion Enterprise Search](https://www.notion.com/help/enterprise-search) | 回答引用来源；可附加指定上下文、限定来源与切换网页搜索 | 工作区问答应有引用和范围选择，不能把无匹配的普通搜索自动发到云端 |
| S07 | [Todoist Task Assist](https://www.todoist.com/help/articles/use-the-task-assist-extension-with-todoist-ZgldtcPeT) | 生成任务、改善任务可执行性、拆分任务；审阅、取消勾选后添加，可重试 | “候选 → 编辑 → 采纳”适合四领域待办；当前项目无子任务结构，拆分只能是后续独立待办建议 |
| S08 | [Todoist Ramble 使用指南](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF) | 语音转任务，预览捕获结果，口头修正；区分计划日期与硬截止时间；当前属于快速捕获工具 | 本项目先复用录音后提取；只有 deadline，不引入第二个计划日期字段，也不把“周四开始”自动当截止 |
| S09 | [Apple Writing Tools](https://support.apple.com/en-ca/guide/mac-help/mchldcd6c260/mac) | 校对、改写、摘要；显示原文、撤销和恢复；只读来源提供复制 | 改写先预览、默认另存或复制；替换笔记正文时校验原版本并可撤销 |
| S10 | [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/) | 展示 `response_format: json_object`、提示中的 JSON 示例与解析流程 | JSON 语法模式不能替代本地字段、长度、来源和日期校验；空内容、截断等列为待测失败场景 |
| S11 | [阿里云 ASR 模型选型](https://www.alibabacloud.com/help/en/model-studio/asr-model) | 区分实时 WebSocket 与文件 HTTP 接口，以及不同模型的说话人、语言等能力 | 不将某个离线模型或开源模型的时间戳/分角色能力推定为当前实时接口已具备 |
| S12 | [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) | 兼容部分 OpenAI API；chat completions 支持流式、JSON、模型列表等 | 可复用请求适配层，但必须逐项检测，且需独立的 loopback 地址策略 |
| S13 | [Microsoft Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/) | 设计建议覆盖初次使用、常规交互、出错和长期使用 | 把空状态、出错后的修正、取消和恢复纳入完整流程 |

## 4. 可借鉴的使用模式

### A. 内容动作

输入范围明确，动作名字直接描述输出，例如“摘要”“精简”“翻译”“提取待办”。动作结果可以复制或保存，不要求用户维护长对话。S01、S02、S09 共同支持这一交互模式。

适配：启动器增加内置 AI 命令，笔记与录音增加就地菜单，共用结果预览。外部选中文字先手动复制/粘贴；当前没有跨平台被动读取选区的实现。

### B. 捕获后整理

转写是原始材料；摘要、决策和行动项帮助用户完成整理。S05 展示了录制后生成摘要，S08 展示了语音任务预览。

适配：保留现有录音保存链路，再从已保存的转写生成结果。首版录音结束后手动“整理录音”，不在 ASR 每个片段后重复调用 LLM。说话人和准确音频时间点需要可靠数据，首版只提供文字引用。

### C. 带来源的问答

S06 展示了在来源范围内回答并引用。与只返回文件相比有价值，但要求检索、分段、引用校验和过期处理。

适配：第二阶段先做本地关键词检索 + 有上限的文本片段 + 回答引用，不先建全盘索引、向量数据库或联网搜索服务。

### D. 自动化代理与屏幕理解

S04 展示的屏幕感知有额外系统能力；Raycast、Notion 还提供扩展/自动化体系。

适配：目前不作为 MVP。项目已有窗口焦点、透明输入区和扩展权限的复杂边界，且没有持续观察、系统回填和模型工具调用审计的完整链路。

## 5. 当前代码事实及实现缺口

下列定位使用函数名辅助查找，行号随开发变化。

| 事实 | 代码证据 | 计划必须处理的影响 |
| --- | --- | --- |
| LLM 调用集中在链接元数据与材料命名，但逻辑重复 | [main.js](../../../main.js)，`enrichLinkMetadata`、`smart:organize-material` | 抽出统一请求、取消、输出上限与错误模型 |
| 材料命名只发送前 8000 个 JS 字符单元 | [main.js](../../../main.js)，`String(...).trim().slice(0, 8000)` | 不能声称“全文理解”；新动作不得静默截断，旧自动命名超长时也应提示/跳过 |
| 笔记只给无标题内容自动命名，并保护手工标题与版本 | [renderer/app.js](../../../renderer/app.js)，`requestNoteTitle`；[renderer/domain.js](../../../renderer/domain.js)，`applyGeneratedNoteTitle` | 复用版本保护，增加手动动作和错误可见性；不把分类能力当成笔记已有功能 |
| 录音完成后自动用转写修改标题/分类 | [renderer/workspace.js](../../../renderer/workspace.js)，`organizeMaterial({ kind: 'recording' ... })` | 增加自动选项及用户修改后的并发保护 |
| ASR 当前把片段拼成字符串，没有保存可靠字词时间戳、说话人 | [main.js](../../../main.js)，`sessionTranscript`、`handleTranscriptionMessage` | 用文字片段定位；不生成虚构时间戳，不承诺音频跳转 |
| 录音有云转写和浏览器识别分支 | [renderer/workspace.js](../../../renderer/workspace.js)，`startCloudTranscription`、`startSpeechRecognition` | 浏览器识别只是可用时的降级，不是可靠的离线转写引擎 |
| 待办根结构固定 P0–P3，创建必须有合法 deadline | [renderer/domain.js](../../../renderer/domain.js)，`createTodo`；[renderer/app.js](../../../renderer/app.js)，`addTodo` | 未确定日期的候选先留预览；显式选日期后写入，不新增正式“无日期 AI 收件箱” |
| P0–P3 对应可改名的责任领域 | [renderer/app.js](../../../renderer/app.js)，`TODO_CATEGORY_KEY` | 提示词带当前显示名与内部 ID，不能把 P0 当最高优先级 |
| 启动器有笔记/待办/链接索引，未索引录音转写 | [renderer/launcher.js](../../../renderer/launcher.js)，`localResults` | 问答不能直接声称已覆盖所有材料；后续增加专门受控检索来源 |
| 工作区周期性同步全部 LocalStorage，主进程有 8 MiB 上限 | [renderer/app.js](../../../renderer/app.js)，`collectLocalStorageSnapshot`；[main.js](../../../main.js)，`workspace:save-data` | 不把 AI 原文副本、长对话和模型诊断塞入 LocalStorage；应用结果需处理保存失败 |
| LLM 地址需通过公开地址校验，当前只认有 Key 为已配置 | [main.js](../../../main.js)，`resolveLlmConfig`、`publicTranscriptionConfig`、`validatePublicHttpUrl` | Ollama 不能仅靠填写 localhost 接上；需单独设计地址与无 Key 能力 |
| API Key 本机 safeStorage 加密；没有通用模型执行工具 | [main.js](../../../main.js)、[preload.js](../../../preload.js) | 继续主进程持有 Key；模型只返回文本/数据，不能生成可执行 IPC |

## 6. 方向比较

评分为本次产品判断，5 为最有利；“投入”与“风险”得分越高表示越容易实施、风险越低。不是竞品实测排名，也没有用未验证的市场频率加权。

| 方向 | 与现有模块契合 | 短时操作价值 | 投入可控 | 数据/平台风险可控 | 建议 |
| --- | ---: | ---: | ---: | ---: | --- |
| A 当前文字动作 + 待办草稿 | 5 | 5 | 4 | 4 | MVP 先行，验证共用预览与写入 |
| B 录音转摘要、笔记和待办 | 5 | 5 | 3 | 3 | MVP 第二条路径，依赖 A 的应用结果能力 |
| C 工作区问答 | 4 | 4 | 2 | 3 | 第二阶段，先解决来源检索和覆盖率 |
| D 通用长对话页 | 2 | 3 | 3 | 3 | 暂缓，维护上下文与历史但缺少本项目特有价值 |
| E 跨应用自动执行/屏幕观察 | 2 | 3 | 1 | 1 | 后置独立研究与系统适配 |

建议组合 A+B：文字入口投入较小，又能成为录音整理的底座；C 在用户开始积累整理后的材料后再验证需求。

## 7. 取舍

- 保留文字搜索与正则的本地、即时行为；未匹配不自动变成模型请求。
- AI 提取任务要引用原文；生成新计划属于另一种“建议”动作，不混成已有承诺。
- 录音音频先保存；AI 失败不能影响录音结束和麦克风释放。
- 链接 AI 当前只有 URL 与网页标题，不能称为网页正文摘要。网页全文提取是后续独立范围。
- MVP 不做模型商店、自动模型排名或多模型并发竞答；现有配置加能力检测即可。
- 不承诺第三方不保留或不训练用户内容；BYOK 实际政策由用户选定服务商决定。
- 撤销与日期修正不是附加优化：它们决定用户是否能放心把结果写入长期数据。

## 8. 待验证假设

1. 用户最愿意采纳的是行动项，还是摘要？首版分别统计本机的操作耗时、采纳与修改；不上传内容。
2. 中文混合日期是否足够可靠？用固定本地时间、时区和人工期望值评测，而非依靠模型自报置信度。
3. 现有配置模型是否适合结构化提取？对当前模型和一个候选模型运行相同小语料集再选择；本次未发起这些调用。
4. 用户能否理解“生成”与“保存”的区别？通过原型任务验证，避免生成后用户误以为已加入待办。
5. 是否频繁遇到超过首版长度上限的录音？记录本机长度分布后决定长文分段优先级。

具体指标和测试方法见 [验收计划](06-validation-plan.md)。
