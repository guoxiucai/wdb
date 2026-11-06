# macOS CLI 开发与 Windows 服务端对接

版本：2026-11-06；协议基线 `/v1`、`protocolVersion:1`、产品版本 `0.1.0`。Windows LAN 支持提交 `4e88694`，独立 CLI/验证脚本提交 `ad15ad6`。本文是 Mac 端并行开发交接文档，Mac 安装包与实机结果尚未交付。

## 1. 目标和复用边界

范围为 **macOS 14+、Apple Silicon arm64 客户端 → Windows x64 服务端**，CLI + Agent Skill，无 Mac GUI、无 Mac 服务端、无客户端桌面控制。所有 UIA、键鼠/触摸、应用安装、PowerShell、FFmpeg、CDP、Flutter VM/Inspector 都在 Windows 端执行；Mac 只做加密传输、任务管理、文件收发和输出展示。

采用现有 Node.js 客户端作为共同实现。当前 CLI 没有第三方 npm 依赖，三个源码文件即可运行；在 Mac 上先跑共享源码，再补启动器、配置目录、分发包及兼容性验证。不要另建一套功能不同的协议或复制一份长期分叉的 CLI。

| 文件 | 复用内容 | Mac 工作 |
|---|---|---|
| `src/cli.js` | 参数解析、设备选择、任务等待、命令映射、文件传输、JSON/退出码 | 本地路径、配置目录、终端信号和跨平台测试 |
| `src/client-transport.js` | TLS 指纹校验、Bearer 认证、身份核对、重连、提交去重恢复 | 复用并在 Mac TLS 栈实测 |
| `src/device-id.js` | 16 字符 ID 与旧 UUID 确定性迁移 | 原样复用 |
| `skills/wdb`、`docs` | 操作策略、命令及验收 | 增加 Mac 入口与安装示例，保持同一 Skill |
| `scripts/validate-lan.js` | 已配对 CLI 的文件/截图/断开重连闭环 | 脚本使用当前 Node 和共享 CLI，可直接在 Mac 运行；尚待 Mac 实测 |
| `bin/wdb.cmd`、`scripts/build-client.ps1` | Windows 启动器/打包清单参考 | 新增 `bin/wdb`、Mac 构建/校验脚本 |
| `native/*`、`src/server.js`、`src/helper.js`、其他服务端 JS | Windows 执行实现/协议依据 | 不放入 Mac 运行包、不在 Mac 执行 |

当前 Windows 包使用 Node **v24.15.0**。Mac 初次对齐同版本 arm64 二进制；后续运行时升级独立提交、两端回归。该版本的 [官方校验清单](https://nodejs.org/download/release/v24.15.0/SHASUMS256.txt) 提供 `node-v24.15.0-darwin-arm64.tar.gz`，SHA-256 为 `372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4`。

## 2. 当前可用服务端

| 项目 | 值 |
|---|---|
| 地址 | `https://172.20.115.75:18766`；以服务器当前网卡为准 |
| hostname / deviceId | `qingwei` / `2f493aacf427f3e9` |
| HTTPS | 自签名证书 + 证书 DER SHA-256 固定指纹，TLS 至少 1.2 |
| 入站范围 | Ethernet 当前 IPv4、18766、LocalSubnet，具体规则 `WdbService-LAN` |
| 配对材料 | 服务器本地 `scripts\show-pairing.ps1 -RevealCode`；不在 Git 或交付包中 |
| GUI 前提 | Windows 用户登录、桌面解锁、WdbDesktopHelper 正常 |

先确认 Mac 与服务器可路由，使用明确 IP，不依赖发现协议。若不在同一可达子网，按服务器 `docs/LAN.md` 配置明确来源地址范围，不关闭防火墙。只有 18766 是客户端连接入口；18767、Electron CDP、Dart VM Service 都是 Windows 服务器内部地址。

最早可进行的开发验证（在仓库根目录，开发机已有 Node 24）：

```sh
node --version
node src/cli.js --version --json
export WDB_CONFIG="$HOME/Library/Application Support/wdb/client-dev"
node src/cli.js connect 172.20.115.75 --fingerprint '<可信指纹>' --pairing-code '<配对码>' --json
node src/cli.js info --device 172.20.115.75 --json
node scripts/validate-lan.js --device 172.20.115.75 --output ./artifacts/mac-lan-smoke
```

以上占位值只用于说明；实际配对码从终端变量/安全输入读取，避免字面值进入 shell 历史、日志或提交。开发终端没有配置 `WDB_CONFIG` 时，当前共享代码在 Mac 会回落到 `~/wdb/client`，并非 `~/Library/Application Support`；不要把计划中的目录当作已实现行为。

## 3. CLI 与本地适配

### 参数和输出

以 `node src/cli.js --help`、`docs/CLI.md` 和 `desktopCommand()` 为当前契约，命令名保持一致。`--json` 常规命令 stdout 只有一个 UTF-8 JSON；进度/重连提示走 stderr。watch 和日志 follow 输出 NDJSON 事件及最终结束结果。成功/accepted/reboot_required 退出 0，失败/取消/超时/unknown/需人工介入退出 1。需重启仅作为结果，不自动重启。

不要把终端渲染、下载进度或调试日志写入 JSON stdout；保持中文、多行、emoji 和分块 UTF-8 完整。`--args-file`、`--script-file`、`--expression-file` 是 **Mac 本地**文件，读取内容后传输；args 的 Windows `path` / `cwd` 是 **远端**路径。

### 路径与文件

本地路径使用 Mac 的 `path.resolve/join`；远端路径保留 Windows 语义，不能用 Mac `path.resolve('C:\\...')`。现有 `remoteJoin` 拼接远端目录，服务器接受绝对 Windows 路径并解析混合分隔符。如新增路径逻辑，显式选择 `path.win32`，参见 [Node Windows/POSIX 路径差异](https://nodejs.org/api/path.html#windows-vs-posix)。

```sh
node src/cli.js push './安装包 1.0.exe' 'C:\wdb-test\安装包 1.0.exe' --json
node src/cli.js pull 'C:\wdb-test\截图.png' './结果/截图.png' --json
node src/cli.js shell --script 'Get-Date; whoami' --json
node src/cli.js shell --script-file './diagnose.ps1' --json
```

shell 始终是远端 Windows PowerShell，不是本地 zsh。用单引号或参数文件防止 Mac shell 展开 `$env:TEMP` 等语法。图片先 pull 到本地，再由 Agent 图片工具/查看器读取；打开截图不改变 Windows 坐标体系。

Mac 文件系统测试需包括空格/中文、大小写冲突、Unicode 文件名、符号链接、下载覆盖和不同卷。当前实现拒绝上传符号链接，服务端目录枚举跳过符号链接；目录传输逐文件提交，后续失败不会回滚已成功文件。不要顺便增加断点续传或 ACL 复制。

### 配置与启动器

配置优先级保持 `--config` > `WDB_CONFIG` > 平台默认。建议为 Mac 新增 `~/Library/Application Support/wdb/client`，明确旧 `~/wdb/client` 的迁移规则：新目录不存在且旧文件存在才迁移，原子写入并保留权限；不得静默合并两个不同身份配置。目录权限 0700、凭据文件 0600；已有目录权限也要验收。当前读改写配置没有多进程锁；Mac 若增加迁移/锁，应在独立修改中解决并保留 Windows 行为，不宣称已有锁。

启动器候选（尚待 Mac 创建/验证）：

```sh
#!/bin/sh
set -eu
WDB_ROOT=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)
exec "$WDB_ROOT/runtime/node" "$WDB_ROOT/src/cli.js" "$@"
```

使用整包路径或将整包 `bin` 加入 PATH；该简例不处理任意外部符号链接入口，若安装方式创建 symlink，需专门实现并测试真实路径解析。脚本 LF、执行位 0755，Git 记录可执行位；不依赖用户全局 Node、Homebrew 或 npm。不需要在 Mac 启动 Windows helper，也不应为远端截图/点击申请 Mac 本地屏幕录制或辅助功能权限。

Ctrl+C：watch/follow 正常结束；普通长任务中止客户端等待不代表取消服务端任务。取消使用 `task cancel`。不要对所有 Ctrl+C 自动补发取消，改变已接受安装/shell 的断线语义。

## 4. HTTPS 协议

实现依据是 `src/server.js::route/submit/upload`、`src/client-transport.js` 和 `src/cli.js`。这是当前实际接口，不是拟定新协议。

### TLS 与配对

1. 将 `<IP>` 标准化为 `https://<IP>:18766`；只允许 HTTPS origin，禁止 URL 用户名/密码、业务路径、query/hash。
2. 建立 TLS，取得服务端叶证书原始 DER，计算 SHA-256，和人工可信渠道给出的 64 位 hex 指纹比较（接受冒号分隔输入，存储小写无冒号）。
3. **指纹比较成功后**才允许 flush HTTP 请求头、Bearer、配对码和请求体。当前 `openRequest()` 延迟 `req.end()` 并在 `secureConnect` 比对；不能简单使用 `rejectUnauthorized:false` 就认为完成认证。Node HTTPS 支持 TLS 相关选项，参见 [官方 HTTPS API](https://nodejs.org/api/https.html#httpsrequestoptions-callback)。
4. 首次 `POST /v1/pair`，body `{"name":"mac-client","pairingCode":"<secret>"}`。响应 `data` 为 `clientId/token/deviceId/version`。token 是 32 随机字节的 base64url 字符串，只在配对响应中明文返回；服务器保存 tokenHash。
5. 此后发送 `Authorization: Bearer <token>`。调用 `/v1/info` 检查协议/能力并记录 hostname。不得把 token 放入 URL、诊断输出或共享报告。

配对码当前是安装时生成、持久保存的随机值，不是单次使用或自动过期 OTP；每个来源地址每分钟最多 10 次配对尝试，错误返回 `PAIRING_DENIED`，超限 `RATE_LIMITED`。`--name` 是客户端授权记录名称，不是服务器昵称。

身份分别处理：hostname 可重复/改名；url 是访问入口；deviceId 为 8 随机字节生成的 **16 位小写 hex**；证书指纹是安全信任锚。只有设备 ID 改短，**clientId、taskId、requestId、submissionId 仍是完整 UUID**。旧 device UUID 迁移计算 `SHA256('wdb-device-id-v1:' + lower(uuid)).slice(0,16)`，复用 `device-id.js`。

每个 JSON API 响应都核对 deviceId；`/v1/info` 或 `/v1/health` 返回的 protocolVersion 如果存在且不是 1，立即报 `INCOMPATIBLE_PROTOCOL`。不可把证书/ID/授权不匹配当网络重试，不自动重新配对。旧端缺少协议字段当前允许兼容，但去重能力必须明确为 true 才能恢复已发送提交。

### 通用信封

```json
{
  "requestId": "<本次响应UUID>",
  "deviceId": "2f493aacf427f3e9",
  "status": "succeeded",
  "error": null,
  "durationMs": 12,
  "data": {},
  "artifacts": []
}
```

错误为 `error:{code,message}`；任务错误可能另有 details。HTTP 错误和 JSON error 均失败。**查询任务的外层 succeeded 仅表示查询成功**，任务结果看 `data.status`，实际业务结果在 `data.data`。任务持续时间是任务自身的 durationMs，不能用查询请求耗时替代。JSON 请求体服务端上限 8 MiB；客户端响应上限 32 MiB；二进制文件不经过 JSON。

### 路由表

除 pair 外均需 Bearer。以下路径中的 ID 使用 URL 编码，文件 path 使用 `URLSearchParams` 编码。

| 方法与路径 | 输入 | `data` / 行为 |
|---|---|---|
| POST `/v1/pair` | name、pairingCode | clientId、token、deviceId、version |
| GET `/v1/health` | 无 | version、protocolVersion、deviceId、hostname、serverProcessId、taskSubmissionDeduplication |
| GET `/v1/info` | 无 | capabilities、desktop、execution、平台/版本/配额等 |
| POST `/v1/heartbeat` | `{}` | connected:true；续期客户端输入租约 |
| DELETE `/v1/connection` | 无 | disconnected:true、credentialsRetained:true；取消该客户端输入 |
| GET `/v1/clients` | 无 | clients 数组，不含 token/hash |
| DELETE `/v1/clients/<clientId>` | 无 | revoked；禁止后续请求、请求取消该客户端活动任务 |
| POST `/v1/tasks` | op、args、submissionId、可选 timeoutMs | HTTP 202 / outer accepted / data 为任务对象 |
| GET `/v1/tasks` | 无 | tasks：当前认证客户端自己的任务 |
| GET `/v1/tasks/<id>` | 无 | 当前任务状态和结果 |
| POST `/v1/tasks/<id>/cancel` | 可无 body | 请求取消，不等于完成；继续查状态 |
| GET `/v1/tasks/<id>/output` | 无 | stdout/stderr 的当前累计内容，不是 SSE |
| DELETE `/v1/tasks/<id>` | 无 | 删除已结束任务及产物；活动任务 TASK_ACTIVE |
| POST `/v1/directories` | `{"path":"C:\\..."}` | 递归创建目录 |
| GET `/v1/directories?path=...` | 绝对 Windows 路径 | path、entries:[{name,type,size}] |
| PUT `/v1/files?path=...&overwrite=false` | 文件流与校验头 | path、bytes、sha256、durationMs |
| GET `/v1/files?path=...` | 绝对 Windows 路径 | 成功为二进制；错误仍是 JSON 信封 |

CLI 的 `artifacts.*` 别名目前没有对应服务端实现，不把它写成 Mac 可用能力。产物使用 task 对象的 artifacts、files 拉取、task delete 清理。文件接口属于完整调试权限，不能理解为只允许访问任务目录的沙盒。

## 5. 任务、恢复和输入租约

提交示例：

```json
{
  "op": "shell",
  "args": {"command":"Get-Date; whoami", "env":{}, "admin":false},
  "submissionId": "<一次逻辑操作生成一次UUID>",
  "timeoutMs": 120000
}
```

任务字段：`id/taskId/requestId`（任务内三者相同）、deviceId、clientId、op、status、createdAt、startedAt、endedAt、durationMs、error、artifacts、data，以及可选 submissionId/submissionHash/cancelRequested/cancelReason。不要把 HTTP 请求的 requestId 和任务内 requestId 混淆。

- 活动状态 `accepted/running`；当前主要终态 `succeeded/failed/timed_out/cancelled/unknown/reboot_required`。共享 CLI 还识别 `needs_manual_intervention/needs_intervention` 等人工介入状态和旧 queued/timeout 别名，复用 `ACTIVE/FAILED` 判定。
- 默认服务端超时 120 s；record.start 默认 durationSeconds×1000+30 s。可设 1..86400000 ms。CLI 默认轮询 350 ms，默认最长等待 24 h；等待中每约 1.5 s 发送 heartbeat。
- 服务器任务和产物默认保留 24 h，空间上限 10 GiB；清理只处理已结束任务。保留过期后不能依赖旧 submissionId 去重。
- 使用 `/health` 的 `taskSubmissionDeduplication:true` 决定可恢复提交。一次逻辑提交固定 submissionId 和整个 body，重连仍发原值；同 clientId+submissionId 返回原任务。不同 body 返回 `SUBMISSION_CONFLICT`。当前 hash 按 `JSON.stringify({op,args,timeoutMs})` 计算，**重试不能改变属性顺序、参数或省略/增加字段**。
- 重连默认预算 60 s、单请求 10 s、退避 250 ms 起最大 3 s。无副作用 GET/heartbeat 可恢复；任务提交仅在支持去重时恢复。pair、revoke、目录创建、delete 等已发送但回包丢失时不盲目重放，返回 `REQUEST_OUTCOME_UNKNOWN`。
- 服务重启后已完成任务保留，未完成任务转 `unknown / SERVICE_RESTARTED`；不重新执行。网络中断时长 shell/安装继续，重新查询旧 ID。输入失联取消，录屏运行至上限，文件中断失败并清理半成品，日志订阅结束。
- 输入控制租约按 **clientId** 维护，不是专属 TCP 连接；除 health 外的认证请求会刷新，超过 10 s 没有刷新时取消该客户端活动 `input.*`。同身份另一个进程可以续租。不要把 input.* detach 后退出；保持 wait 心跳。显式 disconnect 删除租约并取消输入。
- 本地 disconnect 先写 connected:false，即使远端离线也禁用自动恢复。已接受非输入任务继续，connect 复用授权后可查询。需要撤销授权时另用 clients revoke。

watch 用 health 查询，不续期输入；异常身份暂停自动探测直至显式配置/连接改变。客户端无常驻 daemon，连接状态是凭据允许使用 + 当前探测结果，不是持续 TCP socket。

## 6. 文件协议及指标

上传：预先流式计算 SHA-256；PUT 带 `Content-Type: application/octet-stream`、准确 Content-Length、`x-content-sha256:<64hex>`。服务端写同目录 `.wdb-<UUID>.part`，边收边校验；校验通过后发布，默认目标存在返回 TARGET_EXISTS，覆盖必须 overwrite=true。中断删除本次 .part，无续传。

下载：服务端先算 hash 再发送 `Content-Length` 与 `x-content-sha256`；客户端边收边校验，写目标同目录临时文件，验证后原子发布，失败清理。缺校验头、字节校验不符、目标已存在分别明确失败。目录名称需要拒绝 `..`、分隔符和冒号等不安全条目（复用现有实现）。

上传结果含 checksumMs、transferMs、durationMs；下载含 responseWaitMs（含服务端预校验等待）、transferMs、durationMs、checksumMode。吞吐按实际字节/传输阶段时间计算，同时单列含校验总时长；不能用内存缓存的小文件推断≥1 GB 不可压缩文件目标。禁止把大于4 GB长度转32位整数，保留流背压，不用整文件 Buffer。

## 7. 操作映射和三类 UI 调试

| CLI | task op / 要点 |
|---|---|
| shell | `shell`；args.command/cwd/env/admin |
| screens、screenshot、desktop status | 同名或 `desktop.status`；截图远端产物路径 pull |
| windows list | `windows.list` |
| windows focus/maximize/... | `windows.action`，args.action/window |
| ui tree/find/action/wait | `ui.*`；完整 reference，原样传输 |
| mouse、key、text、touch | `input.mouse/key/text/touch`；Windows 物理坐标/键名 |
| app launch | `app.launch`，Windows exe、工作目录 |
| app list/install/update/uninstall | `apps.*`；机器范围显式 admin，用户范围 scope:user |
| record start/stop | `record.*`；持续任务、时长上限、拉取 MP4 |
| logs events/file | `logs.*`；follow 是 CLI 轮询，不是 SSE |
| electron ... | `electron.*`；Windows 端 loopback CDP + UIA/视觉 |
| flutter ... | `flutter.*`；Windows 端 VM Service/Inspector + UIA/视觉 |
| call <op> | 通用 JSON op/args 转发；不编写客户端原生执行适配 |

显示器、截图 mapping、layoutId、window ID、UIA reference 都属于 **Windows 目标机**。不可将远端坐标乘上 Mac Retina 缩放。截图缩略图坐标按原图尺寸和 mapping 还原；DISPLAY_CHANGED 后重新观察。窗口 ID 不截成 HWND；UIA/Flutter 缓存引用不跨过期状态复用。

Electron：CDP endpoint 如 `http://127.0.0.1:9222` 指 Windows 本机，target 是 page ID，window 是完整 Windows 窗口 ID。Mac 不直接连接 CDP。Flutter：传完整 VM Service URI及认证路径（放私有参数文件），window/PID 与 VM 进程绑定；Debug 有 Inspector，Profile/Release 不保证有。Inspector 只观察，动作通过 UIA/明确坐标；auto 仅对确认尚未操作的失败做兜底，unknown/timeout 不自动换后端重做。完整参数见 `ELECTRON.md`、`FLUTTER.md`，共享 CLI 原样支持，不重复实现这些协议。

## 8. 分步开发与独立提交

| 步骤 | 交付 | 独立验证后提交 |
|---|---|---|
| M1 启动与配置 | bin/wdb、LF/执行位、Mac 默认路径/迁移方案 | 从任意 cwd/空格路径启动；不依赖全局 Node；版本、JSON、0700/0600 |
| M2 身份与设备 | 共享 transport/CLI 在 Mac 的适配 | 正确/错误指纹、配对、复用token、ID不符、撤销、多目标歧义；错误指纹时服务收到0请求 |
| M3 任务与重连 | 复用任务状态/去重/取消、信号行为 | 接受回包丢失仅执行一次；网络恢复；service重启unknown；Ctrl+C等待与cancel区别 |
| M4 文件与产物 | Mac本地路径/Unicode/发布语义 | 中文目录、空格、hash不符、中断、覆盖、>4GB、≥1GB性能；拉取截图/MP4可打开 |
| M5 全命令与 Skill | 参数文件、PowerShell、UIA/CDP/Flutter、Skill入口 | 在同一 Windows 三类应用完成观察→动作→状态验证；多客户端共享桌面约束 |
| M6 离线发布 | arm64运行时、许可证、校验、安装/卸载文档 | 一台未安装Node/npm的Mac离线解压运行；断网仍能启动CLI并通过LAN连接 |

每一步验证后提交，后续问题用独立 bug 修复，不积累到最后。若要改协议字段/错误码，先保持 Windows 客户端兼容，再补两端测试；protocolVersion升级需明确策略。

可先运行 `node --test tests/cli.test.js`（开发机需 openssl，测试自己生成临时证书）；现有其他测试中有 Windows PowerShell、真实服务与 `.runtime/server` 测试凭据依赖，不能直接把 Windows 全套 `npm test` 当作 Mac 验收命令。不要复制正在运行服务的 TLS 私钥来满足测试。为重连/去重测试新增平台独立假服务或本地生成专用测试证书。

Mac 真实连接直接运行 `node scripts/validate-lan.js ...`，它只需已有配对配置，不需要服务器数据目录；现有 `tests/cli-live.test.js` 读取本机 Windows 数据目录，不能原封不动搬到 Mac。Mac 验收记录新增 `docs/MACOS-VERIFICATION.md`，包含 OS/芯片/运行时/提交、服务版本、网段、报告和明确未通过项。

## 9. 离线包清单与交接

建议目录：

```text
wdb-client-macos-arm64/
  bin/wdb
  runtime/node
  runtime/NODE-LICENSE.txt
  src/cli.js
  src/client-transport.js
  src/device-id.js
  scripts/validate-lan.js
  scripts/verify-package.*
  skills/wdb/SKILL.md + references/
  docs/
  README.md
  SHA256SUMS.txt
  BUILD-INFO.json
```

在构建机从官方发布下载运行时并核验固定 hash，提取 bin/node 和 LICENSE。交付机不联网下载依赖；不打包 Windows exe/FFmpeg、测试证书、devices.json、tokens、调试 URI、截图。校验清单覆盖每个交付文件，BUILD-INFO 记录产品/协议版本、git commit、Node版本、darwin/arm64、构建时间；避免用服务 version=0.1.0 作为唯一可追溯标记。测试正常系统运行/分发策略；不要把禁用 Gatekeeper 或全局清除隔离属性当作安装步骤。

本仓库提交源码和文档；Windows 离线包由构建脚本生成在被忽略的 dist 目录。Mac 开发者同步仓库后从 M1 开始，无需等待 Windows 远端吞吐验收。配对指纹/码单独由服务器本地读取，不通过 Git 传递。
