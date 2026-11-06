# wdb Windows CLI

Windows x64 的 localhost 已验证，LAN 交付包与本机 LAN IP 自检已完成；另一台电脑的网络验收见 [LAN 指南](LAN.md)，独立客户端使用见 [WINDOWS-CLIENT.md](WINDOWS-CLIENT.md)，Mac 并行开发见 [MACOS-CLI-DEVELOPMENT.md](MACOS-CLI-DEVELOPMENT.md)。开发目录运行 `bin\wdb.cmd`，离线安装包携带 Node.js 运行时，目标机器不需配置 Node、Python 或 SSH。

## 配对和选择设备

新客户端配对需要服务器本机操作者在弹窗中同意。默认临时授权；勾选记住后持久授权。CLI默认等待150秒（`--approval-timeout`），拒绝/关闭/超时不授权。临时许可结束时运行connect重新确认，详见 [连接授权](CONNECTION-APPROVAL.md)。

从服务端本机安装/诊断输出取得 SHA-256 证书指纹和配对码，再运行：

```powershell
.\bin\wdb.cmd connect localhost:18766 --fingerprint <64位证书指纹> --pairing-code <配对码> --json
.\bin\wdb.cmd info --json
.\bin\wdb.cmd devices --json
```

客户端在发送令牌、配对码或操作请求前验证证书 SHA-256 指纹。指纹错误则连接失败，不自动接受新证书。首次配对授予完整调试权限；后续 `connect localhost:18766` 复用已保存的凭据。Windows 凭据保存在 `%LOCALAPPDATA%\wdb\client\devices.json`；Mac 默认 `~/Library/Application Support/wdb/client/devices.json`，目录/文件权限为 0700/0600。优先级为 `--config <目录>` > `WDB_CONFIG` > 平台默认，可选择独立客户端身份。Mac 入口和旧配置迁移见 [MACOS-CLIENT.md](MACOS-CLIENT.md)。请把自定义配置目录放在当前用户私有目录中，不加入 Git。

`disconnect` 禁用本地连接并尝试通知服务端，保留配对凭据，不撤销授权；服务离线也能主动断开。`clients list` 查看授权；`clients revoke <clientId>` 撤销指定客户端。多设备已连接时必须加 `--device <地址、deviceId或唯一设备名>`；不自动选择首个设备。单机可用不同服务端端口和不同 `--config` 目录验证多客户端和多设备路由。

`devices` 同时展示实时状态、Windows 设备名、URL、固定 16 字符且无分隔符的设备 ID；JSON 的 `enabled` 为本地启用，`connected` 为本次在线探测结果。旧 UUID 自动迁移，不需重新配对。`devices --watch` 持续观察离线/恢复变化。已配对命令和任务等待默认自动重连最多 60 秒；`--reconnect-timeout` 可调整。证书、设备 ID 或授权错误不自动重试；服务重启不重跑结果未知的任务。详见[自动重连与设备标识](RECONNECTION.md)。

Electron 应用使用 `wdb electron launch|targets|observe|tree|find|action|wait|eval|screenshot|logs`，支持服务端本机 CDP、UIA 与视觉坐标操作。完整参数、兜底规则、自研应用配置和验证方法见 [Electron 调试指南](ELECTRON.md)。

Flutter 应用使用 `wdb flutter info|isolates|observe|tree|find|properties|wait|logs|memory|screenshot|action`。协议观察接入Dart VM Service/Inspector，操作使用UIA与视觉，详见 [Flutter指南](FLUTTER.md)。

## 结果和任务

所有命令支持 `--json`；常规命令 stdout 只有最终 JSON，文件进度及重连提示输出到 stderr。JSON 信封包含 `requestId`、`deviceId`、`status`、`error`、`durationMs`、`artifacts` 和 `data`。任务对象在 `data` 内，任务结果在其中的 `data`。失败退出码为 1，成功/接受退出码为 0。`reboot_required` 表示需重启，不自动重启设备。`logs ... --follow --json` 和 `devices --watch --json` 按行输出事件/快照及最终结束结果。

默认提交任务后轮询至结束，`--detach` 在接受任务后返回任务 ID。`--timeout <毫秒>` 设置服务端执行超时；`--wait-timeout <毫秒>` 只限制客户端等待。超时或连接错误不能证明操作没有发生，应查询任务或重新观察界面，禁止盲目重复点击、安装、触摸回放。

```powershell
.\bin\wdb.cmd task list --json
.\bin\wdb.cmd task get <任务ID> --json
.\bin\wdb.cmd task wait <任务ID> --follow --json
.\bin\wdb.cmd task cancel <任务ID> --json
.\bin\wdb.cmd task output <任务ID> --json
.\bin\wdb.cmd task delete <已结束任务ID> --json
```

`--follow` 在人类输出模式下把任务新增 stdout 打到 stderr；JSON 模式保持单个最终 JSON。输入任务的等待过程发送控制心跳；客户端退出、`disconnect` 或网络失联后服务端按心跳超时取消输入并释放按键/触点。安装、长 shell 断开后继续，重连查询；录屏继续到预设上限。不要对输入任务使用 `--detach`，除非另有客户端持续维护该身份的控制心跳。

## PowerShell 和文件

```powershell
.\bin\wdb.cmd shell --script 'Get-Date; whoami' --json
.\bin\wdb.cmd shell --script-file .\diagnose.ps1 --cwd 'C:\测试目录' --env '{"TEST":"你好"}' --timeout 60000 --json
.\bin\wdb.cmd shell --script 'Get-Service WdbService' --admin --json
.\bin\wdb.cmd push '.\安装包 1.0.exe' 'C:\wdb-test\安装包 1.0.exe' --json
.\bin\wdb.cmd pull 'C:\wdb-test\结果.png' '.\结果.png' --json
.\bin\wdb.cmd push '.\测试目录' 'C:\wdb-test\目录' --json
.\bin\wdb.cmd pull 'C:\wdb-test\目录' '.\取回目录' --recursive --json
```

默认 shell 通过已登录用户执行，只有显式 `--admin` 请求管理员身份。每次 shell 都是独立任务，跨调用不保留变量/工作目录。GUI 应用使用 `app launch`。

push/pull 使用流式传输和 SHA-256，不把大文件装进 JSON。默认不覆盖文件，`--overwrite` 显式覆盖。下载先写同目录临时文件，校验通过才发布目标文件；失败清理半成品。上传文件在发送前做一次校验，服务端边接收边校验。结果记录字节数、传输阶段和总耗时；不要把 localhost 速度当作千兆局域网验收结论。目录逐文件执行，不承诺整个目录原子替换；已成功发布的文件在后续文件失败时保留。符号链接不递归跟随。

## 桌面、控件和输入

先获取桌面状态和显示器，再获取窗口。窗口引用是包含进程身份的完整字符串，保留原值，不手工只截取 HWND。

```powershell
.\bin\wdb.cmd desktop status --json
.\bin\wdb.cmd screens --json
.\bin\wdb.cmd windows list --title 'Wdb Test' --json
.\bin\wdb.cmd windows focus '<window>' --json
.\bin\wdb.cmd ui tree --window '<window>' --json
.\bin\wdb.cmd ui find --window '<window>' --automationId 'InputBox' --json
.\bin\wdb.cmd screenshot --window '<window>' --json
```

UI 操作用 `ui.find` / `ui.tree` 返回的完整 `reference` 对象。保存 JSON 到参数文件能避免 PowerShell 引号差异和命令行长度限制：

```json
{"reference":{"window":"<完整窗口标识>","runtimeId":[42,123]},"method":"uia","action":"value","value":"中文\nEnglish !"}
```

```powershell
.\bin\wdb.cmd ui action --args-file .\action.json --json
.\bin\wdb.cmd ui wait --window '<window>' --name '完成' --state appeared --timeoutMs 10000 --json
.\bin\wdb.cmd text '中文 English !' --json
.\bin\wdb.cmd key Ctrl+A --json
.\bin\wdb.cmd mouse click --x 400 --y 300 --json
.\bin\wdb.cmd mouse drag --x 400 --y 300 --toX 700 --toY 400 --durationMs 1000 --json
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

**无需实体触摸屏即可验证 Windows 模拟触摸。** Windows 11 的“蓝牙和其他设备 → 触控 → 三指和四指的触摸手势”开启时，系统可能拦截多指应用输入。本机已复现 1/2 指正常、3/5/10 指无应用事件，关闭该开关后 10 指正常。可用 `app launch ms-settings:devices-touch` 打开设置；先记录原始开关状态，诊断时临时关闭，结束后恢复。CLI 注入不会自动修改这项系统偏好。先核实焦点、`windows.hitTest`、屏幕布局，再用应用事件和笔迹判断；详见[触摸复验](touch-verification-20261106.md)。

## 扩展操作和 Agent Skill

录屏启动是有上限的长任务。下面开始 10 分钟录屏后立即返回录屏任务 ID；`record stop --id` 可提前结束，随后用 `task get` 读取 MP4 产物路径并 `pull`。客户端断开不让录像无限继续。

```powershell
.\bin\wdb.cmd record start --durationSeconds 600 --monitor 0 --timeout 630000 --detach --json
.\bin\wdb.cmd record stop --id '<录屏任务ID>' --json
.\bin\wdb.cmd app list --json
.\bin\wdb.cmd app launch 'C:\Apps\Example.exe' --arguments '--test-mode' --json
.\bin\wdb.cmd app install 'C:\wdb-test\setup.exe' --arguments '["/S"]' --admin --timeout 300000 --json
.\bin\wdb.cmd logs file --path 'C:\Apps\logs\app.log' --lines 100 --json
.\bin\wdb.cmd logs file --path 'C:\Apps\logs\app.log' --follow --json
.\bin\wdb.cmd logs events --log Application --limit 100 --json
.\bin\wdb.cmd logs events --log System --startTime '2026-11-05T00:00:00' --follow --duration 60000 --json
```

`app list` 合并机器与当前登录用户的卸载注册表，结果标明 `scope`。机器范围部署显式使用 `--admin`；按用户安装/卸载使用 `--scope user`，由桌面助手以登录用户身份执行，不同时指定 `--admin`。卸载仍须提供查询所得完整 `id`、明确的卸载程序路径与参数。不能因SYSTEM账户看不到用户注册表就认为应用未安装。

日志订阅由 CLI 每秒查询，Ctrl+C、客户端断开或网络失败后结束；重连后重新订阅，可用时间范围补查。文件订阅返回 `content`、`truncated`、`rotated` 事件；增长超过单次读取窗口会显式报告 `gap`，用 `--limitBytes` 扩大窗口或拉取原始日志补查。事件订阅按 RecordId 和时间去重，有下一页时返回 `page_available`，用 `--offset` 查询或缩小时间范围。轮询不等于无损事件流；高写入速率下应拉取文件或按时间分页补查。

所有服务端操作都可通过 `wdb call <op> --args-file <文件> --json` 调用，不需要绕过 CLI。安装器的静默参数必须来自用户或应用配置，不推测通用 EXE 参数。应用部署、日志、录屏具体参数以服务端能力输出和项目实现文档为准。

将交付的 `skills\wdb` 目录复制到项目 `.agents\skills\wdb`（Codex）或 `.claude\skills\wdb`（Claude Code）；也可在需要时直接让 Agent 读取该 SKILL.md。Skill 不包含配对密码或模型 API Key。
