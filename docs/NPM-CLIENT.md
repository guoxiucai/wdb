# 纯 JavaScript npm 客户端

正式包名：`@tsingwill/wdb`，命令名：`wdb`。Windows/macOS 均可执行：

```sh
npm install -g @tsingwill/wdb
wdb --version
```

CLI 0.1.1 通过 npm 分发；需要离线 tarball 时运行 `npm pack @tsingwill/wdb@0.1.1`。Windows 服务端安装器仍见 [GitHub Release v0.1.0](https://github.com/guoxiucai/wdb/releases/tag/v0.1.0)。

CLI 0.1.1 起支持 `wdb update`（确认后更新）与 `wdb update --check --json`（只检查）。旧 0.1.0 用户先运行上面的 npm 安装命令升级，完整行为见 [更新指南](UPDATING.md)。

最低版本统一为 **Node 22.0.0**，CLI 与服务端拒绝 Node 18 / 20，不设置只接受 Node 24 的上限。推荐使用 Node 24 LTS 的受维护补丁版本；自带运行时的 EXE 继续使用固定 Node 24。Electron/Flutter WebSocket 使用已锁定的 `ws`。跨平台共享代码不等于所有 Node 版本或 Mac 实机均已验证。

Windows/macOS 共用一个 tarball，支持 Node `>=22.0.0`。唯一第三方运行依赖为固定版本的纯 JavaScript `ws@8.22.1`（MIT）；无原生程序、服务端代码或 install/postinstall hook，不下载 Node 或自动复制 Skill。安装时可使用 `--omit=optional --ignore-scripts`，无需 ws 的可选原生加速模块。仓库根包仍为 private。交互式 shell 与转发用法见 [CLI 手册](CLI.md)。

```powershell
# 新目录，不覆盖已有构建；仅本地开发包
node scripts/build-cli-npm.js --development true --license MIT --license-file LICENSE --output dist/npm/my-build
node scripts/verify-cli-npm.js dist/npm/my-build/wdb-cli-local-test-0.1.0.tgz 'D:\测试 prefix'
# 从已安装产物运行
& 'D:\测试 prefix\wdb.cmd' connect <服务器IP>
& 'D:\测试 prefix\wdb.cmd' info
```

Mac 对同一个 `.tgz` 执行 `npm install -g --prefix "$HOME/wdb-test" <tarball>`，通过 `$HOME/wdb-test/bin/wdb` 使用。Windows `.ps1` shim 受执行策略限制时可用 `.cmd`，不修改全局安全策略。

`build-cli-npm.js` 记录版本、Git SHA/dirty、完整文件清单、integrity、SHA-256 及下载/解压大小。源码/Skill/客户端文档引用按白名单复制。发行模式必须提供 `--name`、`--license` 和 `--license-file`；开发包名称为 `wdb-cli-local-test`，保留 `private:true`；使用 `--license MIT --license-file LICENSE` 将仓库许可带入产物。构建工具不包含 publish 动作。

客户端凭据位置保持不变。`npm uninstall -g --prefix <prefix> <包名>` 只卸载程序；旧 portable PATH 请操作者自行调整，用 `where.exe wdb` 或 `command -v wdb` 确认当前入口。

## 检查与更新

`wdb update` 检查 npm 发布版本，展示当前版本、候选版本、安装和 Skill 目录，默认取消；确认后才更新。`wdb update --check --json` 只检查，`--yes` 是显式同意，`--no-skill` 只更新 CLI。客户端与 Skill 从同一个精确版本包更新；本地 Skill 修改会保留并报告冲突。旧服务端附带入口不通过 npm 改写，已安装的 Node/服务和配对凭据不受影响。详细安装归属、登记、备份、退出码和失败恢复见[更新指南](UPDATING.md)。

Mac arm64 支持从 npm tarball 安装，交互 shell 需要 TTY，forward/reverse 在前台运行。安装产物不携带 Node，更新或卸载保留客户端配置。具体包体大小以该次构建报告为准；发行包通过 npm registry 与 GitHub Release 分发。

`devices` 在 Windows/macOS 采用相同规则：在线设备正常显示；历史配对记录在新终端中不会显示为 `offline`。仅在当前终端通过 `connect` 或 `devices` 观察到在线的设备，随后探测离线时才保留离线条目，从首次发现离线起最多显示 10 分钟；重复探测不延长时间。恢复在线后重新显示。该过滤同时适用于文本、JSON 和 `--watch`，不删除配对凭据，也不改变显式 `--device` 的使用。授权/证书错误仍显示。会话按终端标识及父 shell 进程识别（Windows 跳过 npm 的临时 cmd /c 启动层）；无法识别时仅保留当前 CLI 调用内的观察，不继承历史离线条目。
