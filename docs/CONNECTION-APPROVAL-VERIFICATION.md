# 连接审批验证（2026-11-06）

## 自动测试

标准回归：**67项，66通过，0失败，1个真实服务测试默认跳过**（`artifacts/approval-full-tests.log`）。其中新审批覆盖：

- 未同意前不发令牌；错误配对码不弹窗；拒绝不建立授权。
- 并发申请返回PAIRING_BUSY，不并排产生多个授权请求。
- 同意并记住：disconnect、服务重启后保留授权。
- 临时同意：disconnect、30分钟闲置、服务重启后不可操作；显式connect重新确认，沿用原clientId。
- 审批中撤销客户端身份，迟到同意不能恢复被撤销授权。
- 审批超时、桌面不可用、客户端断开均不授权。
- 公开task/call不能触发内部审批操作。
- CLI等待确认使用独立等待期限，不被普通请求的短超时打断；拒绝不保存新凭据；JSON stdout保持单个结果。

状态机测试通过构造Bridge时注入模拟本地决定，**不是人工按钮点击的实测**。已安装服务没有自动同意开关。

## 本机安装与真实窗口

- 新服务已安装到 `C:\Program Files\wdb`，保留 `172.20.115.75:18766` LAN监听、设备ID及原有授权。
- 使用独立配置申请新客户端“WDB授权验收”，真实服务器通过登录用户桌面助手显示“WDB连接授权”。只读检查确认来源IP、请求编号、权限说明、未勾选的记住框、同意/拒绝按钮和倒计时存在。
- 首轮未收到人工确认，服务端在约120012ms后返回 `PAIRING_TIMEOUT`，当时客户端没有保存devices.json，服务端没有新增该测试客户端授权（`artifacts/approval-live-timeout.json`、`approval-no-grant.json`）。后续人工同意结果单独记录如下。
- 对话框预览发现文字布局需增加空间，已改为自适应纵向排版并复查：身份信息可完整阅读/滚动，说明文字不再裁切，按钮可见。预览仅调用内部桌面呈现，不会建立实际客户端授权；到时自动关闭。
- 编译与PowerShell配置语法检查通过，Skill校验通过。

## 人工同意并记住闭环：已通过

2026-11-06 14:11—14:13（Asia/Shanghai），重新发起真实配对，由本机操作者勾选记住并点击同意，完成以下验证：

- 配对返回 `succeeded / remembered:true`，独立客户端配置成功保存凭据。
- 新客户端完成13步真实CLI闭环：info、默认用户shell、中文目录及随机文件往返校验、屏幕/窗口枚举、截图拉取、disconnect/connect、再次info及测试文件清理。
- 主动断开后复用原凭据重连成功，无需再次审批，客户端ID和设备ID保持一致。
- 本机重启WdbService，服务进程PID由4340变为30268；重启后再次connect成功，返回reconnected:true，原客户端仍为remembered:true、authorized:true。
- 审计中该客户端只有1次成功pair，重新审批connection.approve为0次，确认重连没有重新触发审批；源码和客户端令牌不需要修改。

证据：`artifacts/approval-live-result.json`、`approval-remembered-smoke/report.json`、`approval-before-restart.json`、`approval-after-restart.json`、`approval-clients-after-restart.json`、`approval-remembered-report.json`。凭据配置仅保存在被Git忽略的独立本机目录中。

## 验证边界

真实窗口的“同意并记住”与重启/重连闭环已通过。拒绝按钮及不勾选记住的人工点击路径尚未单独演练；相应状态机已有自动测试。真实无操作超时拒绝已通过。测试工具没有代替操作者点击安全授权。

如需继续演练临时许可，按 [CONNECTION-APPROVAL.md](CONNECTION-APPROVAL.md) 用新客户端/独立配置首次同意不勾选记住，disconnect再connect应再次确认。现有已记住客户端不会重复弹窗。
