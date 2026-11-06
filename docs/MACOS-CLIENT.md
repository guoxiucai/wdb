# macOS 客户端

适用于 macOS 14+、Apple Silicon arm64。CLI 与 Windows 客户端复用同一份实现；PowerShell、UIA、输入、截图、Electron CDP 和 Flutter VM 操作均在 Windows 执行。Mac 不需要屏幕录制或辅助功能权限。实际验收范围见 [MACOS-VERIFICATION.md](MACOS-VERIFICATION.md)。

## 解压与启动

将整个 `wdb-client-macos-arm64` 目录保存在固定位置，保留执行位。包自带 Node v24.15.0，不需要 Node、npm 或 Homebrew，运行时不下载依赖。

```sh
cd '/你的路径/wdb-client-macos-arm64'
./runtime/node ./scripts/verify-package.js
./bin/wdb --version --json
export PATH="$PWD/bin:$PATH"
```

可以把整个 `bin` 加入 PATH，也支持从用户自己的 bin 目录创建指向 `bin/wdb` 的符号链接。启动器会解析相对或绝对符号链接，支持空格、中文及任意工作目录。包只带命令行入口，没有 Mac GUI，也不启动 Windows 服务。

使用正常 macOS 安全策略安装。若系统阻止启动，核对分发来源、校验结果及系统提示；不以关闭 Gatekeeper 或全局移除隔离属性作为安装步骤。包校验验证文件完整性，不替代可信来源或发行签名。

## 首次连接

Windows 本地 PowerShell 执行：

```powershell
& 'C:\Program Files\wdb\scripts\show-pairing.ps1' -RevealCode
```

从可信渠道取得 `fingerprint` 和 `pairingCode`。当前服务没有“连接时 PC 弹窗同意”的交互，配对码是安装时生成并持久保存的授权凭据。不要从一次未经验证的网络握手自动信任证书。

在 Mac 默认 zsh 中安全读取输入，避免把字面配对码留在历史记录：

```zsh
read 'fingerprint?Windows 证书 SHA-256 指纹: '
read -s 'pairingCode?Windows 配对码: '; print
wdb connect 172.20.115.75 --fingerprint "$fingerprint" --pairing-code "$pairingCode" --name mac-client --json
unset pairingCode fingerprint
wdb info --device 172.20.115.75 --json
```

之后 `wdb connect 172.20.115.75 --json` 复用已保存的 token，不再传配对码。`disconnect` 只停用连接；需要撤销授权时使用 `clients revoke <clientId>`。

配置优先级：`--config` > `WDB_CONFIG` > `~/Library/Application Support/wdb/client`。默认目录不存在且旧 `~/wdb/client/devices.json` 存在时，自动复制并原子发布凭据，保留旧文件；新目录已存在（即使为空）时不迁移、不合并。显式配置目录不触发迁移。Mac 每次读取或写入会将目录和凭据文件权限收紧为 0700/0600，并拒绝配置目录或凭据文件本身是符号链接。

配置尚无一般读改写多进程锁；避免同时运行会修改同一配置的 connect/disconnect。迁移以独占创建新目录、原子且不覆盖的文件发布避免合并身份；若进程在迁移中被强制终止留下空目录，应检查后手动移开空目录再重试。不要复制、分享或提交 `devices.json`。

## 命令与验证

```sh
wdb shell --script 'Get-Date; whoami' --json
wdb shell --script-file './诊断 脚本.ps1' --json
wdb push './资料 中文.txt' 'C:\wdb-test\资料 中文.txt' --json
wdb pull 'C:\wdb-test\截图.png' './结果/截图.png' --json
wdb devices --watch --json
./runtime/node ./scripts/validate-lan.js --device 172.20.115.75 --output './lan-result'
```

`--args-file`、`--script-file`、`--expression-file` 读取 Mac 本地文件；其中的远端 `path`/`cwd` 保留 Windows 语义。PowerShell 使用单引号避免 zsh 展开 `$env:TEMP`。截图先 pull 再查看，坐标始终是 Windows 物理像素，不乘 Mac Retina 缩放。

普通命令 `--json` 的 stdout 只有一个 JSON，进度和重连走 stderr；watch/follow 输出 NDJSON。Ctrl+C 结束 watch/follow；对普通长任务只停止客户端等待，远端可能继续。用 `task get|wait` 查询原任务，明确取消用 `task cancel`。不自动重放未知结果的操作。

文件默认拒绝覆盖；需要时显式 `--overwrite`。上传拒绝符号链接，下载在目标目录校验临时文件后原子发布；目录传输逐文件执行，失败不回滚此前成功文件。大小写或 Unicode 归一化冲突取决于目标卷；默认遇到已有目标会失败，不保证两个 Windows 文件名在 Mac 上都可表示。

完整命令见 [CLI.md](CLI.md)，Agent 使用同一个 `skills/wdb`。LAN 验证会创建并清理独立远端临时目录、核对中文目录文件字节、拉取截图、断开并重连。它不操作业务界面，不代表吞吐或全部应用验收。

## 从源码构建

在 Apple Silicon Mac 仓库根目录执行：

```sh
./scripts/build-client-macos.sh
# 本机已缓存官方运行时，可断网重建到另一个空目录
WDB_NODE_ARCHIVE="$PWD/.runtime/node-v24.15.0-darwin-arm64.tar.gz" ./scripts/build-client-macos.sh ./dist/client-test
./dist/wdb-client-macos-arm64/runtime/node --test tests/cli.test.js tests/macos-client.test.js tests/client-portable.test.js
WDB_TEST_PACKAGE="$PWD/dist/wdb-client-macos-arm64" ./dist/wdb-client-macos-arm64/runtime/node --test tests/macos-package.test.js
```

构建仅首次下载官方 Node，核对固定 SHA-256；来源为 [Node 官方校验清单](https://nodejs.org/download/release/v24.15.0/SHASUMS256.txt)。仅抽取 Node 和许可证，包内不含 npm、Windows 服务、测试凭据或产物。已有输出目录会拒绝覆盖，请移开旧包或选择新路径。构建脚本不依赖全局 Node。

`BUILD-INFO.json` 记录产品/协议/运行时、源码提交、工作树是否修改及构建时间；`SHA256SUMS.txt` 覆盖全部交付文件。校验同时检查遗漏、额外文件、符号链接、执行位，以及移除全局 Node 路径后的启动。

升级时先验证新包再切换 PATH/符号链接；配对配置与安装目录独立。卸载时移除包和自己创建的入口；是否删除私有配置由用户决定，删除本地配置不会撤销服务器端 token。
