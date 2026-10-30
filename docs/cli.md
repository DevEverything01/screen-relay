# CLI reference

`relay` is one Node command (Node 20 or newer, dependencies bundled). Host commands (`up`, `down`, `logs`, `doctor`, `run`) manage a session on the Linux machine; `up`, `down` and `run` fail with `unsupported_platform` elsewhere. Client commands (`status`, `screenshot`, `click`, `move`, `scroll`, `key`, `type`, `input`) run anywhere.

## Common

| Item | Detail |
| --- | --- |
| `--json` | Every command. Success object on stdout. On failure, an error object on stderr. |
| Error shape | `{"status":"error","reason":"<snake_case>","message":"<headline>"}` on stderr, with optional `next` and `data`. `status` is `action_required` when input can unblock a command before any effect. See [Error codes](#error-codes). |
| Human errors | A headline, context and one recovery command on stderr; no stack trace or raw engine payload. |
| `--name N` | Session name, default `default`. Letters, digits, `.`, `_`, `-`, up to 64 characters. |
| `skills` | `list`, `get <name> [--full] [--json]`, and `path [name]` serve the skills shipped with this CLI. |
| State directory | `${XDG_STATE_HOME:-~/.local/state}/relay/<name>/` (mode 0700): `session.json`, `token` (0600), `display.log`, `desktop.log`, `engine.log`, `apps.log` (after `run`), `supervisor.log` (`-d` only). |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Runtime, network, permission, configuration or missing-session failure. |
| 2 | Usage error, invalid value or missing input. |
| 130 | Interrupted with Ctrl+C. A foreground `up` stops its session on the first interrupt; a second interrupt exits immediately. |
| 128+n | Terminated by signal n. |

An existing session's `status` exits 0 for `ready`, `starting`, `stopped` and `failed`. A missing session exits 1. Exit code 3 is no longer used.

### Help and options

`relay --help`, `relay -h` and `relay help` show root help. Use `relay help <COMMAND>` or `relay <COMMAND> --help` for a command. Help works offline, writes stdout and exits 0 without starting anything.

Root help groups commands under Session, Control and Machine. Command help lists arguments, alphabetical options, global options, examples, notes and a documentation link. Empty sections are omitted. `relay <COMMAND> --help --json` returns metadata with `path`, `summary`, `arguments`, `options`, `examples` and the result schema. `relay help --all --json` returns every command.

Global options work before or after the command: `-h`/`--help`, `-v`/`--version`, `--json`, `--no-color` and `--name <NAME>`. Version output contains only the version; `--version --json` returns `{"version":"<VERSION>"}`. Options accept `--name <NAME>`, `--name=<NAME>` and their documented short forms. `--` ends option parsing. Boolean options accept `--no-<OPTION>`. Unknown options, commands and extra positionals fail before work, with at most one close suggestion and a help command. Options do not accept prefix matching.

`-f` means follow; `-n` and `-o` retain only their documented meanings. The exception is `up -d`, which keeps meaning `--detach`.

### Output

Queries write data to stdout. Mutations write receipts and next steps to stderr. When stdout is piped, `up` writes only the viewer URL (including `#token=` when needed), `screenshot` writes only the saved path, and input commands write nothing. Treat the viewer URL as a secret when it includes a token.

TTY receipts use `✓`, `!` and `✗` in column 0, text from column 2, and label values from column 18. Non-TTY stderr or `TERM=dumb` uses plain words and no color. Color precedence is `--no-color`, nonempty `NO_COLOR`, `FORCE_COLOR` (`0` disables it), then detection for each stream.

`--json` writes exactly one JSON document followed by a newline to stdout, pretty-printed with two spaces on a TTY and compact otherwise. Successful JSON commands leave stderr empty. Failures leave stdout empty and write one compact error document to stderr. Keys use camelCase. Success may include `warnings: [{reason, message}]` and `next: [{command, argv}]`.

| Command | JSON success shape |
| --- | --- |
| `up` | `{"session":{...},"outcome":"started"}` |
| `down` | `{"session":{...},"outcome":"stopped"}` or `"unchanged"` |
| `status` | `{"session":{...}}` |
| `screenshot` | `{"screenshot":{"path":"<PATH>","width":1280,"height":720,"bytes":12345},"outcome":"saved"}` |
| `click`, `move`, `scroll`, `key`, `type`, `input` | `{"input":{"events":1},"outcome":"sent"}` |
| `doctor` | `{"checks":[...],"summary":{...}}` |
| `run` | `{"app":{"pid":4412,"command":"<APP>"},"outcome":"started"}` |

These envelopes replace the former flat objects, input `applied` count and nested `error` object. Scripts must read the named object and `reason` instead of `error.code`.

### Settings

Precedence is an explicit option, its `RELAY_*` environment variable, the config file, then the default. An explicit invalid value fails instead of falling back. Config validation reports all problems before starting processes.

| Variable | Applies to |
| --- | --- |
| `RELAY_CONFIG` | `up --config`; otherwise `~/.config/relay/config.yaml` when present |
| `RELAY_URL` | Client `--url` |
| `RELAY_TOKEN_FILE` | Client `--token-file` |

### Client target

Client commands take `--url`, `--token-file` and `--timeout` (seconds, default 10). They pick the engine in this order:

1. `--url`, else `RELAY_URL`.
2. The local session named by `--name`, if it is ready: its URL, token file and TLS certificate. The session certificate is trusted without a hostname check, as a local session needs.
3. `http://127.0.0.1:8080` only when no session was explicitly selected and the default session does not exist. An explicitly selected missing session, a stopped session, or one whose supervisor is gone fails with `not_running`. Pass `--url` to target an engine without a local session.

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

TTY receipt, loopback (no token), on stderr:

```console
$ relay up -d --name demo --port 8084
✓ Started         demo
  Viewer          http://127.0.0.1:8084
  Display         :1
  Resolution      1280x720 at 60 fps
  Logs            /home/relay/.local/state/relay/demo

  Stop it:
    relay down --name demo
```

With `--public` (token shortened here):

```console
$ relay up -d --name pub --port 8082 --public https://desk.example.com --desktop none
✓ Started         pub
  Viewer          https://desk.example.com/#token=<TOKEN>
  Display         :1
  Resolution      1280x720 at 60 fps
  Logs            /home/relay/.local/state/relay/pub

  Stop it:
    relay down --name pub
```

The TLS proxy line is left out with `--tls-cert`. With a non-loopback `--bind` and no `--public`, `up` instead prints `Listening on ADDR:PORT; reach it through a loopback port publish or SSH tunnel.`

`up -d --json` prints one object when ready. Foreground `up --json` defers its result until supervision ends, so a later engine failure leaves stdout empty. Interrupting it stops the session without printing a success document.

```json
{"session":{"ready":true,"name":"two","url":"http://127.0.0.1:8081","viewer":"http://127.0.0.1:8081","token":null,"display":":1","xauthority":"/home/relay/.local/state/relay/two/Xauthority","logs":"/home/relay/.local/state/relay/two","pid":266,"enginePid":272,"bind":"127.0.0.1","port":8081,"public":false},"outcome":"started"}
```

| Session field | Meaning |
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
{"status":"error","reason":"component_failed","message":"Failed to start the desktop. It exited with code 1.","next":[{"command":"relay","argv":["logs","desktop","--name","bad"]}],"data":{"component":"desktop","logs":"/home/relay/.local/state/relay/bad"}}
```

## down

```sh
relay down [--name N]
```

Stops the session and the processes it started. Safe to run twice. `--json` prints `{"session":{"name":"default"},"outcome":"stopped"}`; the outcome is `unchanged` when nothing was running.

## status

```sh
relay status [--name N] [--url URL] [--token-file F] [--timeout S] [--show-token]
```

Without `--url` (or `RELAY_URL`), shows the local session and asks its engine for capabilities. Exits 0 for an existing session, including a stopped or failed one. A missing session exits 1. The token is hidden unless `--show-token`.

```console
$ relay status
  Session         default
  State           ready
  URL             http://127.0.0.1:8080
  Display         :0
  Resolution      1280x720
  Fps             60
  Logs            /home/relay/.local/state/relay/default
```

`status --json` for a running session (capabilities trimmed):

```json
{"session":{"name":"demo","state":"ready","logs":"/home/relay/.local/state/relay/demo","display":":1","xauthority":"/home/relay/.local/state/relay/demo/Xauthority","running":true,"capabilities":{"version":1,"backend":"x11","width":1280,"height":720,"fps":60}}}
```

| Field | Meaning |
| --- | --- |
| `state` | `starting`, `ready`, `stopped` or `failed`. |
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

With `--url`, shows a remote engine instead. `--json` wraps `url`, `capabilities` and `metrics` in `session`:

```console
$ relay status --url http://127.0.0.1:18200 --token-file ./token
  URL             http://127.0.0.1:18200
  Backend         x11
  Resolution      1280x720
```

## logs

```sh
relay logs [--name N] [display|dbus|desktop|engine|apps] [-f|--follow]
```

Prints the last 200 lines of one component's log, or of every log that exists. `--follow` keeps printing new lines. `--json` wraps the component logs in `logs`, for example `{"logs":{"display":"...","desktop":"...","engine":"..."}}`, and cannot be combined with `--follow`. The `-d` supervisor's own output is in `supervisor.log` in the state directory.

## doctor

```sh
relay doctor
```

Checks this machine and prints the fix command for each problem. Exits 1 if any check fails; `warn` does not fail. `--json` gives `checks` and `summary`; each check includes `name`, `status`, `detail` and `fix`, with status `ok`, `warn` or `fail`.

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
✓ Started         mousepad
  PID             4412
  Display         :0
  Logs            ~/.local/state/relay/default/apps.log
```

## screenshot

```sh
relay screenshot [FILE|-]
```

Saves a PNG of the screen. Default file `screen.png`. `-` writes the PNG to stdout. Works while a viewer is connected. `--json` wraps `path`, `bytes`, `width` and `height` in `screenshot`, with outcome `saved`.

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

Types text as text events, one per Unicode scalar value. The engine produces the requested character using the current remote layout, or reports `unsupported_input` when it cannot. Unlike `key`, text input does not assume a US keyboard layout.

## input

```sh
relay input JSON
relay input --stdin
```

Sends a nonempty JSON array of raw events with the same schema as the [SDK](sdk.md#input-events). The SDK splits input according to the engine's advertised `max_input_batch`.

```sh
relay input '[{"type":"keyDown","key":4},{"type":"keyUp","key":4}]'
```

## Input behavior

- X and Y are fractions of the screen from 0 to 1, from the top-left.
- Input goes to the engine as `POST /input` batches limited by capabilities `max_input_batch` (currently 256 events; [protocol](protocol.md#post-input)).
- `type` sends one text event per character and `key` one group per combo. Events are packed into as many batches as needed and never split.
- If a viewer or SDK session holds control, the batch fails with `busy` (HTTP 409). It is never retried. Another controller can take control between batches, so a long `type` or `key` can stop partway. The JSON error then carries `data.applied`, the number of events already applied.
- Held keys and buttons are released at the end of each batch, and when it fails.
- `--json` prints `{"input":{"events":1},"outcome":"sent"}` with the applied event count. Success means the engine applied the events, not that the application reacted. Take a screenshot to confirm.

## Error codes

| Reason | Meaning |
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
| `port_in_use` | The requested listen port is occupied. |
| `component_failed` | display, desktop, engine or the background supervisor exited or could not start (`component`, `log` and `logs` are set), or an app started by `run` exited within a second (`component` is `apps`, `log` is set, no `logs`). |
| `missing_dependency` | A required host program or the engine binary is missing. Failed app spawns use `spawn_failed`. |
| `unsupported_platform` | `up`, `down` or `run` was run off Linux. |
| `invalid_config` | Invalid configuration; the message names the file and key path. |
| `disconnected`, `io_error`, `protocol_error` | Lost session, failed local I/O or an invalid engine response. |
| `canceled` | Interrupted operation (exit 130). |
| `internal` | Unexpected engine response or a CLI bug. |

Input commands that fail after some batches report `data.applied` (events already applied). The SDK exposes the same snake_case `reason` through `RelayError.reason`.

## skills

```sh
relay skills list
relay skills get <name> [--full] [--json]
relay skills path [name]
```

`list` shows available skills. `get` prints a skill's workflow; `--full` appends its `references/` and `templates/` files. `path` prints the skill-data directory, or a named skill directory.
