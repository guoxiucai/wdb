# WDB CLI

Windows/macOS 共享的纯 JavaScript 客户端。需要先安装 Node **>=22.0.0**（[官方安装指引](https://nodejs.org/)）。此包不携带或下载 Node，不安装 Windows 服务，也没有 install/postinstall hooks。

安装：`npm install -g @tsingwill/wdb@0.1.0 --omit=optional --ignore-scripts`。安装后运行 `wdb --version`。

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

WDB 采用 [MIT 许可证](LICENSE)。第三方依赖遵循各自许可。发行文件见 [GitHub Release v0.1.0](https://github.com/guoxiucai/wdb/releases/tag/v0.1.0)。
