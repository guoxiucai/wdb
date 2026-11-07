# Windows 双运行时安装器与本地构建

项目许可为 MIT。安装器支持未签名 Development 测试包及人工签名 Manual 包；CLI/npm 可通过 ServerOnly 从本轮服务端构建中排除。正式发布动作由维护者执行。CLI 分发见 [NPM-CLIENT.md](NPM-CLIENT.md)。

首轮安装/SSE 验收见 [WINDOWS-DISTRIBUTION-VERIFICATION.md](WINDOWS-DISTRIBUTION-VERIFICATION.md)；加入交互 shell / 转发后的最终包、SHA-256、安装矩阵与 30 分钟验证见 [STREAMING-WINDOWS-VERIFICATION.md](STREAMING-WINDOWS-VERIFICATION.md)。

## 构建

一键构建服务端双版本（默认不签名、不访问签名服务、不构建 npm）：

```powershell
npm run build:server
# 或 powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-server.ps1
```

只有显式加 `-Sign` 才使用 SEEWO 签名客户自动完成三轮签名：

```powershell
npm run build:server -- -Sign -BuildId server-auto-example
# 失败后检查构建日志，再使用相同参数续跑：
npm run build:server -- -Sign -BuildId server-auto-example -Resume
```

该入口沿用 Prepare → Package → Finalize，依次签内部 EXE/PowerShell、Inno 卸载缓存和两个 Setup.exe。`.e32/.e64` 以 `.exe` 文件名上传，下载后保留原缓存名。Node 保留上游签名，FFmpeg 按分发文件签名。默认输出位于 `dist/server-builds/<BuildId>/output/<版本>/`，包含双 EXE 和 SHA256SUMS.txt；不会覆盖既有 `release/0.1.0`。`-OutputDirectory` 可指定另一目录，已有不同内容文件会拒绝覆盖。

构建机需可访问 `https://mhci-sign.gz.cvte.cn/`。自动接口与页面一致：POST `/uploadAndSign`，multipart 字段 file/name/md5/customer/from，客户固定 SEEWO；响应中的 MD5 是原文件 MD5，下载后另外计算 SHA256。`-SignSource` 可传入经过维护者确认的来源字符串（如不含凭据的 CI 构建 URL）；默认只含 WDB 版本及 BuildId，不自动发送本机路径或用户信息。签名报告保存在忽略的构建目录，包含追踪 ID 和签前/后哈希；不要求浏览器权限、私钥或 PIN。

自动流程检查签名结构和程序/脚本文本不变；沿用维护者此前选择，不绑定证书指纹、不以证书链验证作为门槛。签名失败立即停止，不降级为未签名产物。已完成文件通过签后 hash 复用；已有下载结果只重试下载，上传结果未知时报告 outcome unknown 并要求人工查看服务日志后使用新 BuildId，不自动重发有副作用的 POST。`-SignTimeoutSeconds` 控制单次请求上限。普通构建完全跳过该流程。

构建机需要 Windows x64、Node/npm 22+、.NET Framework C# 编译器和 Inno Setup 6.7.1。`packaging/windows/dependencies.json` 固定 Node、FFmpeg、Inno 编译工具文件的来源和 SHA-256。Node 缓存放在 `.runtime/dependencies/node-v24.15.0-win-x64/`（node.exe 与 NODE-LICENSE.txt）；FFmpeg 缓存沿用 `.runtime/ffmpeg/`。所有校验先于执行，缓存齐备后不需要下载依赖。

```powershell
.\scripts\build-release.ps1 -Phase Prepare -SigningMode Development -BuildId my-build
.\scripts\build-release.ps1 -Phase Package -BuildId my-build
.\scripts\build-release.ps1 -Phase Finalize -BuildId my-build
.\scripts\verify-release.ps1 -ReleaseDirectory dist/release-builds/my-build/release/Development
```

Prepare 只编译一次服务宿主、桌面桥和 PtyHost，冻结公共 payload、构建模板、npm tarball 和签名前基线。Package 只消费该 BuildId，生成两个独立的单文件 EXE；每个都包含 FFmpeg、许可、服务与助手。with-node 包含已校验官方 Node；external-node 不含 Node，也不在安装时下载 Node。两者共用 AppId `{CB6CE060-4707-4E8F-880A-64CBB085D781}`、服务名和升级通道，不能并存为两套服务。

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

两个 EXE 安装器都会安装 `C:\Program Files\wdb\bin\wdb.exe` 并将此目录加入系统 PATH。安装后重新打开 PowerShell，即可运行 `wdb --help`、`wdb connect localhost:18766` 和 `wdb clients list`；首次连接仍需本机弹窗同意。已打开的终端不会自动刷新环境变量；若新标签页仍继承旧 PATH，请完全退出并重新打开终端应用。

启动器读取受保护的 `runtime-binding.json`，使用与服务相同的 Node 路径，保留当前用户身份、工作目录、标准输入输出和退出码。不会将捆绑 Node 加入 PATH，也不会提升 CLI 权限。安装器保留其他 PATH 项，升级不重复添加，失败回滚和卸载只删除它添加的 WDB 项；预先由用户添加的同路径项保留。若已有其他版本的 `wdb`，用 `Get-Command wdb -All` 检查命令优先级，或直接运行安装目录的 `bin\wdb.exe`。

服务器本机用 `wdb clients list` 查看授权，`wdb clients revoke <clientId>` 撤销授权；默认直接管理本机，无需将本机再 connect 成客户端。使用配置的桌面账户或有权限的管理员运行。显式 `--device` 用于选择远端已配对服务，详见 [CLI 指南](CLI.md)。

依赖、端口、完整性、空间和用户预检发生在停止旧服务前。事务记录和旧程序备份保存在受保护的 `C:\ProgramData\WdbInstaller`。启动校验失败恢复旧程序和运行时绑定；不会覆盖用户数据。进行中任务保持现有 SERVICE_RESTARTED/unknown 语义，不自动重跑；临时授权因重启失效，已记住授权和 TLS/deviceId 保留。

普通修复重新运行同版本 Setup；完整 payload 可通过 `scripts/repair-service.ps1 -NodePath <合格Node>` 重新绑定。缺失/改动程序文件需要 Setup 修复，不会在用户机器触发构建。开发源码安装必须显式 `-Development`，与正式 payload 分开。

通过 Windows“已安装的应用”卸载，或运行安装目录内 `unins000.exe`。卸载移除 WDB 服务、助手、规则、安装器拥有的文件和登记，默认保留业务数据；不删除外部 Node。重新安装可复用记住的授权。

诊断日志：`C:\ProgramData\WdbInstaller\installer.log`；服务/助手日志仍在 WDB 数据目录。一次性实机矩阵脚本 `scripts/validate-release-windows.ps1` 会安装、切换、卸载并重装 WDB，需在开发机管理员环境执行，且从独立 PowerShell/任务计划程序启动，不能直接在将被重启的 WDB shell 内运行。

## 人工签名续跑

仅构建服务端双 EXE 时使用 `-ServerOnly`，不构建 npm、不要求 npm 包名。维护者自行负责手动签名、无需绑定或验证证书时可显式选择 `-TrustManualSignatures`；报告记录 `user-managed-not-validated`，不宣称证书链、发布者或时间戳已验证。文件冻结与最终 SHA-256 仍执行。默认未指定该选项时保持证书/时间戳校验。

```powershell
.\scripts\build-release.ps1 -Phase Prepare -SigningMode Manual -ServerOnly -TrustManualSignatures -Publisher WDB -License MIT -LicenseFile LICENSE -BuildId server-0-1-0-signing
```

Prepare 输出的 signing-plan.json 是精确清单：当前包含四个自有 EXE（CLI 启动器、服务宿主、桌面桥、PtyHost）、十三个 PowerShell 脚本，以及本次分发的 FFmpeg。FFmpeg 保持第三方归属与许可，签名表示分发者签署此二进制；Node 保留上游签名，不重新签署。JS、JSON、配置、文档不做独立 Authenticode 签名，其内容由包内哈希清单覆盖。

只签 `common` 清单中的文件，保持 PowerShell 的 UTF-8 BOM 编码，不改正文；不要改 `pristine`。之后由 Package 生成待签卸载程序，签好再续跑；最后签两个 Setup.exe。最终文件签好后才能生成发布 SHA256SUMS，不能使用签名前的哈希。

Prepare 的 Manual 模式要求干净提交、发布者与许可信息；完整 CLI 构建还要求 npm 名称。默认要求 SignerThumbprint；TrustManualSignatures 按维护者的手动签名确认继续。它导出 signing-plan.json 与文字清单；用户对 common 清单中的 EXE/脚本逐个签名并加时间戳，再执行 Package。原始程序字节冻结；只接受 Authenticode 排除字段和附加证书、或 PowerShell 附加签名块的变化，不能用新程序替换后刷新 hash。

首次 Package 可能返回 `awaiting-uninstaller-signature` 和缓存文件路径；用户签名后用相同 BuildId 续跑。启用 `SignedUninstaller=yes`，保证编译器使用签名卸载程序/安装临时副本。两个 Setup.exe 生成后用户逐个签名，Finalize 验证发布者、时间戳、原始内容及最终 SHA-256；脚本不访问私钥或请求密码/PIN。[Inno 官方签名流程](https://jrsoftware.org/ishelp/topic_setup_signeduninstaller.htm)。

第三方 Node 保留上游签名；FFmpeg 的未签名状态如实记录，不视为自有签名。Development 模式允许未签名本地验证，Manual 模式不能跳过自有签名。真实人工证书签名、干净 Windows、Mac npm 和 registry 测试是独立验收项；本轮不会执行 npm publish 或上传安装包。
