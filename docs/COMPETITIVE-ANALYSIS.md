# WDB 与 Windows 控制、调试工具对比

> 调研日期：2026-11-07。面向开发者与 AI Agent 选择 Windows 调试通路，重点比较能力边界、架构与接入成本。本分析基于官方文档和公开源码阅读，**不是所有产品同环境实测或性能排行榜**。

## 结论与定位

WDB 的主要优势是：**从 Windows/macOS 用同一套 CLI，连接一台已部署服务的 Windows 设备，完成脚本、文件部署、桌面观察、框架调试、终端和 TCP 转发，并统一处理授权、任务与产物。** 它更接近面向 Windows 应用调试的设备桥。

四种方案解决的问题有交集，但不能用单一“功能数量”判胜负：

- **CursorTouch Windows-MCP**：以 MCP 工具直接赋予 Agent Windows 桌面操作能力，适合已有 MCP 客户端的 Computer Use 工作流。
- **winremote-mcp**：以远程 MCP 暴露桌面和系统管理工具，是与 WDB 远端控制定位最接近的方案之一。
- **微软 WinApp CLI**：覆盖 Windows 应用开发、身份、SDK、打包和调试；当前版本还提供 UI 自动化和 Sandbox，既有竞争交集，也可与 WDB 组合。
- **UltraVNC + vncdotool + SSH**：由实时桌面、像素输入自动化和远程命令/文件通路组成，适合已有远程运维基础设施或需要人类持续观看桌面的场景。

因此，WDB 应突出“跨主机应用调试闭环”和统一设备通路，而不宜声称“只有 WDB 能远控 Windows”“竞品都只能点击截图”或“WinApp CLI 只会打包”。各产品定位依据见 [Windows-MCP](https://github.com/CursorTouch/Windows-MCP)、[winremote-mcp](https://github.com/dddabtc/winremote-mcp)、[WinApp CLI](https://github.com/microsoft/winappCli)、[vncdotool 使用指南](https://github.com/sibson/vncdotool/blob/main/docs/usage.md)。

## 比较口径与版本快照

| 项目 | 本次观察范围 | 发布与主线的区别 |
| --- | --- | --- |
| WDB | 0.1.0；发布标签 `v0.1.0`，补充参考本仓库当前 Skill | 已发布功能以 [CLI 手册](CLI.md) 及对应标签源码为准；Skill 更新不等于 npm 包已重新发布 |
| CursorTouch Windows-MCP | 最新 Release `v0.8.8`；主线 `b69ec872623b` | Release README 标注 Python 3.13+；主线 `pyproject.toml` 已要求 3.14+，不能混为同一安装要求 |
| winremote-mcp | 最新 Release `v0.4.24`；默认分支 `master`，快照 `a3a18df435f6` | 清单要求 Python 3.10+；README 与实现同时参考 |
| WinApp CLI | 最新 Release `v0.8.0`；主线 `5f379fb55517` | 本次也检查了 v0.8.0 标签中的 UI 自动化和 Sandbox 文档，不只根据 main 推断已发布功能 |
| vncdotool / UltraVNC / OpenSSH | vncdotool 主线 `b091a9d38c64`；UltraVNC 官方文档；微软/OpenSSH 官方说明 | 这是可替换组件的组合，不存在一个统一版本、授权模型或安装包 |

2026-11-07 的 GitHub API 快照中，Windows-MCP 约 **11,210 stars**，winremote-mcp **219**，WinApp CLI **1,368**，vncdotool **539**。关注度能帮助判断资料和社区规模，不能证明安全性、稳定性、性能或某项任务成功率。数据入口：[Windows-MCP 元数据](https://api.github.com/repos/CursorTouch/Windows-MCP)、[winremote-mcp 元数据](https://api.github.com/repos/dddabtc/winremote-mcp)、[WinApp 元数据](https://api.github.com/repos/microsoft/winappCli)、[vncdotool 元数据](https://api.github.com/repos/sibson/vncdotool)。这些数字随时间变化。

版本证据：[Windows-MCP v0.8.8](https://github.com/CursorTouch/Windows-MCP/releases/tag/v0.8.8)、[Release README](https://github.com/CursorTouch/Windows-MCP/blob/v0.8.8/README.md)、[主线依赖清单](https://github.com/CursorTouch/Windows-MCP/blob/b69ec872623b403f647fb3777685d4cf2678d3a2/pyproject.toml)、[winremote v0.4.24](https://github.com/dddabtc/winremote-mcp/releases/tag/v0.4.24)、[WinApp v0.8.0](https://github.com/microsoft/winappCli/releases/tag/v0.8.0)。

下文“未见专用能力”表示在本次查阅的命令、工具注册和文档中未找到对应产品化接口，**不表示无法通过 PowerShell、插件或外部工具实现**。“有 Shell”也不自动等于有交互 PTY、框架调试协议或统一的持久任务契约。

## 能力矩阵

| 维度 | WDB | Windows-MCP | winremote-mcp | WinApp CLI | UltraVNC + vncdotool + SSH |
| --- | --- | --- | --- | --- | --- |
| 主要入口 | 跨平台 CLI、JSON、独立 Skill | MCP tools，适配 MCP 客户端 | 远程 MCP tools | Windows 开发 CLI、Agent plugins/skills | VNC viewer、`vncdo`、`ssh/scp/sftp` |
| 跨主机连接 | 服务端 HTTPS/SSE/WSS，同一控制端口 | stdio，也支持 SSE / Streamable HTTP | stdio / HTTP，支持远程配置 | 本机开发与 Windows Sandbox 目标；未见任意 LAN Windows 的配对设备桥 | RFB 连接桌面，SSH 提供命令/传输/隧道 |
| Mac 控制 Windows | npm CLI 直接连接 Windows 服务 | Mac 上的 MCP 客户端可经网络连接 Windows 上的服务 | 同左，需客户端支持对应 MCP transport | 未见原生 Mac→任意 Windows 的同类设备桥；可另外用 SSH 在 Windows 执行 | Mac 使用 VNC 客户端/vncdotool 和 SSH |
| UI 观察与操作 | UIA、窗口、坐标输入、截图 | UIA/桌面快照、输入和窗口工具 | 桌面/Win32 元素标注、截图、鼠标键盘、可选 OCR | UIA 检查、查询、状态、模式操作、真实输入 | 像素画面、坐标鼠标键盘；语义树需另加工具 |
| Electron 专用路径 | CDP + UIA + 截图，页面发现、DOM、eval、console | 已查工具以通用桌面/UIA 为主，未见同类独立 CDP 命令组 | 主要依赖通用桌面、视觉/OCR；未见独立 CDP 命令组 | Electron 身份与绑定工具；通用 UIA 不等同于 CDP DOM 调试 | 可通过 SSH/隧道另接 CDP，需自行编排 |
| Flutter 专用路径 | VM Service / Inspector + UIA + 截图 | 未见独立 Inspector 命令组 | 非标准 UI 推荐视觉路径；未见独立 Inspector 命令组 | Flutter 的 Windows 身份/开发场景与通用 UIA；未见同类 Inspector 命令组 | 可另外连接 VM Service，组合自身不提供 Widget 语义 |
| Shell | 普通用户批处理；显式 SYSTEM；ConPTY 交互 shell | PowerShell 工具 | Shell 工具与任务管理 | 运行应用、SDK 工具、Sandbox 执行等开发命令 | SSH 是成熟的命令与交互会话通路 |
| TCP 转发 | 前台 `forward/reverse`，loopback 端点，半关闭 | 未见专用同类规则命令 | 未见专用同类规则命令 | 未见通用设备桥式转发命令 | SSH 有本地/远程转发，能力范围通常更广 |
| 文件与部署 | 文件/目录 push/pull、SHA-256、应用生命周期 | 文件系统和 PowerShell 工具 | 文件读写、上传下载、系统工具 | MSIX、身份、签名与构建工具链更完整 | SCP/SFTP；UltraVNC 原生 viewer 另有文件传输扩展 |
| 异步任务与输出 | 稳定任务 ID、查询/取消、SSE、未知结果处理 | MCP 请求/工具执行；不能据此推定有 WDB 同等持久任务语义 | 已有任务状态、取消和分类并发控制 | JSON、开发命令及 UI 协调；非通用远端任务服务 | SSH 进程及外部任务系统；需要自行约定结果与恢复 |
| 触摸与笔 | Windows 多点触摸注入；未提供独立笔压/倾角调试命令 | 已查工具集中于鼠标/键盘，未见独立同类触摸/笔接口 | 同类专用接口未见 | 明确有 `ui touch` 与 `ui pen`，含笔/手写场景 | 标准 VNC 鼠标事件不等同于多点触摸或笔注入 |
| 画面与记录 | 截图、MP4 录屏；无实时远程桌面播放器 | 截图/快照；不据此推定有持续视频或录屏功能 | 截图、GIF 录屏、OCR | 截图及 `ui record` | VNC 擅长连续画面；录制/回放取决于所选工具 |
| 开发平台能力 | 调试已运行/部署的应用；不提供 SDK/MSIX 工具链 | 桌面 Agent 控制为主 | 桌面与系统管理为主 | SDK、身份、MSIX、签名、WinUI/WinRT、Sandbox 是核心优势 | 依靠另装的开发工具 |

矩阵依据并非工具名称推测：Windows-MCP 查阅了 [工具注册目录](https://github.com/CursorTouch/Windows-MCP/tree/b69ec872623b403f647fb3777685d4cf2678d3a2/src/windows_mcp/tools) 与 [PowerShell 定义](https://github.com/CursorTouch/Windows-MCP/blob/b69ec872623b403f647fb3777685d4cf2678d3a2/src/windows_mcp/tools/shell.py)；winremote 查阅了 [工具入口](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/src/winremote/__main__.py)、[桌面实现](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/src/winremote/desktop.py) 和 [任务管理](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/src/winremote/taskmanager.py)。WinApp 依据 [v0.8.0 UI 自动化](https://github.com/microsoft/winappCli/blob/v0.8.0/docs/ui-automation.md) 与 [Sandbox](https://github.com/microsoft/winappCli/blob/v0.8.0/docs/sandbox-execution.md)。组合方案依据 [vncdotool 命令](https://github.com/sibson/vncdotool/blob/b091a9d38c6493aa0272d172f5f93c0b0f199c54/docs/commands.md)、[UltraVNC 功能](https://uvnc.com/products/ultravnc/18-ultravnc-features.html)、[Windows OpenSSH](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview)。

## 逐项分析

### 1. CursorTouch Windows-MCP：Agent 桌面控制与生态接入更直接

它的强项是将桌面状态和操作直接暴露为 MCP tools，适合 Claude、Cursor 等 MCP 工作流。与 WDB CLI+Skill 相比，接入方可以通过 MCP 发现工具及参数，减少自行解释命令行输出的工作；代价是客户端需要具备相应 MCP transport 与配置能力。WDB 的收益则在于同一入口也能用于人类终端、脚本和没有 MCP 接口但能执行命令的 Agent。这是接口取舍，不是 MCP 或 CLI 天然更先进。[接入说明](https://github.com/CursorTouch/Windows-MCP/blob/v0.8.8/README.md)

不能把它描述为“只支持本机”或“没有安全机制”：当前项目支持网络 transport、认证、TLS，以及桌面所有权和用户接管。在主线策略中，桌面控制的 relaxed/balanced/strict 分级决定哪些工具受桌面 gate 限制；默认 relaxed 下 PowerShell 可绕过桌面 gate。其倒计时无人回应可以开始控制，与 WDB 的首次连接明确同意是不同语义。**连接授权、桌面所有权与进程权限是三件事**，不能把 gate 当成操作系统沙箱，也不宜把 WDB 的配对弹窗概括为全面更安全。[控制策略实现](https://github.com/CursorTouch/Windows-MCP/blob/b69ec872623b403f647fb3777685d4cf2678d3a2/src/windows_mcp/tools/control_policy.py)、[同意窗口实现](https://github.com/CursorTouch/Windows-MCP/blob/b69ec872623b403f647fb3777685d4cf2678d3a2/src/windows_mcp/desktop/control_consent.py)

**WDB 的差异化机会**：对已经交付的 Windows 应用，统一提供远端部署、持久任务、PTY、TCP 转发以及 CDP/Inspector 路径，减少 Agent 在桌面工具、SSH 和框架调试器之间拼装。Windows-MCP 的成熟桌面交互和用户接管体验仍值得借鉴；用户仅需要 MCP 桌面操作时，它可能更直接。

### 2. winremote-mcp：远程系统管理能力广，不能当成“截图点击脚本”

项目除桌面工具外，还覆盖文件、进程、服务、注册表、网络、事件日志和录屏等系统管理入口；其显式工具更容易被 MCP Agent 发现。WDB 也能通过 shell 调用 Windows 命令实现许多系统操作，但“可以写脚本”不等于“已有类型明确的专用命令”。这部分 winremote 的广度是实际优势。[使用指南](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/docs/usage.md)、[工具入口](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/src/winremote/__main__.py)

它已具备 `CancelTask/GetTaskStatus/GetRunningTasks` 和按桌面、文件、查询、Shell 等类别的并发管理。因此不应声称“没有异步任务/取消”。WDB 更明确强调跨请求稳定 ID、提交结果不确定时的查询与去重，以及服务重启后的 interrupted/unknown。winremote 本次查阅的任务实现主要管理进程内任务；未发现与 WDB 相同的落盘恢复和提交去重契约，仍应单独验证其重启、断线和取消行为。[任务管理源码](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/src/winremote/taskmanager.py)、[WDB 任务与结果](CLI.md#结果和任务)

框架方面，winremote 的 AnnotatedSnapshot 主要依靠 Win32 窗口/子窗口信息，并建议对非标准 UI 使用视觉或其他识别方案；这不等于无法操作 Electron/Flutter，而是缺少 WDB 当前独立提供的 CDP DOM、console 与 Flutter Widget/Inspector 观察通路。WDB 在这些应用的深度定位更有优势，但在 Canvas、自绘控件或未开启调试服务时，同样可能退回视觉。[桌面枚举源码](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/src/winremote/desktop.py)、[WDB Electron](ELECTRON.md)、[WDB Flutter](FLUTTER.md)

### 3. 微软 WinApp CLI：开发工具链强，而且已进入运行时 UI 调试

WinApp 的竞争范围已超出 SDK 和 MSIX。v0.8.0 文档明确包含 UIA、真实输入、截图、录屏、触摸/笔和 Windows Sandbox 执行；UI 操作有并发仲裁机制。不能把 WDB 的 UIA、JSON、Skill 或触摸能力描述为相对 WinApp 的独有优势。它还提供 WDB 没有的开发身份、打包签名和 WinUI 专用开发诊断；这更适合应用源码开发和微软技术栈工作流。[v0.8.0 UI 指南](https://github.com/microsoft/winappCli/blob/v0.8.0/docs/ui-automation.md)、[开发工具说明](https://github.com/microsoft/winappCli/blob/5f379fb55517b7a47f9aad11885a7c1676dcca2e/docs/guides/devtools.md)

WDB 的优势应准确落在 **Mac/Windows 客户端连接另一台 Windows 真机的设备桥**。WinApp 的 Sandbox 是同一 Windows 主机上的受控目标，不等于任意局域网 PC 的发现、配对、文件/PTY/流通道一体化。其 Sandbox 文档还明确构建仍可能发生在宿主机；Sandbox 运行不是对整个不可信项目构建的自动隔离保证。[Sandbox 执行边界](https://github.com/microsoft/winappCli/blob/v0.8.0/docs/sandbox-execution.md)

**更合理的组合**：在 Windows 构建环境用 WinApp 管 SDK、身份、MSIX 和 WinUI 调试，用 WDB 从 Mac 连接真机执行部署、采集日志和观察桌面。WDB 可以在授权 shell 中调用已安装的 WinApp，但不能因此把 WinApp 的能力计为 WDB 内置能力。

### 4. UltraVNC + vncdotool + SSH：成熟通用底座，集成由使用方承担

UltraVNC 面向实时桌面，vncdotool 将 RFB 的画面采集和输入变成脚本接口；SSH 提供命令、交互终端、文件和隧道。原生 UltraVNC viewer 的文件传输扩展不能自动算作 vncdotool 已支持同样的文件 API，实际组合通常通过 SCP/SFTP 传文件。vncdotool 官方使用文档还明确区分同一连接内的移动/点击与分开启动命令的行为：脚本需要管理连接状态，而不只是堆坐标命令。[UltraVNC 功能](https://uvnc.com/products/ultravnc/18-ultravnc-features.html)、[vncdotool 使用说明](https://github.com/sibson/vncdotool/blob/b091a9d38c6493aa0272d172f5f93c0b0f199c54/docs/usage.md)、[Windows OpenSSH 组件](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview)

WDB 将授权、设备选择、文件与任务返回值、桌面引用、产物和流生命周期收敛在一套协议及 CLI 中，可以减少组合方案的连接配置、身份映射和故障关联工作。但 SSH 的 `-L/-R` 已有本地/远程转发，不是 WDB 发明的能力；现有 SSH 运维体系在密钥管理、跨平台工具和网络转发场景可能更适用。[OpenSSH 命令手册](https://man.openbsd.org/ssh)

**安全配置不能省略**：SSH 加密只覆盖经过 SSH 的流量；若 VNC 仍单独直连，其加密需要另行配置。UltraVNC 支持 DSM 加密插件，但必须核对客户端兼容性，不能假定所有 VNC 客户端都实现其插件。需要时将 VNC 绑定 loopback 并经 SSH 隧道传输。这里讨论的是配置责任，而不是声称 UltraVNC 天生不安全。[UltraVNC 加密插件配置](https://sc.uvnc.com/docs/documentation/133-ultravnc-how-to-add-encryption.html)、[官方 viewer 配置](https://uvnc.com/docs/ultravnc-viewer/71-ultravnc-viewer-gui.html)

WDB **不提供实时远程桌面播放器**。若任务是持续观看画面并人工接管，VNC 更贴合目标；定时截图和 MP4 取证不能等同于实时桌面体验。

## 架构、安全与使用成本

| 方面 | WDB 的选择与收益 | 必须保留的边界 |
| --- | --- | --- |
| 接入 | npm CLI + Skill，无需客户端实现 MCP；同一命令供人和 Agent 使用 | CLI 参数、JSON 和文档仍需 Agent 解析；原生 MCP schema 发现不是 WDB 当前提供的接口 |
| 网络 | 命令、任务、文件、终端与转发复用同一服务端口 | 默认局域网信任边界，不是 NAT 穿透、云中继或公网设备管理平台 |
| 身份 | 首次 Windows 明确同意；客户端凭据、证书固定与撤销 | 首次使用信任需要评估；凭据持有者仍具备强控制能力，TLS 不等于细粒度 RBAC |
| Windows 权限 | SYSTEM 服务与普通用户 helper 分工；显式 admin | 不能据此宣称抵抗恶意已授权客户端、拥有租户隔离或可绕过 UAC/锁屏 |
| 异常处理 | 查询任务、区分 unknown/interrupted；流断线结束 | 批处理恢复不等于所有副作用 exactly-once；交互输入不能恢复或重放 |
| 运行依赖 | CLI 用用户 Node；Windows 双 EXE 可选自带 Node | 客户端小不等于服务端小；服务端还有原生组件和媒体组件 |

WDB 的这些取舍可核对 [连接与身份实现](../src/client-transport.js)、[服务端授权](../src/server.js)、[流通道](../src/server-streams.js)、[TCP 收尾规则](TCP-FORWARDING-LIFECYCLE.md)、[Windows 安装器](WINDOWS-INSTALLERS.md)。不能把“单端口”直接推导成带宽更低或延迟更小，需要同环境基准测试。

远程 MCP 方案也并非没有保护：Windows-MCP 提供认证/TLS、工具过滤等；winremote 0.4.20 起的远程 HTTP 默认要求认证，并提供 TLS/OAuth/IP 限制配置。WDB 的优势是预设的配对与证书固定流程，而不是“竞品没有加密”。这些配置也不应仅依赖 README 的旧概括，需检查实际启动参数。[Windows-MCP 安全配置](https://github.com/CursorTouch/Windows-MCP/blob/v0.8.8/README.md#-security--access-control)、[winremote 配置及远程限制](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/README.md)

### 分发、依赖与许可

- WDB：客户端为 Node 22+ 的纯 JS npm 包，Windows 服务安装器另行分发；MIT。不能把约几十 KB 的 CLI 压缩体积拿来与完整 Python 环境或完整 VNC/SSH 部署比较。
- Windows-MCP：Python/uv 生态分发；winremote：Python/pip 生态分发。服务在 Windows 运行，远端 Agent 可用网络 MCP 接入；这不要求 Mac 也安装 Windows Python 依赖。Python 版本按实际发行标签确认。[Windows-MCP 清单](https://github.com/CursorTouch/Windows-MCP/blob/b69ec872623b403f647fb3777685d4cf2678d3a2/pyproject.toml)、[winremote 清单](https://github.com/dddabtc/winremote-mcp/blob/a3a18df435f657b092be498cc4c0e576cf40ae36/pyproject.toml)
- WinApp：提供 WinGet、npm、二进制/MSIX 等入口，面向 Windows 开发主机；官方仓库也提供 Agent 插件。[安装与 Agent 接入](https://github.com/microsoft/winappCli#-installation)
- UltraVNC、vncdotool、OpenSSH 的许可分别核对；Windows-MCP、winremote-mcp、WinApp CLI 及 WDB 为 MIT，UltraVNC 为 GPL-3.0，vncdotool 为 MIT，OpenSSH 采用其项目中的多份许可条款。组合使用不意味着可以用一种许可重新分发全部组件。[UltraVNC 许可](https://github.com/ultravnc/UltraVNC)、[vncdotool 许可](https://github.com/sibson/vncdotool/blob/b091a9d38c6493aa0272d172f5f93c0b0f199c54/LICENSE.txt)、[OpenSSH 许可](https://github.com/openssh/openssh-portable/blob/master/LICENCE)

## WDB 值得突出的五个优势

1. **面向远端真机的统一通路**：桌面、文件、任务、PTY 和转发共享设备身份与连接入口，减少把多个工具拼成调试系统的工作。
2. **跨框架的观察路径**：UIA + Electron CDP + Flutter Inspector + 截图，可以在“控件语义”“框架内部状态”“实际画面”之间选择，而不把所有问题都降为视觉点击。
3. **可追踪的执行生命周期**：任务 ID、状态查询、输出、取消与产物是接口的一部分，适合较长的部署和诊断；不确定结果不盲目重放。
4. **人类与 Agent 共用 CLI**：同一命令可进入终端、脚本、CI 或 Skill；客户端从 npm 安装，服务端可用独立安装器交付。
5. **更接近设备调试的工作流**：把脚本、推拉、安装、截图/录屏、交互 shell 和 TCP 转发贯通。优势来自这组能力的组合，而非宣称任意单项都领先所有对手。

这些是基于接口与架构的优势判断，**不是“准确率更高、速度更快、成本一定更低”的实测结论**。WDB 当前仍需扩大兼容性与长期运行验证，也不具备上述所有竞品的社区规模与集成生态。

## 如何选型与组合

| 主要任务 | 更合适的起点 | WDB 的位置 |
| --- | --- | --- |
| 从 Mac 调试另一台 Windows，兼顾部署、脚本、桌面和框架状态 | WDB | 核心目标场景 |
| MCP 客户端中快速获得通用 Windows 桌面能力 | Windows-MCP | 需要统一设备/终端/框架通路时再评估 WDB |
| 远程 Agent 的进程、服务、注册表、OCR 等系统工具集合 | winremote-mcp | WDB 可处理脚本和调试闭环，但部分操作需自行写脚本 |
| WinUI/WinRT、MSIX、身份、SDK、笔输入或 Sandbox 开发 | WinApp CLI | 可由 WDB 连接真机，在 Windows 侧结合使用 |
| 持续看屏、人工远程协助，已有 SSH 密钥和运维规范 | UltraVNC + SSH；需脚本时加 vncdotool | WDB 作为应用语义观察和任务/产物通路补充 |

评估落地时，建议各方案在同一 Windows 应用和网络上完成四组任务：①无障碍控件与自绘控件定位；②文件部署、启动与版本核对；③长任务断线后的结果查询；④权限/锁屏/用户接管及正常退出后的资源回收。记录成功率、人工干预次数、P50/P95 延迟和清理结果。本文没有执行这套竞品横测，不引用不等价演示来证明 WDB 性能领先。
