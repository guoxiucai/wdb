---
name: wdb
description: Install and use WDB (Windows Debug Bridge) to debug local or remote Windows devices from Windows/macOS. Use for Windows application troubleshooting, remote scripts, deployment, desktop/input automation, screenshots, recordings, logs, interactive shell and TCP forwarding, including Electron/Flutter debugging. Applies even when the CLI is not yet installed; excludes Android adb and Windows-only source editing without device interaction.
---

# WDB Windows debugging

## Activate and prepare

When the user asks to debug or operate a Windows device, use this skill automatically; they do not need to mention WDB or invoke the skill by name. Prefer WDB for supported remote commands, transfers and desktop debugging. Respect an explicitly requested alternative. Installing this skill does not itself install the CLI or Windows server, and does not authorize unrelated device operations.

Check `node --version`, `npm --version`, `wdb --version`, and the selected executable (`command -v wdb` on macOS; `where.exe wdb` on Windows). If the CLI is absent, install the published package and verify it:

```sh
npm install -g @tsingwill/wdb
wdb --version
wdb --help
```

Use Node >=22.0.0; recommend Node 24 LTS. The npm package is shared by Windows/macOS and does not bundle Node or install the server. Do not require `--omit=optional` or `--ignore-scripts` for ordinary installation. Windows PowerShell can use `wdb.cmd` when `.ps1` execution is restricted. A Windows server installation may already provide a working `wdb` launcher; reuse it. Do not upgrade a working CLI or replace PATH entries just to invoke the skill.

If global npm installation is denied, use a writable prefix (`npm install -g --prefix <local-prefix> @tsingwill/wdb`) and invoke `<local-prefix>/bin/wdb` on macOS or `<local-prefix>\wdb.cmd` on Windows. Do not silently use sudo, change execution policy or install a system-wide Node runtime. If Node/npm is missing, explain the prerequisite and use the user's environment setup method.

When the user requests CLI/Skill maintenance, use `wdb update --check --json` to inspect the actual npm installation. `--yes` requires the user's update authorization; do not add it just to bypass a prompt or as a debugging prerequisite. Version-matched Skill sync, conflicts and recovery are described in [references/update.md](references/update.md).

Read [references/commands.md](references/commands.md) to choose a command family and [references/cli.md](references/cli.md) for arguments, examples and result semantics. Connection guidance is in [references/connection.md](references/connection.md). Electron, Flutter and streaming details are bundled alongside these references and loaded only when relevant. All paths are relative to this Skill directory; no source checkout or npm-package documentation lookup is required. Compare commands with the installed `wdb --help` and target capabilities before use.

## Connect and choose the task path

Use the server address provided by the user, or an unambiguous saved device from `wdb devices --json`. Ask for the address only when neither is available; do not scan the LAN. Run `wdb connect <address>` when a connection is needed, then `wdb --device <address> info --json`. First approval requires the Windows operator's consent; report the pending dialog and continue after their decision, without asking for pairing codes. The CLI saves first-use certificate trust after approval; a changed saved fingerprint requires verification, never automatic acceptance. If the server is absent, direct the operator to the Windows installers at https://github.com/guoxiucai/wdb/releases/latest; npm installs only the client.

Use the smallest relevant capability: shell/logs for process or service diagnosis, push/app for deployment, UIA/CDP/Flutter/visual tools for desktop applications, and forward/reverse for local TCP access. Run supported inspection and verification steps within the user's task without requiring the user to repeat CLI commands manually. Do not perform every category as a mandatory smoke test. Keep an explicit `--device` selector on remote operations, especially `clients list/revoke`, which otherwise manage the local installed Windows service when available.

## Desktop observation and verification

For desktop tasks:

1. Obtain `windows list`, then `ui tree` / `ui find` on the intended full window identifier. Use accessible controls when exposed. If multiple windows or controls match, inspect candidates and refine the target. GUI requires a logged-in, unlocked interactive desktop; report `DESKTOP_UNAVAILABLE` instead of trying to unlock or operate the secure desktop.
2. Choose the intended interaction path. `ui action` with `method: "uia"` directly invokes a control pattern; `method: "input", action: "click"` injects a mouse click at its bounds. Use `mouse`, `key`, or `text` when testing actual input. Text defaults to Unicode injection; keyboard/IME composition is a separate path. Preserve complete returned window IDs and `reference` objects. On `STALE_WINDOW` / `STALE_CONTROL`, observe again and locate a new reference.
3. After an action, read actual control/window state or wait for an expected state. Take a screenshot for visual fallback when controls are absent or insufficient. Screenshot artifacts include original dimensions, bounds, coordinate mapping, and display `layoutId`; map thumbnail points back to physical virtual-desktop coordinates. Pass `layoutId` for coordinate-sensitive actions. On `DISPLAY_CHANGED`, obtain fresh screen information and observations.
4. Retrieve artifact files with `pull`. CLI JSON is evidence of execution, not proof the business workflow or every pen stroke succeeded. Inspect screenshots, recording content, application logs, and exposed control state before judging the result.

## Results, paths and failures

Use `--json` for machine parsing and `--args-file <path>` for structured arguments, touch trajectories, or difficult shell quoting. Successful task submission is `accepted` / `running`; the final task result is obtained by automatic waiting or `task get|wait <id>`. Waiting uses SSE when advertised, with bounded polling fallback on older services. `--follow` streams existing stdout to stderr; ordinary JSON stdout remains a single result. Recover an interrupted stream on the same task, never by resubmitting it. Preserve request/task IDs, device IDs, errors, and artifact paths in validation records.

On macOS, argument/script/expression files and pull destinations are local Mac paths; JSON `path`/`cwd`, shell commands, CDP endpoints, and VM Service endpoints refer to Windows. Quote PowerShell with single quotes to prevent zsh expansion. Pull screenshots before viewing and retain Windows physical coordinates without Mac Retina scaling. Ctrl+C ends watch/follow; interrupting an ordinary task waiter does not cancel its server task. Use `task cancel` explicitly.

## Application debugging

For Electron, read [references/electron.md](references/electron.md). Use `electron launch` with the observed application path and an unused local debugging port, or `electron targets` against an already enabled endpoint. The endpoint is local to the **server**, not the CLI. Select the exact returned page ID and Windows window ID; do not assume they are interchangeable. Single-instance apps may need a normal exit and relaunch before debugging flags apply. `cdpAvailable:false` does not prove a usable CDP session.

Use `electron observe` to combine DOM, UIA and screenshot evidence. Prefer CDP selectors or exact labels for web controls and UIA references for native controls. `electron action --backend auto` only falls back for confirmed pre-action lookup/unavailability failures; visual fallback requires explicitly supplied observed coordinates. After `ACTION_OUTCOME_UNKNOWN`, timeout, or an ambiguous target, reobserve rather than repeating or changing backend automatically. Keep CDP CSS viewport coordinates separate from physical desktop coordinates and screenshot pixels. A successful CDP action does not prove UIA or Windows input compatibility. `electron eval` can change the page; use it within the intended debugging scope, and use `wait`/state reads to confirm effects. Console capture is bounded to the requested interval. Self-authored temporary DOM panels test the mechanism, not the application's business workflow.

`devices` shows live state, hostname, address and persistent device ID. `enabled` is local selection permission; `connected` is the current probe result. Use `devices --watch` for recovery monitoring. Hostnames can collide; use address or device ID when ambiguous. Commands automatically reconnect for up to 60 seconds by default (`--reconnect-timeout`), and supported task submissions recover the same persisted task by submission ID. This does not authorize replaying an action after `REQUEST_OUTCOME_UNKNOWN` or `SERVICE_RESTARTED`. Explicit disconnect hides the device until connect and retains credentials for remembered authorization; certificate, identity and authorization failures require resolution rather than automatic pairing.

For Flutter, read [references/flutter.md](references/flutter.md). Use the observed Dart VM Service URI, preserving its authentication path in a private args file; it is not the DevTools browser URL. Bind the full window ID to the VM PID and select an exact isolate when ambiguous. `flutter info` probes actual extensions; an unreachable endpoint does not prove a Release build. `flutter observe` continues with UIA and screenshots when the protocol is unavailable. Inspector reads widget diagnostics, while `flutter action` uses UIA or explicitly observed visual coordinates. Use creation locations and an `ancestor` selector to disambiguate repeated widget types. A widget's presence does not prove visibility: confirm relevant properties or screenshots. `flutter wait --property ... --value ...` compares diagnostic descriptions. Do not reuse snapshot paths or temporary Inspector handles as stable controls. Check `truncated` and `cleanup`; do not infer absence or uniqueness from a truncated tree. Profile/Release may lack Inspector. Memory snapshots are not CPU profiling, and a VM connection does not imply a complete Dart evaluator. Keep auth URIs and application logs out of shared reports.

## Tasks, terminal and deployment

Timeouts and network failures can occur after a side effect. Query the task and observe state before deciding whether to retry; do not automatically repeat install, click, or touch. `--wait-timeout` only limits client waiting, while `--timeout` requests a server execution limit. `disconnect` preserves authorization and is distinct from `clients revoke` and `task cancel`.

Long shell and deployment tasks continue across disconnects and can be queried after reconnect. Input tasks require the controlling CLI heartbeat; keep the CLI waiting until completion. They cancel and release held input on cancellation or control loss. Recordings run to a configured duration limit. File interruption fails that transfer and cleans its partial file; restart the transfer. Services restarting leave uncertain tasks interrupted/unknown rather than replaying them.

Use `shell --script` or `--script-file` for automation tasks. Bare `shell` is a persistent interactive terminal and requires TTY stdin/stdout; Ctrl+C goes to the remote program, Ctrl+] closes locally. Use the installed CLI help and [command index](references/commands.md) for terminal and `forward` / `reverse` options; read [references/streaming.md](references/streaming.md) for lifecycle details. These streaming commands remain in the foreground and never reconnect or replay after failure; inspect state before starting a replacement. Forward/reverse accept only literal loopback TCP endpoints; `--json` reports NDJSON lifecycle events. Their leases are separate from GUI input ownership. Windows has the native ConPTY host; Mac terminal behavior requires separate real-machine verification.

Use `shell` with the default logged-in identity; specify `--admin` only for an operation needing administrative execution within the user's authorized task. Use `app launch` for GUI programs. Provide user-supplied installer identifiers and silent parameters; do not guess EXE silent flags or reboot automatically. Report manual intervention when a secure desktop or additional credentials are required.

Inspect `app list` scope before deployment. Use `--scope user` without `--admin` for per-user installers/uninstallers; use explicit `--admin` for machine deployment. Keep the exact application ID and observe registry/version/file state after execution; installer exit code alone does not prove replacement or removal.

File operations default to no overwrite; use `--overwrite` only when replacement is intended. Checksums and transport success do not prove an installer or application behaved correctly. Touch trajectories use true Windows touch injection, up to 10 active contacts; assess delivered input statistics separately from application rendering and stroke completeness.

For multi-finger failures, verify foreground state and `call windows.hitTest` at contact coordinates before attributing the failure to injection. Windows 11's **Bluetooth & devices > Touch > Three- and four-finger touch gestures** can consume application input even on a machine without a physical touch screen. If one/two fingers work but three or more do not, inspect this setting (`ms-settings:devices-touch`). For an authorized diagnostic comparison, record its original state, temporarily disable it, verify actual application events/strokes, and restore it afterward unless the user requested a lasting change. UIA controls supporting Toggle expose `toggleState`; observe before toggling and after restoration. The touch command does not change system preferences itself.

For command examples, schemas, credential locations, and file/coordinate semantics read [references/cli.md](references/cli.md). Use `call <operation> --args-file <path>` for capabilities without a convenient command alias. Keep pairing codes and client tokens out of logs, generated scripts, commits, and shared reports.
