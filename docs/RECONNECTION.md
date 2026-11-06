# 自动重连与设备标识

## 设备如何标识

`wdb devices` 实时探测已配对设备，同时展示状态、设备名、服务地址和唯一 ID，例如：

```text
STATE              HOSTNAME             ADDRESS                          DEVICE ID
online             qingwei              https://127.0.0.1:18766          e032c011-1a94-4882-887c-b8e9c62d1ce1
```

- `hostname` 是服务端 Windows 计算机名，用于识别和显示，可以重复或改名；不是安全身份。`connect --name` 设置的是客户端授权记录名称，不是服务端别名。
- `url` 是 HTTPS 地址与端口，用于网络访问。localhost 验证显示 `127.0.0.1:18766`；LAN 场景使用目标 IP 或主机地址。IP 变化后需更新地址，不按同名设备自动迁移授权。
- `deviceId` 是服务端持久化 UUID，保存在数据目录的 `config.json`；服务进程或 Windows 服务重启后不变。删除数据后重新初始化会生成新 ID。证书指纹用于连接前验证服务器，响应还检查 `deviceId`。

`--device` 支持地址、UUID、已记录的设备名；名称重复时返回 `AMBIGUOUS_DEVICE`，必须改用地址或 UUID。JSON 列表的 `enabled` 表示本地是否允许使用该设备，`connected` 表示本次探测是否在线；不再把历史配对记录当作实时连接状态。离线仍保留最近记录的设备名。

| connectionState | 含义 |
|---|---|
| online | TLS、身份、授权和健康探测成功 |
| offline | 服务或网络当前不可达；保留凭据，后续可以自动恢复 |
| disconnected | 用户主动断开，不自动恢复，需再次 connect |
| unauthorized | 授权无效或撤销 |
| identity_mismatch | 证书指纹或 deviceId 改变 |
| incompatible | 协议版本不兼容 |

## 自动恢复的范围

CLI 使用按请求建立的 HTTPS 连接，不需要额外客户端后台进程。已配对设备的新命令会复用凭据；执行中的查询/任务等待在瞬时网络错误后自动重连。默认恢复窗口 **60 秒**，重试间隔从 250 ms 增长到最多 3 秒；`--reconnect-timeout <ms>` 可调整，设 0 禁用。`--request-timeout <ms>` 控制单次请求等待，默认 10 秒。

任务提交携带唯一 `submissionId`，支持去重的服务端先持久化再执行；接受回包丢失时，重连取回同一个任务，不再执行一次。去重记录随任务保留（默认 24 小时）。只有确认服务端支持去重才自动恢复已送出的提交；旧服务端或其他不可安全重复的操作遇到不确定结果时返回 `REQUEST_OUTCOME_UNKNOWN`。身份、证书或授权错误立即停止自动重试，不自动重新配对。

长 shell/部署任务在网络中断期间继续运行，恢复后查询原任务。服务重启时，已持久化完成的结果保持原状态；尚未确认完成的任务变为 `unknown / SERVICE_RESTARTED`，不会自动重跑。输入任务仍遵循失联取消并释放按键/触点的规则；重连不会恢复已取消的轨迹。

文件传输开始前可以等待连接恢复，传输途中断开仍失败并清理半成品，不续传。日志订阅断线仍结束，需要重新订阅。主动 `disconnect` 立即禁用本地连接，即使服务已离线也生效；无法通知服务端时返回 `remoteNotified:false`，服务端输入任务由原有失联超时处理。

Windows 服务宿主会在 Node 服务进程异常退出后约 2 秒重新启动它；宿主本身异常退出则由 Windows SCM 恢复，当前安装配置依次为 5 / 10 / 30 秒后重启。这里不包含整机启动耗时。用户助手启动时短暂拒绝连接，服务端最多等待 5 秒；仅重试明确的连接拒绝，收到请求后丢失回包不会重复派发操作。

## 使用与验证

```powershell
# 持续观察状态变化；恢复上线自动输出，Ctrl+C 停止观察
.\bin\wdb.cmd devices --watch
# JSON 按行输出，仅在状态/身份/进程变化时输出新快照
.\bin\wdb.cmd devices --watch --json --duration 60000
# 等待原任务，允许网络恢复窗口 60 秒
.\bin\wdb.cmd task wait <任务ID> --reconnect-timeout 60000 --json
```

单次设备探测默认最多 2 秒，可用 `--probe-timeout` 调整；watch 默认每秒探测，`--poll-ms` 可调整。watch 遇到身份/授权错误后暂停该设备的自动探测，直到配对配置或显式连接记录改变。健康探测不会续期输入控制心跳。

显式实机验证脚本：`node scripts/validate-reconnect.js --crash-service`。它使用独立 localhost TCP 转发通道模拟中断，保持 TLS 端到端，不改网卡或防火墙；核验精确进程路径和父进程/服务归属后才终止 wdb Node 和服务宿主。没有 `--crash-service` 时只做通道中断验证。结果写入 `artifacts/reconnect-<时间>/report.json`，不保存凭据；测试完成后关闭测试代理与观察进程。

回归覆盖接受回包丢失、连接重置、TLS 无响应、恢复超时、凭据撤销、证书/设备 ID 变化、主动离线断开、名称重复、服务重启后的原任务状态，以及 UTF-8 分块解码和助手启动取消。
