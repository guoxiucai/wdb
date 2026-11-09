# CLI capability index

Use this index to choose a command family. Read [cli.md](cli.md) for command examples and JSON semantics; [electron.md](electron.md), [flutter.md](flutter.md) and [streaming.md](streaming.md) cover specialized tasks. These files ship with this Skill. Run `wdb --help` to check the installed version; do not guess operation names or parameters.

All remote examples use `wdb --device <server> ...`; `<server>` is the supplied address or returned device ID. Replace placeholders with observed values. Use `--json` for ordinary commands and `--args-file <local.json>` for structured arguments. Bare shell requires a real TTY; forwarding JSON is NDJSON.

| Goal | Command family | Operational choice |
| --- | --- | --- |
| Install / inspect CLI | `npm install -g @tsingwill/wdb`; `wdb --version`; `wdb --help` | Install if absent; inspect the actual executable before changing an existing installation. |
| Connect / select | `connect <address>`; `devices [--watch]`; `info`; `disconnect [address]` | Connect awaits Windows consent. Disconnect hides the device but retains credentials and remembered server authorization; connect reuses them without a new approval when still valid. |
| Manage authorization | `clients list`; `clients revoke <clientId>` | Explicit `--device` targets remote Windows; default can manage a local installed service. Revocation is distinct from disconnect and should be within the requested task. |
| Run scripts | `shell --script <PowerShell>`; `shell --script-file <local.ps1>` | Noninteractive automation; optional `--cwd`, `--env`, `--timeout`, `--detach`. Default logged-in user; explicit `--admin` requests SYSTEM. |
| Track / cancel work | `task list`; `task get\|wait\|output\|cancel\|delete <id>` | Use returned task IDs. `--follow` streams output; query uncertain outcomes before retrying. Cancel explicitly; deleting a record is not cancelling work. |
| Interactive terminal | `shell [--program powershell\|cmd\|pwsh]` | Requires TTY stdin/stdout; Ctrl+C goes remote, Ctrl+] exits locally. Use script mode for Agent automation without TTY. |
| Local TCP access | `forward tcp:<local-port> tcp:<Windows-port>` | Foreground; Windows target is loopback. Stop and await cleanup when the requested use ends. |
| Windows TCP access to client | `reverse tcp:<Windows-port> tcp:<local-port>` | Foreground; client target is loopback. No automatic reconnect or input replay. |
| Upload | `push <local-file-or-directory> <Windows-path>` | SHA-256 verified; add `--overwrite` only for intended replacement. |
| Download | `pull <Windows-file> <local-file>`; `pull <Windows-directory> <local-directory> --recursive` | Download artifacts before opening them locally. Partial directory operations are not atomic. |
| Inspect desktop | `desktop status`; `screens`; `windows list` | Desktop needs logged-in, unlocked user; preserve complete window IDs. |
| Manage windows | `windows focus\|maximize\|minimize\|restore\|move\|resize\|close <id>` | Observe the intended window and supply documented bounds/options. Closing affects the application. |
| Accessible controls | `ui tree\|find\|action\|wait` | Use full returned reference objects; reread stale controls; prefer UIA when exposed. |
| Observe image | `screenshot [remote-output.png] [--window <id>] [--monitor <index>]` | Result is a remote artifact; pull and inspect. Respect physical desktop coordinates and layoutId. |
| Real input | `mouse click\|doubleclick\|drag\|scroll`; `key <chord>`; `text <text>` | Use observed coordinates/focus; Unicode injection differs from IME composition. |
| Touch | `touch --args-file <trajectory.json>` | Up to 10 active contacts; verify application events/rendering, not just injection success. |
| Launch / inspect applications | `app launch <Windows-exe>`; `app list` | GUI launch uses desktop helper. Keep exact IDs and scope returned by the service. |
| Deploy applications | `app install\|update\|uninstall` | Use supplied installer parameters, user vs machine scope and intended elevation; verify installed version/state. Do not guess silent flags. |
| Record desktop | `record start`; `record stop --id <record-task-id>` | Set bounded duration; inspect task result, pull MP4 and verify content. Stop uses the recording task ID. |
| File / event diagnostics | `logs file`; `logs events` | Select documented path/log/time/count; `--follow` is bounded where supported and must be stopped when done. |
| Electron | `electron launch\|targets\|observe\|tree\|find\|action\|wait\|eval\|screenshot\|logs` | Read [electron.md](electron.md); CDP endpoint lives on Windows, page ID is not window ID. |
| Flutter | `flutter info\|isolates\|observe\|tree\|find\|properties\|wait\|logs\|memory\|screenshot\|action` | Read [flutter.md](flutter.md); preserve authenticated VM Service URI privately; extensions depend on app build. |
| Other service operations | `call <operation> --args-file <local.json>` | Only invoke operations documented by the installed client/server. Use this for supported operations without an alias. |

## Minimal task patterns

Script diagnosis (no desktop interaction required):

```sh
wdb connect <server>
wdb --device <server> info --json
wdb --device <server> shell --script 'Get-Date; whoami' --json
```

Desktop observation before choosing UIA/CDP/Flutter/input:

```sh
wdb --device <server> desktop status --json
wdb --device <server> windows list --json
wdb --device <server> ui tree --window '<returned-window-id>' --json
wdb --device <server> screenshot --window '<returned-window-id>' --json
wdb --device <server> pull '<returned-artifact-path>' './screen.png' --json
```

For record duration/FPS, touch schema, app installers, log filters, forwarding endpoint options or framework selectors, consult the bundled references and `wdb --help`. Match options to the installed version; do not assume newer Skill guidance implies an older installed server supports the feature. A terminal command returning success is not proof that a UI or deployment goal succeeded.
