# Windows 服务端局域网配置与验收

## 服务端配置

默认安装仍只监听 localhost。新的 `WdbServiceHost.exe` 接受服务端 `--host`，桌面助手始终绑定 `127.0.0.1`。首次 LAN 部署先安装本版离线包，再在服务器**本地管理员 PowerShell**执行：

```powershell
& 'C:\Program Files\wdb\scripts\set-network.ps1' -Mode Lan -LocalAddress '172.20.115.75'
& 'C:\Program Files\wdb\scripts\show-pairing.ps1' -RevealCode
```

脚本将服务设为 `0.0.0.0:18766` 以兼容 localhost 和 LAN；防火墙规则 `WdbService-LAN` 只允许指定本机 IPv4/网卡、已安装 Node 程序、HTTPS 端口、`LocalSubnet` 来源，禁止边缘穿越。规则覆盖 Windows 的所有网络类别，因此无需把当前 Public 网络改为 Private。它不关闭防火墙，不开放 18767、CDP 或 Dart VM 端口，不覆盖已有企业防火墙策略。

需要更窄来源时指定 `-RemoteAddress '172.20.115.42'`；需要已授权的其他路由子网时明确传入其 CIDR。IP/网卡/端口变化后重新运行配置；不会自动扩大来源范围。`network.json` 记录最近配置，`installation.json` 保存监听地址，常规升级保留监听地址与凭据。改变安装路径或端口后重新运行此脚本刷新防火墙规则。

```powershell
# 回退为仅本机；移除专用防火墙规则并重启服务
& 'C:\Program Files\wdb\scripts\set-network.ps1' -Mode Localhost
```

管理脚本会重启服务，应在本地终端执行；不要在将被重启的 WDB shell 任务里执行它。服务重启可能中断正在运行的任务。后台服务已完成安装的机器无需重复 UAC 配对；用户从另一台电脑配对只需指纹和配对码。

## 客户端与阶段验收

Windows 客户端步骤见 [WINDOWS-CLIENT.md](WINDOWS-CLIENT.md)。Mac 并行开发见 [MACOS-CLI-DEVELOPMENT.md](MACOS-CLI-DEVELOPMENT.md)。

| 阶段 | 操作与证据 | 通过标准 |
|---|---|---|
| LAN 连通 | 另一台 Windows 连接服务器 IP，查看防火墙、网卡/网段 | TCP 18766 通；正确指纹配对成功；助手/调试端口不需要外部开放 |
| 身份与认证 | `devices` / `info`；隔离配置使用错误指纹、错误配对码 | 名称/IP/16 字符 ID 正确；错误身份/认证立即失败 |
| 基础闭环 | `runtime\node.exe scripts\validate-lan.js --device <IP> --output <目录>` | report 通过；人工查看截图确属服务器 |
| 多客户端 | Windows 与后续 Mac 分别配对，同时查询和提交任务 | 请求、任务、产物归属对应客户端；共享桌面不提供焦点隔离 |
| 网络中断 | 长 shell 输出唯一标记，保存任务 ID；客户端 watch；拔测试客户端网线/暂断其测试网络再恢复 | 原任务无重复执行；重新查询原 ID；watch 恢复 online |
| 服务重启 | 客户端持续 watch，服务器本地执行 `scripts\service.ps1 restart` | 自动上线，设备 ID/授权保留；未确认任务报告 unknown，不重跑 |
| 输入失联 | 专用测试程序接收触摸/按键，在运行中中断客户端网络 | 失联检测后取消并释放；重连不继续旧输入 |
| 三类应用 | 原生 UIA、Electron CDP/UIA、Flutter Inspector/UIA，必要时视觉 | 操作前观察、实际动作、读取状态、截图/日志取回形成闭环 |
| 文件性能 | 千兆有线、两端 SSD、≥1 GB 不可压缩文件，分别 push/pull | 单向有效吞吐目标≥80 MB/s；单列校验和总耗时；大于4 GB、目录/小文件另测 |

不要为模拟断网关闭服务器唯一管理网卡；使用测试客户端自己的连接。`--reconnect-timeout` 默认 60 秒，输入控制租约是客户端级别：同一客户端另一个活动请求可能续期租约，故失联测试需停掉该身份的所有流量。

当前本机交付自检见 [LAN-DELIVERY-VERIFICATION.md](LAN-DELIVERY-VERIFICATION.md)。跨电脑结果应单独追加，记录两端 OS、CPU、内存、磁盘、网卡速率、连接方式和测试版本。

## 故障定位

- TCP 不通：先在服务器 `info` 确认服务，再检查 `network.json` 的当前 IP、规则地址和网卡；检查两机可路由性、访客 Wi-Fi/AP 隔离、企业入站策略。不要关闭整机防火墙作为交付步骤。
- `CERTIFICATE_MISMATCH`：用服务器本地 `show-pairing.ps1` 核对指纹，不自动信任新证书。自签名证书不需要导入系统 CA，WDB 在发送认证和请求前验证指纹。
- `DESKTOP_UNAVAILABLE`：服务器登录并解锁，检查 `WdbDesktopHelper`；服务端 SYSTEM 身份不代表 GUI 在 SYSTEM 桌面执行。
- 截图只有远端路径：用 `pull` 取回；客户端无法直接打开 Windows 服务器本地路径。
- Electron/Flutter endpoint 拒绝：endpoint 是服务器 loopback 地址，检查被测应用是否启用调试及窗口/PID 绑定，不把 endpoint 改成客户端的 localhost。
