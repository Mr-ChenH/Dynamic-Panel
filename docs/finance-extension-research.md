# 金融行情扩展研究

> 研究日期：2026-09-14
>
> 目标：为 TO-DO Panel 设计一个可以添加 A 股、美股、加密货币等资产的本地金融扩展。本文先确定交互和技术边界，不直接承诺实时行情或交易能力。

## 结论

金融功能适合做成一个独立的“行情观察”扩展，而不是把股票代码当作普通启动器命令。核心体验分成两条路径：在设置中搜索标的、确认交易所和币种并加入自选分组；在只读行情面板中查看价格与涨跌并联动单标的详情。扩展不保存券商账号或交易密码，不提供下单入口；provider API Key 只能由 Electron 主进程通过安全存储管理。

建议采用独立的金融工作区页面，不向首页增加行情卡片：

1. **金融面板**：与首页同级，提供市场总览、行情榜单、自选和单标的详情；只展示行情数据、市场状态、数据源和更新时间。
2. **设置页**：管理 provider 启用状态、API Key/token、市场覆盖、刷新频率、连接测试和数据授权说明。金融面板不承载数据源配置。

搜索结果必须显示资产类型、交易所和报价币种，避免只凭 `AAPL`、`ETH` 这类不唯一的代码添加错误标的。

当前启动器扩展协议只支持一次性 query/execute，且动态结果不提供收藏和别名。它可以用于“搜索行情”和“打开金融面板”的入口，但不能独立实现常驻刷新、行情缓存、定时提醒或详情页。因此金融功能需要一个受宿主管理的常驻扩展面板/服务能力，或先做成内置模块，再将搜索入口接入扩展系统。

## 竞品交互观察

### Apple Stocks

Apple Stocks 的交互最适合 TO-DO Panel 的紧凑工作台：侧边栏承载自选列表，搜索结果展示名称、代码、交易所和货币，点击结果旁的添加按钮即可加入当前列表；一个标的可以被加入多个用户列表。列表项通常保持名称、走势图、价格和变化值的稳定排列，用户可以在价格变化、百分比变化和市值之间切换显示。

可借鉴的规则：

- 添加前显示“交易所 + 币种”，解决同代码多市场问题。
- “我的标的”作为全量集合，用户分组作为视图；删除某分组不应误删标的本身。
- 搜索结果和自选列表使用同一行结构，降低认知切换。
- 排序和显示字段是列表级设置，不改变资产数据。
- 右键或更多菜单承载“加入分组、移除、分享、排序”等低频动作。

来源：[Apple Stocks：添加、分享、排序和移除股票代码](https://support.apple.com/guide/stocks/add-share-sort-and-remove-ticker-symbols-st9b6d0fb213/mac)、[Apple Stocks：创建和管理自选列表](https://support.apple.com/guide/stocks/create-and-manage-watchlists-std47222cd79/mac)、[Apple Stocks：改变列表中的报价显示](https://support.apple.com/guide/stocks/change-the-ticker-symbol-display-st7e0b19a267/mac)。

### TradingView

TradingView 将自选表和标的详情连接起来：点击列表中的标的，列表下方出现该标的详情；详情根据股票、基金、加密货币等类型变化。自选表可以添加分组、拖拽排序、切换指标列，并提供 Price、Financials、Performance、Risk、Technicals 等高级视图。

可借鉴的规则：

- 默认列表只保留少量高价值指标：最新价、涨跌幅、成交量、市场状态、数据时间。
- 高级指标放进详情页或可切换的次级视图，避免把首页做成密集交易终端。
- 列表中的选中行和详情保持联动，详情不打开新窗口。
- 用户可通过拖拽调整顺序，也可以按涨跌幅、名称等字段排序；需要保留“手动顺序”。
- 分组用于观察策略或主题，标签用于跨分组检索，两者职责分离。

来源：[TradingView：自选列表](https://www.tradingview.com/support/solutions/43000745825-mastering-the-tradingview-watchlists/)、[TradingView：高级自选视图](https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/)、[TradingView Charting Library Watchlist](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/Watch-List/)。

### Raycast Stock Tracker / Coin Caster

Raycast 的 Stock Tracker 将搜索结果和收藏列表都做成统一的列表项。股票行显示代码、当前价格、价格变化颜色、市场状态（盘前/盘后）和收藏状态；按回车或打开详情可以查看更丰富的标的信息。它还允许把标的固定到菜单栏。Coin Caster 采用搜索币种、显示实时价格/市值/24 小时变化、查看图表、加入 watchlist 的路径。

可借鉴的规则：

- 列表行先回答“我关注的是什么、现在多少钱、变动多少”。
- 盘前、盘后和加密货币 24 小时市场状态必须显式显示，不能用“今日涨跌”混淆。
- 收藏动作应即时反馈，且可以从搜索结果直接完成。
- 菜单栏或顶部摘要只显示用户主动固定的标的，不自动把搜索结果加入常驻区域。
- 详情页适合放图表和更多指标，列表不承担全部分析功能。

来源：[Raycast Stock Tracker](https://www.raycast.com/hmarr/stock-tracker)、[Raycast Coin Caster](https://www.raycast.com/chase_manning/coin-caster)。相关开源实现使用 Yahoo Finance 查询股票，收藏和菜单栏标的分开保存；代码资料来自 [Raycast Extensions](https://github.com/raycast/extensions/tree/main/extensions/stock-tracker)。

### CoinGecko

CoinGecko 的 Portfolio 将“观察”和“持仓记录”分开。用户可以建立多个 portfolio，按策略、链、类别或交易所组织资产；即使不输入真实交易，也可以把 portfolio 当作 watchlist。币种详情使用 CoinGecko 的稳定 coin ID，而不是仅依靠 ticker symbol，因为同一个 symbol 可能对应多个币种。

可借鉴的规则：

- 加密货币保存稳定的 provider asset ID，symbol 只作为展示和搜索词。
- 详情至少显示价格、1h/24h/7d 变化、市值、成交量和数据时间。
- “自选观察”和“持仓盈亏”分阶段实现；第一版不需要持仓数量和成本。
- 价格提醒应是用户显式创建的规则，不能由 AI 自由创建。

来源：[CoinGecko Portfolio](https://www.coingecko.com/en/portfolio)、[CoinGecko Portfolio 与价格提醒说明](https://www.coingecko.com/learn/coingecko-crypto-price-alerts-portfolio)、[CoinGecko API 文档](https://docs.coingecko.com/)。CoinGecko 文档说明搜索结果应解析为稳定 coin ID；`/coins/markets` 可以批量获取最多 250 个币种的市场数据，但 Demo API 仍有速率和授权限制。

### 开源终端和中文行情工具

`achannarasappa/ticker` 采用配置文件保存 watchlist、分组和多笔成本记录，列表可以显示币种、交易所、报价延迟、基本面、汇总和持仓；它支持股票、加密货币和衍生品。它证明“一个统一资产列表 + 分组 + 可选字段”适合跨市场观察，但终端配置不适合直接复制到桌面 UI。

`go-stock`、`MarketLens` 和 `tick-stock-panel` 展示了中文用户对 A 股、港股、美股、ETF、概念标签、K 线、新闻、资金流向和 AI 分析的需求。它们的功能范围明显大于 TO-DO Panel 的顶部工作台，尤其是实时行情、市场数据授权、K 线绘图和 AI 数据工具，适合作为后续能力地图，而不是第一版的实现范围。

来源：[ticker](https://github.com/achannarasappa/ticker)、[go-stock](https://github.com/ArvinLovegood/go-stock)、[MarketLens](https://github.com/DevQQQQQ/MarketLens)、[tick-stock-panel](https://github.com/shy3130/tick-stock-panel)。

## 建议的信息架构

### 不采用首页摘要卡

本项目已经确定金融功能与首页平级，因此不把以下竞品常见摘要卡加入首页；这份草图只保留为被否决方案：

```text
金融观察
[全部] [A股] [美股] [加密]                    [刷新] [管理]

上证指数     3,xxx.xx   +x.xx%   15:00 已收盘
贵州茅台     xxx.xx     -x.xx%   沪A · CNY
AAPL         xxx.xx     +x.xx%   NASDAQ · USD · 盘后
BTC          $xx,xxx    +x.xx%   24h · USD
```

建议默认显示 4 条，最多 6 条；卡片有独立滚动时最多显示 8 条。上涨、下跌颜色沿用项目现有状态色，但必须同时显示带符号的数值，不能只依靠颜色。数据时间和市场状态始终可见，过期数据显示“数据较旧”而不是继续伪装成实时。

### 金融面板

面板采用无固定侧栏的单一工作区，避免在固定顶部窗口内同时挤压市场导航、榜单和详情：

- 顶栏：市场状态、数据源摘要、最近取回时间和手动刷新。
- 市场视图：三类市场的数据覆盖、连接状态与可用快照；未配置 provider 只显示明确空态。
- 榜单视图：使用完整内容宽度展示当前 provider 支持的榜单，临时切换市场、加密数据源和排序；Binance 属于加密货币市场的数据源，不作为独立市场。
- 榜单前三和表格行均可打开当前项目详情；未加入自选的项目只进入当前会话的临时详情，不改变自选关系。
- 自选视图：按需显示用户分组、批量报价和当前选中资产详情；详情显示价格、序列、指标、feed、事件时间和取回时间。
- 设置页：资产搜索、加入/移除、自定义分组、provider、凭据和默认展示均集中在这里。
- 小屏：隐藏详情并保留列表，最窄宽度改为单列；不使用伪造价格填充暂不可用市场。

添加流程位于设置页，并采用搜索结果确认，而不是让用户直接填写一个模糊代码：

1. 在“金融与行情”设置中输入关键词。
2. 搜索结果按资产类型分组：A 股、美股、加密货币。
3. 每行显示名称、symbol、交易所/链、报价币种和数据状态。
4. 选择目标自选分组并点击“加入”；资产始终同时属于“全部观察”。
5. 设置页负责后续移除资产、重命名分组和删除分组。

### 分组与数据模型

建议使用独立的金融数据键，例如 `notch-finance-watchlists-v1`，不要复用链接或启动器数据。核心记录需要保存 provider、assetId、assetType、symbol、exchange、currency 和用户分组关系：

```json
{
  "schemaVersion": 1,
  "lists": [
    { "id": "default", "name": "全部观察", "assetIds": ["cn:sh:600519", "us:nasdaq:AAPL", "crypto:coingecko:bitcoin"] }
  ],
  "assets": {
    "us:nasdaq:AAPL": {
      "provider": "provider-id",
      "assetId": "AAPL",
      "assetType": "stock",
      "symbol": "AAPL",
      "exchange": "NASDAQ",
      "currency": "USD",
      "name": "Apple Inc.",
      "note": "",
      "createdAt": 0,
      "updatedAt": 0
    }
  }
}
```

行情缓存应放在主进程的内存或受控本地缓存中，用户自选配置只保存身份和偏好。原始行情响应不进入 LocalStorage，避免数据无限增长。添加、移除、分组和备注可以随工作区迁移；API Key、Cookie、券商信息和 provider 私有缓存必须留在本机安全存储。

## 数据源和市场边界

### 第一阶段建议

优先支持“可插拔 provider”而不是在 UI 里写死某个网站：

| 市场 | 最低可用字段 | 标识要求 | 注意事项 |
| --- | --- | --- | --- |
| A 股 | 名称、代码、最新价、涨跌额、涨跌幅、成交量、交易时间 | `SH/SZ/BJ + code` | 交易时段、涨跌停、复权与实时延迟需明确；供应商授权要先确认 |
| 美股 | 名称、ticker、最新价、涨跌额、涨跌幅、盘前/盘后、报价币种 | `exchange + ticker` | 实时行情常有授权或延迟；不能默认把延迟数据显示成实时 |
| 加密货币 | 名称、symbol、稳定 asset ID、价格、1h/24h/7d、成交量、市值 | `provider + assetId` | symbol 不唯一；区分现货聚合价、交易所价和链上池价 |

当前实现使用注入式 provider 响应覆盖 UI 和缓存行为测试，生产路径由主进程 `FinanceService` 接入 CoinGecko、Binance、Alpha Vantage、Alpaca、可选 Twelve Data、SEC EDGAR、QuantDash，以及可分别启停的腾讯、东方财富和新浪公开 A 股接口。Alpha Vantage 免费榜单按日终数据和约 25 次/日额度处理，使用 12 小时内存缓存；Alpaca Basic IEX 明确为单一交易所 feed，不是 SIP；Twelve Data Basic 每轮最多处理 8 个 fallback 代码，提供报价、名称搜索和历史但不提供 Pro-only movers；SEC EDGAR 只通过带联系邮箱的 Fair Access User-Agent 读取官方 XBRL 申报基本面，不提供价格或估值。QuantDash A 股路径使用用户自己的 API Key，通过 `X-API-Key` 读取实时快照、元数据和日 K；Free 实时快照为每分钟 10 次、每次最多 5 只，日 K 为每分钟 10 次、每次仅 1 只，且不支持 `CN_Stock` 全市场池。东方财富公开接口负责 A 股列表、榜单分页、按代码报价和日 K，腾讯与新浪负责按代码批量实时快照；公开源按优先级作为兼容回退，不代表稳定 SLA 或显示/再分发授权。市值榜因 QuantDash 和公开统一报价都缺少可承诺的全市场市值字段明确停用。所有真实服务仍需分别核对商业授权、请求限制、数据新鲜度、跨境网络和隐私政策；“支持某市场”不能直接等同于“免费实时”。

CoinGecko 当前提供 REST、WebSocket 和 Webhooks，但 Demo 计划有调用频率、数据新鲜度和商业授权边界。若只是个人本地观察，可以先用受限 REST 批量刷新；商业发布前需要重新审查授权，不能把免费 Demo 计划当作产品默认后端。

### 刷新策略

- 首页可见时刷新，切换到其他页停止高频刷新。
- 股票市场根据开闭市状态刷新；加密货币按较低频率轮询，第一版不强求 WebSocket。
- 同一个 provider 的多个标的合并请求，避免每行单独请求。
- 失败时保留最后一次成功值、显示“上次更新”和失败状态；指数或行情为零时不写入正常价格。
- 设置全局刷新间隔，范围建议 15 秒到 15 分钟；默认 60 秒。
- 对 provider 做并发和速率限制，取消页面请求时不能留下定时器或悬挂请求；Alpha Vantage 配额保护缓存不能被手动刷新绕过，Twelve Data fallback 单轮最多 8 个代码。

## AI 应该做什么

AI 适合帮助用户整理和解释，不应成为行情事实来源：

- 用户显式点击“AI 解读”后，将已取得的行情快照、数据时间、来源和用户问题作为冻结资料发送给现有 AI 网关。
- AI 可以生成“观察摘要、风险点、待关注事件、术语解释、比较表”，并必须显示“基于某时刻数据”。
- AI 不能自行获取实时价格、创建交易指令、代替用户下单或把不确定推断写成事实。
- “添加资产”可以提供 AI 辅助意图解析，例如把“加苹果和比特币”拆成搜索候选，但最终必须展示候选的交易所、币种和稳定 ID，由用户确认后保存。
- AI 生成的提醒条件必须先进入可编辑预览，确认后才创建；提醒触发不应执行交易动作。
- 发送给 AI 的上下文遵守项目现有 12,000 UTF-16 code units、最多 3 份资料和 API Key 不落盘规则。

建议第一版 AI 入口只有两个：

1. **解释当前标的**：对当前已选中的一条资产做摘要。
2. **比较已选标的**：最多选择 3 条，比较近一段时间变化和用户提供的观察目标。

## 与现有扩展协议的关系

当前协议可以复用这些能力：

- 启动器命令“搜索资产”“打开金融观察”。
- `navigate` 将搜索结果带回金融面板，需要扩展 `tab` 白名单。
- 本地扩展管理页展示 provider 名称、权限和数据来源。

当前协议不能直接承载：

- 常驻后台刷新和跨页面共享缓存。
- 观察列表收藏、分组和拖拽排序。
- 价格提醒定时器和独立通知队列。
- 资产搜索结果与详情页之间的连续状态。
- 需要长时间运行的 WebSocket 连接。

推荐的扩展方向是新增“受控金融 provider”能力，而不是给任意扩展开放网络权限：

```text
扩展 manifest
  ├─ financeProvider: true
  ├─ markets: [cn-stock, us-stock, crypto]
  ├─ dataPolicy: delayed | realtime | unknown
  └─ endpoints/actions 由宿主注册并校验

主进程 FinanceService
  ├─ provider 注册与能力声明
  ├─ 公共搜索、批量报价、历史区间接口
  ├─ HTTPS/DNS/响应大小/超时/速率限制
  ├─ 内存缓存与过期状态
  ├─ 本机安全配置读取
  └─ 定时刷新与通知调度

renderer finance panel
  ├─ watchlists / assets / preferences
  ├─ 搜索确认
  ├─ 列表与详情
  └─ AI 快照上下文
```

金融 provider 的网络请求仍应由主进程执行，renderer 只接收规范化后的公开数据。provider 不应读取工作区全部内容、API Key 或任意本地路径。若允许扩展自行联网，必须明确当前 Node 权限机制不是完整 OS 沙箱，且将网络权限、域名白名单、响应大小和凭据存取单独设计。

## 第一版范围建议

第一版控制在以下范围：

- 设置页提供 A 股、美股、加密货币三类搜索和添加。
- 设置页管理一个固定的“全部观察”列表和最多 8 个用户分组。
- 最多 100 个观察标的，首页最多 6 个。
- 列表显示名称、代码、交易所/链、价格、涨跌幅、币种、市场状态、更新时间。
- 点击行打开详情，显示 1D/1W/1M/1Y 小型历史走势。
- 行情页支持临时排序和手动刷新；设置页支持加入/移出分组、删除和备注。
- 过期、限流、市场关闭和数据源错误状态可见。
- AI 只做显式的快照解释和候选整理，不做自动交易和自动提醒。
- 用注入式 provider 响应完成行为测试；生产路径已接入至少一个真实 provider。

暂缓：持仓盈亏、成本批次、组合净值、期权、期货、ETF 深度数据、Level 2、K 线绘图、新闻聚合、自动选股、WebSocket 常驻连接和交易 API。

## 验收清单

- 搜索 `AAPL` 时能区分 NASDAQ、NYSE 或其他市场结果，并显示 USD。
- 搜索 `贵州茅台` 时显示沪 A、代码 `600519`、CNY 和数据状态。
- 搜索 `ETH` 时使用稳定的 provider asset ID，不能只保存 symbol。
- 关闭市场时显示“已收盘/盘后/数据时间”，不显示误导性的实时标签。
- provider 请求失败时保留最后成功值并标记时间，不清空用户列表。
- 重复添加同一个 provider + asset ID 时不会生成重复行。
- 删除分组不会删除资产；删除资产会从所有分组移除。
- 首页刷新和面板刷新合并请求，切页后停止不必要的网络轮询。
- AI 解释明确引用快照时间、来源和数据延迟，且用户未点击时不调用模型。
- 导出工作区不包含 API Key、Cookie、原始 provider 响应和本地绝对路径。
- 注入式 provider 响应覆盖缓存、过期/限流、空结果和网络错误；生产 provider 的授权与跨平台行为仍需持续验收。

## 研究来源汇总

- [Apple Stocks User Guide](https://support.apple.com/guide/stocks/welcome/mac)
- [TradingView Watchlists](https://www.tradingview.com/support/solutions/43000745825-mastering-the-tradingview-watchlists/)
- [TradingView Advanced Watchlist View](https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/)
- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)
- [Raycast Stock Tracker](https://www.raycast.com/hmarr/stock-tracker)
- [Raycast Coin Caster](https://www.raycast.com/chase_manning/coin-caster)
- [CoinGecko Portfolio](https://www.coingecko.com/en/portfolio)
- [CoinGecko API](https://docs.coingecko.com/)
- [achannarasappa/ticker](https://github.com/achannarasappa/ticker)
- [ArvinLovegood/go-stock](https://github.com/ArvinLovegood/go-stock)
- [DevQQQQQ/MarketLens](https://github.com/DevQQQQQ/MarketLens)
- [shy3130/tick-stock-panel](https://github.com/shy3130/tick-stock-panel)
- [Twelve Data Exchanges](https://twelvedata.com/exchanges)
- [Twelve Data API credits](https://support.twelvedata.com/en/articles/5615854-credits)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC Fair Access](https://www.sec.gov/about/developer-resources)
- [QuantDash 官方文档](https://docs.quantdash.net/zh-Hans)
- [QuantDash 官方示例与 SDK 说明](https://github.com/quantdash-net/QuantDash)
- [Tushare：通用行情接口](https://tushare.pro/document/2?doc_id=109)（替代来源研究）
- [Alpha Vantage API Documentation](https://www.alphavantage.co/documentation/)
