# wdb — Windows Debug Bridge

Windows 服务端 + Windows CLI + Agent Skill。localhost 功能已验证，Windows LAN 交付包已准备并在本机 LAN IP 完成自检；另一台电脑的局域网验收接下来开展。macOS CLI 可按 [开发交接文档](docs/MACOS-CLI-DEVELOPMENT.md) 同步开发。原始基线保留在 [wdb-phase1-requirements.md](wdb-phase1-requirements.md)，本次用户授权优先于其中早期“只编写需求”的记录。

## 当前状态

已实现并验证 TLS 指纹配对、客户端授权撤销、异步任务、用户 PowerShell、目录/大文件校验传输、UI Automation、窗口管理、截图、键鼠/Unicode 输入、真实触摸注入、日志查询/跟踪及 MP4 录屏。具体通过项与限制见 [验收记录](docs/ACCEPTANCE.md)，不把接口成功等同于实际应用验收。

已内置 Electron 的 CDP + UIA + 视觉调试：目标发现、控件查询、点击/输入、等待、脚本、截图和console采集，继续走现有认证服务与CLI。EasiClass三通道实测及自研应用配置见 [Electron指南](docs/ELECTRON.md) 和 [验证报告](docs/ELECTRON-VERIFICATION.md)。

已内置 Flutter VM Service/Inspector + UIA + 视觉调试，可查询Widget与属性、等待状态、采集事件及内存。鸿镜Debug已完成UIA最大化/还原，以及UIA模式不支持→视觉折叠→Inspector确认→恢复的闭环，见 [Flutter指南](docs/FLUTTER.md) 和 [验证报告](docs/FLUTTER-VERIFICATION.md)。

**2026-11-06 已完成后台服务修复和实机验证。** 服务安装在 `C:\Program Files\wdb`，开机自动启动，HTTPS 服务实际以 SYSTEM 身份运行；默认 shell 和桌面助手仍以登录用户身份运行，只有显式 `--admin` 使用管理员能力。已验证服务重启、配对保留、任务记录保留及真实 CLI 集成。首次安装的 Node 代理和 PowerShell 5.1 服务路径引号问题已修复。

用户指定的 EasiClass 安装包已完成强制覆盖、启动观察及卸载，见[部署记录](docs/app-deployment-verification.md)。无触摸屏设备上已通过 10 指 30 秒 / 60 Hz 与录屏并行验证；需要关闭 Windows 系统多指手势以让应用接收输入，本次测试后已恢复原开关。详见[触摸复验](docs/touch-verification-20261106.md)，真实业务画布和 LAN / macOS 仍分别验收。

## 直接使用

**局域网测试入口：** [Windows 客户端使用](docs/WINDOWS-CLIENT.md)、[服务端网络配置与验收](docs/LAN.md)、[本次交付记录](docs/LAN-DELIVERY-VERIFICATION.md)。本机已安装服务地址为 `https://172.20.115.75:18766`，设备 `qingwei / 2f493aacf427f3e9`；IP 变化后按网络文档更新规则。

在本目录 PowerShell 中：

```powershell
# 从本机受保护数据目录读取证书指纹与配对码，不显示秘密
.\scripts\connect-local.ps1
.\bin\wdb.cmd info --json
.\bin\wdb.cmd shell --script 'whoami; Get-Date' --json
.\bin\wdb.cmd screens --json
.\bin\wdb.cmd windows list --json
.\bin\wdb.cmd screenshot --json
```

服务默认只监听 `127.0.0.1:18766`，桌面助手在 `127.0.0.1:18767`。数据在 `C:\ProgramData\wdb`；默认 CLI 配置在 `%LOCALAPPDATA%\wdb\client`。截图/录像返回远端产物路径，用 `wdb pull <路径> <本地路径>` 取回。需要修复旧安装时才运行 `scripts\repair-service.ps1`，通过正常 UAC 保留配置重新安装；失败会尝试恢复先前的普通用户调试进程。`scripts\start-local.ps1` 和 `stop-local.ps1` 仅用于无系统服务时的开发调试。

桌面操作要求登录且解锁。窗口/控件引用来自最新查询；多设备连接必须明确 `--device`。默认不会覆盖文件，不会重试点击、书写或安装。具体命令和 JSON 契约见 [CLI 文档](docs/CLI.md)。

连接中断时，CLI 默认自动恢复最多 60 秒，已接受的任务按 ID 去重恢复，不重复执行。`wdb devices --watch` 同时显示设备名、地址、唯一 ID 和实时在线状态，服务自动重启后自动恢复观察。边界与故障注入方法见[重连文档](docs/RECONNECTION.md)。

## 构建和离线交付

```powershell
.\scripts\build.ps1
# 独立客户端（不含 Windows 服务、FFmpeg 和桌面桥）
.\scripts\build-client.ps1
```

输出 `dist\wdb-windows-x64`，包含 Node、FFmpeg/ffprobe、预编译服务宿主/桌面桥、CLI、Skill、源码、许可、安装脚本和 SHA-256 清单。把整个目录复制到目标机，以管理员运行其中 `scripts\install-service.ps1`；安装过程不联网。开发机器首次准备录屏依赖才需 `scripts\fetch-ffmpeg.ps1`。安装、升级、诊断和卸载见 [Windows 服务文档](docs/windows-service.md)。

独立客户端输出 `dist\wdb-client-windows-x64`，解压即可使用；服务端与客户端包均带 `BUILD-INFO.json` 记录源码提交和运行时。`dist` 不提交 Git，交付时压缩整个目录并保留校验清单。

Agent Skill 在 `skills/wdb/SKILL.md`。将整个 `skills/wdb` 目录复制到 Codex/Claude Code 的 skills 目录，并确保 `bin\wdb.cmd` 在 PATH 中，或在调用时使用完整路径。Skill 指导先控件、必要时截图、操作后验证、超时先查询，服务端不配置模型密钥。

## 验证和提交

```powershell
# 标准测试：证书、认证、CLI、文件、任务、恢复、取消、权限、日志编码
npm test
# 真实桌面测试：会打开自己的测试窗口并操作它，勿同时人工操作桌面
node --test tests/desktop.test.mjs
# 已运行服务的集成测试
$env:WDB_TEST_DATA_DIR = 'C:\ProgramData\wdb'
$env:WDB_TEST_URL = 'https://127.0.0.1:18766'
node --test tests/cli-live.test.js
# 大文件压力测试，会生成并清理专用目录内的测试文件
node scripts/validate-transfer.js
```

标准测试需要测试证书：首次在开发机执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/init-data.ps1`。测试数据、凭据、生成文件和本机应用截图均忽略于 Git。分步方案见 [实施计划](docs/IMPLEMENTATION.md)，每个验证完成的阶段独立提交，后续问题用修复提交。

离线包携带 Node 而不携带 npm；在解压目录可用 `runtime\node.exe --test tests/*.test.js` 运行同一套标准测试，先执行 `scripts/init-data.ps1` 初始化独立测试证书。
