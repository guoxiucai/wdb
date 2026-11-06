# 交互式 Shell 与 TCP 转发

Windows 服务端与 CLI 使用已有 HTTPS 端口上的 WSS `/v1/stream`，复用客户端授权和证书固定。首次连接仍执行 `wdb connect <地址>`。无需开放额外服务端入口。客户端依赖纯 JavaScript `ws@8.22.1`；Windows 服务端安装包包含预编译 `PtyHost.exe`。

```powershell
wdb info
wdb shell
wdb shell --interactive --program cmd
wdb shell --program powershell --cwd 'C:\Users\Public'
wdb shell --program pwsh
wdb shell --admin
wdb forward tcp:127.0.0.1:9000 tcp:127.0.0.1:3000
wdb reverse tcp:127.0.0.1:9000 tcp:127.0.0.1:3000 --json
```

`shell` 无脚本时进入交互终端，要求 stdin/stdout 都是 TTY；普通会话通过已登录桌面的 helper 以该普通用户运行。`--admin` 显式请求服务的 SYSTEM 身份，进入后 stderr 显示实际身份。GUI 程序仍使用 `app launch`。`pwsh` 需事先在服务器的标准 Program Files 路径安装 PowerShell 7；缺失返回 `SHELL_NOT_FOUND`。helper 不可用返回 `HELPER_UNAVAILABLE`，不会自动提升权限。

变量和工作目录在同一 shell 内保持，支持 Read-Host、中文、emoji、终端 resize 与 ANSI 输出。Ctrl+C 发送给远端程序；Ctrl+] 结束会话并恢复本地终端，退出码为 130。`--escape none` 禁用该本地转义键。远端退出码 0–255 原样返回，其余 Windows 退出码返回 1 并输出原始值。默认 powershell 是 Windows PowerShell 5.1；每个 PowerShell 版本使用自身默认模块路径与执行策略。

自动化脚本继续使用 `shell --script ...` 或 `--script-file ...`，通过任务 API 取得 JSON；无 TTY 时不要请求交互模式。`--interactive` 不接受脚本、`--json`、`--detach`、`--follow`；流式命令不接受任务专用 `--poll-ms`、`--wait-timeout`、`--reconnect-timeout`。结构化环境变量可用 `--env '{"NAME":"value"}'`，不在共享日志记录秘密。

`forward` 在客户端监听并连接服务端本地目标；`reverse` 在服务端监听并连接客户端本地目标。两个端点只支持字面 loopback `127.0.0.1` 或 `::1`，格式为 `tcp:127.0.0.1:端口` 或 `tcp:[::1]:端口`。监听端口可为 0，最终端口由 ready 输出给出；目标端口必须为 1–65535。转发的是 TCP 字节，HTTP、WebSocket、TLS 等上层协议自行保持。

规则在 CLI 前台存活，Ctrl+C 停止规则及其全部连接。`--json` 按行输出 `ready`、`connection_error`、`closed`，不向 stdout 输出转发数据。单个目标拒绝、超时或连接重置不撤销整个规则；已有规则恢复目标后可建立新连接。

交互与转发连接断开后结束，**不自动重连，不重放命令，不恢复旧 shell**。主动 `disconnect`、撤销授权、服务/helper 退出都会回收相关资源。重新执行命令建立新的会话；原有任务 API 的恢复规则仍然有效。

每客户端最多 4 shell、4 转发规则、16 TCP 连接；全局分别 16、16、64。二进制消息 64 KiB、JSON 16 KiB、每方向窗口 256 KiB、单队列 512 KiB；应用队列总预算 64 MiB。租约每 5 秒更新，30 秒到期；Ping 不续租。目标连接超时 5 秒，reverse 待认领连接超时 10 秒。终止 shell 会回收其 Job 中的子进程。

Windows 的实现及实机结果见后续验收记录。Mac 共用 npm 代码与协议，但本轮没有 Mac 实机验收；需在 Mac 验证 raw mode、resize、Ctrl+C、Ctrl+] 和终端恢复后再声明支持。
