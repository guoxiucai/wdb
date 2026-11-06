# wdb — Windows Debug Bridge

Windows 服务端 + Windows CLI + Agent Skill。本次范围是本机 localhost；macOS 客户端和局域网实机验收后续开展。原始基线保留在 [wdb-phase1-requirements.md](wdb-phase1-requirements.md)，本次用户授权优先于其中早期“只编写需求”的记录。

## 当前状态

已实现并验证 TLS 指纹配对、客户端授权撤销、异步任务、用户 PowerShell、目录/大文件校验传输、UI Automation、窗口管理、截图、键鼠/Unicode 输入、真实触摸注入、日志查询/跟踪及 MP4 录屏。具体通过项与限制见 [验收记录](docs/ACCEPTANCE.md)，不把接口成功等同于实际应用验收。

**2026-11-06 已完成后台服务修复和实机验证。** 服务安装在 `C:\Program Files\wdb`，开机自动启动，HTTPS 服务实际以 SYSTEM 身份运行；默认 shell 和桌面助手仍以登录用户身份运行，只有显式 `--admin` 使用管理员能力。已验证服务重启、配对保留、任务记录保留及真实 CLI 集成。首次安装的 Node 代理和 PowerShell 5.1 服务路径引号问题已修复。

## 直接使用

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

## 构建和离线交付

```powershell
.\scripts\build.ps1
```

输出 `dist\wdb-windows-x64`，包含 Node、FFmpeg/ffprobe、预编译服务宿主/桌面桥、CLI、Skill、源码、许可、安装脚本和 SHA-256 清单。把整个目录复制到目标机，以管理员运行其中 `scripts\install-service.ps1`；安装过程不联网。开发机器首次准备录屏依赖才需 `scripts\fetch-ffmpeg.ps1`。安装、升级、诊断和卸载见 [Windows 服务文档](docs/windows-service.md)。

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
