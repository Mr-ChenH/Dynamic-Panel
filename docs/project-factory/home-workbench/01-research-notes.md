# 调研与范围

前轮已检索 Notion Home、Evernote Home、Things Today/Inbox、Raycast：首页以当下行动、恢复工作、收集为主；单篇固定笔记改为最近笔记入口。

来源：
- https://www.notion.com/help/home-and-my-tasks （当前跳转至导航说明）
- https://evernote.com/features/home
- https://culturedcode.com/things/support/articles/4001304/
- https://www.raycast.com/
- https://open-meteo.com/en/docs 与 https://github.com/open-meteo/open-meteo ：固定天气及地理编码 API；免费非商业、需要署名。
- https://support.apple.com/guide/watch/check-the-weather-apd07ec24f9e/watchos ：先展示未来 12 小时的状况和温度，再展示日预报。
- https://apps.apple.com/us/app/weather/id1069513131 ：成熟天气产品同时提供体感、湿度、风等指标；卡片层应保持信息优先级，详细指标进入下钻视图。
- https://support.apple.com/guide/iphone/check-the-weather-iph1ac0b35f/ios ：Apple Weather 按当前状况、小时预报和 10 天预报组织单向浏览；小时预报可横向浏览，长期预报同时呈现降水概率及高低温。
- https://www.makeuseof.com/apple-weather-app-colored-bars-explained/ ：逐日温度条使用整个预报周期的最低到最高温作为共同标尺；今天额外用圆点标记当前温度在当天区间中的位置。
- https://9to5google.com/2023/10/19/google-weather-pixel-redesign/ ：Google Weather 将 Now、小时轮播和 10 天预报合并为单一信息流，并把近期降雨提醒放在小时趋势之前。
- https://weathergraph.app/ 与 https://www.meteomatics.com/en/weather-app/ ：面向决策的天气产品在同一时间轴组合温度曲线和降雨柱，帮助用户识别升降温与降雨窗口，而不是逐格比较数字。
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager ：系统已接入 SMTC 的媒体会话。

检索：Open Meteo API free non commercial attribution geocoding api forecast；Windows GlobalSystemMediaTransportControlsSessionManager TryTogglePlayPauseAsync；Apple Weather current conditions hourly forecast precipitation wind humidity；Apple Support next 12 hours weather forecast。

执行方式：尝试Paseo（配置不兼容）及Herdr（父会话未开启控制）均不可用，改由当前代理顺序实施，不修改全局环境。
