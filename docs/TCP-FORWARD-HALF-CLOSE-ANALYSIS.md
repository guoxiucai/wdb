# TCP 转发半关闭尾部截断：Windows 排查交接

## 实测结论

Mac CLI 经 LAN 连接 Windows 服务，构建以下链路：

```text
测试连接 → Mac forward → Windows loopback reverse → Mac TCP 回显服务
```

回显服务设置 `allowHalfOpen: true`，收到全部请求和 EOF 后才用 `socket.end(Buffer.concat(parts))` 返回原始字节。客户端连接后 `socket.end(payload)`，持续读取至 EOF，逐字节比对。4 路并发，每路随机数据 `1024*1024+17` 字节。

- 一轮短测全部完整，证明基本路径及半关闭可工作，但不能证明竞态不存在。
- 后续约 183 秒、35 次额外交换中，数据完整但出现正常传输后的 `connection_error`，错误为 `WebSocket is not open: readyState 2 (CLOSING)`。原脚本顶层只判断字节完整而标为 pass；按错误事件验收应判失败。
- 修复客户端关闭阶段延迟 credit 后，严格复验又出现期望 **1,048,593**、实际 **1,048,576** 字节，即尾部少 **17** 字节；未完成后续 soak。不能据此断定每次总是少 17 字节。
- 实机客户端修复包源码为 `709aeec`；最终交付包 `96e4058` 的 src/bin 与之相同。Windows 服务报告 0.1.0，但未核对其源码 SHA，未同步部署本机修复。

证据位于执行验证的 Mac 本机忽略目录 `artifacts/macos-2172e21/`：`forward-report.json`、`forward-soak-report.json`、`forward-fixed-report.json` 和对应 `.cjs` 脚本。目录不随 Git 交接，也不包含在发行包中；需要在 Windows 侧独立复现。

## 初步分析（尚未证明唯一根因）

首要怀疑是 **TCP 两方向 FIN、异步写入排空与 WebSocket close 的顺序不一致**，不是已经证明的 TLS 或网络丢包。

1. `src/stream-flow.js` 的 `pump()` 在本地发送队列为空时发送 FIN。`outBytes === 0` 代表数据交给 WebSocket，不代表对端已写入目标 TCP；`sent` 与 `peerConsumed` 才分别表示发送量与对端消费确认。
2. `src/stream-tcp.js` 的 `attachTcp()` 在本地 socket close、两方向 FIN 及本地队列为空时调用 `channel.close()`，此条件没有要求 `sent === peerConsumed`，也没有显式等待对端接收队列排空。
3. 对端 WebSocket closed 会触发 `Flow.stop()`，清空待写队列；TCP adapter 同时 `socket.destroy()`。若 WebSocket 关闭先于 TCP 异步写入完成，就可能切掉最后一段。必须用时序观测确认截断发生在哪一跳，不能只凭代码就认定。
4. `src/forward-server.js` 的 `release()` 及 `src/forward-client.js` 的 closed 回调也会销毁 adapter/socket；需检查正常收尾是否走了本应仅适用于中断的强制释放路径。
5. `Channel.close()` 在 transport 非 OPEN 时调用 terminate；重复 close 是否将已进入正常关闭握手的连接强制终止，也应记录验证。

17 字节恰好是测试负载跨整 MiB 边界后的余量，符合“最后一个小块尚未排空”的线索，但不是根因证明。

`709aeec` 仅在 transport 已 CLOSING/CLOSED 时不再发送延迟 credit，并补回归；它解决的是一种收尾误报。**它不保证尾部排空，不能作为截断修复结论。** Windows 仍运行旧服务，也可能继续产生旧 credit 关闭错误。

## Windows 建议排查步骤

1. 记录 Windows 服务、Win CLI 和 Mac CLI 的准确 SHA、Node/ws 版本，先保留原始复现，再同步候选修复版本。不要以同一个 0.1.0 版本号推断源码相同。
2. 使用独立测试端口、普通用户环境和合成数据。分别测试 forward、reverse，最后测试上述组合链路，避免只能观察到组合链路总失败。
3. 每条连接以 connectionId 关联记录：端点角色、单调时间、`sent/peerConsumed/received/consumed`、`outBytes/inBytes/writing`、`localFin/remoteFin/finSent`、socket `end/finish/close`、WS readyState/close code，以及 stop/destroy/release 的调用原因。只记录计数与生命周期，不记录实际业务 payload 或凭据。
4. 在可控测试夹具中延迟最后一次 sink.write 回调，覆盖“收到 FIN/WS close 时仍有未完成写入”的情况，形成稳定失败回归，不用反复跑到一次成功代替定位。
5. 检查正常关闭的必要条件：本地输出已排空、目标 TCP 写入完成、双方 FIN、对端消费确认完成。最终小块需要及时 credit，不能等待小块阈值而导致关闭等待死锁。异常断线仍应有界中断，不自动恢复或重放数据。
6. 将正常 drain 与取消/失败的强制 destroy 分开设计，并检查外层 manager/release 不会越过 drain。若更改 FIN/确认/关闭协议，同步协议文档、共享夹具及两个 CLI；仅延长 timeout 或吞掉所有 send 错误不可接受。

## 复验门槛

- payload 覆盖 0、1、17、65535、65536、65537、1 MiB、1 MiB+17 及多 MiB；随机内容严格逐字节相等。
- 单路与 4 路并发，连续多轮；EOF 后响应、慢读、延迟尾块、双向半关闭分别覆盖。
- 在首次功能通过之后再做至少 3 分钟连续测试；数据一致之外，正常收尾必须零 connection_error。进一步长稳结论需另外记录实际时长。
- Ctrl+C/异常断网不挂死；结束后两端监听端口可重新绑定，无连接/租约泄漏。
- Windows 本机、Mac → Windows LAN 分开记录 pass/fail；Windows 通过不能替代 Mac 实机复验。

本交接只提供问题分析及排查建议，不宣称截断已经修复。
