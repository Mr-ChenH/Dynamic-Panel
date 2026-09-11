# 修复后二次复查

复查日期：2026-09-11。

## 新发现与处理

已实际复现遗漏：取得动态结果后调用 service.execute(target)，不等待执行启动就立即 cancel，原实现仍返回 copy-text 动作。原因是执行虽进入串行队列，却没有查询所具备的 epoch 有效性校验；取消后 controller 为空，执行仍启动。

修复：执行入队时记录 queryEpoch；出队时检查 epoch、controller、abort 状态及 target 仍属于当前结果缓存，失败返回 cancelled。进程返回后再次检查 signal。新增 `cancel invalidates queued execution before it can start` 回归测试。

POSIX 静态复查另发现：进程组主进程退出可能提前清除 SIGKILL 升级定时器。complete 收尾现在也发送进程组 SIGKILL，以处理尚存的同组后代。逃逸进程组的代码仍不是这一运行模型可隔离的对象。

## 验证结论

已复核原修复对应的代码，并运行完整 npm test。新增排队执行取消与原运行中卸载、并发 registry 写入、排队查询取消测试通过。生产 Electron 的失败导航统计、错误可见性、打开期间关闭、管理页输入暂停和完成待办定位回归通过。

测试合计 129 项 Node case，128 通过、1 项 POSIX SIGTERM 测试在 Windows 跳过；3 组 Electron 场景及语法检查通过。git diff --check 通过。

结论：此次复查发现的排队执行取消遗漏已修复。已覆盖的 Windows 自动化场景通过；POSIX 强制回收仍待 macOS/Linux 实测，不宣称全平台验证完成。产品需求缺项仍以 09 审计文档为准，此次复查不将其关闭。
