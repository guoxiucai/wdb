# 首次连接：服务端同意、拒绝与记住

首次配对仍需可信的服务端证书指纹和配对码。校验通过后，服务器当前登录用户的桌面显示 **WDB 连接授权**，包含客户端自报名称、实际来源 IP、请求编号、权限说明，以及“同意”“拒绝”“记住此客户端”。客户端只等待结果，不能在命令行要求服务端自动同意或记住。

## 使用

```powershell
# 首次连接：服务器操作者必须在弹窗中作出决定
wdb connect 172.20.115.75 --fingerprint <指纹> --pairing-code <配对码>
# 后续连接复用当前客户端凭据
wdb connect 172.20.115.75
wdb clients list --json
wdb clients revoke <clientId> --json
```

| 本地选择/事件 | 效果 |
|---|---|
| 同意，不勾选记住（默认） | 建立临时逻辑连接，允许当前客户端执行 WDB 操作 |
| 同意，并勾选记住 | 持久授权；以后连接、服务重启不再弹窗，直到撤销 |
| 拒绝或关闭窗口 | 不授权，不建立拒绝名单；勾选记住也不会记住拒绝 |
| 120秒无决定 | 自动关闭并拒绝；CLI返回PAIRING_TIMEOUT |
| 临时连接主动disconnect | 临时许可立即结束；再次connect重新弹窗 |
| 临时连接30分钟没有认证请求 | 许可过期；下一次connect重新弹窗 |
| 临时连接服务重启 | 许可失效；再次connect重新弹窗 |
| 客户端等待期间断线 | 关闭/取消弹窗；迟到的同意不产生授权 |
| 桌面未登录/锁定/助手不可用 | 不自动授权，返回PAIRING_DESKTOP_UNAVAILABLE；等待时锁屏也关闭弹窗 |

“临时连接”跨多条 CLI 命令和 HTTPS 请求。`devices --watch` 等认证查询也算活动；停止全部该身份的请求后才开始闲置计时。未勾选记住不等于下一条命令马上再弹框。CLI 默认等待150秒，可通过 `--approval-timeout <毫秒>` 修改；它与普通 `--request-timeout` 分开，避免10秒网络超时打断人工确认。超时/断线后不自动重发配对或审批请求。

临时客户端的凭据哈希与clientId保留，用于识别同一客户端和查询自己的历史任务；**临时允许状态只在服务内存中**。再次确认后沿用原clientId，已接受的长任务不因重新确认而丢失归属。`disconnect`不等于撤销身份；`clients revoke`会禁用令牌，已撤销的客户端不能仅靠旧令牌再次申请确认。

升级前已经配对的客户端继续按“已记住”处理，保留既有授权。需要让某个旧客户端重新确认时，先撤销其授权，再用配对码重新配对。不删除整个服务数据目录。

## CLI 状态与错误

- 首次/需要重新确认时，stderr显示等待服务器批准；`--json` stdout仍只有最终JSON。
- 配对返回 `remembered:true|false`，临时连接另返回 `temporaryIdleMs`。
- `clients list` 给出 `remembered` 与当前 `authorized`，不显示令牌/哈希。
- 临时许可结束后，普通操作返回 `PAIRING_REQUIRED`；`devices` 显示 `approval_required`。watch不自动弹窗，操作者显式运行connect。
- `PAIRING_REJECTED`：拒绝/关闭；`PAIRING_TIMEOUT`：服务端审批超时；`PAIRING_BUSY`：已有另一请求正在等待；`PAIRING_DESKTOP_UNAVAILABLE`：当前桌面不能审批。错误配对码依旧是 `PAIRING_DENIED`。
- 客户端等待期限先到或响应丢失可能返回 `REQUEST_OUTCOME_UNKNOWN`。不要自动重试；观察服务器窗口和授权列表后再显式连接。

同一时刻只显示一个配对/重新确认弹窗，其他申请返回PAIRING_BUSY。客户端名称由客户端提供，不是安全身份；来源地址由服务器连接读取。永久授权仍依赖保存在客户端的Bearer凭据，复制凭据文件等于复制该客户端身份。

## Mac/其他客户端协议增补

协议仍为v1，本次为兼容扩展：

1. `POST /v1/pair` 在正确配对码之后等待本地确认，最长120秒；同意后才返回token/clientId。没有“忽略弹窗”参数。
2. 普通认证请求返回 `401 / PAIRING_REQUIRED` 时停止操作；仅显式connect可调用 **`POST /v1/connection`**，携带原Bearer，body `{}`，等待重新确认。
3. 成功响应data为 `{connected:true,clientId,remembered}`，之后重新查询 `/v1/info`、更新本地connected和lastConnected。令牌及clientId不变；拒绝不恢复许可。
4. `DELETE /v1/connection` 仍保留凭据；临时许可被清除，响应增加 `reauthorizationRequired:true`。
5. `/v1/health` 的 `connectionApproval:true` 表示支持该功能。旧版已授权CLI可继续操作；新配对/临时授权恢复请升级CLI，否则旧的短请求超时可能提前结束等待。

本地对话框通过认证的loopback助手显示，SYSTEM服务不直接显示UI。`connection.approve`是服务内部操作，公开task/call入口拒绝执行。UI自动测试可用进程内模拟审批提供者测试状态机；运行服务没有环境变量、配置项或HTTP接口可以替换为自动批准。

本次自动测试与真实窗口验证边界见 [验证记录](CONNECTION-APPROVAL-VERIFICATION.md)。`tests/cli-live.test.js`属于手动启用的真实服务测试，运行时需操作者同意并记住测试客户端；标准npm test默认跳过。
