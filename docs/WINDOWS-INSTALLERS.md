# Windows 双运行时安装器与本地构建

当前交付是未签名的 **Development** 测试包，不发布 npm。正式 npm 名称、项目许可、发布者证书尚未配置。CLI 使用同一个纯 JS tarball，见 [NPM-CLIENT.md](NPM-CLIENT.md)。

首轮安装/SSE 验收见 [WINDOWS-DISTRIBUTION-VERIFICATION.md](WINDOWS-DISTRIBUTION-VERIFICATION.md)；加入交互 shell / 转发后的最终包、SHA-256、安装矩阵与 30 分钟验证见 [STREAMING-WINDOWS-VERIFICATION.md](STREAMING-WINDOWS-VERIFICATION.md)。

## 构建

构建机需要 Windows x64、Node/npm 22+、.NET Framework C# 编译器和 Inno Setup 6.7.1。`packaging/windows/dependencies.json` 固定 Node、FFmpeg、Inno 编译工具文件的来源和 SHA-256。Node 缓存放在 `.runtime/dependencies/node-v24.15.0-win-x64/`（node.exe 与 NODE-LICENSE.txt）；FFmpeg 缓存沿用 `.runtime/ffmpeg/`。所有校验先于执行，缓存齐备后不需要下载依赖。

```powershell
.\scripts\build-release.ps1 -Phase Prepare -SigningMode Development -BuildId my-build
.\scripts\build-release.ps1 -Phase Package -BuildId my-build
.\scripts\build-release.ps1 -Phase Finalize -BuildId my-build
.\scripts\verify-release.ps1 -ReleaseDirectory dist/release-builds/my-build/release/Development
```

Prepare 只编译一次服务宿主、桌面桥和 PtyHost，冻结公共 payload、构建模板、npm tarball 和签名前基线。Package 只消费该 BuildId，生成两个独立的单文件 EXE；每个都包含 FFmpeg/ffprobe、许可、服务与助手。with-node 包含已校验官方 Node；external-node 不含 Node，也不在安装时下载 Node。两者共用 AppId `{CB6CE060-4707-4E8F-880A-64CBB085D781}`、服务名和升级通道，不能并存为两套服务。

Release 目录包含两个 Setup.exe、同一个 npm tarball、SHA256SUMS、release-manifest、signing-report、verification-report。报告分开记录下载大小、解压 payload 大小和实机安装大小。`releaseReady:false` 表示本地开发/等待发行验收，不可当作正式签名版本。

## 安装和运行时

双击 EXE，通过正常 UAC，再确认实际桌面用户。默认目标是当前控制台用户，不使用提升后的管理员用户名。静默安装必须显式传用户：

```powershell
Start-Process '.\wdb-server-0.1.0-windows-x64-with-node-Development-setup.exe' -Wait `
  -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DESKTOPUSER="DOMAIN\User"'
Start-Process '.\wdb-server-0.1.0-windows-x64-external-node-Development-setup.exe' -Wait `
  -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DESKTOPUSER="DOMAIN\User" /NODEPATH="C:\Program Files\nodejs\node.exe"'
```

目前预检最低为 Windows 桌面 build 19045、x64、.NET Framework 4.8、Windows PowerShell 5.1 与 UI Automation 组件；实际验证平台单列在验收报告，未宣称完整 Windows 10/11 矩阵已通过。安装到 `C:\Program Files\wdb`，数据保留在 `C:\ProgramData\wdb`。客户机器不需要 npm、Git、Inno 或编译器；正式运行不会现场编译桌面桥。

外部 Node 必须是签名有效的 OpenJS Windows x64 Node `>=22.0.0`，文件和父目录仅受 SYSTEM/管理员控制。拒绝用户目录、nvm/fnm/Volta、临时目录、UNC、重解析跳转和普通用户可写目录；在信任位置与签名通过后才运行探测。绑定记录在受保护的 `runtime-binding.json`，服务与助手均使用同一绝对路径，不按 PATH 自动换 Node。删除/移动/不支持版本通过 `scripts/service.ps1 diagnose` 明确报告；SCM Running 本身不等于健康。

首次安装默认监听所有 IPv4（0.0.0.0），自动创建绑定实际 Node 路径、仅允许 LocalSubnet 访问服务端口的防火墙规则，无需手动启用 LAN。升级延续已有监听、端口和 LAN 来源范围。可选执行 `scripts/set-network.ps1 -Mode Lan -LocalAddress <本机IPv4>` 收窄网卡，或 `-Mode Localhost` 关闭 LAN。模式切换会同步更新防火墙应用路径。helper 端口不开放到 LAN。

## 升级、修复与卸载

依赖、端口、完整性、空间和用户预检发生在停止旧服务前。事务记录和旧程序备份保存在受保护的 `C:\ProgramData\WdbInstaller`。启动校验失败恢复旧程序和运行时绑定；不会覆盖用户数据。进行中任务保持现有 SERVICE_RESTARTED/unknown 语义，不自动重跑；临时授权因重启失效，已记住授权和 TLS/deviceId 保留。

普通修复重新运行同版本 Setup；完整 payload 可通过 `scripts/repair-service.ps1 -NodePath <合格Node>` 重新绑定。缺失/改动程序文件需要 Setup 修复，不会在用户机器触发构建。开发源码安装必须显式 `-Development`，与正式 payload 分开。

通过 Windows“已安装的应用”卸载，或运行安装目录内 `unins000.exe`。卸载移除 WDB 服务、助手、规则、安装器拥有的文件和登记，默认保留业务数据；不删除外部 Node。重新安装可复用记住的授权。

诊断日志：`C:\ProgramData\WdbInstaller\installer.log`；服务/助手日志仍在 WDB 数据目录。一次性实机矩阵脚本 `scripts/validate-release-windows.ps1` 会安装、切换、卸载并重装 WDB，需在开发机管理员环境执行，且从独立 PowerShell/任务计划程序启动，不能直接在将被重启的 WDB shell 内运行。

## 人工签名续跑

Prepare 的 Manual 模式要求干净提交和维护者明确提供 `-Publisher`、`-NpmName`、`-License`、`-LicenseFile`、`-SignerThumbprint`。它导出 signing-plan.json 与文字清单；用户对 common 中自有 EXE/脚本逐个签名并加时间戳，再执行 Package。原始程序字节冻结；只接受 Authenticode 排除字段和附加证书、或 PowerShell 附加签名块的变化，不能用新程序替换后刷新 hash。

首次 Package 可能返回 `awaiting-uninstaller-signature` 和缓存文件路径；用户签名后用相同 BuildId 续跑。启用 `SignedUninstaller=yes`，保证编译器使用签名卸载程序/安装临时副本。两个 Setup.exe 生成后用户逐个签名，Finalize 验证发布者、时间戳、原始内容及最终 SHA-256；脚本不访问私钥或请求密码/PIN。[Inno 官方签名流程](https://jrsoftware.org/ishelp/topic_setup_signeduninstaller.htm)。

第三方 Node 保留上游签名；FFmpeg/ffprobe 的未签名状态如实记录，不视为自有签名。Development 模式允许未签名本地验证，Manual 模式不能跳过自有签名。真实人工证书签名、干净 Windows、Mac npm 和 registry 测试是独立验收项；本轮不会执行 npm publish 或上传安装包。
