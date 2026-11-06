# Windows 实机 SSE 验证

2026-11-06，Windows 11 x64（qingwei）、Node 24.15.0，远端基线 `41f00e4`。通过现有记住授权连接本机 LAN 地址 `172.20.115.75:18766`；真实 SCM `WdbService` 运行于 SYSTEM，桌面助手运行于已登录普通用户。不是另一台物理客户端的断网测试。

`scripts/validate-sse-windows.js` 实机 8 项通过：

| 检查 | 结果 |
| --- | --- |
| health 声明 taskEvents | true |
| 连续 5 次 health | 复用 1 条已校验指纹的 TLS 连接 |
| 普通用户 shell | 助手跨进程写入输出，结束前实时推送中文及 emoji |
| SYSTEM shell | 服务进程直接推送，身份正确 |
| 主动断开客户端 SSE TCP 流 | 按非零字节偏移恢复，6 行输出完整且无重复/乱码，不重新提交任务 |
| 等待超时与取消 | CLIENT_WAIT_TIMEOUT 后任务仍运行；显式取消变为 cancelled |
| JSON stdout | 仅 1 条终态 JSON，无实时输出混入 |
| 真正 Restart-Service | Node PID 改变；原任务 unknown/SERVICE_RESTARTED；标记文件证明只执行 1 次 |

协议/重连回归 23 项通过，另覆盖归属隔离、撤销、临时授权不被 SSE 心跳续期、证书更换、输出背压、旧服务端轮询回退。修正旧重连夹具：该夹具只伪造任务查询接口，需要明确声明不支持 SSE，不能沿用新服务的能力声明。

复现（会按显式开关重启本机 WdbService）：

```powershell
node scripts/validate-sse-windows.js --config '<已授权客户端目录>' --device 172.20.115.75 --output artifacts/sse-windows-live --restart true
# 从 npm 安装产物验证时，额外指定 --cli '<prefix>/node_modules/<包名>/src/cli.js'
```

本机脱敏报告：`artifacts/sse-windows-live/report.json`。真实跨机器物理断网和 Mac npm 客户端留给对应环境验证；既有测试不会自动新建或放行安全授权。
