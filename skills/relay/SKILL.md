---
name: relay
description: Start a streamed Linux X11 desktop and control it with the relay CLI (screenshot, click, type, key). Use when an agent needs to see and operate a GUI on a Linux VM, sandbox or container.
---

# relay

Streams a Linux X11 desktop (1280x720) to a browser and lets you control it from the CLI.

## Setup

On a Debian/Ubuntu machine, from the repo:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
relay up -d
relay status --json
```

`up -d` returns once the engine and desktop are ready. `status --json` gives `state` (`ready` when up), `running`, `url` and `display`; it exits 3 when the session exists but is not running. Run `relay doctor` if anything fails. Do not use `xhost +` or delete X lock files. To use an existing display: `relay up -d --display :0`.

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
- Add `--json` to parse output. Input commands print `{"applied": N}`.
- `type` is US layout only: printable ASCII, newline, tab.
- A long `type` is sent in batches of 256 events. If it fails partway, the error has `applied`; do not resend the whole text blindly.

## Remote use

Behind an HTTPS proxy: `relay up -d --public https://HOST`. Share the viewer link or token through the user's secret channel, never in logs or URLs. From another machine, set `RELAY_URL` and `RELAY_TOKEN_FILE`. See `docs/remote-access.md`.

## Start apps

Start apps with `relay run -- APP [ARGS...]`, not from another shell: it shares the desktop's display, D-Bus session bus (so accessibility clients can find the app), runtime, config and cache directories, and ICE authority, and drops inherited ambient capabilities. Attach mode (`up --display :N`) keeps the caller's session environment. Add `--restart` to restart the app after it exits until `relay down`; retries back off from 1 to 30 seconds and reset after 60 seconds of uptime. The returned pid belongs to the first app process and changes on restart. Output and restarts: `relay logs apps`.

## Stop

```sh
relay down
```

## Errors

With `--json`, errors are `{"error":{"code","message","hint"}}` on stderr, plus `component` and `log` (and `logs` for session components) when a component failed and `applied` for input commands. Exit codes: 0 success, 1 failure, 2 usage error, 3 `status` of a session that is not running, 130 interrupted. Full list: `docs/cli.md#error-codes`.

| Code | Meaning |
| --- | --- |
| `invalid_input` | Bad argument or usage, JSON, input event, key combo, unmappable character, port, session name, URL, `--public` origin, TLS or token file; also an event or batch the engine rejected (HTTP 400/413/422). |
| `unauthorized` | Token missing or wrong (HTTP 401), or Host/Origin rejected (HTTP 403). |
| `busy` | A viewer or SDK session holds control (HTTP 409), or a screenshot is already running (HTTP 503). Never retried. |
| `unreachable` | Cannot connect to the URL. |
| `timeout` | No reply within `--timeout`, or `up` did not become ready in time (`component` and `log` set). |
| `not_running` | No session or logs with that name. |
| `not_found` | `run` found no running session with that name. |
| `invalid_option` | `run` was given no app. |
| `spawn_failed` | `run` could not start the app. |
| `already_running` | A session with that name is already running. |
| `component_failed` | display, desktop, engine or the background supervisor exited or could not start, including an app started with `run` that exited at once. `component` and `log` are set. |
| `missing_dependency` | A required program or the engine binary is missing. |
| `unsupported_platform` | `up`, `down` or `run` was run off Linux. |
| `internal` | Unexpected engine response or a CLI bug. |

Fixes: `busy`, ask the user to close the viewer, then retry. `unauthorized`, pass `--token-file` or set `RELAY_TOKEN_FILE`. `unreachable`, check `relay status` and the URL. `component_failed` or `timeout` from `up`, read `relay logs <component>` and run `relay doctor`.

Limits: X11 only, fixed 1280x720, one controller, no audio or clipboard.
