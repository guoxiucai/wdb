# 更新 CLI 和对应 Skill

在包含更新命令的 npm 客户端版本中执行：

```sh
wdb update
```

命令从 npm 的 `latest` 查询正式包 `@tsingwill/wdb`，展示当前/候选版本、registry、实际安装目录及 Skill 路径。默认 `[y/N]`，只有 y/yes 才更新；回车、拒绝、EOF、Ctrl+C 都取消。只支持稳定 X.Y.Z 版本，不自动降级。不会在普通命令中偷偷检查更新，也不需要 connect。

| 命令 | 用途 |
| --- | --- |
| `wdb update --check` | 只检查，绝不安装 |
| `wdb update --check --json` | Agent/脚本读取版本和 Skill 状态 |
| `wdb update --json` | 同样只检查，不交互 |
| `wdb update --yes` | 显式同意后执行，仍先显示目标 |
| `wdb update --yes --json` | stdout 只有最终 JSON，预览走 stderr |
| `wdb update --no-skill` | 交互确认，只更新 CLI |

`--check` 与 `--yes` 互斥。没有 TTY 且没有 --yes 时报告 CONFIRMATION_REQUIRED，不写安装目录。Agent 只有获得用户更新授权后才可使用 --yes；不能把它作为普通调试的前置操作。

## 更新哪个安装

只自动更新当前运行的正式 npm 全局客户端，支持可验证归属的自定义 --prefix。查询和安装复用 npm 的用户配置、scope registry、代理与 CA，但要求 HTTPS；不会输出认证信息。npm 必须能定位到匹配当前 Node 的 npm-cli.js，由当前 Node 直接运行，避免 shell 拼接、路径转义或不透明启动器的取消问题。

源码、private/development、项目局部依赖、npx 临时缓存、旧 portable 或 Windows 服务安装器附带入口不原地 npm 更新。运行 `where.exe wdb`（Windows）或 `command -v wdb`（macOS）确认入口。Windows 服务提供的 wdb.exe 可能排在 npm wdb.cmd 前面；必要时显式运行 npm prefix 下的 wdb.cmd，不自动更改 PATH。

Node、npm、Windows 服务和桌面 helper 不更新；设备凭据、配对授权和 devices.json 不改变。候选版本的 Node 要求不符时，在替换 CLI 前停止，不自动安装 Node。

客户端配置和外部 Skill 不能放在将被替换的 npm 程序目录中；检测到重叠会拒绝更新，避免配置/用户文件随包替换丢失。

## Skill 同步

npm 包包含完整 `skills/wdb` 和 `SKILL-MANIFEST.json`。更新从刚确认的精确版本包中同步 Skill，不另取 GitHub main，避免版本错配。新安装脚本优先从可识别的 npm CLI 包读取 Skill，并在客户端配置目录的 `skill-installs.json` 登记位置及文件 hash；设置 WDB_CONFIG 可选择独立的登记目录，update 也可用 --config 选择。

默认同步所有已登记的 Codex/Claude Code 用户级与项目级位置，不扫描其他磁盘或未知项目。CLI 已是最新、但登记的 Skill 落后时，确认后可单独同步 Skill。包更新不等于已安装 Skill 自动热重载，完成后请新开 Agent 会话。

旧安装没有登记时，只发现已知用户目录和当前项目目录；交互模式逐项询问是否备份后纳入同步，然后再询问总更新确认。--yes 不会认领未登记目录。其他项目可重跑安装脚本纳入登记。手动复制的 Skill 不会被静默覆盖。

每个 Skill 先 staging/校验再切换，旧目录备份在 Agent 的 `wdb-skill-backups`，位于 skills 搜索目录之外。本地有新增/修改文件时保留原内容，报告 local_changes；--yes 不强制覆盖这些修改。检查差异后可重跑安装脚本，明确选择替换（仍保留备份），或恢复原内容后再次 update。

首次安装脚本复用旧/非 npm CLI 时，如无法找到包内 Skill 清单，会继续使用固定 Git 提交的仓库资源，并提示无法保证与该 CLI 版本对应；显式 --ref 也选择仓库资源。后续同步到新版 npm 包可恢复对应版本关系。

## 结果与失败恢复

检查 JSON 的 `data` 包含 currentVersion/latestVersion、state、updateAvailable、skillUpdateAvailable、skillAttentionRequired 和目标列表。实际更新成功会给出 installedVersion；发生失败时尽可能报告 actualVersion 与 recoveryDirectory。PATH 被其他 wdb 遮蔽会给出 pathShadowed 提示，不能把目标包升级当作默认入口已切换。

常见 state：up_to_date、newer_than_release、update_available、cancelled、updated、skills_updated、updated_with_skill_errors、unsupported_installation、update_failed。检查成功、无更新或取消退出 0；网络、安装、校验、确认缺失及 Skill 部分失败退出 1。

CLI 与多个 Skill 不是一个原子事务。若 CLI 成功但某个 Skill 失败/冲突，结果会分别列明，返回非零；不要误以为 CLI 已回退。修复冲突后重跑可只补 Skill。npm 更新失败也不保证原样回滚，先检查明确目标入口的版本和保留证据，再决定重试或用原 prefix 手动安装。

同一安装有更新锁，不能因为看到锁就强删；检查 owner.json 对应进程和运行记录。更新在包目录之外的执行器中完成，预取精确 tarball 并核对 integrity，安装 hook/可选原生依赖禁用，最后实际启动新入口核验。失败证据目录只保存在本机，避免公开带个人路径的记录。

开发验证：`node --test tests/client-update.test.js tests/npm-client.test.js tests/update-skills.test.js tests/update-package.test.js`。Windows 完整闭环：`node scripts/validate-update-windows.js <新的输出目录>`，使用自建 HTTPS registry、隔离 prefix 和真实 ConPTY，不发布任何包；需要预编译的 native/bin/PtyHost.exe。Windows 通过不等于 Mac 实机已通过。
