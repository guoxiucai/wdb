# Windows 后台服务与离线交付

服务端采用真正的 Windows SCM 服务 `WdbService`（开机自动启动、SYSTEM、Session 0），仅在 `127.0.0.1` 监听。桌面操作由计划任务 `WdbDesktopHelper` 在指定已登录用户的交互会话内执行，权限为 `Limited`。没有登录或桌面锁定时，服务与桌面可用性分别报告。

## 本机开发安装

首次从管理员 Windows PowerShell 运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 -Development
```

默认位置：程序宿主及随包 Node 位于 `C:\Program Files\wdb`；配置、配对、任务及日志位于 `C:\ProgramData\wdb`。默认服务端口 18766、桌面 helper 端口 18767。自定义端口必须保持服务与 helper 配置一致。随机 helper 密钥保存在 `helper-secret`，数据目录只授权 SYSTEM、管理员和指定桌面用户。

`-Development` 让后台服务直接执行当前仓库代码，方便在一次 UAC 安装后迭代验证。因此仓库内容具有管理员代码执行能力，必须保护仓库目录。正式交付不使用此开关，安装器把程序复制到 Program Files。开发安装的用户数据不包含在交付包内。

服务宿主通过 .NET Framework 编译器构建，不需要安装 .NET SDK。Windows 10/11 自带的 .NET Framework、Windows PowerShell 和 UI Automation 是平台组件。Node 运行时随包附带，不要求目标设备安装 Node 或联网下载依赖。宿主以隐藏窗口运行并监督子进程，退出后重启；日志轮转上限为每类 8 MiB 加一个历史文件。

## 生命周期

```powershell
.\scripts\service.ps1 status
.\scripts\service.ps1 diagnose
.\scripts\service.ps1 restart
.\scripts\service.ps1 stop
.\scripts\service.ps1 start
```

服务停止会结束它的进程树，进行中的任务应由应用层在下次启动时标记为中断或结果未知，不会自动重新执行。计划任务不自动登录、不自动解锁；必须在桌面用户登录后才能启动交互 helper。`diagnose` 仅报告状态和末尾日志，不输出配对凭据或 helper 密钥。

## 构建、离线安装与升级

```powershell
.\scripts\build.ps1
```

输出 `dist\wdb-windows-x64`，其中包含运行时、服务宿主、CLI、源码、脚本、Skill、使用文档和 `SHA256SUMS.txt`。整个目录复制到目标 Windows x64 设备，在管理员 PowerShell 执行该目录里的 `scripts\install-service.ps1`。安装前没有网络请求。

升级使用新版目录重新执行安装脚本，停止旧服务/helper，覆盖程序，再启动。默认保留原数据目录与 `helper-secret`。客户端凭据属于客户端自身配置，不随服务升级删除。安装失败信息见 `C:\ProgramData\wdb\install.log`；服务/桌面宿主信息见 `logs\service-host.log`、`logs\helper-host.log`。

卸载：管理员执行 `scripts\uninstall-service.ps1`，移除 SCM 服务与计划任务，保留程序文件、配置和配对。确认不再需要后可手动删除程序目录。明确指定 `-RemoveData` 才删除默认 `C:\ProgramData\wdb` 数据目录；自定义目录须手动处理。

## 验证边界

本机开发验证不等于支持矩阵全覆盖。Windows 10 22H2、Windows 11 24H2/25H2 的干净离线环境、重启后的自动启动、无人登录与锁屏场景仍需要分别执行验收。当前实现不配置防火墙或开放局域网访问。

设计参考：[Windows 服务架构](https://learn.microsoft.com/en-us/dotnet/framework/windows-services/service-application-programming-architecture)、[任务的交互用户身份](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal)。
