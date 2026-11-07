# Interactive shell and TCP forwarding

These commands use WSS on the normal WDB HTTPS port. First connect to the supplied Windows address and check `wdb --device <server> info --json` for supported capabilities. Commands stay in the foreground; own their process and stop them when the task ends. Network loss ends the session/rule without reconnection or byte replay.

## Shell

For Agent automation without a terminal, use script mode:

```sh
wdb --device <server> shell --script 'Get-Date; whoami' --json
wdb --device <server> shell --script-file './diagnose.ps1' --json
```

The script file is local; its contents execute in Windows. Script tasks do not preserve variables between calls. A long script can use `--detach` and the returned task ID with `task get`, `task wait`, `task output` or `task cancel`.

For a persistent interactive terminal, allocate a real TTY with the Agent's execution tool:

```sh
wdb --device <server> shell
wdb --device <server> shell --program cmd
wdb --device <server> shell --program pwsh --cwd 'C:\Work'
```

Both stdin and stdout must be TTY. Do not combine interactive shell with `--json`, `--detach`, `--follow` or script arguments. PowerShell is the default; pwsh must be installed on Windows. The default identity is the logged-in user; `--admin` explicitly requests SYSTEM when required and authorized.

Ctrl+C is remote input. Ctrl+] ends the local session; `--escape none` disables that escape if the remote application needs the byte. Window resizing is propagated. After a timeout or disconnect, inspect actual remote state rather than replaying terminal input. If TTY allocation is unavailable, use scripts or explain why the requested interactive program requires a human terminal.

## Forward and reverse

Run a service on the intended target loopback port before starting a rule:

```sh
# Client 9223 → Windows loopback 9222
wdb --device <server> forward tcp:9223 tcp:9222 --json

# Windows loopback 9000 → client loopback 3000
wdb --device <server> reverse tcp:9000 tcp:3000 --json
```

The left endpoint is the listening port; the right is the target port. `tcp:0` requests an automatically allocated listening port; read the actual endpoint from the `ready` event. Forward listens on the client; reverse listens on Windows. Endpoints are loopback TCP only, not arbitrary LAN addresses, UDP or Unix sockets.

`--json` emits lifecycle NDJSON, not a single final JSON result. Wait for `ready` before using the listener, monitor `connection_error`, and treat rule/channel failures as failures even if another exchange succeeded. Keep the process running while the rule is needed. Ctrl+C stops the rule; await exit and verify the listener is released. Rules have independent leases from desktop input ownership.

TCP FIN closes one direction only; the response can arrive after request EOF. Preserve both directions until buffered writes and peer consumption complete. For a debugging check, compare full returned bytes or application responses and observe errors; a successful TCP connect alone proves neither correct forwarding nor application success.
