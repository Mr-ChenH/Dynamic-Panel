## 选择你的安装包

| 电脑 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Mac · Apple Silicon · macOS 13+ | [下载 macOS 安装包（.dmg）](https://github.com/xiaopu-ai/TO-DO-Panel/releases/download/v1.1.0/TO-DO-Panel-1.1.0-arm64.dmg) | 打开 DMG，将应用拖入「应用程序」 |
| Windows 10/11 · Intel / AMD 64 位（x64） | [下载 Windows 安装包（.exe）](https://github.com/xiaopu-ai/TO-DO-Panel/releases/download/v1.1.0/TO-DO-Panel-1.1.0-windows-x64-setup.exe) | 双击 EXE，按安装向导完成安装 |

`.sha256` 是对应文件的完整性校验码，不是安装包。官网提供 macOS 与 Windows 两个下载入口。

## 1.1.0

- 新增 Windows 版：贴顶面板、待办、笔记、链接、录音、密钥、镜子、番茄钟、指令、可选剪贴板历史与本机 AI 完成提醒。
- Windows 首版暂不提供当前窗口切换与汽水音乐控制。剪贴板点击后复制，通过 Ctrl+V 手动粘贴；AI 提醒支持展示，暂不支持点击切回任务窗口。
- 支持 Windows 托盘、开机启动、系统加密存储；Mac 和 Windows 共用业务代码与工作区格式。加密密钥不可跨电脑直接解密，迁移后需重新配置。
- 官网两个入口动态获取当前 Release 对应安装包。
- 修复工作区备份恢复时页面初始化中断及便签覆盖的问题，增加带已有数据启动的回归测试。

## 首次安装

Mac 采用 ad-hoc 签名，不进行 Apple 公证。若首次被系统拦截，打开「系统设置 → 隐私与安全性」并点击「仍要打开」。

Windows 安装包目前没有商业代码签名，首次运行可能显示「Windows 已保护你的电脑」。请确认来自本仓库 Release 并核对校验码，再通过「更多信息 → 仍要运行」继续。安装在当前用户目录，无需管理员权限。受组织策略管理的电脑可能需要管理员批准。

Windows 使用 GitHub 托管 Windows runner 验证安装、程序启动、核心 IPC、系统加密、快捷键、录音/摄像头模拟设备生命周期、重新安装数据保留与卸载。物理摄像头/麦克风、Windows 10 实机、多显示器硬件与特定安全软件不属于此次自动测试覆盖范围。
