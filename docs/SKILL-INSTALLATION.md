# 安装 WDB CLI 与 Agent Skill

安装器一期支持 **Claude Code、Codex**，可在 macOS 或 Windows 上执行。它只安装客户端和 Skill；Windows 服务端、Node/npm 和 Agent 本身需另行安装。最低 Node.js 22，推荐 Node 24 LTS。

## 一行安装

macOS（需要 curl 和 bash）：

```sh
curl -fsSL https://raw.githubusercontent.com/guoxiucai/wdb/main/install.sh | bash
```

Windows PowerShell（兼容 5.1）：

```powershell
irm https://raw.githubusercontent.com/guoxiucai/wdb/main/install.ps1 | iex
```

脚本在终端中引导选择：① Codex、Claude Code 或两者；② 用户级或项目级；③ 项目目录（如适用）。macOS 管道执行时从终端读取选择，不会把下载脚本流当成答案。无交互终端时使用下方参数方式。

脚本会检查 `wdb --version --json`：已有可用 CLI 就复用，否则执行 `npm install -g @tsingwill/wdb`，随后确认命令可运行。不自动升级正常工作的 CLI，不使用 sudo、不修改全局 PATH 或 PowerShell 执行策略。若 Node/npm 缺失或全局 npm 目录不可写，会给出错误；先按自己的 Node 环境管理方式解决后重试。npm 安装后若入口尚不在 PATH，配置 npm 全局命令目录、重新打开终端再运行。

## 安装位置

| Agent | 用户级：对该用户的所有项目生效 | 项目级：仅指定项目 |
| --- | --- | --- |
| Codex | `~/.agents/skills/wdb/` | `<项目>/.agents/skills/wdb/` |
| Claude Code | `~/.claude/skills/wdb/` | `<项目>/.claude/skills/wdb/` |

Windows 的 `~` 表示当前用户主目录，通常为 `%USERPROFILE%`。项目目录必须已经存在；脚本会显示实际写入位置。项目级安装可由项目自行决定是否纳入版本控制。安装位置依据 [OpenAI 官方安装目录说明](https://developers.openai.com/api/reference/cli) 和 [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)。

安装的是完整 `skills/wdb/`，包括 `SKILL.md` 和所有参考文件，不要求用户克隆仓库，也不依赖仓库 `docs/`。安装成功后新开目标 Agent 会话；可直接请求“连接这台 Windows 并检查应用”，提供设备地址。首次 WDB 连接仍需 Windows 操作者点击同意，安装器不会代替授权或扫描设备。

## 指定参数

macOS：安装 Codex 用户级 Skill：

```sh
curl -fsSL https://raw.githubusercontent.com/guoxiucai/wdb/main/install.sh | bash -s -- --agent codex --scope user
```

安装到一个现有项目，为两个 Agent 都安装：

```sh
curl -fsSL https://raw.githubusercontent.com/guoxiucai/wdb/main/install.sh | bash -s -- --agent both --scope project --project "$PWD"
```

PowerShell 可将下载内容作为带参数的脚本块执行：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/guoxiucai/wdb/main/install.ps1))) -Agent both -Scope project -Project (Get-Location).Path
```

也可先下载根目录的 `install.sh` / `install.ps1`，审阅后本地运行。PowerShell 本地脚本如受执行策略限制，按组织允许的方式执行，不必全局放开策略。

| 用途 | bash 参数 | PowerShell 参数 |
| --- | --- | --- |
| Agent | `--agent codex/claude/both`（选其一） | `-Agent codex/claude/both`（选其一） |
| 安装范围 | `--scope user/project` | `-Scope user/project` |
| 已存在的项目目录 | `--project <目录>` | `-Project <目录>` |
| 替换已有 Skill，不再询问 | `--yes` | `-Yes` |

没有提供 agent/scope 时会交互询问。显式选择项目级但省略项目路径时，使用当前目录。自动化中应同时提供 Agent、scope，以及需要替换时的 yes；项目级建议明确目录。

## 下载、更新与失败处理

- 两个入口下载本仓库 `main` 上的共享安装程序及文件清单，再从清单固定的提交下载完整 Skill，并按 SHA-256 校验。无需 GitHub API、账号或 token，不下载整个仓库或大体积 server EXE。
- `raw.githubusercontent.com` 必须可达。网络错误、缺少资源或哈希不符时失败，不写入不完整 Skill；已有 CLI 的安装与 Skill 写入是独立步骤。
- 单个 Skill 先写临时目录，再切换目标目录。拒绝替换符号链接或非目录目标。并发安装锁存在时不要强制删除；先确认没有其他安装进程。
- 已有 `wdb` Skill 时询问是否替换。确认后，旧目录保存在对应 Agent 目录下的 `wdb-skill-backups/wdb-<时间>-<标识>/`，**不在 `skills/` 搜索目录里**，避免重复发现。`--yes` / `-Yes` 仍会保留备份。
- 两个 Agent 的目录分别安装；若其中一个失败，查看输出，已完成的安装会保留，修复原因后重试。不会清空其他 Skill，也不修改 WDB 配对凭据。
- 更新 Skill 时重跑脚本并确认替换即可。CLI 的显式升级可单独执行 `npm install -g @tsingwill/wdb`。

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
