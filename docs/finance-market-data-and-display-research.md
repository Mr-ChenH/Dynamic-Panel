# 金融扩展：实时数据源与全市场展示研究

> 研究日期：2026-09-14
>
> 这份文档补充 `docs/finance-extension-research.md`，专门回答两个问题：如何获得真实行情，以及“自选 + 整个市场”在独立金融面板中应该如何组织。

## 先确定“实时”定义

行情产品不能只保存一个 `price` 字段。每次报价至少要带上：

- 标准资产身份：市场、交易所、代码或 provider asset ID。
- 价格类型：最新成交、买一/卖一、快照或 OHLC bar。
- 行情会话：盘中、盘前、盘后、休市或 24/7。
- 事件时间：数据源产生报价的时间。
- 获取时间：本机收到报价的时间。
- feed：交易所、IEX、SIP、聚合源、延迟或日终。
- 数据状态：实时、延迟、过期、错误、无交易。

“实时”只描述新鲜度，不代表覆盖整个市场。比如美股单一交易所的实时价格不等于全市场 NBBO；A 股收盘后才拿到的日线不应标成实时；加密货币聚合价也不等于某一家交易所的可成交价。

## 数据源策略

### A 股与美股公开源复核（2026-09-15）

“能从公网发出 HTTP 请求”不等于“可以在桌面产品中稳定展示并再分发”。下面的免费额度是公开页面在本次复核时看到的上限，不是 SLA；接入前仍需重新核对套餐、交易所授权和产品条款。

| 市场与用途 | 数据源 | Key/免费边界 | 稳定性与授权判断 | 当前建议 |
| --- | --- | --- | --- | --- |
| A 股实时快照/榜单 | 上交所、深交所官方行情与信息披露页面 | 公开页面不等于面向第三方应用的通用免费 API；实时数据和再分发通常需要交易所或授权供应商许可 | 来源权威，但没有适合本应用直接依赖的统一公开 REST 契约 | 生产环境采购有显示/再分发授权的 provider；不要把官网页面接口当默认 API |
| A 股实时快照 | 腾讯 `qt.gtimg.cn`、东方财富 `push2`、新浪 `hq.sinajs.cn` | 无需 Key；未发现面向第三方产品的公开 SLA、稳定版本和明确再分发许可 | 本次三者均返回可解析响应；字段、GBK 编码、限流和封禁策略可能随时变化 | 作为设置中可分别停用的兼容源；不宣称稳定 SLA 或自动获得显示/再分发权 |
| A 股历史/基础行情 | BaoStock | 免费/开源接口方向，主要适合日线和基础研究；实时覆盖、服务 SLA 与商业再分发边界需单独确认 | 比网页抓取更适合研究批处理，但不是交易所授权的实时 feed | 可作为个人本地或测试 adapter；发布前核对数据许可，不宣称实时 |
| A 股多品种研究数据 | AKShare / AKTools | 代码为开源项目，但官方文档明确接口和相关数据主要用于学术研究，并提示商业风险；无统一免费额度承诺 | 多数接口采集外部网站，字段和上游页面变化会造成回归；项目代码许可不自动授予上游数据权利 | 只用于本地研究、离线导入或开发验证；不作为 Electron 正式网络 provider |
| A 股实时快照与 K 线 | QuantDash | 用户提供 API Key；Free 实时快照为 10 次/分钟、每次最多 5 只，日 K 为 10 次/分钟、每次仅 1 只，不支持 `CN_Stock` 全市场池；Starter 及以上才提供对应批量/标的池能力 | 官方 REST 契约、统一证券代码和错误码清晰；行情约 3 秒刷新，但套餐、展示用途和服务可用性仍须按官方条款核对 | 已接入 QuantDash adapter；全市场榜单按账户权限启用，市值榜因缺少字段明确停用 |
| A 股历史、财务、其他权限化实时 | TuShare 或 Wind、同花顺 iFinD、东方财富 Choice、聚源等授权服务 | TuShare 以 Token、积分和接口权限控制；商业终端/授权服务按套餐和用途收费 | 可作为其他长期接入方向，但需确认实时级别、分钟线、展示权、用户数和再分发条款 | 不在当前生产网络链路；需要时另行确定合同与凭据模式 |
| A 股公告/财务披露 | 中国证监会、上交所、深交所、巨潮资讯 | 公开披露可查，但页面、下载和批量访问规则分别适用；这不是行情 API | 适合做公告链接和基本面出处，不应推导为实时行情授权 | 只展示官方链接或用户主动查询；批量缓存前核对站点条款和访问规则 |
| 美股实时/延迟快照 | Alpaca Market Data | Basic 免费计划的美股实时覆盖是 IEX；全美交易所覆盖需要更高套餐/权限；需用户 Key/Secret | 官方 API、HTTP/WebSocket 和快照/bar 契约清晰，但 IEX 不等于 SIP/NBBO；账户 entitlement 必须显式展示 | 当前 Electron MVP 的首选美股 provider；在 UI 标 `IEX` 或 `SIP`，不写“全市场实时” |
| 美股榜单/历史/基础字段 | Alpha Vantage | 免费覆盖多数数据集，每日 25 次请求；官方明确美国实时和 15 分钟延迟行情属于交易所授权的 premium 能力；需 API Key | API 契约清晰，免费额度不适合高频全市场轮询；`TOP_GAINERS_LOSERS` 是 provider 快照，不代表完整 SIP 市场 | 当前实现可作为低频榜单和研究补充；生产展示重新确认套餐及商业条款 |
| 美股实时/基本面/经济数据 | Finnhub | 需免费 Key；公开定价页给出免费计划的调用限制，但具体覆盖和商业使用随计划变化 | API 方便，免费层更适合个人/原型；交易所覆盖和展示权不能从“免费实时 API”字样推断 | 可做可选 adapter，不作为默认全市场 provider |
| 美股历史/实时与多市场 | Twelve Data | Basic 公开计划为 8 API credits/min、800/day；个人/非商业边界与市场覆盖按套餐执行 | 限额清楚但低频额度有限，交易所和商业展示权需逐市场确认 | 适合原型和用户自带 Key；不直接承诺商业实时 |
| 美股申报/基本面 | SEC EDGAR APIs | 无需 API Key；需规范 `User-Agent`，自动访问遵守 SEC 的速率指导（常见公开指导为不超过 10 req/s） | 官方申报数据，适合公司、XBRL 和公告事实；不提供实时行情，且字段是发行人申报口径 | 可补充基本面与公告来源，不能替代 quote provider |
| 美股 EOD 历史 | Stooq、Yahoo Finance/yfinance 等 | 多数无需 Key，但公开接口、服务稳定性、商业显示/再分发权不清晰 | 适合个人研究或一次性核对；Yahoo 内部接口不是稳定的官方开发者 API | 不进入本应用正式网络路径，除非取得明确许可并自行承受上游变化 |
| 美股生产级完整市场 | Massive（原 Polygon）、Alpaca SIP 或其他交易所授权供应商 | 通常付费并按市场数据许可、用户数和用途计费 | 覆盖、历史、延迟和授权边界比免费源清晰，成本是主要代价 | 需要“全美市场实时”时的生产方向，先采购再实现，不以免费层替代 |

本次也做了最小可达性核验：腾讯 A 股快照、东方财富 A 股 JSON 和新浪 A 股 GBK 快照均返回 `200`，SEC EDGAR 公司提交数据返回 `200`。这些结果只说明当前网络请求状态，不能证明接口长期稳定或允许商业再分发。

### QuantDash 官方契约复核

本次迁移以 QuantDash 官方中文文档、OpenAPI、定价页、FAQ、服务协议、隐私政策和官方示例仓库为依据，落地边界如下：

- API 固定为 `https://api.quantdash.net`，凭据只放在 `X-API-Key` 请求头；应用不接受自定义 QuantDash 地址，也不把密钥放进 URL、renderer 或日志。
- `/v1/quotes` 提供实时快照，支持 `symbols` 或 `universes` 二选一；`/v1/instruments` 提供名称和交易所元数据；`/v1/klines` 提供单标的列式 K 线，`/v1/klines/batch` 是后续可用的批量接口。
- A 股代码统一为 `600519.SH`、`000001.SZ`、`430047.BJ`。新自选写入 `cn:quantdash:<symbol>`；旧 `cn:tushare:*`、`cn:sh:*`、`cn:sz:*` 和 `cn:bj:*` 只在读取时映射到同一代码，不改写用户已有分组。
- 行情涨跌幅位于 `ext.change_pct`，官方示例按小数表达，进入 UI 前乘以 100；若缺失则只在 `last_price` 与 `prev_close` 都有效时确定性计算。缺失名称、市值或历史不会以 fixture 补齐。
- Free 套餐实时快照为 10 次/分钟、每次最多 5 只；日 K 线为 10 次/分钟、每次仅 1 只，支持 `1d`、`1w`、`1M`，并且不支持 `CN_Stock` 全市场池。Starter 及以上才可能提供全市场池与更高批量/频率，具体能力由连接测试实际探测，不根据套餐名称猜测。
- `401` 表示 API Key 缺失或无效，`403` 表示套餐或市场权限不足，`429` 表示限流；若响应给出 `retry_after_ms`，主进程在 30 秒至 5 分钟范围内有界退避。
- QuantDash 快照没有当前产品所需的全市场市值字段，因此 A 股市值榜直接返回“不支持”，不会用成交额、价格或外部抓取结果冒充市值。
- 服务协议允许按所购套餐用于个人研究或商业用途，但 API Key 不得共享、转让或公开；未经授权不得向外提供数据转售服务。用户自带凭据不自动授予本应用或其分发者额外展示、交易所或再分发权利。

### 公开 A 股兼容源

本次新增的三个公开 provider 使用固定的上游 HTTPS origin，由主进程统一处理请求、大小上限、取消、缓存和失败状态：

| Provider | 上游接口 | 响应与能力 | 明确边界 |
| --- | --- | --- | --- |
| 腾讯 | `https://qt.gtimg.cn/q=` | GBK 文本；按代码批量实时快照 | 没有统一全市场列表和日 K 契约；字段可能变化 |
| 东方财富 | `https://push2.eastmoney.com/api/qt/clist/get`、`ulist.np/get`；`https://push2his.eastmoney.com/api/qt/stock/kline/get` | UTF-8 JSON；A 股列表、榜单分页、按代码报价和日 K | 公开接口没有稳定 SLA；市值和字段含义按实际响应校验，不作为授权承诺 |
| 新浪 | `https://hq.sinajs.cn/list=` | GBK 文本；按代码批量实时快照 | 没有统一全市场列表和日 K 契约；字段可能变化 |

设置页分别控制三个源。实际报价请求按 QuantDash、腾讯、东方财富、新浪的优先级执行，只为仍未解析的证券调用下一来源，避免无条件扇出；返回行明确记录实际 provider/feed，自选资产 ID 则保留请求时的兼容身份，旧 QuantDash/TuShare 身份继续可读。A 股全市场榜单优先使用 QuantDash 的 `CN_Stock`（若账户有权限），否则使用东方财富 provider 原生排序页；Free QuantDash 的权限不足不会被误报为应用错误，而是降级到已启用的公开源。公开源的可达性、稳定性、字段完整性、显示和再分发权都需用户自行确认，用户自有 QuantDash Key 也不改变公开源的授权边界。

### 可执行的分级结论

- **A 股实时**：腾讯、东方财富和新浪提供无需 Key 的公开兼容接口，但没有足够明确的稳定 SLA、显示许可或再分发授权；它们已作为用户可分别停用的 fallback 接入。QuantDash Free 适合少量代码快照，`CN_Stock` 全市场榜单依赖更高套餐；产品发布仍须确认账户套餐和展示用途，且不得共享 API Key 或未经授权提供数据转售服务。
- **A 股历史**：个人研究可选 BaoStock 或 AKShare；正式产品应使用有数据许可的供应商。若只需要官方披露，不要用行情抓取接口代替上交所、深交所和巨潮的公告来源。
- **A 股财务/公告**：优先官方披露页面和具备授权的结构化服务；公开网页可链接，不代表可以无限批量抓取、存储或再分发。
- **美股实时/延迟**：MVP 采用用户自有 Alpaca Key，明确 IEX/SIP 和账户权限；低频榜单可选 Alpha Vantage，但不能把 25 次/日免费层当成全市场实时方案。
- **美股历史**：Alpaca bars、Alpha Vantage 历史接口或付费授权 provider；Stooq/Yahoo 仅做个人研究核对。
- **美股基本面**：SEC EDGAR 是官方补充源，但只负责申报和 XBRL 事实，不能提供价格、涨跌幅或市场宽度。

对本 Electron 应用的直接落地结论是：A 股保留用户主动启用并提供 API Key 的 QuantDash adapter，同时提供可分别启停的腾讯、东方财富、新浪公开兼容源；美股保留 Alpaca 和 Alpha Vantage 的主进程 adapter，各市场数据行都展示 provider、feed、session、事件时间和获取时间。API Key 只经 Electron `safeStorage` 或环境变量读取，永不进入 renderer、LocalStorage、工作区导出或 AI 上下文。QuantDash 请求固定发送到 `https://api.quantdash.net`，通过 `X-API-Key` 认证；公开源固定发送到各自上游 origin，文本源按 GBK 解码。`401`、`403`、`429` 分别作为认证、权限和限流错误处理，限流响应的 `retry_after_ms` 用于有界退避；公开源格式或网络失败则使用下一优先级源并保留 provider 错误。

参考：

- [AKShare 使用说明与免责声明](https://akshare.akfamily.xyz/introduction.html)
- [QuantDash 官方文档](https://docs.quantdash.net/zh-Hans)
- [QuantDash Python 快速开始](https://docs.quantdash.net/zh-Hans/sdk/python-quickstart)
- [TuShare 文档](https://tushare.pro/document/1?doc_id=1)（替代来源研究，不在当前生产链路）
- [Alpha Vantage API Key 与 FAQ](https://www.alphavantage.co/support/#api-key)
- [Alpaca Market Data 订阅说明](https://docs.alpaca.markets/docs/about-market-data-api)
- [Finnhub Pricing](https://finnhub.io/pricing)
- [Twelve Data Pricing](https://twelvedata.com/pricing)
- [SEC EDGAR APIs](https://www.sec.gov/edgar/sec-api-documentation)
- [Massive Pricing](https://massive.com/pricing)
- [上交所市场数据](https://www.sse.com.cn/market/stockdata/)
- [深交所市场数据](https://www.szse.cn/market/index.html)

### 默认配置不是默认密钥

建议应用首次安装时默认创建三个**数据源配置模板**，而不是内置共享 API Key：

| 默认源 | 覆盖 | 默认状态 | 适合用途 | 关键边界 |
| --- | --- | --- | --- | --- |
| CoinGecko Demo REST | 加密货币 | 可直接启用或填入用户自己的 Demo Key | 全市场币种榜单、搜索、批量价格、24h 市值和成交量 | 免费 Demo 有端点、频率和商业使用边界；WebSocket 属于付费能力 |
| Binance Public REST | 加密货币 | 无需密钥，用户可在设置中停用 | USDT 现货 24h 榜单、批量报价和日线/小时线 | 交易所行情，不等同于 CoinGecko 聚合市场价；地区可用性、限流和服务条款需单独确认 |
| Alpaca Market Data | 美股 | 需要用户填写 Key/Secret | 美股实时或延迟行情、IEX stream、快照和 bars | 免费实时股票流主要是 IEX 单一交易所；完整 SIP 和显示授权需要确认订阅 |
| Alpha Vantage | 美股 | 需要用户填写 API Key | `TOP_GAINERS_LOSERS` 涨跌榜和成交榜 | 免费层约 25 次/日且免费榜单通常为日终数据；应用使用至少 12 小时、手动刷新不可绕过的内存缓存，不代表实时或完整 SIP 市场 |
| Twelve Data | 美股 | 默认停用，需要用户 API Key；Basic 约 8 credits/分钟、800/日 | 最多 8 个未由 Alpaca 解析标的的报价、名称搜索与 1D/7D/30D 历史 | 默认 US feed 约覆盖 5% 成交量、不是 SIP；`market_movers` 需 Pro 且 100 credits/次，因此不接入榜单；再分发需要相应授权 |
| SEC EDGAR | 美股基本面 | 默认停用，无 API Key；需要用户提供 Fair Access 联系邮箱 | 官方 ticker→CIK 映射及 XBRL `companyconcept` 最近申报值 | 不提供行情；请求 User-Agent 带联系邮箱并限制为官方 `www.sec.gov` / `data.sec.gov`；应用逐项显示表单、期间和披露日 |
| QuantDash | A 股 | 需要用户 API Key；Free 实时快照限制为 10 次/分钟、每次最多 5 只，日 K 限制为 10 次/分钟、每次仅 1 只，且不支持 `CN_Stock` 全市场池 | 直接代码快照、元数据与日 K 历史；全市场榜单按套餐能力启用；行情响应没有全市场市值字段 | 固定官方 HTTPS API 与 `X-API-Key`；应用分项探测能力、不提供共享密钥，用户须确认套餐和展示用途；未经授权不得提供数据转售服务 |
| 腾讯公开行情 | A 股 | 无需 Key；按代码批量实时快照 | `qt.gtimg.cn/q=` 返回 GBK 文本，接口和字段可能变化 | 设置中可停用；不宣称稳定 SLA 或显示/再分发授权 |
| 东方财富公开行情 | A 股 | 无需 Key；A 股列表、榜单分页、按代码报价和日 K | `push2.eastmoney.com` / `push2his.eastmoney.com` 返回公开 JSON，字段和限流可能变化 | 设置中可停用；不宣称稳定 SLA 或显示/再分发授权 |
| 新浪公开行情 | A 股 | 无需 Key；按代码批量实时快照 | `hq.sinajs.cn/list=` 返回 GBK 文本，接口和字段可能变化 | 设置中可停用；不宣称稳定 SLA 或显示/再分发授权 |

新浪、腾讯、东方财富等公开接口现在作为本应用内置但可分别停用的“兼容源”接入；它们的上游 origin、编码和字段解析固定在主进程，必须显示“公开兼容源/稳定性和授权待确认”。这不改变它们缺少面向第三方产品的稳定 SLA、显示许可或再分发授权这一事实，主进程仍需执行超时、请求边界、响应大小和格式变化防护。

候选方向：

- **A 股个人本地使用**：允许用户配置 QuantDash API Key、AKShare 本地服务或其他合法 provider。QuantDash Free 只适合有界代码查询，不能假设注册即有全市场标的池访问。
- **A 股正式发布**：采购具备显示/再分发授权的供应商，或让用户自行提供其合法 API 服务。应用内置的只能是 provider adapter，不应内置共享凭据。
- **美股个人起步**：Alpaca 可作为 IEX 实时流的默认模板；如果产品需要完整美国市场，选择具有 SIP/交易所授权的计划并在 UI 标出 feed。
- **美股 REST/历史补充**：Massive（原 Polygon）、Alpha Vantage、Twelve Data 等可作为可选 provider，但每个计划的实时 entitlement、延迟和商业条款必须在设置页记录。
- **加密货币**：CoinGecko REST 适合市场榜单和低频批量刷新；交易所 WebSocket（例如 Binance 等）只应在用户明确选择交易所行情时加入，不能与聚合市场价混为一谈。CoinGecko WebSocket 当前属于付费能力。

因此“默认几个数据源”的产品实现应是：

```text
内置 provider registry
  ├─ CoinGecko REST：默认可用，但显示 Demo/限流状态
  ├─ Binance Public REST：默认可用，显示交易所现货 feed
  ├─ Alpaca：默认模板，等待用户填写凭据；IEX 明确标为单一交易所、非 SIP
  ├─ Alpha Vantage：默认停用，等待用户填写 API Key；免费榜单按日终与半日缓存处理
  ├─ Twelve Data：默认停用，等待用户填写 API Key；有界报价、名称搜索与历史，不接入 Pro movers
  ├─ SEC EDGAR：默认停用，等待用户填写联系邮箱；只提供官方申报基本面
  ├─ QuantDash：默认停用，等待用户填写 API Key；按套餐探测直接行情、K 线、元数据与全市场权限
  ├─ 腾讯公开行情：默认启用，可在设置中停用；GBK 按代码实时快照
  ├─ 东方财富公开行情：默认启用，可在设置中停用；JSON 列表、榜单、报价和日 K
  ├─ 新浪公开行情：默认启用，可在设置中停用；GBK 按代码实时快照
  └─ 自定义 provider：用户填写公网 HTTPS endpoint 和鉴权方式
```

API Key、Secret、token、SEC 联系邮箱和 Cookie 必须只经 Electron 主进程安全存储读取，不进入 renderer、LocalStorage、工作区导出、AI 上下文、URL 或诊断正文。旧 TuShare Token 不迁移或复用为 QuantDash API Key；旧 `cn:tushare:*` 自选身份只作为本地兼容标识解析为同一证券代码。自定义 provider 只允许公网 HTTPS；本地 provider 若开放，应明确是用户主动配置的 loopback 例外，并固定连接回环地址。

### 刷新方式

不能对“全市场每只资产”逐条轮询。建议按数据类型分层：

- **市场总览**：每 30–60 秒刷新一次，或在交易时段按 provider 最低频率刷新。
- **全市场榜单**：先请求 provider 的批量 snapshot/排序接口，每 60–120 秒刷新；榜单只展示前 N 条。
- **自选**：在面板可见时每 15–30 秒刷新，最多 100 个标的；同 provider 合并请求。
- **选中详情**：选中资产时请求更高频的短周期 bars；离开详情停止请求。
- **加密货币**：默认 REST 15–60 秒；只有用户启用支持 WebSocket 的 provider 才使用常驻流。
- **后台通知**：第一版不对全市场建立常驻订阅，只对用户显式设置的少量提醒订阅或轮询。

每个 provider 需要独立的速率限制器、缓存、退避和取消逻辑。定时刷新由 Electron 主进程持有单一计时器，renderer 只上报“金融页可见/展开”和当前自选资产 ID；主进程先复用 TTL 内缓存，再把完整快照通过受控 IPC 推送给 renderer。窗口切换离开金融面板后停止定时器；应用失焦时可以降频，但不应悄悄继续消耗 API 配额。手动打开或切换视图时，renderer 保留已有快照并立即渲染，网络请求在后台完成后替换成功结果，失败时继续保留旧快照并显示错误/过期状态。

## 全市场展示方案

### 不使用“全部股票列表”作为默认首页

完整市场可能包含几千到几万资产。把它们作为一张长表会带来三个问题：

1. 首屏没有回答市场发生了什么。
2. 每行实时刷新会造成大量请求和渲染压力。
3. “自选”与“市场发现”的目的混在一起，用户无法快速回到自己的观察列表。

建议金融面板采用三个主视图，顶部使用 tabs 或 segmented control：

```text
金融
[市场总览] [行情榜单] [自选]
```

右上角固定显示 feed/延迟、最后刷新和手动刷新。数据源、默认视图、刷新频率、资产搜索与自选管理统一进入设置页。

### 1. 市场总览

市场总览是独立面板的默认视图，先给市场状态，再给榜单：

```text
市场总览                                      [数据源] [刷新]

A 股                 美股                 加密货币
上证  +0.38%          S&P 500  +0.42%       全球市值  +1.18%
深证  -0.21%          Nasdaq   +0.76%       BTC       +2.04%
创业板 +0.64%         Dow      +0.08%       ETH       -0.31%
盘中 / 15:02          盘前 / 09:12          24/7 / 15:02

市场宽度                         热门方向
上涨 2,841   下跌 1,706            半导体       +3.2%
涨停  68     跌停  21              AI 应用      +2.6%
成交额 xxxx 亿                   新能源       -1.4%
```

市场总览只放指数、市场宽度、成交额/市值、热门方向和市场状态。它不承载全部个股，也不强制用户先创建自选。

### 2. 行情榜单

榜单是全市场浏览的核心，提供固定的、可解释的榜单类型：

- 涨幅榜
- 跌幅榜
- 成交额榜
- 成交量榜
- 市值榜
- 换手率榜（provider 支持时显示）
- 新高/新低榜（provider 支持时显示）
- 加密货币可加 24h 市值、成交量和波动率榜

榜单顶部先选市场，再选榜单类型：

```text
[A 股] [美股] [加密]       [涨幅] [跌幅] [成交额] [市值]
筛选：交易所  行业/分类  价格区间  涨跌幅区间
```

每行建议显示：

```text
排名  名称/代码          最新价       涨跌幅       成交额/市值    行情状态
 1    NVIDIA NVDA        $139.28      +2.17%       $...           NASDAQ · 实时
```

榜单每页最多渲染 50 行，通过上一页/下一页显式切换；页码进入内存缓存键和主进程后台刷新活动，但不写入 LocalStorage。CoinGecko 当前只对其一次请求返回的前 100 个市值样本排序分页，不宣称是全币种全局涨跌榜；Binance 与具备 `CN_Stock` 权限的 QuantDash 账户对各自批量返回集合分页。QuantDash Free 无全市场池权限，独立使用时只支持自选和精确代码查询；启用东方财富公开源后，A 股榜单使用其 provider 原生页码和上游总数，每页最多读取 50 行，不把数千条原始行情拉入 renderer 或 LocalStorage。东方财富分页响应不提供完整市场上涨/下跌/横盘统计，因此这些全量宽度指标显示为缺失，不用当前页计数冒充全市场计数。

### 3. 自选

自选视图保留现有实现方向，但要与全市场明确分开：

- 全部观察
- 用户自定义分组
- A 股 / 美股 / 加密快捷筛选
- 手动排序、涨跌幅排序、名称排序
- 点击列表行联动右侧详情
- 当前页面临时切换手动顺序、涨跌幅或名称排序

自选列表数据只保存稳定资产身份和用户偏好；行情由当前数据源缓存填充。资产属于全部观察集合，用户分组只是视图关系。添加、移除、重命名和删除分组均在设置页完成。

### 设置中的资产搜索

资产搜索属于自选配置流程，应放在设置页，并由跨市场 resolver 提供结果，不能只是前端过滤本地 fixture：

```text
输入：AAPL
结果：
  Apple Inc. · AAPL · NASDAQ · USD · stock
  Apple Hospitality REIT · APLE · NYSE · USD · stock

输入：ETH
结果：
  Ethereum · ethereum · CoinGecko · USD · crypto
  ETH/USD · 某交易所 · USD · spot
```

选择结果前必须显示完整市场身份、数据源和报价类型。加密资产保存 provider asset ID；股票保存交易所和标准 symbol；同 symbol 不得覆盖。

## 详情页的适当内容

右侧详情面板只服务当前选中资产，不与全市场榜单重复：

- 标题、标准代码、市场/交易所、币种。
- 最新价、涨跌额、涨跌幅、事件时间和获取时间。
- 市场状态：盘中、盘前、盘后、休市、24/7。
- 1D/1W/1M/1Y 时间范围切换。
- 1 分钟或 5 分钟 bars 仅在 provider 支持时显示。
- 成交量、市值、振幅等市场相关字段。
- 数据源、feed、延迟和错误状态。
- 打开官方来源页面等不改变配置的浏览动作。

图表采用成熟的 `lightweight-charts` 或同等可靠图表库；如果继续保持无构建步骤，则先使用原生 canvas 的受限走势图，待金融模块引入明确依赖后再接入完整 K 线。第一版不应手写交易终端级指标。

## 配置与展示边界

金融面板是只读浏览工作区：市场总览、行情榜单、自选列表和详情只显示规范化行情及其状态。数据源的添加、启用/停用、凭据、默认视图、默认市场、默认榜单类型、刷新频率、资产搜索和自选分组管理统一放在设置页。行情页可以保留视图切换、临时筛选、临时排序、选择详情和手动刷新；这些动作不改变 provider、自选关系或持久化默认配置。

## 推荐的最终页面结构

```text
┌─────────────────────────────────────────────────────────────┐
│ 金融观察          [市场] [榜单] [自选]     数据源 · 更新时间 · 刷新 │
├─────────────────────────────────────────────────────────────┤
│ 市场状态：A 股 QuantDash 待 Key · 美股未连接 · 加密可用         │
│ 总览：市场覆盖 / 加密全局快照 / 24h 变化榜单                     │
│ 榜单：完整内容区，按市场和排序查看已接入 provider                 │
│ 自选：分组报价 ─────────────────────────────── 当前资产详情 │
└─────────────────────────────────────────────────────────────┘
```

默认使用完整内容宽度；只在自选视图按需显示详情列。低于 900px 隐藏详情，低于 620px 将顶栏和列表改为单列，并保留固定行高，避免数据刷新造成布局跳动。全市场原始结果不写入 LocalStorage；当前尚不支持的市场显示 provider 空态。

## 数据模型调整

自选关系、provider 配置和行情快照分离；真实行情使用三个对象：

```json
{
  "watchlists": {
    "lists": [{ "id": "all", "name": "全部观察", "assetIds": [] }],
    "assets": {}
  },
  "providerSettings": {
    "coingecko": { "enabled": true, "mode": "demo-rest" },
    "alpaca": { "enabled": false, "mode": "iex" },
    "cn-stock": { "enabled": false, "mode": "user-configured" }
  },
  "marketView": {
    "view": "overview",
    "market": "cn-stock",
    "rank": "change-desc",
    "refreshSeconds": 60
  }
}
```

行情缓存不应与用户配置混存。建议主进程维护：

```text
FinanceService
  ├─ ProviderRegistry
  ├─ AssetResolver
  ├─ QuoteCache（内存 + 有界磁盘缓存）
  ├─ MarketSnapshotService
  ├─ WatchlistQuoteService
  ├─ HistoryService
  ├─ RefreshScheduler
  └─ AlertScheduler（后续）
```

renderer 通过 preload 只接收规范化对象，例如：

```json
{
  "assetId": "us:nasdaq:AAPL",
  "priceType": "snapshot",
  "price": 231.54,
  "changePercent": 0.86,
  "currency": "USD",
  "session": "regular",
  "feed": "iex",
  "eventAt": "2026-09-14T13:42:18.120Z",
  "retrievedAt": "2026-09-14T13:42:18.410Z",
  "freshness": "realtime"
}
```

## 二次展示研究与本次取舍

本次重新核对了 TradingView、Apple Stocks、Yahoo Finance、雪球和东方财富的公开产品资料，得到三个稳定的展示规律：

- **先看整体，再看个体**：TradingView 的 Market Overview 和 Heatmap 先用指数、市场范围、相对涨跌和权重回答“哪里在动”；Yahoo Finance 把市场总览、热力图和 watchlist 分开；东方财富把指数、板块、排行、自选和个股行情分层。面板首屏不应只放几张孤立指标卡。
- **曲线必须有时间范围和对象**：Apple Stocks 将交互式价格曲线作为 ticker 详情核心；TradingView 将图表和 watchlist 选中项联动。曲线需要明确是全球总市值、指数，还是某个资产的价格，不能用无标签的装饰性 sparkline。
- **颜色提供扫描线索，数字提供证据**：TradingView Heatmap 用面积表示权重、颜色表示变化；watchlist 同时保留价格、涨跌、成交量等数值。TO-DO Panel 不接入交易终端级热力图，但采用同一原则：市场宽度显示 provider 返回样本的上涨/横盘/下跌数量，曲线使用 provider 的时间戳序列。

对应的实现调整如下：

1. 市场总览首屏增加全市场总市值、24h 变化、成交额、BTC 市占率、活跃资产和数据状态。
2. 增加“上涨 / 横盘 / 下跌”市场宽度，并明确标注“仅统计 provider 当前返回的资产”，不把 Top 100 样本冒充完整市场。
3. 优先请求 CoinGecko `/global/market_cap_chart` 显示全球总市值 7 日曲线；该接口需要符合条件的计划。没有权限时改用真实 BTC 7 日序列作为“市场代理”，标题和来源均明确写出代理身份。
4. 自选详情通过 CoinGecko `/coins/{id}/market_chart` 加载 1D / 7D / 30D 时间序列；启用 Twelve Data 时，美股详情通过有界 `time_series` 请求加载对应历史，否则显示不可用，不以当前价重复绘图。
5. 美股详情可独立请求 SEC EDGAR XBRL 基本面；历史或基本面任一失败都不阻断另一部分，申报值逐项保留表单、期末日与披露日。
6. AI 采用用户主动点击的快照解读，引用当前 provider 返回的数据、来源和时间；模型只能总结事实，不能预测或生成买卖建议。

参考： [TradingView Watchlists](https://www.tradingview.com/support/solutions/43000745825-mastering-the-tradingview-watchlists/)、[TradingView Heatmaps](https://www.tradingview.com/support/solutions/43000766446-tradingview-heatmaps-from-global-trends-to-details/)、[Yahoo Finance Markets](https://finance.yahoo.com/markets/stocks/52-week-gainers/heatmap/)、[Apple Stocks User Guide](https://support.apple.com/guide/stocks/welcome/mac)、[雪球行情中心](https://xueqiu.com/hq)、[东方财富行情中心](https://quote.eastmoney.com/center/)、[CoinGecko Global Market Cap Chart](https://docs.coingecko.com/reference/global-market-cap-chart)、[CoinGecko Market Chart](https://docs.coingecko.com/reference/coins-id-market-chart)。

## GitHub 数据源复核

本轮同时检查了公开仓库所代表的数据获取路径，结论按“能否作为发布版内置 provider”而不是按项目热度排序：

- [`binance/binance-public-data`](https://github.com/binance/binance-public-data) 是 Binance 官方公开历史文件说明，可用于校验归档数据；应用内实时榜单使用同一官方体系的 Spot REST `/api/v3/ticker/24hr`。`MINI` 明确省略 `priceChangePercent`，因此全量榜单基于它返回的真实 `openPrice` / `lastPrice` 计算 24h 变化，以控制响应低于 2 MB；有界单标的/批量报价请求使用 `FULL` 的直接变化字段。该源已作为可停用、无密钥、明确标注交易所现货的 provider 接入。
- [`alphavantage/alpha_vantage_mcp`](https://github.com/alphavantage/alpha_vantage_mcp) 证明官方服务公开支持 `TOP_GAINERS_LOSERS`。应用把它作为用户自带 API Key 的可选美股涨跌/成交榜源；免费结果按日终数据标注，并通过 12 小时配额保护缓存避免自动或手动刷新消耗约 25 次/日的额度，不将榜单快照解释为完整 SIP 市场。
- [`alpacahq/alpaca-py`](https://github.com/alpacahq/alpaca-py) 是 Alpaca 官方 SDK，但当前 Electron 服务继续直接调用受限 HTTPS REST，以避免引入 Python 运行时；Basic IEX 明确标为单一交易所 feed，SIP entitlement 仍由用户账户决定。
- Twelve Data 作为可选美股补充 adapter 接入报价、符号搜索和历史；Basic 的 8 credits/分钟、800/日约束落实为每轮最多 8 个 fallback 代码和 60 秒报价缓存。默认 US feed 不是 SIP，`market_movers` 需要 Pro 且单次成本高，因此当前不用于榜单。
- SEC EDGAR 作为独立的无 Key 基本面 adapter 接入官方 ticker 映射和 XBRL `companyconcept`。用户必须配置联系邮箱供 Fair Access User-Agent 使用；应用只返回有界规范化申报指标，不读取价格，也不合成估值。
- [`ranaroussi/yfinance`](https://github.com/ranaroussi/yfinance) 覆盖广、适合个人研究，但依赖非官方 Yahoo Finance 接口，其 README 对研究/教育和个人使用的边界有明确提示，因此不作为发布版默认实时源。
- [`akfamily/akshare`](https://github.com/akfamily/akshare) 对 A 股覆盖丰富，但聚合多个网页与公开接口，响应稳定性、上游条款和再分发授权无法由本应用统一保证，因此只保留为未来“用户主动配置的本地 adapter”候选，不直接内置。
- 对 AKShare、efinance、adata、easyquotation、Ashare、mootdx、pytdx、TuShare、BaoStock 及三个下游应用的源码复核显示，GitHub 上大量所谓“多源”实现最终集中到东方财富 `push2` / `push2his`、新浪 `hq.sinajs.cn`、腾讯 `qt.gtimg.cn`、百度、同花顺或通达信 TCP 7709。efinance 与 AKShare 的常用 A 股函数尤其高度共享东方财富故障域；开源许可证只覆盖客户端代码，不证明这些上游允许产品展示或再分发。
- AKShare 的代码名称函数会直接组合上交所、深交所和北交所公开列表，可作为未来独立股票目录的技术参考。但交易所网站端点不是带 SLA 的正式行情 API；在授权、更新与缓存方案确定前，本应用不新增这些域名，也不把它们作为行情 fallback。

因此本次扩展落地 Binance Public REST、Alpha Vantage、Alpaca、可选 Twelve Data、SEC EDGAR、用户 API Key 驱动的 QuantDash，以及明确标为公开兼容源的腾讯、东方财富和新浪 adapter；TuShare、yfinance、AKShare、efinance、其他网页门户行情及各类 MCP 封装不进入当前生产网络链路。所有新增远程请求仍经过主进程固定 origin、DNS 公网校验、无重定向、10 秒超时和 2 MB 响应上限。

## GitHub 展示模式复核

为避免只参考商业行情产品，本轮又检查了几个可运行的 GitHub 项目，并只借鉴展示结构，不引入其数据源、交易能力或模拟数据：


- [`hkgunawan/market-dashboard`](https://github.com/hkgunawan/market-dashboard)：用少量可选标的卡建立明确的选中态，主图占据首要空间，时间范围紧贴图表标题。适合借鉴“先选对象，再看详情”的联动关系。
- [`heinzZzy91/OpenTerminal`](https://github.com/heinzZzy91/OpenTerminal)：将 chart、quote、watchlist 作为可组合的工作区单元；watchlist 用固定列展示 `Sym / Last / Chg% / Vol`，点击行驱动主图和报价详情。其 heatmap 还验证了面积表达权重、颜色表达变化的扫描模式。
- [`dylanpersonguy/OpenCharts`](https://github.com/dylanpersonguy/OpenCharts)：主图与报价列表联动，详情状态集中在当前标的，避免每个列表项都展开一份完整图表。
- [`achannarasappa/ticker`](https://github.com/achannarasappa/ticker)：终端环境下优先显示紧凑的代码、价格、涨跌和更新时间，适合作为高密度列表的信息分层参考。

本轮界面据此做了三项调整：

1. 市场总览把真实时间序列提升为主视觉，右侧只保留市场总值和少量市场焦点；市场状态改成带来源、会话和状态的横向信息带。
2. 市场焦点列表改为可点击行，点击真实资产会联动主图；只有 BTC fallback 才显示“市场代理”，不把普通资产曲线误称为市场走势。
3. 自选改成带列头的紧凑行情表，固定显示标的、7 日走势、最新报价和事件时间；行使用键盘可访问的 button，详情仍只在自选视图出现。

没有采用 OpenTerminal 的可拖拽 widget 网格、heatmap 全市场覆盖或交易执行，因为当前应用的目标是常驻本地只读工作台，且 provider 目前不能合法、完整地提供这些数据。

## 实施顺序

1. 已将当前金融 UI 接入 `FinanceService` IPC；使用注入式 provider 响应覆盖缓存、错误和空态测试。
2. 已增加数据源管理页：启用/停用、密钥状态、连接测试和 `safeStorage` 保存/清除。
3. 已接入 CoinGecko REST，完成真实搜索、全市场 crypto 榜单、全局快照和批量自选报价。
4. 已接入 Binance Public REST 的 USDT 现货榜单、批量报价、搜索与历史序列，以及 Alpha Vantage 用户密钥驱动的美股涨跌/成交榜；Binance 在榜单中作为加密货币市场内的可选来源，不再显示为独立市场；两者均保留 feed 边界和显式不可用状态。
5. Alpaca 已接入用户配置的美股精确代码搜索和批量快照，并明确 Basic IEX 为单一交易所 feed、不是全市场 SIP；Twelve Data 已作为可选后备接入最多 8 个代码的报价、名称搜索和 1D/7D/30D 历史，不接入 Pro-only movers。
6. SEC EDGAR 已通过独立 IPC 接入美股详情，使用带联系邮箱的 Fair Access User-Agent，按指标显示最近可用 XBRL 申报值及其表单、期间和披露日；它不提供行情或估值。
7. 启动阶段会先由 Electron 主进程执行一次受限预热，填充总览、当前榜单和当前自选的进程内存缓存；此预热不激活行情页、不启动隐藏页的周期请求。后续自动刷新仍由主进程在行情页可见且展开时按设置频率预取，renderer 保留并立即展示已有快照，后台成功结果通过 IPC 替换。
8. 已将 A 股 provider 迁移到 QuantDash，支持约 3 秒实时快照、每批最多 5 只且单次刷新至多 4 批的直接报价、精确代码搜索、元数据和日 K 历史。连接测试分别探测直接快照、K 线、元数据与 `CN_Stock` 全市场权限；Free 套餐保持自选与代码查询可用，全市场榜单明确提示套餐限制，市值榜明确不支持。旧 TuShare Token 不迁移，旧自选 ID 继续兼容读取。
9. 已将金融面板改为“市场 / 榜单 / 自选”三个只读视图，在设置中实现资产搜索和自选管理；市场总览增加真实全局快照、市场宽度和全球/代理曲线，榜单前三和表格行点击后可直接切换到当前项目的详情。
10. 已增加 CoinGecko 1D/7D/30D 历史序列、canvas 曲线、错误状态、缓存过期和 AI 快照解读；虚拟列表、分页 cursor、成熟 K 线和跨市场历史仍是后续工作。
11. 后续再做提醒、成熟 K 线、更多 provider 的历史 bars、新闻和更深的市场分析。

## 结论

适合 TO-DO Panel 的产品不是一个交易终端，也不是一张无限长的股票表，而是一个本地、只读、来源透明的市场观察台：

- 默认可以创建 provider 模板，但不共享密钥。
- 加密货币可以先用 CoinGecko REST 真实运行。
- 美股默认模板应明确 IEX 与 SIP 的差异；Twelve Data Basic 同样不能标为 SIP，SEC EDGAR 只能标为申报基本面。
- A 股通过用户自有 QuantDash API Key 解决 provider 配置缺口；Free/Starter 能力和展示用途仍在 provider 账户层确认，API Key 不得共享或转让，未经授权不得提供数据转售服务。
- 全市场通过总览和榜单发现，自选通过独立列表持续跟踪，详情通过选中行展开。
- 所有价格都必须带 feed、市场状态、事件时间、获取时间和新鲜度。
- 不将全市场原始行情写入 LocalStorage，不用实时刷新制造“看起来像实时”的假象。

## 参考资料

- [CoinGecko API 文档](https://docs.coingecko.com/)
- [CoinGecko WebSocket](https://www.coingecko.com/en/api/websocket)
- [Alpaca Market Data](https://docs.alpaca.markets/docs/about-market-data-api)
- [Massive Stocks API](https://massive.com/stocks)
- [Alpha Vantage API Documentation](https://www.alphavantage.co/documentation/)
- [Twelve Data Stocks API](https://twelvedata.com/stocks)
- [Twelve Data API credits](https://support.twelvedata.com/en/articles/5615854-credits)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC Fair Access](https://www.sec.gov/about/developer-resources)
- [QuantDash 官方文档](https://docs.quantdash.net/zh-Hans)
- [QuantDash 官方示例与 SDK 说明](https://github.com/quantdash-net/QuantDash)
- [AKShare 股票数据](https://akshare.akfamily.xyz/data/stock/stock.html)
- [stock-api：腾讯/新浪/东方财富 adapter](https://github.com/zhangxiangliang/stock-api)
- [TradingView Watchlists](https://www.tradingview.com/support/solutions/43000745825-mastering-the-tradingview-watchlists/)
- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)
