# Mac 流式客户端交接

Windows 服务端及共享客户端实现已可对接；**本文不是 Mac 实机通过报告**。Windows 安装包的源码基线是 `6eccc311ac1ae191de5ac51f3d47ed242ec26350`，后续提交补充验证脚本与报告。子协议固定为 `wdb.stream.v1`，共用原有 HTTPS 端口 `/v1/stream`。

## 版本与模块

- Node `>=24.15.0 <25`，本轮实测 `24.15.0`。
- 唯一纯 JS 依赖 `ws@8.22.1`，精确版本和 integrity 见根目录 `package-lock.json`。不安装 `bufferutil` 等可选原生模块。
- `client-stream.js`：TLS 指纹校验在发送 Upgrade/Bearer 之前完成，随后核对 deviceId 与 serverInstanceId。
- `stream-protocol.js`、`stream-channel.js`、`stream-flow.js`、`stream-tcp.js`：两端共用 schema、状态、流控和 TCP 半关闭。
- `terminal-client.js`：raw mode、resize、本地转义、远端退出码及 finally 恢复。Windows 还处理 Win32 输入记录中的 Ctrl+C/Ctrl+]；Mac 需要独立验证 VT/信号行为。
- `forward-client.js`：前台 forward/reverse，每条 TCP 独立 WSS，控制通道定期续租。

Mac 不编译或安装 PtyHost，不改变本机屏幕录制/辅助功能权限。远端 shell 程序、cwd、环境和命令路径始终指 Windows。用法见 [STREAMING.md](STREAMING.md)，完整合同见 [INTERACTIVE-SHELL-AND-FORWARDING.md](INTERACTIVE-SHELL-AND-FORWARDING.md)。

## 共享回归

```sh
npm ci --omit=optional --ignore-scripts
node --test tests/stream-protocol.test.js tests/stream-transport.test.js tests/stream-forward.test.js tests/stream-faults.test.js
```

`tests/stream-fixture.js` 为隔离服务生成临时自签名证书，构建机需要 OpenSSL；审批注入只存在于测试创建的 Bridge 对象，生产没有绕过审批的接口。协议/网络测试包括 pin-before-request、身份/子协议、重定向、分片/超长消息、credit、超时/取消、配额、归属、reverse 单次认领、IPv4/IPv6、TLS/目标 WebSocket、FIN/RST。不要把 fixture 通过当成 Mac 真实终端通过。

然后安装同一个 `.tgz`，在 Terminal/iTerm/实际使用的终端中连接 Windows：

```sh
npm install -g --prefix "$HOME/wdb-stream-test" ./wdb-cli-local-test-0.1.0.tgz --omit=optional --ignore-scripts
"$HOME/wdb-stream-test/bin/wdb" connect <Windows-IP>
"$HOME/wdb-stream-test/bin/wdb" info --json
"$HOME/wdb-stream-test/bin/wdb" shell
"$HOME/wdb-stream-test/bin/wdb" forward tcp:9000 tcp:3000 --json
"$HOME/wdb-stream-test/bin/wdb" reverse tcp:9001 tcp:3001 --json
```

新 Mac 身份仍须 Windows 操作者在首次连接窗口同意。不复制测试 token、设备私钥或 ProgramData 目录。指纹变化不自动接受。

## 必须补齐的 Mac 验证

验证真实 raw mode、Ctrl+C、Ctrl+]、`--escape none`、Unicode/emoji、拆块 UTF-8、方向键/退格/Tab/历史、resize、粘贴、全屏进入与退出、正常/异常退出后本地输入恢复。Windows 的实际终端启用 Win32 输入模式；Mac 不应假设该模式可用，需要验证 ANSI/VT 输入路径。终端断开后不能自动重连或重放输入。

Mac→Windows 两个方向都验证本地监听位置、目标拒绝后恢复、并发与长连接、请求 FIN 后响应、目标 FIN 后仍可写入、RST、CLI 强杀和 Windows 服务重启。首版限制：字面 loopback TCP，4 shell/4 规则/16 TCP 每客户端，64 KiB 二进制、16 KiB JSON、256 KiB window、5/30 秒 lease。不得为了 Mac 单独修改首版隐式协议。

## 已测 Windows 产物

构建 `streams-win-02`，未签名 Development；没有发布 npm。文件位于 Windows 仓库的 `dist/release-builds/streams-win-02/release/Development/`。

| 文件 | SHA-256 |
| --- | --- |
| `wdb-cli-local-test-0.1.0.tgz` | `e605f71ea3f74fb911cc0b120e8de23f7c085b91e3aa73131f4463f5f27785ac` |
| `wdb-server-0.1.0-windows-x64-with-node-Development-setup.exe` | `6d6f7504a49fd17d6e1e4784f7b4ff1ced53f3df3cca50aecff51d2c6d4307b6` |
| `wdb-server-0.1.0-windows-x64-external-node-Development-setup.exe` | `58ac9acb07d00b35358eb0c6ce60ca82001c7211b0434feb98884f0b339d00f5` |

产物和本机原始日志未加入 Git；通过项目约定的文件方式传递，核对上表摘要。Windows 证据汇总见 [STREAMING-WINDOWS-VERIFICATION.md](STREAMING-WINDOWS-VERIFICATION.md)。Mac 完成后新增独立的 `STREAMING-MACOS-VERIFICATION.md`，注明 OS、CPU、终端、Node、包 hash 与测试结果。
