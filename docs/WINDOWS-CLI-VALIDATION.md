# Windows CLI 局域网验证指导

适用版本：2026-11-06 起支持直接 `wdb connect <IP>` 的 Windows x64 客户端。首次连接不需要 fingerprint 或 pairingCode，由 Windows 服务端弹窗决定同意、拒绝及记住。已有客户端应替换旧包；产品版本目前仍是 `0.1.0`，用包内 `BUILD-INFO.json` 的 `sourceCommit` 区分构建。

本指南用于**另一台 Windows 客户端连接本机服务端**。同机 LAN IP 自检已完成，记录见 [连接验证](CONNECTION-APPROVAL-VERIFICATION.md)；下面的跨电脑步骤需要实际执行后才能记为通过。

## 1. 准备两台电脑

| 角色 | 准备事项 |
|---|---|
| 服务端 | WdbService 已安装并运行；用户保持登录、桌面解锁，能够看到并操作授权弹窗 |
| 客户端 | 安装 Node/npm `>=24.15.0 <25`，使用同一个 npm tarball；不安装 WdbService |
| 网络 | 客户端可访问服务端 TCP 18766；无需开放 18767、Electron CDP 或 Flutter VM Service 端口 |
| 本次目标 | `172.20.115.75:18766`，设备名 `qingwei`，设备 ID `2f493aacf427f3e9`；IP 变化时以实际地址为准 |

**客户端 PowerShell**：进入 tarball 所在目录，执行一次。以下开发包名是 `wdb-cli-local-test`，正式包名配置后应对应替换。后续未标注“服务端”的命令均在这个终端执行。先与交付的 SHA256SUMS.txt 核对 tarball SHA-256。

```powershell
Get-FileHash .\wdb-cli-local-test-0.1.0.tgz -Algorithm SHA256
$wdbPrefix = Join-Path $env:LOCALAPPDATA 'wdb-cli-validation'
npm install -g --prefix $wdbPrefix .\wdb-cli-local-test-0.1.0.tgz --ignore-scripts --offline --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '客户端安装失败' }
$wdbRoot = Join-Path $wdbPrefix 'node_modules\wdb-cli-local-test'
$wdb = Join-Path $wdbPrefix 'wdb.cmd'
$server = '172.20.115.75'
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$env:WDB_CONFIG = Join-Path $env:LOCALAPPDATA ('wdb\validation\' + $runId)
$resultDir = Join-Path (Get-Location) ('lan-result-' + $runId)
New-Item -ItemType Directory -Path $resultDir -Force | Out-Null
Get-Content (Join-Path $wdbRoot 'BUILD-INFO.json') | Tee-Object -FilePath (Join-Path $resultDir 'build-info.json')
& $wdb --version --json
& $wdb --help
Test-NetConnection $server -Port 18766
```

通过标准：SHA-256 与交付清单一致；版本命令正常；帮助中的 connect 不要求配对码；`TcpTestSucceeded=True`。`$wdb` 固定使用本次安装的 CLI，避免 PATH 中旧版命令干扰。独立配置放在当前用户目录，不覆盖日常客户端身份；同一次验证始终使用此配置。旧 portable 包仍可按 [历史入口](WINDOWS-CLIENT.md) 校验，并把 `$wdb` 指向其 `bin\wdb.cmd`。

## 2. 首次连接、设备信息与记住

```powershell
& $wdb connect $server --json |
    Tee-Object -FilePath (Join-Path $resultDir 'connect.json')
& $wdb devices --json | Tee-Object -FilePath (Join-Path $resultDir 'devices.json')
& $wdb info --device $server --json | Tee-Object -FilePath (Join-Path $resultDir 'info.json')
```

服务端操作者核对客户端名和来源 IP，**勾选“记住此客户端”并点击“同意”**，以便后续稳定性测试不被再次审批打断。服务端弹窗最多等待120秒；客户端默认等待150秒。

通过标准：首次connect 的 `status=succeeded`、`data.state=connected`；devices 中目标 `connectionState=online`；info 的 `protocolVersion=1`、`desktop.available=true`、`connection.remembered=true`，设备 ID 是16位无分隔符字符串。证书指纹自动保存，不需要从服务端抄取。普通 stdout JSON 不包含令牌。connect只返回地址和状态；客户端ID、指纹和记住状态通过info的`data.connection`读取。

再次执行`& $wdb connect $server`应仅显示`already connected to 172.20.115.75:18766`；`--json`对应`data.state=already_connected`，无需再次审批。失败时仅提示原因码，超时有单独提示；示例见 [CLI输出说明](CLI.md)。

人类可读输出示例（列间空白可能不同）：

```text
STATE              HOSTNAME             ADDRESS                          DEVICE ID
online             qingwei              172.20.115.75:18766               2f493aacf427f3e9
```

## 3. 基础功能：一条命令完成13步

开发验证脚本不属于 npm 运行依赖。把同一源码版本的 `scripts/validate-lan.js` 复制到当前目录（或在仓库执行并调整脚本路径），通过 `--cli` 显式指定已安装产物：

```powershell
node .\validate-lan.js --cli (Join-Path $wdbRoot 'src\cli.js') --device $server --config $env:WDB_CONFIG --output $resultDir
$report = Get-Content (Join-Path $resultDir 'report.json') -Raw | ConvertFrom-Json
$report | Select-Object passed, error, cleanupError, fileRoundtripVerified
$report.steps | Format-Table label, status, durationMs
Invoke-Item (Join-Path $resultDir 'desktop.png')
```

覆盖：info、默认用户 shell、中文目录/1 MiB 随机文件上传、递归下载和逐字节校验、显示器/窗口枚举、截图及拉取、主动断开、断开状态检查、重连、重连后info，以及测试文件清理。

通过标准：退出码为0；报告 `passed=true`、`fileRoundtripVerified=true`；13步均成功；人工查看 `desktop.png` 确认是**服务端**当前桌面。输出目录会保留每步 JSON、图片及往返文件；脚本只清理自己创建的服务端临时目录。

## 4. 主动断开与自动重连的区别

```powershell
& $wdb disconnect $server --json
& $wdb devices
& $wdb devices --watch --duration 5000
& $wdb connect $server --json
& $wdb devices
```

通过标准：主动断开后持续显示 `disconnected`，不会自行恢复；显式connect后恢复online，已记住的客户端不再弹窗，clientId/deviceId保持不变。`disconnect`保留凭据，撤销权限是另一条命令 `clients revoke <clientId>`。

## 5. 客户端网络中断后自动恢复

先测试状态观察：

```powershell
& $wdb devices --watch --json --duration 90000 |
    Tee-Object -FilePath (Join-Path $resultDir 'network-watch.jsonl')
```

运行期间，拔掉**测试客户端**网线或短暂断开其 Wi-Fi，保持10～15秒后恢复；保持服务端网络不变。通过标准：观察到online→offline→online，恢复时不手工connect、不再次审批，设备ID不变。watch的持续探测与普通命令的重连期限是两回事；普通命令默认重连窗口60秒。

再测试执行中的任务：下面脚本在服务端临时目录写入本次唯一标记，等待30秒后回读。它只提交一次，用标记行数判断是否重复执行。

```powershell
$marker = [guid]::NewGuid().ToString('N')
$scriptFile = Join-Path $resultDir 'network-task.ps1'
@'
$marker = '__MARKER__'
$file = Join-Path $env:TEMP ('wdb-reconnect-' + $marker + '.txt')
Add-Content -LiteralPath $file -Value $marker
Start-Sleep -Seconds 30
$count = @(Get-Content -LiteralPath $file | Where-Object { $_ -eq $marker }).Count
[pscustomobject]@{ marker=$marker; executions=$count; path=$file } | ConvertTo-Json -Compress
'@.Replace('__MARKER__', $marker) | Set-Content -LiteralPath $scriptFile -Encoding UTF8
$submitted = & $wdb shell --device $server --script-file $scriptFile --detach --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw '任务未成功提交，请先检查连接' }
$taskId = $submitted.data.id
$taskId | Set-Content (Join-Path $resultDir 'network-task-id.txt')
& $wdb task wait $taskId --device $server --reconnect-timeout 60000 --wait-timeout 120000 --json |
    Tee-Object -FilePath (Join-Path $resultDir 'network-task-result.json')
```

在 `task wait` 等待期间让客户端断网10～15秒再恢复。通过标准：等待命令自动恢复，最终 `data.status=succeeded`，`data.id`为原任务ID，`data.data.stdout`中的 `executions=1`。临时标记文件保留供复查，不修改应用数据。如果终端已超时，只查询原任务，不重新执行shell提交：

```powershell
& $wdb task get $taskId --device $server --json
```

## 6. 服务重启与异常退出后的自动恢复

使用第2节已记住的身份。**客户端**先启动观察，在下面60秒窗口内由服务端操作者执行本节的A或B。A、B分别跑一轮，分别保存记录。

```powershell
$restartRun = Get-Date -Format 'yyyyMMdd-HHmmss'
& $wdb info --device $server --json |
    Tee-Object -FilePath (Join-Path $resultDir ("restart-before-$restartRun.json"))
& $wdb devices --watch --json --duration 60000 |
    Tee-Object -FilePath (Join-Path $resultDir ("restart-watch-$restartRun.jsonl"))
& $wdb info --device $server --json |
    Tee-Object -FilePath (Join-Path $resultDir ("restart-after-$restartRun.json"))
```

**A：正常重启。服务端本地管理员 PowerShell 执行：**

```powershell
Restart-Service WdbService
Get-Service WdbService
```

**B：服务进程异常退出。服务端本地管理员 PowerShell 执行：**先核对进程路径和宿主归属，且只在唯一匹配时终止 WDB 的 Node 子进程。安装路径不同时先修改这两个路径。此轮不要手工启动服务，观察宿主是否自行拉起新进程。

```powershell
$service = Get-CimInstance Win32_Service -Filter "Name='WdbService'"
$expectedNode = 'C:\Program Files\wdb\runtime\node.exe'
$expectedScript = 'C:\Program Files\wdb\src\server.js'
$candidates = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.ParentProcessId -eq $service.ProcessId -and
    $_.ExecutablePath -eq $expectedNode -and
    $_.CommandLine -and $_.CommandLine.Contains($expectedScript)
})
if ($service.State -ne 'Running' -or $candidates.Count -ne 1) {
    throw '无法唯一确认 WDB 服务子进程，停止此次故障注入'
}
$oldServerPid = $candidates[0].ProcessId
Stop-Process -Id $oldServerPid -Force
Start-Sleep -Seconds 5
Get-Service WdbService
```

两轮通过标准：watch自行恢复online，info可查询；`serverProcessId`变化、deviceId不变，无新审批。恢复很快时可能来不及捕获offline，可结合watch中的进程变化和前后info判断。B测试覆盖Node子进程由宿主自动拉起；不等同于宿主自身崩溃、整机重启或断电验收。

本节不要通过 `wdb shell` 重启/终止承载该命令的服务。重启会打断在执行任务，故单独验证；未确认完成的任务可能返回 `unknown / SERVICE_RESTARTED`，不能要求自动重新执行。

## 7. 授权边界单独验证

保持主测试身份不变。**每个用例创建一个新的独立配置**，同一用例内复用它；若复用已记住身份，服务端不会再弹首连窗口。

```powershell
$caseConfig = Join-Path $env:LOCALAPPDATA ('wdb\validation\case-' + [guid]::NewGuid().ToString('N'))
& $wdb connect $server --config $caseConfig --name "$env:COMPUTERNAME-授权用例" --json
```

| 用例 | 服务端/后续动作 | 通过标准 |
|---|---|---|
| 拒绝 | 点击拒绝 | `PAIRING_REJECTED`，该新配置没有保存devices.json |
| 关闭 | 直接关闭弹窗 | 同上；不会建立授权 |
| 超时 | 120秒内不操作 | `PAIRING_TIMEOUT`，不保存新身份 |
| 临时同意 | 同意但不勾选记住；执行下面disconnect/connect | `info --config $caseConfig --device $server --json`显示`data.connection.remembered=false`；再次连接重新弹窗，同意后info中的clientId不变 |
| 临时授权遇到重启 | 临时同意后按第6节A重启 | 普通命令返回 `PAIRING_REQUIRED`，显式connect再次请求确认 |
| 临时授权闲置 | 停止该身份所有CLI/watch请求至少30分钟 | 后续操作要求重新确认；可作为延后验收项 |

临时授权的断开/重连命令：

```powershell
& $wdb disconnect $server --config $caseConfig --json
& $wdb connect $server --config $caseConfig --json
```

用例结束后用主测试身份 `clients list` 查找刚才的用例名称和clientId，再对**该用例的确切clientId**执行 `clients revoke`，避免遗留测试授权。不得把另一台客户端的devices.json复制过来代替首次连接。

## 8. 应用验证、故障定位与交付记录

基础连接通过后再验证应用，分别记录实际业务结果：

| 应用 | 建议路径 | 入口 |
|---|---|---|
| 希沃白板5 | windows list → UIA观察/操作 → 状态回读/截图 | [CLI桌面命令](CLI.md) |
| EasiClass | CDP + UIA，缺失时视觉兜底 | [Electron指南](ELECTRON.md) |
| 鸿镜 | Debug VM Service/Inspector + UIA + 视觉兜底 | [Flutter指南](FLUTTER.md) |

应用需在服务端安装并启动。UI结构无法获取时记录限制，继续截图及可用通道，不阻塞其他验证；接口调用成功不等于业务流程通过。`--endpoint http://127.0.0.1:...`指服务端本地调试入口。触摸按Windows模拟注入验证，当前非触摸屏设备不计入物理触屏验收。

| 现象 | 排查方式 |
|---|---|
| 仍要求fingerprint/pairingCode | 确认使用本包完整路径 `$wdb`，查看BUILD-INFO；旧服务端返回PAIRING_DENIED时也需升级服务端 |
| TCP不通/offline | 服务运行状态、实际IP、18766入站规则、两机路由/AP隔离；见 [LAN配置](LAN.md) |
| PAIRING_BUSY | 等当前弹窗处理完再试，不连续发起多个connect |
| PAIRING_DESKTOP_UNAVAILABLE | 服务端保持登录解锁，检查桌面助手 |
| approval_required | 临时许可已结束，显式connect并由服务端重新确认 |
| CERTIFICATE_MISMATCH/identity_mismatch | 核对实际服务端身份与证书变化原因，不自动清空配置或覆盖已保存指纹 |
| REQUEST_OUTCOME_UNKNOWN | 先查询原任务/服务端状态，不盲目重发有副作用的操作 |

验收时保留本次 `$resultDir`，记录两端Windows版本、客户端BUILD-INFO、连接方式、设备ID、每项通过/失败/未测及错误码。不要上传devices.json、令牌、服务端私钥或helper-secret；截图和应用日志按实际内容决定是否共享。

最小验收清单：包校验、首次同意记住、13步基础闭环、主动断开、网络自动恢复、原任务不重复、正常服务重启、Node异常退出自动恢复、拒绝/关闭/超时/临时授权。记录模板如下，不把未执行项填成通过：

| 用例 | 结果（通过/失败/未测） | 证据路径/任务ID/错误码 |
|---|---|---|
| 首次连接与记住 | 待执行 | connect.json / devices.json |
| 基础13步 | 待执行 | report.json / desktop.png |
| 网络与原任务恢复 | 待执行 | network-watch.jsonl / network-task-result.json |
| 正常重启 / 异常自动恢复 | 待执行 | restart-before/after/watch记录 |
| 授权边界 | 待执行 | 每个独立用例的结果 |
| 应用业务流程 | 待执行 | 应用名、动作、状态、截图/日志 |

1 MiB基础文件往返不用于吞吐验收；大文件、千兆吞吐、多设备、多屏、物理触屏与macOS按 [LAN验收清单](LAN.md) 单独记录。
