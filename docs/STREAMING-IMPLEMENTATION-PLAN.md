# Windows 流通道实施记录

基线 `b54d318`，按 INTERACTIVE-SHELL-AND-FORWARDING 的 W1→W4 执行，每阶段验证后单独提交。

1. W1：精确锁定纯 JS ws；共享消息校验、流控、pin-before-Upgrade、授权/lease/shutdown；协议及 TLS 回归。
2. W2：前台 forward、reverse，独立数据通道；IPv4/IPv6、端口冲突、半关闭、并发、归属隔离及故障清理。
3. W3：预编译 ConPTY/Job 后端，helper 普通用户与显式 SYSTEM，真实 TTY 适配、持续状态、输入/resize/退出及进程树回收。
4. W4：npm 与双 EXE；安装后 shell/TCP/原有 SSE 和文件回归、至少 30 分钟持续会话、性能和 Mac 交接材料。

沿用用户已确认的 Development 参数和未签名包；不发布 npm，不代操作授权弹窗。实机使用已有记住身份；无 GUI/未登录的边界通过独立测试后端和真实 helper 生命周期分别记录。Windows 以外的真实终端、正式签名明确列为未执行。

2026-11-06 完成 W1–W4：协议 `db55e6b`、转发 `e89eefa`、ConPTY/TTY `eb3b007`、打包 `7cb580f`、实机验证与安装预检修复 `6eccc31`。最终安装构建 `streams-win-02`；后续验证脚本补充了真实终端编辑、故障清理、背压及 1800 秒持续会话。结果见 [Windows 验收](STREAMING-WINDOWS-VERIFICATION.md)，Mac 接手材料见 [交接说明](STREAMING-MACOS-HANDOFF.md)。
