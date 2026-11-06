---
name: wdb
description: Use the Windows Debug Bridge CLI to deploy and validate Windows applications, query accessible controls, operate the interactive desktop, and retrieve screenshots, recordings, and logs. Applies when wdb is available; does not provide Android adb control.
---

Use `wdb` (or the project/package `bin\wdb.cmd`) as the Windows device entry point. This build first validates Windows localhost; do not claim macOS, LAN, physical touch hardware, or real application acceptance from local fixture results.

1. Read `wdb --help`, `wdb devices --json`, and `wdb info --json` for the installed version, target, capabilities, and desktop status. With multiple devices, pass `--device <address|deviceId>`. First pairing needs the locally obtained server certificate SHA-256 fingerprint and pairing code. Do not accept a changed fingerprint automatically. Reuse saved credentials with `wdb connect <address>`.
2. Obtain `windows list`, then `ui tree` / `ui find` on the intended full window identifier. Use accessible controls when exposed. If multiple windows or controls match, inspect candidates and refine the target. GUI requires a logged-in, unlocked interactive desktop; report `DESKTOP_UNAVAILABLE` instead of trying to unlock or operate the secure desktop.
3. Choose the intended interaction path. `ui action` with `method: "uia"` directly invokes a control pattern; `method: "input", action: "click"` injects a mouse click at its bounds. Use `mouse`, `key`, or `text` when testing actual input. Text defaults to Unicode injection; keyboard/IME composition is a separate path. Preserve complete returned window IDs and `reference` objects. On `STALE_WINDOW` / `STALE_CONTROL`, observe again and locate a new reference.
4. After an action, read actual control/window state or wait for an expected state. Take a screenshot for visual fallback when controls are absent or insufficient. Screenshot artifacts include original dimensions, bounds, coordinate mapping, and display `layoutId`; map thumbnail points back to physical virtual-desktop coordinates. Pass `layoutId` for coordinate-sensitive actions. On `DISPLAY_CHANGED`, obtain fresh screen information and observations.
5. Retrieve artifact files with `pull`. CLI JSON is evidence of execution, not proof the business workflow or every pen stroke succeeded. Inspect screenshots, recording content, application logs, and exposed control state before judging the result.

Use `--json` for machine parsing and `--args-file <path>` for structured arguments, touch trajectories, or difficult shell quoting. Successful task submission is `accepted` / `running`; the final task result is obtained by automatic waiting or `task get|wait <id>`. Preserve request/task IDs, device IDs, errors, and artifact paths in validation records.

Timeouts and network failures can occur after a side effect. Query the task and observe state before deciding whether to retry; do not automatically repeat install, click, or touch. `--wait-timeout` only limits client waiting, while `--timeout` requests a server execution limit. `disconnect` preserves authorization and is distinct from `clients revoke` and `task cancel`.

Long shell and deployment tasks continue across disconnects and can be queried after reconnect. Input tasks require the controlling CLI heartbeat; keep the CLI waiting until completion. They cancel and release held input on cancellation or control loss. Recordings run to a configured duration limit. File interruption fails that transfer and cleans its partial file; restart the transfer. Services restarting leave uncertain tasks interrupted/unknown rather than replaying them.

Use `shell` with the default logged-in identity; specify `--admin` only for an operation needing administrative execution within the user's authorized task. Use `app launch` for GUI programs. Provide user-supplied installer identifiers and silent parameters; do not guess EXE silent flags or reboot automatically. Report manual intervention when a secure desktop or additional credentials are required.

Inspect `app list` scope before deployment. Use `--scope user` without `--admin` for per-user installers/uninstallers; use explicit `--admin` for machine deployment. Keep the exact application ID and observe registry/version/file state after execution; installer exit code alone does not prove replacement or removal.

File operations default to no overwrite; use `--overwrite` only when replacement is intended. Checksums and transport success do not prove an installer or application behaved correctly. Touch trajectories use true Windows touch injection, up to 10 active contacts; assess delivered input statistics separately from application rendering and stroke completeness.

For command examples, schemas, credential locations, and file/coordinate semantics read the package's `docs/CLI.md` if available. Use `call <operation> --args-file <path>` for capabilities without a convenient command alias. Keep pairing codes and client tokens out of logs, generated scripts, commits, and shared reports.
