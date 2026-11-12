# WDB CLI 0.1.1

Windows/macOS 共享的纯 JavaScript 客户端。需要先安装 Node **>=22.0.0**（[官方安装指引](https://nodejs.org/)）。此包不携带或下载 Node，不安装 Windows 服务，也没有 install/postinstall hooks。

安装：`npm install -g @tsingwill/wdb`。安装后运行 `wdb --version`。

旧 0.1.0 用户先用上述 npm 命令升级一次；从 0.1.1 起支持以下自更新命令。

维护：`wdb update --check --json` 只检查；`wdb update` 展示候选版本和 Skill 路径，确认后才更新。同步使用该精确 npm 包内的 Skill，不静默覆盖本地修改；详见[更新指南](docs/UPDATING.md)。服务端、Node 和已保存授权不随 CLI 更新。

本地验证：`npm install -g --prefix <测试目录> <包文件.tgz>`；Windows 使用 `<测试目录>\wdb.cmd`，Mac 使用 `<测试目录>/bin/wdb`。正式包名为 `@tsingwill/wdb`；本地开发包不用于 npm 发布。

```text
wdb --version
wdb connect <Windows服务器IP>
wdb devices
wdb info
wdb disconnect <Windows服务器IP>
```

首次连接由 Windows 桌面的授权窗口确认。详见 [CLI](docs/CLI.md)、[npm 安装与配置](docs/NPM-CLIENT.md)。Agent Skill 位于 [skills/wdb/SKILL.md](skills/wdb/SKILL.md)，不自动复制到其他应用。

凭据继续保存在 Windows `%LOCALAPPDATA%\wdb\client` / Mac `~/Library/Application Support/wdb/client`；更新或卸载 npm 包不会删除这些数据。用 `where.exe wdb` / `command -v wdb` 核实入口，避免旧 portable 包遮挡命令；不要删除旧凭据。

WDB 采用 [MIT 许可证](LICENSE)。第三方依赖遵循各自许可。CLI 发行包以 npm 为准；Windows 服务端安装器见 [GitHub Release v0.1.0](https://github.com/guoxiucai/wdb/releases/tag/v0.1.0)。
