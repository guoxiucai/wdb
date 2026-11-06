# Windows CLI 使用与 LAN 验证

目标平台：Windows 10 22H2、Windows 11 24H2/25H2，x64。包内已有 Node，无需安装 Node、npm、Python，也不需要在客户端安装 WdbService。当前包在本机 Windows 验证；跨电脑测试按下面流程执行。

## 解压与校验

解压 `wdb-client-windows-x64.zip`，在解压后的 `wdb-client-windows-x64` 目录打开 PowerShell：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-package.ps1 -Kind Client -PackageDirectory .
.\bin\wdb.cmd --version --json
$env:PATH = (Resolve-Path .\bin).Path + ';' + $env:PATH
```

后续当前终端可直接用 `wdb`。不修改全局 PATH。`--config <目录>` 或 `WDB_CONFIG` 可隔离测试身份，默认 `%LOCALAPPDATA%\wdb\client`。复制客户端包不会复制任何已配对凭据。

## 首次连接

本次准备的服务器为 **qingwei / 172.20.115.75:18766 / 2f493aacf427f3e9**。IP 如有变化，以服务器实际网卡地址为准，重新配置服务端防火墙的 LocalAddress。

1. 在服务器本地执行 `scripts\show-pairing.ps1 -RevealCode`，取得 `fingerprint` 与 `pairingCode`，通过可信方式给测试操作者。指纹是证书 DER 的 SHA-256，不是设备 ID。
2. 在客户端执行下面命令。配对码使用输入变量，避免将字面值写入命令历史；不要把凭据写入共享日志。这里的地址指 Windows **服务器**。
3. 服务器会弹出“WDB连接授权”，由本机操作者点击同意或拒绝；勾选记住可让后续连接免重复确认。等待超时或拒绝时CLI返回失败，详见 [连接授权](CONNECTION-APPROVAL.md)。

```powershell
$server = '172.20.115.75'
Test-NetConnection $server -Port 18766
$fingerprint = Read-Host '服务器 fingerprint'
$pairingCode = Read-Host '服务器 pairingCode'
wdb connect $server --fingerprint $fingerprint --pairing-code $pairingCode --name "$env:COMPUTERNAME-LAN" --json
Remove-Variable pairingCode
wdb devices
wdb info --device $server --json
```

首次配对授予完整 WDB 调试权限。每台客户端自行配对，禁止把服务器私钥、helper-secret 或另一台客户端的 `devices.json` 当作安装材料复制。已经配对时只需 `wdb connect $server`。

## 自动验证闭环

保持服务器用户登录、桌面解锁。运行脚本会截图，并在服务器用户临时目录下创建、核对和清理本次传输文件，不操作被测应用。

```powershell
.\runtime\node.exe .\scripts\validate-lan.js --device 172.20.115.75 --output .\lan-result
# 如配对使用了独立配置，上述命令追加 --config <同一目录>
```

检查 `lan-result\report.json` 的 `passed:true`，并打开 `desktop.png` 确认确实是目标服务器桌面。覆盖身份、默认用户 shell、中文目录/1 MiB 文件往返及字节校验、显示器/窗口枚举、截图拉取、主动断开与复用凭据重连。截图可能包含应用数据，测试报告目录自行保管。

如果首次同意时没有勾选记住，脚本的断开→重连阶段会再次弹窗，需要本机操作者再次确认；无人值守跑完整脚本时使用已经记住的客户端授权。

之后按 [LAN 验收清单](LAN.md) 继续网络中断、服务重启、应用与吞吐测试。本机地址自连接和 1 MiB 文件不能证明真实 LAN 吞吐或远端防火墙放行。

## Skill

将包内整个 `skills\wdb` 文件夹复制到 Agent 的 skills 目录，并在 Agent 的启动环境中加入本包 `bin` 目录到 PATH，或告知完整 `bin\wdb.cmd` 路径。例如 Codex 使用 `%USERPROFILE%\.codex\skills\wdb`，Claude Code 使用 `%USERPROFILE%\.claude\skills\wdb`。若对应目录已有自定义 Skill，先比较再替换。

也可以单独解压 `wdb-skill.zip`。Skill 不包含运行时、配对信息或模型密钥；CLI 包内 `docs` 是完整命令、Electron/Flutter 指南。

```powershell
wdb disconnect 172.20.115.75
wdb connect 172.20.115.75
wdb devices --watch
```

`disconnect` 保留授权、禁用本地自动恢复；`clients revoke <clientId>` 才是撤销授权。多台设备时每次明确 `--device`。Electron/Flutter 的 `127.0.0.1` 调试地址属于远端服务器，客户端不需要额外打通调试端口。
