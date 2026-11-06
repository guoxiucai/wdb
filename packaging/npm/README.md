# WDB CLI

Windows/macOS 共享的纯 JavaScript 客户端。需要先安装 Node **>=24.15.0 <25**（[官方安装指引](https://nodejs.org/)）。此包不携带或下载 Node，不安装 Windows 服务，也没有 install/postinstall hooks。

本地验证：`npm install -g --prefix <测试目录> <包文件.tgz>`；Windows 使用 `<测试目录>\wdb.cmd`，Mac 使用 `<测试目录>/bin/wdb`。正式 registry 名称由维护者确认，本地测试包不用于 npm 发布。

```text
wdb --version
wdb connect <Windows服务器IP>
wdb devices
wdb info
wdb disconnect <Windows服务器IP>
```

首次连接由 Windows 桌面的授权窗口确认。详见 [CLI](docs/CLI.md)、[Windows 验证](docs/WINDOWS-CLI-VALIDATION.md)、[Mac 使用](docs/MACOS-CLIENT.md)。Agent Skill 位于 [skills/wdb/SKILL.md](skills/wdb/SKILL.md)，不自动复制到其他应用。

凭据继续保存在 Windows `%LOCALAPPDATA%\wdb\client` / Mac `~/Library/Application Support/wdb/client`；更新或卸载 npm 包不会删除这些数据。用 `where.exe wdb` / `command -v wdb` 核实入口，避免旧 portable 包遮挡命令；不要删除旧凭据。

开发包的 `UNLICENSED` 仅表示尚未配置项目发行许可，不自动授予开源许可。正式发行需维护者提供 LICENSE 和包名。
