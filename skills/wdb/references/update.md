# Client and Skill updates

Use this workflow when the user requests maintenance, not as a prerequisite for ordinary Windows debugging. First inspect `wdb --help` and the actual entry (`where.exe wdb` / `command -v wdb`); old releases may not have update.

`wdb update --check --json` is read-only and needs no device connection. `wdb update` displays the npm candidate, installation and Skill paths, then asks `[y/N]`; default/EOF/Ctrl+C cancels. `--json` alone also checks only. `--yes` is explicit consent for automation and requires authorization from the user for this update. Do not combine --check and --yes. `--no-skill` updates only the CLI.

Updates support the current official npm global installation, including a validated custom prefix. Windows server-bundled wdb.exe, source/private/local/npx/portable entries are not npm self-update targets. Do not rewrite PATH, elevate or install another global copy to manufacture success. Node, Windows server/helper and pairing credentials are unchanged.

Registered Codex/Claude user/project Skills are synchronized from that exact CLI package snapshot. New installers record their targets and file hashes in the client configuration directory; --config/WDB_CONFIG select an isolated registry. CLI already current can still repair an older managed Skill. Unknown projects are not scanned. Legacy unregistered folders need explicit interactive adoption or rerunning the installer; --yes does not adopt them.

Local file changes are preserved and reported, even with --yes. Replacing via the installer requires explicit consent and retains a backup outside skills discovery. Updates do not hot-reload the current Agent session; start a new session after synchronization.

Read state and each skills result, not just the installed version: updated_with_skill_errors exits nonzero even if CLI advanced. A failed npm install is not a guaranteed rollback; inspect actualVersion, the exact target entry and recoveryDirectory before retrying. Do not automatically replay a partially completed update or delete a lock without verifying its owner.
