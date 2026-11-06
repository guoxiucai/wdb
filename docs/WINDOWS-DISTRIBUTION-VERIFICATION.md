# Windows 本地分发验收记录

日期：2026-11-06。远端代码已快进到 `41f00e4`，本地实现基于该提交继续开发。最终候选 BuildId 为 `windows-final-05`，构建源码为干净提交 `61f93c9841cc17253d9a12a2c4d3248698f179f8`；后续提交仅补充验收脚本和报告，不改变该候选包的字节。

本机闭环结果：安装矩阵 12 项全部通过，安装后 SSE 8 项全部通过，3 轮各 13 步业务检查和 3 次录屏均通过。最后恢复为 with-node，WdbService Running / Automatic，桌面助手可用；源码隔离及普通用户程序目录权限检查也通过。该结果只覆盖本文列出的本机范围。

用户确认的开发参数：`wdb-cli-local-test`、`UNLICENSED`、`WDB Development`。所有 WDB 安装器均为未签名 Development 包，`releaseReady:false`。未执行 npm publish，也未上传安装包。

## 环境与产物

Windows 11 x64 / build 28000，Windows PowerShell 5.1.28000.3365，.NET Framework Release 533510，Node 24.15.0，Inno Setup 6.7.1。真实 SCM 服务使用 LocalSystem，桌面助手为 `QINGWEI\Tsingwill`、Limited、session 1。客户端通过本机 LAN 地址 `172.20.115.75:18766` 访问，使用用户先前同意并记住的客户端身份。

产物目录：`dist/release-builds/windows-final-05/release/Development/`。

| 文件 | 下载 bytes | SHA-256 |
| --- | ---: | --- |
| wdb-server-0.1.0-windows-x64-with-node-Development-setup.exe | 99,012,116 | `63a3e92f6036f6c6abfef82d8830c3174ac874b1d034177e6a315433ff170542` |
| wdb-server-0.1.0-windows-x64-external-node-Development-setup.exe | 70,248,369 | `e2cfb5a32b633253418529f12cd5099f2b3102f13664af84400bc1b7775f3eae` |
| wdb-cli-local-test-0.1.0.tgz | 86,571 | `0ad80656e7ec5e3080ba619d0d0cdb9d95ad3dd776e74eab23fc1bd3e5f364cd` |

with-node 解压 payload 为 303,103,135 bytes，external-node 为 211,251,629 bytes。npm 解压内容为 218,796 bytes / 28 个文件；无 Node、原生桥、服务端代码、安装钩子或凭据。实际安装目录包含卸载器：最后重装 with-node 为 307,575,572 bytes；external-node 升级后为 216,040,993 bytes。多次升级的卸载日志会使数值变化，不能直接用 payload 大小代替。

两个 EXE、npm tarball、SHA256SUMS、release-manifest、signing-report、verification-report 放在同一交付目录。最终机器可读验收状态以该目录中的 `verification-report.json` 为准。

## 验收方法

npm tarball 在 `.runtime/npm 最终客户端 05` 隔离 prefix 安装，测试中文/空格路径、任意 cwd、PowerShell 调用 `.cmd`、cmd 入口、help/version/JSON、更新/卸载/重装保留独立配置。没有改全局执行策略。后续服务操作全部显式指定这一份已安装 CLI。

`scripts/validate-release-windows.ps1` 从独立 SYSTEM 一次性任务启动，避免服务重启杀死测试自身。真实运行 EXE 完成两模式各自升级、双向切换；校验服务、桌面助手及防火墙均绑定正确的 Node 绝对路径。with-node、external-node 和最后重装分别执行 13 步连接/用户 shell/文件往返/截图验收，以及 3 秒、15 fps 的录屏拉取、ffprobe 和完整解码。

故障测试包括：缺失外部 Node、用户 nvm 路径在停止旧服务前拒绝；事务复制后破坏 server.js 必须拒绝提交并恢复旧程序、绑定及授权；删除指定测试用外部 Node 后必须报告准确缺失路径，不从 PATH 选择另一个 Node。故障注入只存在于测试脚本中。

卸载测试使用真正的 Inno 卸载器，检查服务、计划任务、防火墙和安装程序文件清理，数据目录中的 deviceId、TLS、已记住授权保持不变，外部 Node 不被删除；随后重装并复用原授权。测试外部 Node 仅放在 `C:\Program Files\WdbTestRuntime\node.exe`，不改变全局 PATH。

`scripts/validate-installed-isolation.ps1` 以普通用户验证程序目录不可写，暂时移走仓库 `src`、`native`，再重启已安装服务并执行桌面用户 shell，最后恢复源码。它验证源码入口和本地编译源不参与运行；不把这个结果等同于一台全新、断网的 Windows 机器。

## SSE 与回归

实机 SSE 的 8 项内容见 [WINDOWS-SSE-VERIFICATION.md](WINDOWS-SSE-VERIFICATION.md)：TLS 连接复用、普通用户/SYSTEM 输出实时到达、中文及 emoji、断流按字节偏移续接、等待超时不取消、显式取消、单条 JSON 终态、真正 SCM 重启后不重跑任务。最终包再次使用已安装 npm CLI 执行这些检查。

`npm test`：121 项，110 通过、11 跳过、0 失败。跳过项包括 Mac 专属测试及需显式开启的旧实机测试；本轮的独立 Windows 安装矩阵和 SSE 验收不依赖该旧测试开关。协议/重连专项的 23 项也通过。

本轮发现并修复了三处 Windows PowerShell 5.1 兼容问题：安装事务和诊断日志不能直接深度序列化带 Provider 元数据的 Get-Content 字符串；高级脚本默认参数不能提前依赖 PSScriptRoot。分别用普通 .NET 字符串、限定日志尾部，以及在参数绑定后解析目录修复，并增加回归检查。卸载器现在保留其子进程输出和退出码，便于定位启动阶段错误。

## 尚未执行的发行矩阵

以下项目仍需对应环境或正式发行材料，不能由本机通过推断：真实 Mac arm64 npm；干净无 Node/npm 的 Windows 和不同 Windows 10/11 版本；物理跨机断网；真实 registry 安装；正式发布者证书、时间戳及完整签名安装/卸载；实际 OS 重启、注销/锁屏、另一个管理员账号完成 UAC；安装期间取消 UAC、磁盘满、端口被其他产品占用；更换实际 Node 补丁/大版本二进制。Node 不支持大版本/预发布版本的拒绝逻辑有自动化覆盖，不能替代这些实机格子。

本轮使用已有记住授权，未再次代操作首连同意/拒绝安全弹窗。短录屏已验证，不扩大既有长时录屏验收结论。部署、签名续跑和客户端操作分别见 [WINDOWS-INSTALLERS.md](WINDOWS-INSTALLERS.md)、[NPM-CLIENT.md](NPM-CLIENT.md)、[WINDOWS-CLI-VALIDATION.md](WINDOWS-CLI-VALIDATION.md)。

## 本机证据

原始证据保存在 git 忽略的 `artifacts` 下，截图、视频、客户端凭据不进入仓库或交付包：

- `release-matrix-05/report.json`：完整 EXE 安装矩阵及每次安装大小。
- `release-matrix-05/external-sse/report.json`：安装后 SSE 8 项。
- `release-matrix-05/*-lan/report.json`、`*-recording/report.json`：文件/截图/短录屏。
- `npm-final-05.json`、`release-verification-final-05.json`：实际 npm 安装和最终产物校验。
- `distribution-final-tests-05.log`：完整回归。
- `installed-isolation-05/report.json`：普通用户 ACL、源码移走及服务重启。

复现命令的安装矩阵会停止、卸载和重新安装当前 WDB；应在专用测试机或已安排中断的环境运行。每次必须选择已授权 profile，不能通过自动放行安全弹窗代替用户授权。
