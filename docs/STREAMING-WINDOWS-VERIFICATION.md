# Windows 交互 Shell / 端口转发验收

日期：2026-11-06。构建 `streams-win-02`，源码 `6eccc311ac1ae191de5ac51f3d47ed242ec26350`，构建时工作区干净。Windows 功能、双安装包及 30 分钟持续会话已通过；后续提交补充验证和交接材料。

## 环境与产物

Windows 11 x64 `10.0.28000.3365`，Windows PowerShell 5.1，Node 24.15.0，ws 8.22.1，.NET Framework 4.8+。Windows 服务使用 LocalSystem / Session 0；helper 使用已登录的普通桌面用户 / Session 1。测试为本机访问本机 LAN IP，不能替代跨主机 LAN 验收。

两种 EXE 均已实机安装：with-node 使用安装目录的私有 Node，external-node 使用受保护目录中的系统级 Node。最终保留 with-node，服务自动启动，既有设备标识、证书、配对凭据保留。包 hash 见 [Mac 交接清单](STREAMING-MACOS-HANDOFF.md)。

CLI 从 `.tgz` 安装到含中文和空格的新 prefix；36 个包内文件，tgz 99,088 bytes，自身解压 261,009 bytes，含 ws 共 413,148 bytes。无原生组件、Node 运行时、服务端代码和 install/postinstall hook；升级/卸载保留独立配置。源码 `src`、`native` 临时移出仓库后，安装版服务及 CLI 仍完成操作；目录随后恢复。

本轮沿用已确认的 **未签名 Development / UNLICENSED** 参数。PtyHost 已纳入签名计划和校验清单，正式发布者签名、时间戳及签名安装验收没有执行；`releaseReady` 保持 false，未发布 npm 或 GitHub Release。

## 验证结果

| 项目 | 结果与范围 |
| --- | --- |
| 协议与认证 | pass：错误 pin 时无 HTTP Upgrade/token 到达；身份/实例、子协议、Origin、重定向、取消和截止时间；断开/撤销/临时授权、输入 lease 隔离 |
| 分片与边界 | pass：JSON 分片重组、超长 JSON/binary、错误方向、重复 open/requestId、伪造 credit、慢消费窗口、规则配额、reverse 认领与 10 秒超时；安装版停止 credit 后输出限制在 262,074 bytes，resize 可响应，关闭回收 20.3 ms |
| 普通/SYSTEM shell | pass：helper 普通用户与 SYSTEM Session 0 独立创建；实际子进程 SID 与声明身份一致；普通路径无 SYSTEM 回退 |
| shell 状态与输入 | pass：变量、cwd、Read-Host、Unicode/emoji、Ctrl+C、resize、cmd 非零退出；pwsh 标准安装路径缺失时明确 `SHELL_NOT_FOUND` |
| Windows 真实 TTY | pass：安装版 CLI 运行于真实 ConPTY；方向键、退格、Tab、历史、Ctrl+C、全屏/ReadKey、resize；Ctrl+] 返回本地后继续输入 |
| 退出与回收 | pass：正常/非零/完整 uint32 退出码映射、异常 finally 恢复；断网、helper 退出、服务重启和 CLI 强杀后回收进程树/监听端口，不重放输入 |
| forward/reverse | pass：IPv4/IPv6、端口 0/冲突、并发随机字节、HTTP over TLS、目标 WebSocket、双向 FIN 与 RST、拒绝后恢复、跨客户端归属及目标不可替换 |
| 原有功能 | pass：全量测试 162 项中 151 pass、11 skip；新增补充组 24/24 pass，涵盖异常 TTY 清理与 Windows uint32 退出码。跳过项保留在测试日志，不算通过 |
| 安装矩阵 | pass：12 项，包括两模式升级/切换、拷贝损坏回滚、无效运行时预检、运行时移除诊断、卸载保留数据及重装；SSE 8 项、三轮文件/截图/连接和录屏验证 |
| 持续运行 | pass：1800.019 秒，177 轮双 shell / 双向传输检查；同一普通/SYSTEM shell、两条规则及两个 TCP 长连接始终存活，最终 FIN 后响应完全一致 |

Windows 终端测试按 ConPTY 请求的 Win32 输入模式发送特殊键。早期测试驱动把 ANSI 方向键直接送入该模式导致失败，改为匹配当前输入模式后通过；未修改生产代码。Mac 的 ANSI/VT 和终端信号仍需独立实测。

安装器的端口预检修复了此 Windows 构建在大量 loopback 流量后把监听状态报为 0、返回 PID 0 临时行的情况：按目标端口和远端 wildcard/0 端点筛选，再验证真实进程归属。无关应用占用仍拒绝覆盖。修复后完整矩阵通过。

## 性能与持续运行

负载：每方向 8 个并发 TCP，每连接 4 MiB + 17 bytes，请求 FIN 后才回复相同字节；并行测试 16 MiB 传输中的 shell 响应。每约 10 秒向两个持久 shell 发一个验证命令，并在两个方向新建短 TCP 连接；另保留两个 TCP 连接直到 30 分钟结束才发 FIN、核对响应。终端观察间隔 10 ms，命令响应包含 PowerShell 执行耗时。

| 指标 | 本机结果 |
| --- | --- |
| shell 建立至 ready.ack | 普通 101.7 ms；SYSTEM 84.4 ms；不含提示符初始化 |
| TCP 建立并收到小响应 | 均值 3.47 ms；本轮 10 次最大 6.11 ms |
| shell 命令响应 | 均值 30.9 ms；本轮 10 次最大 31.9 ms |
| 16 MiB 传输时 shell 响应 | 均值 19.5 ms；本轮 10 次最大 64.5 ms |
| forward 吞吐 | 218.6 MiB/s，按往返总字节计 |
| reverse 吞吐 | 228.5 MiB/s，按往返总字节计 |
| 断网回收 shell/子进程 | 30.5 ms |
| helper 退出回收 | 278.2 ms |
| 服务重启回收旧会话 | 736.6 ms，含 Restart-Service 调用 |
| CLI 强杀释放 reverse 端口 | 33.9 ms |

30 分钟持续测试在本地时间 23:08:59–23:39:00 完成。服务树稳态 14 个进程、16 个 TCP 端点；每分钟采样的工作集约 339.4–396.5 MiB、句柄 3,666–5,686。早期穿插真实 TTY 测试时采样峰值 489.8 MiB，随后回落。最后关闭会话用时 369.2 ms，进程恢复为 6 个、TCP 端点 2 个、句柄 1,265、工作集 149.0 MiB；两个规则端口均能重新绑定，没有遗留 PtyHost 或会话 shell。

CPU 使用 `Win32_Process` 的 KernelModeTime + UserModeTime 逐进程计数汇总。覆盖后 1397.239 秒的稳定进程组消耗 61.156 CPU 秒，相当于平均单核 4.38%；不是整机 CPU 百分比。普通权限 `Get-Process.CPU` 对 SYSTEM PID 可为空，不能把该空值算作零负载。采样范围是服务、helper 及其子进程，不包含测试客户端和外部应用。

以上为单机单轮观测，不是跨机器延迟、吞吐保证或基准排名；持续测试使用上述周期负载，并非连续 30 分钟跑满带宽。分钟级采样不能证明没有更短的资源峰值。

## 本机证据与复现

产物目录：`dist/release-builds/streams-win-02/release/Development/`。以下原始证据位于忽略的 `artifacts/`，不提交凭据或终端业务输出：

- `stream-complete-tests.log`、`stream-final-extended-tests.log`：完整和补充回归。
- `stream-npm02-verification.json`、`stream-release02-verified.json`：npm 安装与产物摘要。
- `stream-release-matrix-03/report.json`：12 项安装矩阵及每种安装模式的 streams/LAN/录屏子报告。
- `stream-source-isolation/report.json`：源代码隔离与 Program Files 写权限验证。
- `stream-tty-editing4/report.json`：7 项真实 TTY 行为。
- `stream-recovery02/report.json`：4 项实机故障回收。
- `stream-pressure02/report.json`：安装版慢消费者、控制响应及有界关闭。
- `stream-soak30/report.json`、`stream-soak30/process-cpu.json`：持续会话、性能和进程采样。

```powershell
# 必须先安装新 EXE 和 npm 包，使用已经人工授权的独立配置目录。
node scripts/validate-streams-windows.js --cli '<安装目录>/src/cli.js' --config '<配置目录>' --device '<Windows-IP>' --output artifacts/stream-live --soak-seconds 1800
# 另一个终端补采 SYSTEM 与普通进程 CPU。
.\scripts\sample-stream-processes.ps1 -SoakReport artifacts/stream-live/report.json -OutputFile artifacts/stream-live/process-cpu.json
node scripts/validate-stream-tty-windows.js --cli '<安装目录>/src/cli.js' --config '<配置目录>' --device '<Windows-IP>'
# 下项会重启真实服务/helper，安排在持续测试之外。
node scripts/validate-stream-recovery-windows.js --cli '<安装目录>/src/cli.js' --config '<配置目录>' --device '<Windows-IP>'
```

## 未执行的边界

Mac 实机、跨主机 LAN、其他 Windows 版本/全新系统、真实注销用户、标准路径已安装 pwsh、完整 Vim/编辑器应用、超过 30 分钟运行、强制触发系统 Job API 分配失败、最大 64 TCP/全局 64 MiB 队列耗尽压力，以及正式签名/registry 安装均不记为通过。已测 helper 不可用和生命周期故障，不用这些结果冒充实际注销测试；已测全屏终端小程序，不冒充完整编辑器验收。
