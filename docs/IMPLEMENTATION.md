# Windows localhost 实施方案

需求基线：`wdb-phase1-requirements.md`。本次用户明确授权实施代码，覆盖 Windows localhost；macOS 与局域网实机验证后续开展。

## 架构

- CLI：Node.js 内置库、JSON 结果、TLS 证书指纹固定、独立客户端凭据。
- 服务：真实 Windows SCM 服务托管 Node HTTPS 服务；默认仅监听 127.0.0.1:18766；负责授权、任务、文件、管理员命令、审计与保留策略。
- 桌面助手：当前登录用户下独立后台进程，回环接口与随机秘密认证；执行默认用户 shell 和 GUI 请求。GUI 不从 Session 0 直接操作。
- 原生桥：系统 PowerShell/.NET Framework + Win32/UI Automation，截图、窗口、键鼠、真实触摸。
- MP4：打包 FFmpeg 可执行文件；本地采集、独立任务、显式时长上限。
- 生产包附 Node 和录屏依赖；开发安装直接引用工作区以便逐步验证。用户密码不写入代码、配置或日志。

## 分步提交与独立验证

| 步骤 | 交付 | 验证与提交门槛 |
|---|---|---|
| S01 | Git、架构、实施与验收计划 | 需求逐项映射、开发工具检查 |
| S02 | 后台服务安装、启停、桌面助手与离线打包 | 编译服务宿主、一次 UAC 安装、状态/诊断 |
| S03 | TLS、配对、凭据、任务、文件、shell、审计 | API 自动测试、未授权拒绝、校验/覆盖、取消/重启 |
| S04 | CLI 与 Agent Skill | CLI 测试、localhost 真连接与任务/文件往返 |
| S05 | 原生桌面与控件、触摸 | 独立测试窗口验证 UIA/截图/输入/窗口与轨迹 |
| S06 | 录屏、应用管理、日志、生命周期 | 短录屏、任务并发/失联、日志/安装状态 |
| S07 | 三类已安装应用与压力验收 | 逐个实际观察；UIA 不可用记录视觉兜底并继续 |
| S08 | 离线包与交付记录 | 包完整性、实际通过/未通过/待材料区分，Git 干净 |

每步验证通过后提交；之后发现问题用独立修复提交。没有实测的数据不写成通过。

## 验收边界

A01/A02 用希沃白板5、EasiClass、鸿镜逐类验证，缺少可访问性不阻塞全局流程。A03 真实安装升级需对应包/静默参数；自建测试包仅证明机制。A04/A05 分开记录注入与笔迹完整性。A06 实测10分钟。A07千兆LAN、A09两台物理设备、A10特殊多屏、支持系统版本矩阵与macOS当前不具备条件，保留待验收。大文件/大量小文件单独测试。

## 参考

- https://learn.microsoft.com/en-us/windows/win32/services/interactive-services
- https://nodejs.org/api/https.html
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-injecttouchinput
