# CLI reference

`relay` is one Node command (Node 20 or newer, dependencies bundled). Host commands (`up`, `down`, `logs`, `doctor`, `run`) manage a session on the Linux machine; `up`, `down` and `run` fail with `unsupported_platform` elsewhere. Client commands (`status`, `screenshot`, `click`, `move`, `scroll`, `key`, `type`, `input`) run anywhere.

## Common

| Item | Detail |
| --- | --- |
| `--json` | Every command. Success object on stdout. On failure, an error object on stderr. |
| Error shape | `{"error":{"code","message","hint","component"?,"log"?,"logs"?,"applied"?}}`. Codes are listed under [Error codes](#error-codes). |
| Human errors | `error: ...` and `hint: ...` on stderr, plus the log tail when a component failed. |
| `--name N` | Session name, default `default`. Letters, digits, `.`, `_`, `-`, up to 64 characters. |
| State directory | `${XDG_STATE_HOME:-~/.local/state}/relay/<name>/` (mode 0700): `session.json`, `token` (0600), `display.log`, `desktop.log`, `engine.log`, `apps.log` (after `run`), `supervisor.log` (`-d` only). |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Failure. The error carries a code. |
| 2 | Usage error from argument parsing. The code is `invalid_input`, and it is JSON with `--json`. |
| 3 | `status` found the session but it is not running. |
| 130 | Interrupted with Ctrl-C. A foreground `up` stops cleanly and exits 0. |

### Client target

Client commands take `--url`, `--token-file` and `--timeout` (seconds, default 10). They pick the engine in this order:

1. `--url`, else `RELAY_URL`.
2. The local session named by `--name`, if it is ready: its URL, token file and TLS certificate. The session certificate is trusted without a hostname check, as a local session needs.
3. `http://127.0.0.1:8080`.

The token comes from `--token-file`, else `RELAY_TOKEN_FILE`, else the local session. The file holds the 64-character token; the client only reads it, so its mode does not matter.

URL rules: an origin only (no path, query or credentials). Plain HTTP only for `localhost` and `127.0.0.1`; other hosts need HTTPS and a token. Redirects are refused.

## install.sh

```sh
./install.sh [--prefix DIR] [--no-desktop] [--no-deps] [--client-only]
```

| Flag | Meaning |
| --- | --- |
| `--prefix DIR` | Absolute install location. Default `$PREFIX`, else `~/.local`. |
| `--no-desktop` | Skip XFCE and the other desktop packages. |
| `--no-deps` | Skip apt. Dependencies must already be present. |
| `--client-only` | Install only the CLI, for example on a laptop. Needs Node 20 or newer with npm. Works off Linux. |

Apt needs root or passwordless sudo. On apt systems it installs `nodejs` and `npm` when Node 20 or newer is missing, then the build tools, the X11 libraries, `libx264`, `libwebsockets`, `xvfb`, `xauth`, `x11-utils`, `x11-xkb-utils`, `util-linux` (for `setpriv`), and with the desktop: D-Bus, XFCE (`xfce4-session`, `xfwm4`, `xfce4-panel`, `xfdesktop4`, `xfce4-settings`, `thunar`, `xfce4-terminal`) and `glycin-loaders` when the distro has it. It runs `npm ci` and `npm run build`. Safe to re-run.

It installs the CLI as `<prefix>/lib/relay/relay.mjs` (linked as `<prefix>/bin/relay`), the engine and the built viewer in `<prefix>/lib/relay/` (the engine is linked as `<prefix>/bin/relay-engine`). When `<prefix>/bin` is not on `PATH` it prints:

```text
Not on PATH; add it with: export PATH="<prefix>/bin:$PATH"
```

A full install ends by running `relay doctor` and exits non-zero if doctor finds a failure.

## up

```sh
relay up [-d] [--name N] [--config FILE] [--port N] [--desktop xfce|none|CMD] [--display :N]
                 [--public HTTPS_URL] [--tls-cert F --tls-key F] [--bind ADDR] [--timeout S]
```

Starts Xvfb at the configured resolution (default 1280x720), the desktop and the engine, then supervises them. Without `-d` it runs in the foreground; Ctrl-C stops it.

| Flag | Default | Meaning |
| --- | --- | --- |
| `-d`, `--detach` | off | Run in the background. Returns once ready, or with the startup error. |
| `--name N` | `default` | Session name. One running session per name. |
| `--config F` | `$RELAY_CONFIG`, else `~/.config/relay/config.yaml` when it exists | Config file. Flags beat the file. See [Config](config.md). |
| `--port N` | `8080` | Listen port. |
| `--desktop` | `xfce`; `none` with `--display` | `xfce`, `none` (no desktop), or a command such as `openbox`. Runs under `dbus-run-session` when it is installed. |
| `--display :N` | new Xvfb | Attach to an existing display. Uses your `XAUTHORITY`. The CLI never stops or changes a display it did not start. |
| `--public URL` | off | Public HTTPS origin. Binds `0.0.0.0` unless `--bind` is set, generates a token and allows that origin. Expects a TLS proxy in front unless `--tls-cert` is given. See [Remote access](remote-access.md). |
| `--tls-cert F`, `--tls-key F` | off | Serve TLS natively. Both are required together. |
| `--bind ADDR` | `127.0.0.1` | Listen address. Any other address generates a token. |
| `--timeout S` | `30` | Seconds to wait for readiness. |

Ready means:

1. The engine this run started has logged its ready line, and `GET /screenshot.png` returns a PNG.
2. The desktop shows its own signal on the display: for `xfce`, a window manager (`_NET_SUPPORTING_WM_CHECK`) with at least one managed window (`_NET_CLIENT_LIST`); for a custom command, at least one window on the root. Skipped for `--desktop none`.

If that does not happen within `--timeout`, `up` fails with `timeout`. If a component exits first, it fails with `component_failed`. Both errors name the component and include its log tail. After ready, the supervisor keeps watching. If the display, desktop or engine exits later, the whole session stops and `status` shows the error. Apps started with `run` are not supervised; they stop with `down`.

`up` prints the token once, when there is one ([Tokens](remote-access.md#tokens)).

Real output, loopback (no token):

```console
$ relay up -d --name demo --port 8084
relay "demo" is ready
  url:     http://127.0.0.1:8084
  viewer:  http://127.0.0.1:8084
  display: :1
  logs:    /home/relay/.local/state/relay/demo
Running in the background; stop with `relay down --name demo`.
```

With `--public` (token shortened here):

```console
$ relay up -d --name pub --port 8082 --public https://desk.example.com --desktop none
relay "pub" is ready
  url:     https://desk.example.com
  viewer:  https://desk.example.com/#token=<64 hex>
  token:   <64 hex>  (shown once; status --show-token prints it again)
  display: :1
  logs:    /home/relay/.local/state/relay/pub
Expects a TLS proxy in front: forward https://desk.example.com to http://<this host>:8082.
Running in the background; stop with `relay down --name pub`.
```

The TLS proxy line is left out with `--tls-cert`. With a non-loopback `--bind` and no `--public`, `up` instead prints `Listening on ADDR:PORT; reach it through a loopback port publish or SSH tunnel.`

`up --json` prints one object:

```json
{"ready": true, "name": "two", "url": "http://127.0.0.1:8081", "viewer": "http://127.0.0.1:8081", "token": null, "display": ":1", "xauthority": "/home/relay/.local/state/relay/two/Xauthority", "logs": "/home/relay/.local/state/relay/two", "pid": 266, "enginePid": 272, "bind": "127.0.0.1", "port": 8081, "public": false}
```

| Field | Meaning |
| --- | --- |
| `url` | The `--public` origin, else the local URL. |
| `viewer` | `url/#token=TOKEN` when there is a token, else `url`. |
| `token` | The token, or `null`. |
| `display`, `xauthority` | X display and its cookie file. With `--display`, your `XAUTHORITY` or `null`. |
| `logs` | State directory. |
| `pid`, `enginePid` | Supervisor and engine process IDs. |
| `bind`, `port`, `public` | Listen address, port, and whether `--public` was set. |

A failed start, for example a desktop command that exits:

```console
$ relay up -d --name bad --port 8085 --desktop false --json
{"error": {"code": "component_failed", "message": "desktop exited with code 1", "hint": "Run `relay doctor` (icon decoding, D-Bus) and read `relay logs desktop`.", "component": "desktop", "log": "", "logs": "/home/relay/.local/state/relay/bad"}}
```

## down

```sh
relay down [--name N]
```

Stops the session and the processes it started. Safe to run twice. `--json` prints `{"name": "default", "stopped": true}`; `stopped` is `false` when nothing was running.

## status

```sh
relay status [--name N] [--url URL] [--token-file F] [--timeout S] [--show-token]
```

Without `--url` (or `RELAY_URL`), shows the local session and asks its engine for capabilities. Exits 3 when the session exists but is not running, and fails with `not_running` when there is no session with that name. The token is hidden unless `--show-token`.

```console
$ relay status
default: ready
  url:        http://127.0.0.1:8080
  display:    :0
  resolution: 1280x720
  fps:        60
  logs:       /home/relay/.local/state/relay/default
```

`status --json` for a running session (capabilities trimmed):

```json
{"name": "demo", "state": "ready", "supervisor": {"pid": 494, "start": "87687"}, "logs": "/home/relay/.local/state/relay/demo", "port": 8084, "display": ":1", "xauthority": "/home/relay/.local/state/relay/demo/Xauthority", "ownsDisplay": true, "desktop": "xfce", "resolution": "1280x720", "fps": 60, "bind": "127.0.0.1", "localUrl": "http://127.0.0.1:8084", "url": "http://127.0.0.1:8084", "tlsCert": null, "ready": 1793146225.0122316, "running": true, "capabilities": {"version": 1, "backend": "x11", "width": 1280, "height": 720, "...": "..."}}
```

| Field | Meaning |
| --- | --- |
| `state` | `starting`, `ready`, `stopped`, `failed`, or `dead` (the supervisor is gone without cleaning up). |
| `running` | `true` only when `state` is `ready` and the supervisor is alive. |
| `url`, `localUrl` | Public or local URL, and the URL local clients use. |
| `display`, `xauthority`, `ownsDisplay`, `desktop` | X display, cookie file, whether `up` started the display, desktop setting. |
| `resolution`, `fps` | Display size and stream frame rate. With `--display`, the size comes from the existing display. |
| `bind`, `port`, `tlsCert` | Listen address, port, TLS certificate path or `null`. |
| `tokenFile` | Token path, present only when there is a token. |
| `token` | Present only with `--show-token` while running. |
| `supervisor`, `logs` | Supervisor PID and start time; state directory. |
| `ready`, `stopped` | Unix times. |
| `capabilities` | Engine capabilities when running ([Protocol](protocol.md#get-capabilities)). |
| `health` | Error object when running but the engine did not answer. |
| `error` | Error object after a failure, with `component` and `log`. |

With `--url`, shows a remote engine instead. `--json` gives `{"url", "capabilities", "metrics"}`; the text form is one line:

```console
$ relay status --url http://127.0.0.1:18200 --token-file ./token
http://127.0.0.1:18200: up (x11 1280x720, 0 frames encoded)
```

## logs

```sh
relay logs [--name N] [display|dbus|desktop|engine|apps] [-f|--follow]
```

Prints the last 200 lines of one component's log, or of every log that exists. `--follow` keeps printing new lines. `--json` gives one key per log, for example `{"display": "...", "desktop": "...", "engine": "..."}` and cannot be combined with `--follow`. The `-d` supervisor's own output is in `supervisor.log` in the state directory.

## doctor

```sh
relay doctor
```

Checks this machine and prints the fix command for each problem. Exits 1 if any check fails; `warn` does not fail. `--json` gives `{"ok", "checks": [{"name", "status", "detail", "fix"}]}` with `status` `ok`, `warn` or `fail`.

| Check | What it looks at |
| --- | --- |
| `platform` | Linux. Off Linux this is the only check, and it fails. |
| `user` | Root or the UID (information only). |
| `node` | Node 20 or newer. |
| `setpriv` | `util-linux`, used to start apps without ambient capabilities. |
| `home`, `state dir` | `HOME` and the state directory are writable. |
| `engine` | `relay-engine` is found and runs. |
| `libx264` | The x264 library is installed. |
| `Xvfb`, `xauth`, `xprop`, `xwininfo`, `xdpyinfo` | Programs are on `PATH`. |
| `dbus-run-session`, `xfce4-session` | Present (warn only). |
| `/tmp/.X11-unix` | Usable by Xvfb. |
| `port` | `127.0.0.1:8080` is free (warn only). |
| `X extensions` | A scratch Xvfb offers XTEST, DAMAGE, XFIXES and MIT-SHM. |
| `ambient caps` | Inherited ambient capabilities. `up` and `run` clear them; GTK apps started from another shell with them set crash on icons. |
| `icon decoding` | gdk-pixbuf decodes a PNG and an SVG under your user with ambient capabilities cleared. On failure it suggests `glycin-loaders` or reports blocked user namespaces for bubblewrap. Warn only when gdk-pixbuf is not installed. |

## run

```sh
relay run [--name N] [--restart] -- APP [ARGS...]
```

Starts an app on the session's desktop and returns its pid. The app gets the desktop's D-Bus session bus, display, X authority, runtime, config and cache directories, and ICE authority. Sharing the bus lets accessibility clients find the app. With `up --display :N`, apps inherit the caller's session environment instead. Apps run with ambient capabilities cleared and stop with `relay down`. Output goes to `relay logs apps`.

`--restart` starts the app again whenever it exits, until the session stops. Retries wait 1 second, doubling up to 30 seconds; the delay resets after the app stays up for 60 seconds. Each restart is recorded in `relay logs apps`. The returned pid is the first app process, not its watcher; it changes on restart. Without this flag, apps start once as before.

```console
$ relay run -- mousepad notes.txt
Started mousepad (pid 4412) on :0; output in ~/.local/state/relay/default/apps.log
```

## screenshot

```sh
relay screenshot [FILE|-]
```

Saves a PNG of the screen. Default file `screen.png`. `-` writes the PNG to stdout. Works while a viewer is connected. `--json` prints `{"path", "bytes", "width", "height"}`.

## click

```sh
relay click X Y [--button left|middle|right]
```

Clicks at X Y. Default button `left`.

## move

```sh
relay move X Y
```

## scroll

```sh
relay scroll X Y [--dx N] [--dy N]
```

Moves to X Y, then scrolls. `--dx` and `--dy` are wheel notches. Positive `--dy` scrolls down, positive `--dx` right. At least one must be nonzero.

## key

```sh
relay key COMBO...
```

Presses each combo in order. Combos are `+`-joined: `ctrl+l`, `Enter`, `alt+Tab`, `ctrl++`. Modifiers: `ctrl`, `shift`, `alt`, `super` (also `control`, `meta`, `cmd`, `win`). Keys: a US-layout character or a name such as `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `F1` to `F24`.

## type

```sh
relay type TEXT
relay type --stdin
```

Types text as text events, one per Unicode character, so the remote keyboard layout decides each character. The engine produces the character by pressing a key of the current layout, or reports `invalid_input` when it cannot.

## input

```sh
relay input JSON
relay input --stdin
```

Sends a JSON array of 1 to 256 raw events with the same schema as the [SDK](sdk.md#input-events), as one batch.

```sh
relay input '[{"type":"keyDown","key":4},{"type":"keyUp","key":4}]'
```

## Input behavior

- X and Y are fractions of the screen from 0 to 1, from the top-left.
- Input goes to the engine as `POST /input` batches of at most 256 events ([protocol](protocol.md#post-input)). `click`, `move`, `scroll` and `input` send one batch.
- `type` sends one text event per character and `key` one group per combo. Events are packed into as many batches as needed and never split.
- If a viewer or SDK session holds control, the batch fails with `busy` (HTTP 409). It is never retried. Another controller can take control between batches, so a long `type` or `key` can stop partway. The error then carries `applied`, the number of events already applied.
- Held keys and buttons are released at the end of each batch, and when it fails.
- `--json` prints `{"applied": N}`. Success means the engine applied the events, not that the application reacted. Take a screenshot to confirm.

## Error codes

| Code | Meaning |
| --- | --- |
| `invalid_input` | Bad argument or usage, JSON, input event, key combo, character the remote layout cannot produce, port, session name, URL, `--public` origin, TLS or token file; also an event or batch the engine rejected (HTTP 400/413/422). |
| `unauthorized` | Token missing or wrong (HTTP 401), or Host/Origin rejected (HTTP 403). |
| `busy` | A viewer or SDK session holds control (HTTP 409), or a screenshot is already running (HTTP 503). Never retried. |
| `unreachable` | Cannot connect to the URL. |
| `timeout` | No reply within `--timeout`, or `up` did not become ready in time (`component` and `log` set). |
| `not_running` | No session or logs with that name. |
| `not_found` | `run` found no running session with that name. |
| `invalid_option` | `run` was given no app. |
| `spawn_failed` | `run` could not start the app. |
| `already_running` | A session with that name is already running. |
| `component_failed` | display, desktop, engine or the background supervisor exited or could not start (`component`, `log` and `logs` are set), or an app started by `run` exited within a second (`component` is `apps`, `log` is set, no `logs`). |
| `missing_dependency` | A required program (including the `run` app) or the engine binary is missing. |
| `unsupported_platform` | `up`, `down` or `run` was run off Linux. |
| `internal` | Unexpected engine response or a CLI bug. |

Input commands that fail after some batches report `applied` (events already applied) in the error.
