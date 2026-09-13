# 执行安排

原拟服务层、AI适配、首页UI分工。当前Paseo因daemon.browserTools配置不兼容无法启动，Herdr因父会话未启用session-control不可用。因此由当前代理顺序执行TASK-001至TASK-005，不修改全局配置、不重启守护进程。

集成门禁：服务输入白名单与上限→聊天角色及adapter测试→首页交互→npm test→Electron截图→文档。无独立代理审核，不将自检称为独立审核。
