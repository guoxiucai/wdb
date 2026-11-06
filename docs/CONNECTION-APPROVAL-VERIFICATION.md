# 连接审批验证（2026-11-06）

## 最新修订：connect简要结果与服务重启，已验证

实现提交`4027e07`：默认connect输出单行connected/already connected/failed/timed out；JSON保留通用信封，data只含address/state。详情通过info返回，连接身份及记住状态位于data.connection。已连接判断先验证在线和授权，连接过程使用health，不重复获取桌面详情或发起审批。

自动回归 **76项：75通过、0失败、1个需人工参与的服务测试默认跳过**（`artifacts/connect-summary-full-tests.log`）。覆盖新连接/重复连接/主动断开后的输出、拒绝与超时、TLS发现超时、已启用但离线时不误报已连接，以及已发送审批请求超时仍保留REQUEST_OUTCOME_UNKNOWN。文档12段PowerShell通过5.1语法检查，Skill校验通过。

2026-11-06 15:30（Asia/Shanghai）完成本机验证：

- 更新安装目录并按用户要求重启WdbService；服务进程PID从32076变为13084，状态Running，设备和已记住的客户端身份保持。
- 已安装CLI和独立客户端包均返回`already connected to 172.20.115.75:18766`；主动断开后返回`connected to 172.20.115.75:18766`，再次连接恢复already connected。
- 错误指纹返回单行`failed to connect ... (CERTIFICATE_MISMATCH)`；JSON结果不再包含客户端身份、指纹或嵌套info。
- info仍提供能力、桌面状态及连接详情；客户端包13步基础闭环通过，重连步骤额外确认`data.state=connected`。

证据：`artifacts/connect-summary-verification.json`、`connect-summary-after-restart.json`、`connect-summary-smoke/report.json`。本轮未重新触发人工首次授权；同意/记住实测见下方历史记录，新增超时输出由自动测试覆盖。

## 仅地址连接修订，已验证

实现提交 `f6b7066` 取消人工 fingerprint/pairingCode 前置条件。最新标准回归 **73项：72通过、0失败、1个需人工参与的服务测试默认跳过**，记录 `artifacts/simple-connect-full-tests.log`。针对性20项通过，包含无配对码审批、无HTTP数据的证书发现、发现超时、拒绝不保存、可选错误指纹、已有证书变化不重新信任、旧参数不绕过弹窗、频率限制和临时/持久授权。

2026-11-06 14:34—14:36（Asia/Shanghai），已更新本机服务，使用独立 Windows 客户端包与全新配置执行 `wdb connect 172.20.115.75 --name WDB直连验收 --json`（另用 `--config` 隔离验收身份），**没有传入指纹或配对码，也没有读取服务端配对材料**：

- 真实“WDB连接授权”窗口出现，服务器收到本机“同意且记住”的决定；14:34:30客户端返回成功，指纹和凭据自动保存。测试工具没有代点按钮。
- 新客户端ID为 `4e2b56ff-74b3-4ef8-9977-3ba52cc9da90`，设备ID保持 `2f493aacf427f3e9`。
- 独立客户端完成13步闭环：info、用户shell、中文目录/随机文件往返校验、显示器/窗口查询、截图拉取、disconnect/connect和清理。
- 再次重启WdbService，进程PID由636变为32076；直接connect成功，原客户端/设备身份不变。审计仅1次pair、0次重新审批。
- 安装目录的核心服务/客户端源码与本次提交一致；服务端/客户端包校验及Skill校验通过。

本机证据：`artifacts/simple-connect-live.json`、`simple-connect-smoke/report.json`、`simple-connect-before-restart.json`、`simple-connect-after-restart.json`、`simple-connect-verification.json`。此处为同机LAN地址的真实安装验证；另一台电脑和macOS网络验收仍分别进行。

以下为早期版本历史记录；其中人工配对码规则已由上述修订取代。

## 早期版本自动测试

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

后续按用户要求精简界面：内容区宽度由550缩至360，只显示连接问题、客户端名、来源IP、记住选项、同意/拒绝和小倒计时；移除大文本框、请求编号与长篇规则说明。已重新编译并通过交互桌面助手只读检查4K桌面的预览，文字和按钮完整显示，默认仍不勾选记住，预览到时关闭。此改动仅涉及呈现，授权状态机及已完成的记住/重连验证保持适用。

真实窗口的“同意并记住”与重启/重连闭环已通过。拒绝按钮及不勾选记住的人工点击路径尚未单独演练；相应状态机已有自动测试。真实无操作超时拒绝已通过。测试工具没有代替操作者点击安全授权。

如需继续演练临时许可，按 [CONNECTION-APPROVAL.md](CONNECTION-APPROVAL.md) 用新客户端/独立配置首次同意不勾选记住，disconnect再connect应再次确认。现有已记住客户端不会重复弹窗。
