# CLI reference

Run `relay help` for root help, `relay help <command>` for one command, and `relay help --all --json` for every command's metadata. Help works offline.

## Session commands

```sh
relay up [-d] [--name NAME] [--config FILE] [--port PORT] [--desktop xfce|none|COMMAND]
         [--display :N] [--public HTTPS_URL] [--tls-cert FILE --tls-key FILE]
         [--bind ADDRESS] [--timeout SECONDS]
relay down [--name NAME]
relay status [--name NAME] [--url URL] [--token-file FILE] [--timeout SECONDS] [--show-token]
relay logs [component] [--name NAME] [-f|--follow]
relay run -- <app> [args]... [--name NAME] [--restart]
```

- `up` starts Xvfb, the desktop and the engine, waits until ready, then supervises. Without `-d` it runs in the foreground and the first Ctrl+C stops the session (exit 130). Piped, it prints only the viewer URL. `--public` advertises an HTTPS origin and expects a TLS proxy unless `--tls-cert` is set. `--display` attaches to an existing display and keeps the caller's environment.
- `down` stops the session and everything it started; safe to repeat. Its JSON outcome is `stopped` or `unchanged`.
- `status` with no URL reads the local session and exits 0 for any existing session. With `--url` (or `RELAY_URL`) it queries a remote engine. A missing session is `not_running`, exit 1.
- `logs` prints the last 200 lines of one component (`display`, `dbus`, `desktop`, `engine`, `apps`) or of every component log. `-f` follows; it cannot be combined with `--json`.
- `run` starts an app on the session desktop and returns its pid. It shares the desktop's display, D-Bus session bus, runtime, config and cache directories, and X authority, and clears ambient capabilities. `--restart` restarts the app until the session stops. App output goes to `relay logs apps`.

## Control commands

```sh
relay screenshot [file] [--url URL] [--token-file FILE] [--timeout SECONDS]
relay click <x> <y> [--button left|middle|right]
relay move <x> <y>
relay scroll <x> <y> [--dx NUMBER] [--dy NUMBER]
relay key <combo>...
relay type <text>
relay type --stdin
relay input <json>
relay input --stdin
```

- Coordinates are fractions of the screen from `0` to `1`, from the top-left.
- `screenshot` writes `screen.png` by default; `-` writes PNG bytes to stdout (not with `--json`).
- `click` defaults to the left button. `move` only moves the pointer.
- `scroll` needs a nonzero `--dx` or `--dy`; positive `dy` scrolls down, positive `dx` right.
- `key` presses each physical combo in order: `ctrl+l`, `Enter`, `alt+Tab`, `cmd+shift+t`. `cmd`, `meta` and `win` alias `super`.
- `type` sends text events, one per Unicode scalar value, so the remote layout decides each character. Use `--stdin` to read the text from standard input.
- `input` sends a JSON array of 1 to 256 SDK input events, for example `relay input '[{"type":"keyDown","key":4},{"type":"keyUp","key":4}]'`.

## Skills

```sh
relay skills list
relay skills get <name> [--full] [--json]
relay skills path [name]
```

`list` is the default and leaves out hidden skills. `get` prints a skill workflow, including a hidden one asked for by name; `--full` appends its `references/` and `templates/`. `path` prints the skills directory or one skill's directory. An unknown skill is `not_found` (exit 1).

## Global options

At any position: `-h`/`--help`, `-v`/`--version` (prints only the version, `0.1.0`), `--json`, `--no-color`, `--name NAME`. `--` ends option parsing. Booleans accept `--no-<name>`. Short options are only `-h`, `-v`, `-f` and `-d` (`up -d`).

## Output

Queries print data on stdout. Mutations write receipts and next steps on stderr; piped, `up` prints the viewer URL, `screenshot` prints the saved path, and input commands print nothing. Receipts use `✓`, `!` and `✗` on a TTY and plain words otherwise.

With `--json`, success is one document on stdout and stderr stays empty; failure is one compact document on stderr and stdout stays empty:

```json
{"status":"error","reason":"unreachable","message":"Couldn't reach 127.0.0.1:1. Connection refused.","next":[{"command":"relay status --url http://127.0.0.1:1","argv":["relay","status","--url","http://127.0.0.1:1"]}]}
```

`next[].command` is the full command line; `next[].argv` starts with `relay`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success, including `status` of any existing session. |
| 1 | Runtime, network, permission, config or missing-session failure. |
| 2 | Usage error, invalid value or missing input. |
| 130 | Interrupted with Ctrl+C. |
| 128+n | Terminated by signal n. |

## Client target

Client commands take `--url`, `--token-file` and `--timeout` (seconds, default 10). The target is `--url`, else `RELAY_URL`, else the ready local session named by `--name`, else `http://127.0.0.1:8080` when no session was explicitly selected. A URL is an origin only; plain HTTP is allowed only for `localhost` and `127.0.0.1`, and remote hosts need HTTPS plus a 64-character token. Redirects are refused.

When a connection fails, the message names the cause: `Connection refused.`, `The host name did not resolve.`, `The request timed out.` or `The TLS certificate was rejected.` An unreachable `--url` suggests checking the address and `relay status --url <URL>`; a missing local session suggests `relay up -d`.
