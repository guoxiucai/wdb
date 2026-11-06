# Windows LAN 交付自检（2026-11-06）

## 已部署状态

- Windows 服务 `WdbService` 自动启动，已更新编译后的 x64 宿主，安装路径 `C:\Program Files\wdb`，实际执行身份 SYSTEM。
- 桌面助手 `WdbDesktopHelper` 以 `QINGWEI\Tsingwill` 在交互会话运行；升级后 desktop.available=true。
- 服务 `0.0.0.0:18766`，本机与 LAN URL 均可连接。当前入口 **`https://172.20.115.75:18766`**，hostname `qingwei`，deviceId **`2f493aacf427f3e9`**。
- 规则 `WdbService-LAN` 已启用：仅 Ethernet、LocalAddress=172.20.115.75、RemoteAddress=LocalSubnet、TCP18766、已安装 Node 程序；所有网络类别，不改变当前 Public 分类。
- 桌面助手仍仅本机 18767；对 LAN IP 的 18767 TCP 探测不可达。未新增 CDP/Flutter 对外端口规则。
- 服务升级与后续重启保留已有 localhost 配对、LAN 测试身份和设备 ID。

## 验证结果

| 检查 | 结果与证据 |
|---|---|
| C# 宿主/桌面桥编译、服务安装 | 通过；`artifacts/lan-build-stage1.log`、`lan-install-result.json`、`lan-install.log` |
| PowerShell 语法/服务配置 | 通过 `tests/service-config.test.ps1`，包含引号、提供方失败及读回检查 |
| localhost 安装后身份/桌面检查 | 通过；`artifacts/lan-localhost-info.json` |
| 独立 LAN 地址配对/助手隔离 | 通过；`artifacts/lan-initial-check.json`；凭据仅在被忽略的独立配置目录中 |
| 独立客户端包闭环 | 13 步通过；`artifacts/lan-smoke/report.json` |
| 传输 | 中文/空格目录、1 MiB 随机文件和文本往返，逐字节一致；测试目录已清理 |
| 观察 | screens/windows 返回；PNG 拉取后已查看，确为服务器 3840×2160 当前桌面 |
| 主动断开/重连 | 显示 disconnected；connect 复用同一凭据，deviceId 一致 |
| 新宿主服务重启 | watch 自动观察到 serverProcessId 从15952切到33020，身份和授权保持；`artifacts/lan-restart-watch.jsonl` |
| 标准回归 | 59项：58通过、0失败、1真实服务测试默认跳过；`artifacts/lan-full-tests.log` |
| LAN URL 真实服务集成 | 单独启用并通过1项（测试名沿用localhost，WDB_TEST_URL实际为LAN IP）；`artifacts/lan-live-tests.log` |
| Skill | skill-creator quick_validate 通过 |

此轮客户端与服务端都是 **qingwei 同一台主机**。LAN IP 自连接验证监听/认证/客户端执行，不证明来自第二台机器的入站流量已穿过防火墙，也不证明交换机/AP/企业网络可达。跨电脑网络中断、实际吞吐、多设备、多屏和 Mac 实机结果均不计入本报告通过项；按 `LAN.md` 在对应设备验收。

## 交付文件

- `dist/wdb-windows-x64.zip`：完整 Windows 服务端离线包，含 CLI/Skill/依赖和安装脚本。
- `dist/wdb-client-windows-x64.zip`：独立免安装客户端，含运行时、CLI、Skill、文档和验证脚本。
- `dist/wdb-skill.zip`：单独 Skill（wdb 目录）。
- `dist/SHA256SUMS.txt`：以上压缩包的校验值；目录内各有文件级 SHA256SUMS。
- `docs/MACOS-CLI-DEVELOPMENT.md`：Mac 并行开发交接，macOS CLI 尚待开发者在 Mac 完成适配与验收。

包内 `BUILD-INFO.json` 标记源码提交、产品/协议版本、运行时和构建时间，以此识别本次构建。dist、测试报告、凭据与截图不进入 Git；GitHub 仓库提供源码、文档及可重复构建脚本。
