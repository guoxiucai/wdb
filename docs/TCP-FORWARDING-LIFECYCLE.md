# TCP 转发正常收尾与半关闭

`wdb.stream.v1` 的字段及 FIN/credit 格式不变。FIN 只表示该方向不会再发送数据；credit 表示目标 TCP 的 write 回调已完成，两者都不能等同于 TCP 连接已彻底关闭。

正常收尾必须满足：双方 FIN、本地发送队列为空、目标写入完成、`sent === peerConsumed`、`received === consumed`。最后不足 64 KiB 的字节在收到 FIN 且写入完成后立即发送 credit，不等待批量阈值或延时计时器。

本地 TCP close 后若消费确认尚未到达，保留 WSS 等待确认（最多 10 秒），超时报告 `OUTPUT_DRAIN_TIMEOUT`。重复调用 Channel.close 不终止正在进行的 WebSocket 正常关闭握手，原有 2 秒关闭超时仍有效。

对端正常关闭 WSS 时，已满足排空条件的 TCP 继续完成 end/FIN；管理器等待 adapter 回收，不能再次直接 destroy socket。此阶段最多等待 10 秒。取消、错误、异常断线仍强制终止，不恢复连接、不重放字节。

## Windows / Mac 同步

本修复涉及共享 `stream-flow.js`、`stream-tcp.js`、`stream-channel.js`、`forward-client.js`，以及 Windows 的 `forward-server.js`。两端均须更新；只更新客户端不能修复旧 Windows 服务的提前回收。版本字符串相同不代表源码一致，应核对构建 SHA。

```powershell
node --test tests/stream-half-close.test.js tests/stream-forward.test.js tests/stream-faults.test.js
$env:WDB_HALF_CLOSE_SOAK_MS='180000'
node --test tests/stream-half-close-integration.test.js
```

测试覆盖 forward、reverse、组合链路；0、1、17、65535/65536/65537、1 MiB、1 MiB+17、多 MiB；EOF 后回包、慢读、4 路并发、零 connection_error、关闭后端口重绑定和资源归零。确定性单测延迟目标 write 回调，并验证管理器不会越过 adapter 销毁 socket。

Windows loopback 验证不能替代 Mac → Windows LAN。Mac 仍应按 [原始问题分析](TCP-FORWARD-HALF-CLOSE-ANALYSIS.md) 的链路复验，并记录两个构建 SHA、实际时长、逐字节结果及错误事件。
