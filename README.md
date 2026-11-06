<p align="center">
  <img src="docs/assets/wdb-icon.png" width="144" height="144" alt="WDB：连接终端与桌面的桥梁" />
</p>

<h1 align="center">WDB · Windows Debug Bridge</h1>

<p align="center"><strong>用一套 CLI 连接、操作和调试 Windows，让开发者与 AI Agent 共用同一条调试通路。</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="版本 0.1.0" />
  <img src="https://img.shields.io/badge/server-Windows-0078D4" alt="Windows 服务端" />
  <img src="https://img.shields.io/badge/CLI-Windows%20%7C%20macOS-333333" alt="Windows 与 macOS CLI" />
  <img src="https://img.shields.io/badge/Node.js-24.15%2B%20%28%3C25%29-43853D" alt="Node.js 24.15 及以上、小于 25" />
  <img src="https://img.shields.io/badge/status-Development-orange" alt="开发测试阶段" />
</p>

<p align="center">
  <a href="#quick-start">快速开始</a> ·
  <a href="#commands">核心命令</a> ·
  <a href="#how-it-works">工作原理</a> ·
  <a href="#agent-skill">Agent Skill</a> ·
  <a href="#documentation">完整文档</a> ·
  <a href="#development">参与开发</a>
</p>

## 项目介绍

WDB 由 Windows 后台服务、跨平台 CLI 和 Agent Skill 组成。可以在本机或局域网中执行脚本、传输文件、观察桌面、操作应用、采集日志，也可以进入交互终端或建立 TCP 端口转发。命令提供结构化结果，便于自动化系统查询状态、验证操作和处理失败。

WDB 面向 Windows 应用调试，独立于 Android adb；截图与录屏用于观察和取证，目前不提供实时远程桌面视频串流。

**当前为 0.1.0 开发测试版。** Windows 服务已完成安装、升级、回滚、卸载、SSE 重连，以及交互 shell / 转发的实机验证。30 分钟持续会话测试覆盖普通用户与 SYSTEM shell、双向 TCP 长连接和周期负载；这不代表 30 分钟持续满带宽测试。证据与未覆盖项见 [Windows 验证报告](docs/STREAMING-WINDOWS-VERIFICATION.md)。

> 正式 npm 包与 GitHub Release 尚未发布。当前本地包名为 `wdb-cli-local-test`，安装器为未签名 `Development` 版，项目许可暂为 `UNLICENSED`，正式开源许可证待维护者确定。

## 核心能力

| 能力 | 用途 |
| --- | --- |
| 设备连接与授权 | 仅用地址发起连接；服务端弹窗同意 / 拒绝，可记住客户端；查看状态、断开和撤销授权 |
| 任务与脚本 | PowerShell 批处理、任务查询 / 取消、SSE 输出与按任务 ID 恢复 |
| 交互式 shell | Windows ConPTY；PowerShell / cmd / 已安装的 pwsh；中文、窗口尺寸、Ctrl+C 和终端恢复 |
| TCP 转发 | `forward` / `reverse`；传输 TCP 字节，支持半关闭；监听和目标均限制为 loopback |
| 文件与应用部署 | 文件 / 目录推拉、SHA-256 校验、显式覆盖、安装 / 更新 / 卸载 |
| 桌面与输入 | 窗口管理、UI Automation、截图、键鼠 / Unicode 输入、Windows 触摸注入 |
| Electron 调试 | CDP + UIA + 视觉观察与操作；目标发现、DOM 查询、脚本和 console |
| Flutter 调试 | VM Service / Inspector + UIA + 视觉；Widget / 属性观察与操作验证 |
| 日志与录屏 | Windows 事件 / 文件日志、跟踪输出、MP4 录制及产物下载 |
| AI Agent | 同一套 CLI 与 Skill；先观察、再操作、后验证，无需在服务端配置模型密钥 |

## 平台与验证范围

| 组件 | 当前范围 |
| --- | --- |
| Windows 服务端 | x64；安装预检要求桌面版 build 19045+、.NET Framework 4.8、Windows PowerShell 5.1；本轮实测 Windows 11 build 28000 |
| Windows CLI | npm 纯 JS 客户端；基础命令、SSE、交互 shell 与 TCP 转发已实测 |
| macOS CLI | Apple Silicon 基础客户端已完成跨机器首连、文件、截图和重连验证；npm 安装及新增交互 shell / 转发仍待 Mac 实机验收 |
| 应用适配 | 希沃白板 5、EasiClass、鸿镜的结果分别记录；控件可访问性和构建类型会影响调试能力 |

桌面操作需要目标用户已登录且解锁。Flutter Inspector 依赖应用提供相应调试服务；不能把 Debug 验证结果推广到所有 Release 应用。模拟触摸的通过也不等同于触摸屏硬件或业务画布验收。详见 [应用验收](docs/ACCEPTANCE.md)、[Electron](docs/ELECTRON-VERIFICATION.md)、[Flutter](docs/FLUTTER-VERIFICATION.md) 和 [Mac 验收](docs/MACOS-VERIFICATION.md)。

<a id="quick-start"></a>

## 快速开始

### 1. 安装 Windows 服务端

使用本地构建的以下一种安装器；[GitHub Releases](https://github.com/guoxiucai/wdb/releases) 作为后续正式下载入口，当前未发布正式产物。

| 安装器 | 适用场景 |
| --- | --- |
| `wdb-server-0.1.0-windows-x64-with-node-Development-setup.exe` | 自带固定版本 Node，目标机器无需安装 Node、npm、Git 或编译器 |
| `wdb-server-0.1.0-windows-x64-external-node-Development-setup.exe` | 使用系统已安装的合格 Node；要求受保护的安装路径、有效签名和匹配版本 |

双击安装器，通过 Windows UAC，并确认实际使用桌面的用户。安装完成后，`WdbService` 自动启动；程序位于 `C:\Program Files\wdb`，数据位于 `C:\ProgramData\wdb`。两个安装器共用一个服务与数据目录，可切换升级。

首次安装默认监听 `127.0.0.1:18766`。本机验证可以直接连接 `localhost`。需要另一台电脑连接时，在**服务器本机的管理员 PowerShell** 中运行以下命令，将示例 IP 换成服务器实际 IPv4：

```powershell
& 'C:\Program Files\wdb\scripts\set-network.ps1' -Mode Lan -LocalAddress 192.168.1.10
```

该操作更新监听与防火墙并重启服务，默认允许本地子网；不要在将被重启的 WDB shell 内执行。桌面 helper 始终只监听本机 loopback。升级、静默安装、诊断、卸载与完整构建步骤见 [Windows 安装器指南](docs/WINDOWS-INSTALLERS.md)，网络配置见 [LAN 指南](docs/LAN.md)。

### 2. 安装 CLI

Windows 与 macOS 共用一个 npm tarball，需要 **Node.js `>=24.15.0 <25`**。当前先安装本地开发包：

```sh
npm install -g ./wdb-cli-local-test-0.1.0.tgz --omit=optional --ignore-scripts
wdb --version
wdb --help
```

Windows PowerShell 如限制 npm 生成的 `.ps1` 启动器，可使用 `wdb.cmd`。安装不包含服务端、不下载 Node、不执行安装 hook；Agent Skill 单独安装。

**npm 地址占位：** `https://www.npmjs.com/package/<待确定的正式包名>`。正式包名确定并发布后再提供 registry 安装命令。当前本地包的生成、隔离安装、配置路径和卸载见 [npm CLI 指南](docs/NPM-CLIENT.md)。历史 portable 包入口见 [Windows 客户端](docs/WINDOWS-CLIENT.md) / [Mac 客户端](docs/MACOS-CLIENT.md)。

### 3. 连接设备

```sh
# 同一台 Windows
wdb connect localhost
# 或从局域网客户端连接；请替换示例 IP
wdb connect 192.168.1.10
wdb devices
wdb info
```

首次连接时，在服务器桌面的“允许此客户端连接？”窗口选择同意或拒绝；可勾选记住。**无需手工提供 fingerprint 或 pairingCode。** `connect` 只返回简要连接结果，重复连接提示已连接；`info` 返回详细信息。

```text
connected to 192.168.1.10:18766
already connected to 192.168.1.10:18766
```

证书指纹在首次连接时保存，后续变化会拒绝连接。可选 `--fingerprint <SHA256>` 预先指定可信证书。未记住的授权在主动断开、服务重启或闲置 30 分钟后需要重新确认；拒绝、关闭和超时均不授权。完整规则见 [连接授权](docs/CONNECTION-APPROVAL.md)。

### 4. 执行与验证

```powershell
wdb shell --script 'whoami; Get-Date' --json
wdb windows list --json
wdb screenshot --json
# 将截图结果中的远端路径替换到下面的命令
wdb pull '<远端截图路径>' './screen.png'

# 需要真实终端；Ctrl+C 发送给远端，Ctrl+] 退出会话
wdb shell

# 将客户端 9223 端口转发到 Windows 服务端本机 9222
wdb forward tcp:9223 tcp:9222
# 将 Windows 服务端本机 9000 转发到客户端本机 3000
wdb reverse tcp:9000 tcp:3000
```

转发命令各自在前台运行，用 Ctrl+C 停止。端口目标需要已有程序监听。交互 shell / 转发断线即结束，**不自动重连或重放**；批处理任务的查询与恢复另按任务 ID 处理。

<a id="commands"></a>

## 核心命令速查

| 命令 | 说明 | 详细文档 |
| --- | --- | --- |
| `connect` / `devices` / `info` / `disconnect` | 连接、实时设备列表、详情、主动断开 | [CLI](docs/CLI.md) |
| `clients list` / `clients revoke <clientId>` | 查询与撤销客户端授权 | [连接授权](docs/CONNECTION-APPROVAL.md) |
| `shell --script '...'` / `shell --script-file ...` | 一次性 PowerShell 任务；默认普通用户 | [CLI](docs/CLI.md) |
| `task list\|get\|wait\|cancel\|output\|delete` | 查询状态、等待输出、取消与清理任务 | [任务与 SSE](docs/TASK-EVENTS.md) |
| `shell` / `shell --program cmd` | 交互终端；显式 `--admin` 使用 SYSTEM | [交互 shell](docs/STREAMING.md) |
| `forward tcp:9223 tcp:9222` | 客户端监听 → 服务端 loopback 目标 | [TCP 转发](docs/STREAMING.md) |
| `reverse tcp:9000 tcp:3000` | 服务端监听 → 客户端 loopback 目标 | [TCP 转发](docs/STREAMING.md) |
| `push <本地> <远端>` / `pull <远端> <本地>` | 文件或目录传输；覆盖需 `--overwrite`，拉目录加 `--recursive` | [文件传输](docs/CLI.md) |
| `desktop status` / `screens` / `windows list` | 桌面会话、显示器与窗口信息 | [桌面操作](docs/CLI.md) |
| `ui tree\|find\|action\|wait` | UIA 查询、操作与等待 | [UIA](docs/CLI.md) |
| `screenshot` / `record start\|stop` | 截图与 MP4 录屏；产物通过 `pull` 取回 | [CLI](docs/CLI.md) |
| `mouse` / `key` / `text` / `touch` | 键鼠、Unicode 文本与触摸轨迹 | [输入](docs/CLI.md) |
| `electron` / `flutter` | 应用专用调试通道 | [Electron](docs/ELECTRON.md) · [Flutter](docs/FLUTTER.md) |
| `app launch\|list\|install\|update\|uninstall` | 启动与部署应用 | [CLI](docs/CLI.md) |
| `logs events\|file` | 事件 / 文件日志，可跟踪输出 | [CLI](docs/CLI.md) |

常规命令使用 `--json` 获取结构化结果，复杂参数使用 `--args-file file.json` 避免终端转义差异。多设备时显式加 `--device <地址或设备ID>`；设备 ID 为无分隔符的 16 字符串。`devices --watch` 持续观察连接状态。交互 shell 要求 TTY，不支持 `--json`；转发的 `--json` 输出生命周期 NDJSON。

完整参数、错误语义、文件路径和操作示例请查 [CLI 手册](docs/CLI.md) 及 [交互与转发手册](docs/STREAMING.md)，也可随时运行 `wdb --help`。

<a id="how-it-works"></a>

## 工作原理

![WDB 从客户端到 Windows 服务、授权窗口及普通用户 helper 的工作原理](docs/assets/wdb-architecture.svg)

CLI 通过 TCP 上的 TLS 加密连接到同一个端口（默认 `18766`）：HTTPS 处理命令、任务和文件，SSE 推送任务状态 / 输出，WSS 承载交互终端与 TCP 双向字节流。无需额外开放交互服务端口。

Windows 后台服务以 SYSTEM 运行；默认 shell 与桌面调试通过普通用户 helper 执行。只有显式 `--admin` 才请求 SYSTEM shell。流通道有窗口、配额、租约和关闭回收；ConPTY 进程树由 Windows Job 管理。协议细节见 [交互与转发设计](docs/INTERACTIVE-SHELL-AND-FORWARDING.md)。

<a id="agent-skill"></a>

## 与 AI Agent 配合

将整个 [`skills/wdb`](skills/wdb) 目录放入所用 Agent 的 Skill 搜索目录，并确保 `wdb` 在该 Agent 的 PATH 中。具体使用规则见 [SKILL.md](skills/wdb/SKILL.md)。

Skill 指导 Agent 先查询窗口和控件，再执行操作，最后重新观察确认结果；UIA 不可用时按应用选择 CDP、Flutter Inspector 或视觉坐标。自动化脚本使用 `shell --script`，需要人类终端的交互 shell 单独使用。请求超时先查任务状态，避免重复点击、安装或输入。

## 权限与使用边界

- 首次连接必须由目标设备上的用户同意；后续校验证书及客户端凭据。首次信任的局限与可选预置指纹见 [连接授权](docs/CONNECTION-APPROVAL.md)。
- WDB 提供执行脚本、文件和桌面操作能力；只授权可信客户端。记住的客户端可用 `clients revoke` 撤销；`disconnect` 仅断开，不撤销持久授权。
- 默认仅 localhost；LAN 模式显式启用并限制防火墙来源。helper、CDP 和 VM Service 调试端点保持本机访问，不直接暴露公网。
- UIA 和应用调试接口取决于应用自身实现。Electron 的 CDP 与可访问性是两条通路；Flutter 的具体构建要求见对应指南。
- 错误或超时不保证操作尚未发生。任务重连查询与交互流终止的区别见 [重连规则](docs/RECONNECTION.md)。安全问题报告方式见 [SECURITY.md](SECURITY.md)。

<a id="documentation"></a>

## 文档导航

| 主题 | 文档 |
| --- | --- |
| 安装与分发 | [Windows 服务端](docs/WINDOWS-INSTALLERS.md) · [npm CLI](docs/NPM-CLIENT.md) · [打包设计](docs/DISTRIBUTION-AND-PACKAGING.md) |
| 使用与网络 | [完整 CLI](docs/CLI.md) · [Windows 验证步骤](docs/WINDOWS-CLI-VALIDATION.md) · [Mac 客户端](docs/MACOS-CLIENT.md) · [LAN](docs/LAN.md) |
| 授权与任务 | [首次连接](docs/CONNECTION-APPROVAL.md) · [自动重连](docs/RECONNECTION.md) · [SSE](docs/TASK-EVENTS.md) |
| 双向流 | [用法](docs/STREAMING.md) · [协议](docs/INTERACTIVE-SHELL-AND-FORWARDING.md) · [Windows 实测](docs/STREAMING-WINDOWS-VERIFICATION.md) · [Mac 待验收交接](docs/STREAMING-MACOS-HANDOFF.md) |
| 应用调试 | [Electron 配置与操作](docs/ELECTRON.md) · [Flutter 配置与操作](docs/FLUTTER.md) · [验收记录](docs/ACCEPTANCE.md) |
| 项目开发 | [AGENTS.md](AGENTS.md) · [贡献指南](CONTRIBUTING.md) · [一期需求](wdb-phase1-requirements.md) · [实施记录](docs/IMPLEMENTATION.md) |

<a id="development"></a>

## 本地开发与构建

开发前阅读 [AGENTS.md](AGENTS.md)。Windows 开发环境需要 Node.js `>=24.15.0 <25`；原生与安装器构建另需 .NET Framework 编译器、Windows PowerShell 和 Inno Setup 6.7.1。

```powershell
git clone https://github.com/guoxiucai/wdb.git
cd wdb
npm ci --omit=optional --ignore-scripts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/init-data.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-pty.ps1
npm test
# 共享客户端测试
npm run test:client
```

测试使用独立数据目录；流协议测试还需要 OpenSSL。桌面实机、安装和故障注入有额外环境要求，不能用默认单元测试通过代替。初始化脚本默认写入忽略于 Git 的 `.runtime/server`。

仅构建 CLI 开发包：

```sh
node scripts/build-cli-npm.js --development true --output dist/npm/local-dev-01
```

构建包含 CLI 与两个 Windows EXE 的开发分发：

```powershell
.\scripts\build-release.ps1 -Phase Prepare -SigningMode Development -BuildId local-dev-01
.\scripts\build-release.ps1 -Phase Package -BuildId local-dev-01
.\scripts\build-release.ps1 -Phase Finalize -BuildId local-dev-01
.\scripts\verify-release.ps1 -ReleaseDirectory dist/release-builds/local-dev-01/release/Development
```

每次修改源码后使用新的 BuildId。三阶段冻结公共 payload 并验证完整性，输出安装器、npm tarball、SHA-256 和构建报告；正式签名流程见 [安装器指南](docs/WINDOWS-INSTALLERS.md)。生成的 `dist/`、`artifacts/` 和本机凭据不提交 Git。

### 目录结构

```text
bin/           CLI 启动器
src/           CLI、服务、任务、传输协议与平台适配
native/        Windows 服务宿主、桌面桥、ConPTY C# 源码
scripts/       构建、安装、校验与实机验证工具
packaging/     npm 白名单、安装器模板、依赖锁定清单
tests/         自动化回归与测试夹具
skills/wdb/    AI Agent Skill
docs/          用户指南、协议、验证报告与图形资产
AGENTS.md      项目开发、验证、提交与交付规范
```

## 后续计划

- [x] Windows 后台服务、首次连接弹窗与 CLI 基础调试。
- [x] Electron / Flutter 调试通路与真实应用验证记录。
- [x] SSE、Windows 交互 shell / TCP 转发、安装矩阵与 30 分钟持续会话验证。
- [ ] Mac npm 客户端及新增交互 / 转发的真实终端验证。
- [ ] 扩展干净 Windows 环境、跨主机网络与更长时间稳定性验证。
- [ ] 确定开源许可证、正式 npm 名称与发布者，完成签名和公开分发。

## 贡献与反馈

欢迎通过 [Issues](https://github.com/guoxiucai/wdb/issues) 报告可复现问题或讨论功能，通过 [Pull Requests](https://github.com/guoxiucai/wdb/pulls) 提交改进。请提供版本、平台、最小复现步骤和脱敏日志；开发规范、测试选择与提交要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。漏洞和凭据不要放入公开 Issue。

## 许可与致谢

**项目当前使用 `UNLICENSED` 开发配置，尚未选择正式开源许可证。** 仓库可见性不代替使用、修改和再分发的许可；正式发布前会补充许可证与发行信息。

感谢 Node.js、ws、FFmpeg、Inno Setup 及 Windows ConPTY / UI Automation 生态提供基础能力。第三方依赖遵循各自许可，发行包保留相应声明。README 的页面组织参考 [ohos-scrcpy-app](https://github.com/guoxiucai/ohos-scrcpy-app/blob/main/README.md)；WDB 图标为新生成的原创图形，原理图为可编辑 SVG，来源与提示词见 [图形资产说明](docs/assets/README.md)。
