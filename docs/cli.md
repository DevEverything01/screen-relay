# CLI reference

`native-stream` is one Python 3 command (stdlib only). Host commands run on the Linux machine. Client commands run anywhere.

## Common

| Item | Detail |
| --- | --- |
| `--json` | Success object on stdout. On failure, an error object on stderr and a non-zero exit. |
| Error shape | `{"error":{"code","message","hint","component"?,"log"?}}` |
| Human errors | One line on stderr with a fix hint. |
| `NATIVE_STREAM_URL` | Default `--url` for client commands. |
| `NATIVE_STREAM_TOKEN_FILE` | Default `--token-file` for client commands. |
| State directory | `${XDG_STATE_HOME:-~/.local/state}/native-stream/<name>/` (mode 0700): `session.json`, `token` (0600), logs. |
| Session name | `default` unless `--name` is set. |

Client commands take `--url`, `--token-file` and `--timeout`. With none of them set, they use the local session named `default`.

## install.sh

```sh
./install.sh [--prefix DIR] [--no-desktop] [--no-deps] [--client-only]
```

| Flag | Meaning |
| --- | --- |
| `--prefix DIR` | Install location. Default `~/.local`. |
| `--no-desktop` | Skip XFCE and desktop packages. |
| `--no-deps` | Skip apt. Dependencies must already be present. |
| `--client-only` | Install only the CLI, for use from a laptop. |

Needs root or passwordless sudo for apt. Installs `glycin-loaders` when the distro has it. Safe to re-run. Ends by running `native-stream doctor`.

## up

```sh
native-stream up [-d] [--name N] [--port N] [--desktop xfce|none|CMD] [--display :N]
                 [--public HTTPS_URL] [--tls-cert F --tls-key F] [--bind ADDR]
```

Starts Xvfb, the desktop and the engine. Ready means the engine returns a PNG snapshot and the desktop has stayed up for a short settle window.

| Flag | Default | Meaning |
| --- | --- | --- |
| `-d` | off | Run in the background. Returns once ready. |
| `--name N` | `default` | Session name. One session per name. |
| `--port N` | `8080` | Listen port. |
| `--desktop` | `xfce` | `xfce`, `none` (Xvfb only), or a command such as `openbox`. |
| `--display :N` | new | Attach to an existing display. The CLI never stops or changes a display it did not start. Keeps your `XAUTHORITY`. |
| `--public URL` | off | HTTPS origin. Binds `0.0.0.0`, generates a token, allows that origin, trusts TLS proxy headers. |
| `--tls-cert F`, `--tls-key F` | off | Native TLS instead of a proxy. |
| `--bind ADDR` | `127.0.0.1` | Listen address. |

```console
$ native-stream up -d
Viewer   http://127.0.0.1:8080
Display  :99
Logs     ~/.local/state/native-stream/default/logs
```

When the session is not loopback-only, `up` also prints the token and a viewer link `URL/#token=...`. The token is shown once.

If a component fails, the error names it (display, desktop or engine), its exit code and the last log lines.

## down

```sh
native-stream down [--name N]
```

Stops the session. Safe to run twice.

## status

```sh
native-stream status [--name N] [--url URL] [--show-token]
```

Shows state, URL, display and process health for a local session. With `--url`, shows capabilities and health of a remote engine. The token is hidden unless `--show-token`.

```console
$ native-stream status --json
{"name":"default","state":"running","url":"http://127.0.0.1:8080","display":":99"}
```

## logs

```sh
native-stream logs [--name N] [display|desktop|engine] [--follow]
```

Prints logs for one component, or all. `--follow` streams new lines.

## doctor

```sh
native-stream doctor
```

Checks the machine and prints the exact fix command for each failure.

- root or non-root, writable `HOME`, state and runtime dirs
- D-Bus without systemd (`dbus-run-session`), `/tmp/.X11-unix`
- port free, Xvfb and xauth present
- X extensions XTest, XDamage, XFixes, MIT-SHM
- libx264, python3
- icon decoding under your real user and environment, and blocked user namespaces

## snapshot

```sh
native-stream snapshot [FILE|-]
```

Saves a PNG of the desktop. Default file `screen.png`. `-` writes to stdout. Works while a viewer is connected.

## click

```sh
native-stream click X Y [--button left|middle|right]
```

Clicks at normalized coordinates (0 to 1). Default button `left`.

```sh
native-stream click 0.5 0.5
```

## move

```sh
native-stream move X Y
```

## scroll

```sh
native-stream scroll X Y [--dx N] [--dy N]
```

Scrolls at X Y. `--dx` and `--dy` are in wheel notches. Positive `--dy` scrolls down.

## key

```sh
native-stream key COMBO...
```

Presses each combo in order. Combos are `+`-joined: `ctrl+l`, `Enter`, `alt+Tab`.

## type

```sh
native-stream type TEXT
native-stream type --stdin
```

Types US-layout text. Characters that cannot be mapped are rejected with an error.

## input

```sh
native-stream input JSON
native-stream input --stdin
```

Sends raw events with the same schema as the [SDK](sdk.md#input-events).

```sh
native-stream input '[{"type":"keyDown","key":4},{"type":"keyUp","key":4}]'
```

## Input behavior

- Input commands send one `POST /input` batch ([protocol](protocol.md#post-input)).
- If a viewer or SDK session holds control, the command fails with `busy` (HTTP 409). It does not retry.
- Held keys and buttons are released when the batch ends or fails.
- Success means the input was submitted, not that the application reacted.

## Error codes

| Code | Meaning |
| --- | --- |
| `busy` | Another controller owns input, or a snapshot is already running. |
| `unauthorized` | Missing or wrong token. |
| `unreachable` | Cannot connect to the URL. |
| `invalid_argument` | Bad coordinates, key combo or unmappable character. |
| `timeout` | No reply within `--timeout`. |
| `component_failed` | `up` failed. `component` and `log` are set. |
