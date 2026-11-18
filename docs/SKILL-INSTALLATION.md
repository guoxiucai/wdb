# 安装 WDB CLI 与 Agent Skill

安装器可在 macOS 或 Windows 上执行，支持 **共享安装、Claude Code、Cursor** 三个选项。它安装 WDB 客户端和 Skill。Windows 服务端、Node/npm 和 Agent 本身需另行安装。最低 Node.js 22，推荐 Node 24 LTS。

## 一行安装

macOS（需要 curl 和 bash）：

```sh
curl -fsSL https://raw.githubusercontent.com/guoxiucai/wdb/main/install.sh | bash
```

Windows PowerShell（兼容 5.1）：

```powershell
irm https://raw.githubusercontent.com/guoxiucai/wdb/main/install.ps1 | iex
```

在终端输入一个或多个编号，例如 `1,3` 选择共享安装和 Cursor。接着选择用户级或项目级，项目级可指定目录。macOS 管道执行时从终端读取选择。无交互终端时使用下方参数方式。

脚本会检查 `wdb --version --json`：已有可用 CLI 就复用，否则执行 `npm install -g @tsingwill/wdb`，随后确认命令可运行。不自动升级正常工作的 CLI，不使用 sudo、不修改全局 PATH 或 PowerShell 执行策略。若 Node/npm 缺失或全局 npm 目录不可写，会给出错误；先按自己的 Node 环境管理方式解决后重试。npm 安装后若入口尚不在 PATH，配置 npm 全局命令目录、重新打开终端再运行。

## 安装位置

| Agent | 用户级：对该用户的所有项目生效 | 项目级：仅指定项目 |
| --- | --- | --- |
| 共享安装 | `~/.agents/skills/wdb/` | `<项目>/.agents/skills/wdb/` |
| Claude Code | `~/.claude/skills/wdb/` | `<项目>/.claude/skills/wdb/` |
| Cursor | `~/.cursor/skills/wdb/` | `<项目>/.cursor/skills/wdb/` |

共享目录供 Codex、GitHub Copilot（CLI 和 VS Code）、Gemini CLI、OpenCode、Grok Build CLI、DeepSeek Harness 官方桌面版、Qwen Code、Kimi Code CLI 和 Qoder CN IDE 的兼容版本复用。已通过 Codex 选项安装的用户可以继续使用原目录。[Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) · [VS Code](https://code.visualstudio.com/docs/agent-customization/migrate-customizations) · [Gemini CLI](https://geminicli.com/docs/cli/skills/) · [OpenCode](https://opencode.ai/docs/skills/) · [Grok Build](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.zh.md) · [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/) · [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) · [Qoder CN](https://docs.qoder.cn/qoder/skills) · [Qoder CN IDE](https://docs.qoder.cn/user-guide/skills)

本地 Cursor 也可以使用共享目录。需要从 Cursor 同步个人 Skill 时，使用 Cursor 用户级目录并在 Cursor 中开启同步。TRAE 中国版可使用项目级共享目录，需在「设置 → 技能与命令 → 导入设置」开启 `.agents` 技能目录。[Cursor](https://prod.cursor.com/help/customization/skills) · [TRAE 中国版](https://docs.trae.cn/ide_skills)

Windows 的 `~` 表示当前用户主目录，通常为 `%USERPROFILE%`。项目目录必须已经存在，脚本会显示实际写入位置。项目级安装可由项目自行决定是否纳入版本控制。

安装的是完整 `skills/wdb/`，包括 `SKILL.md` 和所有参考文件，不要求用户克隆仓库，也不依赖仓库 `docs/`。安装成功后新开目标 Agent 会话；可直接请求“连接这台 Windows 并检查应用”，提供设备地址。首次 WDB 连接仍需 Windows 操作者点击同意，安装器不会代替授权或扫描设备。

## 指定参数

在 macOS 安装用户级共享 Skill：

```sh
curl -fsSL https://raw.githubusercontent.com/guoxiucai/wdb/main/install.sh | bash -s -- --agent shared --scope user
```

在现有项目同时安装共享 Skill 和 Cursor Skill：

```sh
curl -fsSL https://raw.githubusercontent.com/guoxiucai/wdb/main/install.sh | bash -s -- --agent shared,cursor --scope project --project "$PWD"
```

PowerShell 可将下载内容作为带参数的脚本块执行：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/guoxiucai/wdb/main/install.ps1))) -Agent shared,cursor -Scope project -Project (Get-Location).Path
```

也可先下载根目录的 `install.sh` / `install.ps1`，审阅后本地运行。PowerShell 本地脚本如受执行策略限制，按组织允许的方式执行，不必全局放开策略。

| 用途 | bash 参数 | PowerShell 参数 |
| --- | --- | --- |
| Agent | `--agent shared,claude,cursor`（可多选，也可重复传入） | `-Agent shared,claude,cursor`（可多选） |
| 安装范围 | `--scope user/project` | `-Scope user/project` |
| 已存在的项目目录 | `--project <目录>` | `-Project <目录>` |
| 替换已有 Skill，不再询问 | `--yes` | `-Yes` |

没有提供 agent/scope 时会交互询问。旧参数 `codex` 等同于 `shared`，`both` 等同于 `shared,claude`。显式选择项目级但省略项目路径时，使用当前目录。自动化中应同时提供 Agent、scope，以及需要替换时的 yes。

## 下载、更新与失败处理

- 两个入口下载本仓库 `main` 上的共享安装程序。可定位新版 npm CLI 时，优先使用该包内的 Skill 和 hash 清单；否则使用仓库清单固定的 Git 提交并提示兼容性未与 CLI 版本绑定。显式 --ref 使用所选仓库资源。无需 GitHub API、账号或 token，不下载整个仓库或大体积 server EXE。
- `raw.githubusercontent.com` 必须可达。网络错误、缺少资源或哈希不符时失败，不写入不完整 Skill；已有 CLI 的安装与 Skill 写入是独立步骤。
- 单个 Skill 先写临时目录，再切换目标目录。拒绝替换符号链接或非目录目标。并发安装锁存在时不要强制删除；先确认没有其他安装进程。
- 已有 `wdb` Skill 时询问是否替换。确认后，旧目录保存在对应 Agent 目录下的 `wdb-skill-backups/wdb-<时间>-<标识>/`，**不在 `skills/` 搜索目录里**，避免重复发现。`--yes` / `-Yes` 仍会保留备份。
- 多选时每个目录分别安装。若其中一个失败，已完成的安装仍会保留，修复原因后可重试失败的选项。
- 安装成功后在客户端配置目录的 skill-installs.json 登记目标及 hash（WDB_CONFIG 可指定独立目录）。支持该功能的客户端可用 `wdb update` 一次确认更新 CLI 与已登记 Skill；`--check --json` 只检查。Skill 本地修改、未登记目录及备份规则见[更新指南](UPDATING.md)。也可重跑本安装脚本，明确确认替换并保留备份；npm 手动升级本身不会同步已复制的 Skill。

## 手动安装

复制整个 [`skills/wdb`](../skills/wdb) 到上表目标路径；不要只复制 `SKILL.md`。需要 CLI 时执行：

```sh
npm install -g @tsingwill/wdb
wdb --version
```

只安装一次适合你的用户级或项目级 Skill 即可；同名 Skill 在多个层级并存时，按 Agent 自身的发现与优先级规则处理。安装 Skill 不保证每次任务都触发它；可显式引用 WDB Skill，并检查 Agent 是否读到了完整参考文件。

## 维护安装清单

维护者修改 `skills/wdb/` 后，先提交 Skill 变更，再运行 `node scripts/build-skill-manifest.js`，提交更新后的 `scripts/skill-install-manifest.json`。清单固定到已经存在的源码提交，使用 Git 中的文件内容计算哈希，不受 Windows checkout 的 CRLF 转换影响。它不需要在仅修改安装器或其他文档时重建。新增 Skill 资源也必须更新清单。

安装器回归：`node --test tests/skill-install.test.js tests/npm-package.test.js`。macOS 的管道交互退出回归使用 Python 3 标准库分配 PTY；Python 仅用于开发测试，安装器本身只依赖 Node/npm。Windows PowerShell 5.1 入口还需在 Windows 原生环境单独验收。
