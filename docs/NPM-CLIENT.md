# 纯 JavaScript npm 客户端

Windows/macOS 共用一个 tarball，支持 Node `>=24.15.0 <25`。唯一第三方运行依赖为固定版本的纯 JavaScript `ws@8.22.1`（MIT）；无原生程序、服务端代码或 install/postinstall hook，不下载 Node 或自动复制 Skill。安装时可使用 `--omit=optional --ignore-scripts`，无需 ws 的可选原生加速模块。仓库根包仍为 private。交互式 shell 与转发用法见 [CLI 手册](CLI.md)。

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

2026-11-06 Windows 首轮结果：27 个文件，tgz 84,977 bytes、解压 215,411 bytes；中文/空格 prefix、任意 cwd、Node 和 `.cmd` 入口正常。从安装产物完成 13 步文件往返、截图与连接验证。后续最终包大小以 release-manifest 为准。Mac npm 实机、registry 安装尚未执行。
