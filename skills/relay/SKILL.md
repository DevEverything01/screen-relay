---
name: relay
description: Start a streamed Linux X11 desktop and control it with the relay CLI (screenshot, click, type, key). Use when an agent needs to see and operate a GUI on a Linux VM, sandbox or container.
---

# relay

Streams a Linux X11 desktop to a browser and lets you control it from the CLI.

## Setup

On a Debian/Ubuntu machine with Node 20 or newer, from the repo:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
relay up -d
relay status --json
```

`up -d` returns once the engine and desktop are ready. `status --json` gives `session.state` (`ready` when up), `session.running`, `session.url` and `session.display`. It exits 0 for any existing session, including stopped or failed sessions; inspect the state rather than the exit code. A missing session exits 1. Run `relay doctor` if anything fails. Do not use `xhost +` or delete X lock files. To use an existing display: `relay up -d --display :0`.

In the Docker image the session is already running; prefix commands with `docker exec <container>`.

## Operate

```sh
relay screenshot screen.png
relay click 0.5 0.5
relay type "hello"
relay key ctrl+l Enter
relay scroll 0.5 0.5 --dy 3
```

- Coordinates are 0 to 1 from the top-left.
- Take a screenshot, act, then take another to confirm. Success means the engine applied the input, not that the app reacted.
- Add `--json` to parse output. Input commands print `{"input":{"events":1},"outcome":"sent"}` with the applied event count. Screenshots return `{"screenshot":{"path":"screen.png","width":1280,"height":720,"bytes":12345},"outcome":"saved"}`.
- Successful JSON commands write one document on stdout and leave stderr empty. Human receipts and next commands go to stderr. Piped input commands leave stdout empty; a piped screenshot prints only its saved path.
- `type` sends text events, so the remote keyboard layout decides each character; `key` combos stay physical keys.
- A long `type` is sent in batches of at most 256 events. If it fails partway, the JSON error has `data.applied`; do not resend the whole text blindly.

## Remote use

Behind an HTTPS proxy: `relay up -d --public https://<HOST>`. Piped `up` writes the viewer URL, including its `#token=` fragment. Treat that URL as a secret and share it only through the user's secret channel. From another machine, set `RELAY_URL` and `RELAY_TOKEN_FILE`. Explicit options override these variables. See `docs/remote-access.md`.

## Start apps

Start apps with `relay run -- APP [ARGS...]`, not from another shell: it shares the desktop's display, D-Bus session bus (so accessibility clients can find the app), runtime, config and cache directories, and ICE authority, and drops inherited ambient capabilities. Attach mode (`up --display :N`) keeps the caller's session environment. Add `--restart` to restart the app after it exits until `relay down`; retries back off from 1 to 30 seconds and reset after 60 seconds of uptime. The returned pid belongs to the first app process and changes on restart. Output and restarts: `relay logs apps`.

## Stop

```sh
relay down
```

## Errors

With `--json`, failures leave stdout empty and write one compact document on stderr: `{"status":"error","reason":"busy","message":"A controller already holds control"}`. `status` can be `action_required` when input can unblock work before any effect. Optional `data` carries context such as `component`, `log`, `logs` or `applied`; optional `next` contains `{command, argv}` recovery commands. Match `reason`, not the former `error.code`.

Exit codes: 0 success (including any existing session's status), 1 runtime failure, 2 usage or missing-input error, 130 interrupted, 128+n for signal n. Foreground `up` stops its session on Ctrl+C and exits 130. Full list: `docs/cli.md#error-codes`.

Help works offline: `relay help <COMMAND>` or `relay <COMMAND> --help`. Add `--json` for command metadata, or use `relay help --all --json` for every command. Global options include `--name <NAME>`, `--json`, `--no-color`, `-h`/`--help` and `-v`/`--version` at any position. `up -d` keeps meaning `--detach`.

| Code | Meaning |
| --- | --- |
| `invalid_input` | Invalid argument, JSON, input event, key combo, port, session name, URL, public origin, TLS or token file; also an invalid engine input batch (HTTP 400/413). |
| `invalid_option`, `unknown_command`, `missing_input` | Unknown option or command, or required input missing (exit 2). |
| `unauthorized` | Token missing or wrong (HTTP 401). |
| `forbidden` | Host or Origin rejected (HTTP 403). |
| `unsupported_input` | The backend cannot produce a character or apply the requested input (HTTP 422). |
| `busy` | A viewer or SDK session holds control (HTTP 409), or a screenshot is already running (HTTP 503). Never retried. |
| `unreachable` | Cannot connect to the URL. |
| `timeout` | No reply within `--timeout`, or `up` did not become ready in time (`component` and `log` set). |
| `not_running` | No session or logs with that name. |
| `not_found` | `run` found no running session with that name. |
| `missing_command` | `run` was given no app (exit 2). |
| `spawn_failed` | `run` could not start the app. |
| `already_running` | A session with that name is already running. |
| `component_failed` | display, desktop, engine or the background supervisor exited or could not start, including an app started with `run` that exited at once. `component` and `log` are set. |
| `missing_dependency` | A required host program or the engine binary is missing. A failed app spawn uses `spawn_failed`. |
| `unsupported_platform` | `up`, `down` or `run` was run off Linux. |
| `invalid_config` | Invalid configuration; the message names the file and key path. |
| `internal` | Unexpected engine response or a CLI bug. |

Fixes: `busy`, ask the user to close the viewer, then retry. `unauthorized`, pass `--token-file` or set `RELAY_TOKEN_FILE`. `unreachable`, check `relay status` and the URL. `component_failed` or `timeout` from `up`, read `relay logs <component>` and run `relay doctor`.

Limits: X11 only, resolution set in the config up to 1920x1080, one controller, no audio or clipboard.
