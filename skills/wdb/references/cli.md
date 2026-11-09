# CLI 使用参考

所有命令使用 npm 安装的 `wdb`。远端操作显式加 `--device <server>`；参数以已安装版本的 `wdb --help` 为准。

## 配对和选择设备

新客户端配对需要服务器本机操作者在弹窗中同意。默认临时授权；勾选记住后持久授权。CLI默认等待150秒（`--approval-timeout`），拒绝/关闭/超时不授权。临时许可结束时运行connect重新确认，详见 [连接授权](connection.md)。

直接连接服务器地址，无需手工提供指纹和配对码：

```powershell
wdb connect localhost:18766 --json
wdb info --json
wdb devices --json
```

`connect`默认只输出一行结果，详细信息由`info`查询：

```text
connected to 172.20.115.75:18766
already connected to 172.20.115.75:18766
failed to connect to 172.20.115.75:18766 (PAIRING_REJECTED)
connection to 172.20.115.75:18766 timed out (PAIRING_TIMEOUT)
```

首次同意、主动断开后重连、临时许可重新确认成功均为`connected`。本地身份已启用且在线/授权检查通过才返回`already connected`，不重复审批；不能仅凭本地记录把离线设备判为已连接。等待人工审批时stderr有简短提示。

`connect --json`保留通用JSON信封，`data`只含`address`和`state`：`connected`、`already_connected`、`failed`或`timeout`。成功/已连接的顶层`status=succeeded`且退出码0；失败为`failed`、超时为`timed_out`，退出码均1，`error`保留原因。不再返回嵌套info、指纹、clientId或remembered；这些连接详情在`info --json`的`data.connection`中。服务端配对接口不变。已发送审批请求后超时仍保留`REQUEST_OUTCOME_UNKNOWN`，先核对服务端状态再重试。

首次连接自动获取证书 SHA-256，服务端弹窗同意后保存指纹及凭据；所有 HTTP 请求均先匹配本次/已保存的指纹。以后证书变化则失败，不自动接受。可选 `--fingerprint <SHA256>` 预先指定可信证书；旧 `--pairing-code` 参数不再参与授权。首次信任的边界见 [连接授权](connection.md)。后续 `connect localhost:18766` 复用已保存的凭据。Windows 凭据保存在 `%LOCALAPPDATA%\wdb\client\devices.json`；Mac 默认 `~/Library/Application Support/wdb/client/devices.json`，目录/文件权限为 0700/0600。优先级为 `--config <目录>` > `WDB_CONFIG` > 平台默认，可选择独立客户端身份。Mac 入口和旧配置迁移见 [MACOS-CLIENT.md](connection.md)。请把自定义配置目录放在当前用户私有目录中，不加入 Git。

`disconnect` 隐藏本地设备条目并停止本地自动重连，保留配对凭据和服务端已保存的授权；服务离线也能主动断开。再次 `connect` 复用凭据，服务端已记住且授权仍有效时无需重新同意。`clients list` 查看授权；`clients revoke <clientId>` 撤销指定客户端。多设备已连接时必须加 `--device <地址、deviceId或唯一设备名>`；不自动选择首个设备。单机可用不同服务端端口和不同 `--config` 目录验证多客户端和多设备路由。

Windows 服务端本机安装后，`wdb clients list` / `wdb clients revoke <clientId>` 默认管理本机服务，无需先 connect，也不读取本地 CLI 设备记录。可加 `--local` 明确选择本机；`--local` 与 `--device` 互斥。指定 `--device` 则保留远端已配对管理流程。未安装本机服务的 CLI 按原设备选择规则执行。

本机管理仅允许安装时配置的桌面账户或有权限读取受保护服务凭据的管理员，使用已保存的本机证书指纹和凭据访问服务；不自动提权，不因缺少凭据而跳过认证。服务未启动会报告连接错误；权限不足报告 LOCAL_ADMIN_UNAVAILABLE。撤销立即终止目标客户端的连接、订阅、转发与正在执行的任务；列表仍保留带 revokedAt 的记录。

撤销并非永久禁止设备连接。远端再次执行 `wdb connect <服务端地址>` 会申请新的授权，服务端再次弹窗同意后生成新凭据；拒绝、关闭或超时不恢复访问。旧凭据始终失效，旧撤销记录保留。

`devices` 和 `devices --watch` 的文本表格中，ADDRESS 显示主机及端口，例如 `172.20.115.75:18766`，省略 `https://`。这是显示格式；JSON的`url`、保存的服务地址及实际HTTPS传输保持不变。

`devices` 同时展示实时状态、Windows 设备名、URL、固定 16 字符且无分隔符的设备 ID；JSON 的 `enabled` 为本地启用，`connected` 为本次在线探测结果。旧 UUID 自动迁移，不需重新配对。`devices --watch` 持续观察离线/恢复变化。已配对命令和任务等待默认自动重连最多 60 秒；`--reconnect-timeout` 可调整。证书、设备 ID 或授权错误不自动重试；服务重启不重跑结果未知的任务。详见[自动重连与设备标识](connection.md)。

Electron 应用使用 `wdb electron launch|targets|observe|tree|find|action|wait|eval|screenshot|logs`，支持服务端本机 CDP、UIA 与视觉坐标操作。完整参数、兜底规则、自研应用配置和验证方法见 [Electron 调试指南](electron.md)。

Flutter 应用使用 `wdb flutter info|isolates|observe|tree|find|properties|wait|logs|memory|screenshot|action`。协议观察接入Dart VM Service/Inspector，操作使用UIA与视觉，详见 [Flutter指南](flutter.md)。

## 结果和任务

常规命令支持 `--json`，stdout 只有最终 JSON，文件进度及重连提示输出到 stderr。JSON 信封包含 `requestId`、`deviceId`、`status`、`error`、`durationMs`、`artifacts` 和 `data`。任务对象在 `data` 内，任务结果在其中的 `data`。失败退出码为 1，成功/接受退出码为 0。`reboot_required` 表示需重启，不自动重启设备。`logs ... --follow --json` 和 `devices --watch --json` 按行输出事件/快照及最终结束结果。无脚本的 `shell` 是交互终端，不接受 JSON；`forward` / `reverse --json` 输出生命周期 NDJSON，见 [交互与转发](streaming.md)。

默认提交任务后轮询至结束，`--detach` 在接受任务后返回任务 ID。`--timeout <毫秒>` 设置服务端执行超时；`--wait-timeout <毫秒>` 只限制客户端等待。超时或连接错误不能证明操作没有发生，应查询任务或重新观察界面，禁止盲目重复点击、安装、触摸回放。

```powershell
wdb task list --json
wdb task get <任务ID> --json
wdb task wait <任务ID> --follow --json
wdb task cancel <任务ID> --json
wdb task output <任务ID> --json
wdb task delete <已结束任务ID> --json
```

`--follow` 在人类输出模式下把任务新增 stdout 打到 stderr；JSON 模式保持单个最终 JSON。输入任务的等待过程发送控制心跳；客户端退出、`disconnect` 或网络失联后服务端按心跳超时取消输入并释放按键/触点。安装、长 shell 断开后继续，重连查询；录屏继续到预设上限。不要对输入任务使用 `--detach`，除非另有客户端持续维护该身份的控制心跳。

支持 `taskEvents` 的服务端通过 HTTPS SSE 推送任务状态和 stdout，CLI 自动使用，无需新参数；旧服务端回退轮询。`--poll-ms` 用于回退轮询，`--wait-timeout` 仍约束整个等待。单次 CLI 命令内复用已校验证书的 HTTPS 连接，退出时释放。详见 [重连规则](connection.md)。

## PowerShell 和文件

```powershell
wdb shell --script 'Get-Date; whoami' --json
wdb shell --script-file .\diagnose.ps1 --cwd 'C:\测试目录' --env '{"TEST":"你好"}' --timeout 60000 --json
wdb shell --script 'Get-Service WdbService' --admin --json
wdb push '.\安装包 1.0.exe' 'C:\wdb-test\安装包 1.0.exe' --json
wdb pull 'C:\wdb-test\结果.png' '.\结果.png' --json
wdb push '.\测试目录' 'C:\wdb-test\目录' --json
wdb pull 'C:\wdb-test\目录' '.\取回目录' --recursive --json
```

默认 shell 通过已登录用户执行，只有显式 `--admin` 请求管理员身份。每次 shell 都是独立任务，跨调用不保留变量/工作目录。GUI 应用使用 `app launch`。

push/pull 使用流式传输和 SHA-256，不把大文件装进 JSON。默认不覆盖文件，`--overwrite` 显式覆盖。下载先写同目录临时文件，校验通过才发布目标文件；失败清理半成品。上传文件在发送前做一次校验，服务端边接收边校验。结果记录字节数、传输阶段和总耗时；不要把 localhost 速度当作千兆局域网验收结论。目录逐文件执行，不承诺整个目录原子替换；已成功发布的文件在后续文件失败时保留。符号链接不递归跟随。

## 桌面、控件和输入

先获取桌面状态和显示器，再获取窗口。窗口引用是包含进程身份的完整字符串，保留原值，不手工只截取 HWND。

```powershell
wdb desktop status --json
wdb screens --json
wdb windows list --title 'Wdb Test' --json
wdb windows focus '<window>' --json
wdb ui tree --window '<window>' --json
wdb ui find --window '<window>' --automationId 'InputBox' --json
wdb screenshot --window '<window>' --json
```

UI 操作用 `ui.find` / `ui.tree` 返回的完整 `reference` 对象。保存 JSON 到参数文件能避免 PowerShell 引号差异和命令行长度限制：

```json
{"reference":{"window":"<完整窗口标识>","runtimeId":[42,123]},"method":"uia","action":"value","value":"中文\nEnglish !"}
```

```powershell
wdb ui action --args-file .\action.json --json
wdb ui wait --window '<window>' --name '完成' --state appeared --timeoutMs 10000 --json
wdb text '中文 English !' --json
wdb key Ctrl+A --json
wdb mouse click --x 400 --y 300 --json
wdb mouse drag --x 400 --y 300 --toX 700 --toY 400 --durationMs 1000 --json
```

`method: "uia"` 的 `invoke/value/toggle/select/expand/collapse/focus` 是控件接口调用。需要验证真实输入路径时选择 `method: "input", action: "click"`，或 `mouse/key/text`；文本默认 Unicode 注入并返回实际方式。`key ... down --holdMs 1000` 是有界保持，结束/取消后释放；不创建跨任务永久按下状态。

支持 TogglePattern 的控件返回 `toggleState: "On" | "Off" | "Indeterminate"`，不支持时为 null；可用于操作前后验证。`wdb call windows.hitTest --args '{"x":500,"y":400}' --json` 返回该物理坐标命中的子窗口、类名及根窗口，用于排查透明覆盖层或输入目标错误。

截图、UI 边界和输入坐标均为 `virtual-desktop-physical` 物理像素。截图返回 `bounds`、`mapping` 和 `layoutId`。输入可传 `--layout-id <layoutId>`，布局变化返回 `DISPLAY_CHANGED` 后重新观察。显示器通过 `screens` 返回的数字 `index` 选择，例如 `screenshot --monitor 0`。区域截图用 `--args-file` 中的 `region:{x,y,width,height}`。缩略图坐标先按缩放比例还原至原图像素，再加截图 `mapping.offsetX/offsetY`。

## 真实触摸

触摸在目标机使用 Windows 触摸注入接口，不转换成鼠标。参数文件格式：

```json
{"frames":[
  {"t":0,"contacts":[{"id":1,"x":500,"y":400,"phase":"down"}]},
  {"t":100,"contacts":[{"id":1,"x":550,"y":430,"phase":"move"}]},
  {"t":110,"contacts":[{"id":1,"x":550,"y":430,"phase":"up"}]}
]}
```

运行 `wdb touch --args-file trajectory.json --json`。`t` 是相对毫秒；同一 frame 同步注入最多 10 个活动触点。各触点使用独立 ID 和 down/move/up 生命周期，up 坐标必须等于该触点最后一次 move/down 坐标。时序在服务端执行，不逐点网络往返。执行成功仅说明接口执行结果，笔迹完整性还需对应用画面和录像进行独立判断。


## 扩展操作和 Agent Skill

录屏启动是有上限的长任务。下面开始 10 分钟录屏后立即返回录屏任务 ID；`record stop --id` 可提前结束，随后用 `task get` 读取 MP4 产物路径并 `pull`。客户端断开不让录像无限继续。

录屏使用捆绑 FFmpeg，安装包不再包含 ffprobe。结果保留兼容字段 `probe: null`；`recordingStats` 的 `frames` 和 `outputDurationSeconds` 来自 FFmpeg 编码进度，缺失时为 null，`complete` 表示进度收到 end。它们不是文件完整解码或实际画面采集帧率的证明；`requestedFps` 是请求值。开发验收通过 FFmpeg 完整解码到 EOF、H.264 检查和提取画面核对尺寸；Media Foundation 元数据读取留作后续扩展。

```powershell
wdb record start --durationSeconds 600 --monitor 0 --timeout 630000 --detach --json
wdb record stop --id '<录屏任务ID>' --json
wdb app list --json
wdb app launch 'C:\Apps\Example.exe' --arguments '--test-mode' --json
wdb app install 'C:\wdb-test\setup.exe' --arguments '["/S"]' --admin --timeout 300000 --json
wdb logs file --path 'C:\Apps\logs\app.log' --lines 100 --json
wdb logs file --path 'C:\Apps\logs\app.log' --follow --json
wdb logs events --log Application --limit 100 --json
wdb logs events --log System --startTime '2026-11-05T00:00:00' --follow --duration 60000 --json
```

`app list` 合并机器与当前登录用户的卸载注册表，结果标明 `scope`。机器范围部署显式使用 `--admin`；按用户安装/卸载使用 `--scope user`，由桌面助手以登录用户身份执行，不同时指定 `--admin`。卸载仍须提供查询所得完整 `id`、明确的卸载程序路径与参数。不能因SYSTEM账户看不到用户注册表就认为应用未安装。

日志订阅由 CLI 每秒查询，Ctrl+C、客户端断开或网络失败后结束；重连后重新订阅，可用时间范围补查。文件订阅返回 `content`、`truncated`、`rotated` 事件；增长超过单次读取窗口会显式报告 `gap`，用 `--limitBytes` 扩大窗口或拉取原始日志补查。事件订阅按 RecordId 和时间去重，有下一页时返回 `page_available`，用 `--offset` 查询或缩小时间范围。轮询不等于无损事件流；高写入速率下应拉取文件或按时间分页补查。



`devices` 在 Windows/macOS 采用相同规则：在线设备正常显示；历史配对记录在新终端中不会显示为 `offline`。仅在当前终端通过 `connect` 或 `devices` 观察到在线的设备，随后探测离线时才保留离线条目，从首次发现离线起最多显示 10 分钟；重复探测不延长时间。恢复在线后重新显示。该过滤同时适用于文本、JSON 和 `--watch`，不删除配对凭据，也不改变显式 `--device` 的使用。授权/证书错误仍显示。会话按终端标识及父 shell 进程识别（Windows 跳过 npm 的临时 cmd /c 启动层）；无法识别时仅保留当前 CLI 调用内的观察，不继承历史离线条目。
