# WDB 项目开发指南

本文件适用于整个仓库，面向在此项目中修改代码、测试和文档的开发者与 AI Agent。优先完成当前用户明确授权的目标；历史需求中的阶段限制以最新明确决定为准。WDB 是 **Windows Debug Bridge**，不是 Android adb，也不是远程桌面视频串流产品。

## 技术栈与运行边界

- Node.js `>=18.17.0`，JavaScript CommonJS；使用 Node 内置 HTTP(S)、TLS、文件、进程和 `node:test` API。
- WebSocket 使用纯 JavaScript `ws`，版本由 `package.json` 和 `package-lock.json` 精确锁定；发行构建的依赖清单另在 `packaging/windows/dependencies.json`。
- Windows 原生适配使用 C# / .NET Framework 4.8：服务宿主、UI Automation / 输入 / 截图和 ConPTY / Job。在构建机编译，安装后的服务不能现场编译程序。
- 安装、生命周期及构建脚本使用 PowerShell；安装器涉及的脚本必须兼容 Windows PowerShell 5.1。EXE 分发使用固定版本 Inno Setup。
- 服务与平台适配在 Windows 运行；CLI 的共享 JS 模块供 Windows/macOS 使用。Windows 通过不代表 Mac 真实终端通过。
- 服务为 SYSTEM；桌面 helper 为已登录普通用户。默认 shell 走 helper，只有显式 `--admin` 才走 SYSTEM，不能静默回退或提升权限。

## 目录与职责

后续开发分析、实施计划和本机验证记录优先放在本地 `dev_doc/`（Git 忽略）。`docs/` 用于需要 Git 跟踪共享的用户指南、协议和交接文档。

| 位置 | 职责 |
| --- | --- |
| `src/cli.js`、`bin/` | CLI 参数、命令路由、输出和启动器 |
| `src/client-transport.js`、`src/client-stream.js` | HTTPS/SSE 与 WSS 客户端；证书固定、授权和连接生命周期 |
| `src/server.js`、`src/operations.js` | HTTPS API、持久任务及操作分派 |
| `src/helper.js` | 本机 loopback 桌面会话桥；不开放到 LAN |
| `src/stream-*.js` | 共享协议、流量控制、通道与 TCP 适配 |
| `src/server-streams.js`、`src/shell-sessions.js`、`src/forward-*.js` | 流资源登记、shell 和转发规则生命周期 |
| `src/terminal-client.js`、`src/pty-host.js` | 本地终端适配、Windows 原生 PTY IPC |
| `src/electron*.js`、`src/cdp.js`、`src/flutter*.js` | Electron CDP、Flutter VM Service/Inspector 及 UIA/视觉路径 |
| `native/` | C# 源码、Windows API 与 PowerShell 原生桥 |
| `scripts/` | 构建、安装、校验和可复现的实机验证工具 |
| `packaging/` | npm 白名单模板、Windows 安装器和依赖锁定清单 |
| `tests/` | 自动化回归、协议夹具与独立测试窗口 |
| `skills/wdb/` | Agent 使用 CLI 的 Skill；新增命令需要同步使用边界 |
| `docs/` | 用户指南、协议、交接和有证据的验收报告 |
| `.runtime/`、`artifacts/`、`dist/` | 本机依赖/私有配置、测试证据、产物；均不提交 Git |

不要把新的业务状态机全部加入 `cli.js` 或 `server.js`。共享协议/客户端模块不得依赖 Windows 原生代码；npm CLI 不打包服务端、Node、PtyHost 或原生扩展。

## 开发准备与验证

在 Windows 开发机安装匹配的 Node/npm，按变更范围准备依赖：

```powershell
npm ci --omit=optional --ignore-scripts
# 初始化独立开发证书；不要指向正式服务数据目录。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/init-data.ps1
# 开发 ConPTY 时预编译原生 host。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-pty.ps1
npm test
```

跨平台客户端回归使用 `npm run test:client`。流协议回归可运行：

```sh
node --test tests/stream-protocol.test.js tests/stream-transport.test.js tests/stream-forward.test.js tests/stream-faults.test.js
```

流测试夹具依赖 OpenSSL；完整 Windows 测试及原生/桌面验证另有环境要求。桌面 `.mjs` 测试不在默认 `npm test` 的 `.test.js` 通配中，需按实际变更运行 `node --test tests/desktop.test.mjs`。不要把 skip 计为通过。

先运行与变更相关的检查；协议、共享传输、权限、安装或任务生命周期变更还需相关回归。发现失败后修复并验证，不能用重复运行掩盖竞态。轻微文档/样式修改无需增加只匹配文案的测试。对实机行为，核对真实状态、产物和进程回收，不只看 CLI 退出码。

当前协议见 [交互与转发设计](docs/INTERACTIVE-SHELL-AND-FORWARDING.md)，实机方法见 [Windows 流验证](docs/STREAMING-WINDOWS-VERIFICATION.md)。跨主机 LAN、Mac、物理触摸、真实业务应用和不同 Windows 版本分别记录，不能互相替代。

## 实现规范

- 遵循相邻模块的 CommonJS、命名和错误处理方式；优先清晰的小函数。避免顺手重排无关文件、引入新的格式化工具或改变全部换行。
- 新增依赖须说明用途，更新锁文件、许可、包白名单和体积报告。使用既有 Node 内置能力能完成时，不额外增加依赖。
- 所有网络、进程、监听、计时器、流和事件订阅都有明确所有者与关闭路径；关闭可重复调用并等待清理。异步取消同样回收正在创建的资源。
- 任务使用稳定 ID 和已定义的 unknown/interrupted 语义；结果不确定时查询状态，不能盲目重新提交有副作用的操作。
- 交互 shell / forward / reverse 断线即结束，不自动恢复或重放输入。保留 TLS pin-before-request、身份归属、消息上限、窗口、配额、半关闭和独立 lease。
- TTY 数据使用字节流；恢复 raw mode、监听器及显示状态。不要把 stdout 日志混入终端或转发数据。机器输出遵循现有 JSON / NDJSON 契约。
- C# 原生资源使用受控句柄和 `finally`；shell 在挂起状态加入会话 Job 后再运行。禁止放宽任意程序启动、helper 认证或普通用户/SYSTEM 边界来规避失败。
- PowerShell 文件操作使用明确绝对路径与 `-LiteralPath`；递归移动/删除前核对目标范围。安装脚本在签名与 hash 冻结前完成编码处理。
- 不提交/打印 token、helper-secret、配对材料、设备私钥、用户密码、真实终端业务输出或本机应用隐私截图。示例用清楚标注的虚构地址与标识。

## 安装、打包与实机操作

生产安装使用双 EXE：with-node 和 external-node，共用一个服务身份及数据目录。三阶段构建 `Prepare → Package → Finalize` 的 BuildId 和冻结内容不可复写；修改源码后使用新 BuildId。详见 [安装器指南](docs/WINDOWS-INSTALLERS.md)。

安装、重启、真实桌面操作和故障注入在本次授权范围内执行；需要用户本人操作的系统授权及时说明，不能绕过 UAC 或首次连接同意窗口。先用临时目录、测试窗口和 loopback 验证；不要干扰无关进程或真实网卡。

会重启或卸载 WDB 的验证必须从独立进程/任务计划启动，不能让它成为将被终止的 WDB shell 的子进程。结束后检查安装状态、数据保留和服务健康，不能只根据 SCM `Running` 判断成功。

默认沿用 Development 测试包，不自动执行 `npm publish`、创建公开 Release、改变仓库可见性或替维护者选择项目许可证。正式发布需要明确的包名、许可、发布者、签名和发布范围；已经给定的授权不重复请求。

## 提交与交付

1. 开始前检查 `git status`、当前分支和相关文档，保留他人的修改。不要为了得到干净工作区丢弃用户内容。
2. 将工作拆为可独立验证的步骤，每个通过的步骤单独提交。后续发现问题用修复提交，不把大量无关变更堆在一起。
3. 提交标题沿用 `feat(scope): ...`、`fix(scope): ...`、`test(scope): ...`、`docs: ...` 等形式，说明具体行为。提交前检查 diff、意外文件、凭据和换行问题。
4. 新命令/行为同步 CLI 帮助、用户文档、Skill、协议与打包清单中受影响的部分。协议变化更新两端共享夹具和 Mac 交接说明。
5. 报告实际运行的检查、源码 SHA、安装包 hash、平台/版本和 pass/fail/not-run 边界。产物源码 SHA 与后续文档提交不同应明确说明。
6. 推送或发布遵循用户已给定的范围；不 force-push 共享分支。交付时说明结果、使用入口及尚未验证的实质范围。
