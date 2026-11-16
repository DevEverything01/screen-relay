---
name: core
description: Control a screen-relay desktop from an agent using screenshots and input commands.
allowed-tools: Bash(screen-relay:*)
---

# screen-relay core workflow

screen-relay streams a desktop to a browser viewer and gives you CLI control. On Linux it runs an X11 or Wayland desktop. On macOS it streams the logged-in user's display.

## Install

On the Linux or macOS machine that will show the desktop, install the CLI from npm. Node 22 or newer must already be installed:

```sh
npm install -g screen-relay
```

The package ships the CLI, the Node SDK, the viewer, the agent skills, and the engine source. It runs no install script and installs no system packages. Client commands work right away with `--url` and a token file.

Setup installs the system packages and builds the engine. `screen-relay up` runs setup first when the machine is not set up yet. An agent has no terminal, so `up` never prompts there. Run setup with `--yes` before the first session:

```sh
screen-relay install --yes
screen-relay up -d
```

- `screen-relay install --backend wayland --yes` sets up Wayland with sway, XWayland, and foot. `--backend all` sets up both X11 and Wayland. Adding a backend keeps the ones already set up.
- `--desktop none` skips the XFCE desktop packages on x11.
- `screen-relay up -d --yes` runs setup and starts the session in one command.

Setup is safe to repeat. When nothing is missing, `install` reports `unchanged`. After an upgrade of `screen-relay`, the next `up` rebuilds the engine. That takes well under a minute and needs no `sudo`.

On Linux, automatic setup supports Debian, Ubuntu, Fedora, Arch Linux, and Alpine on x64 and arm64. It needs root or passwordless `sudo`. On another distribution, install the build tools and libraries yourself, then run `screen-relay install` to build the engine.

On macOS, setup needs Homebrew and the Xcode Command Line Tools. It installs `pkgconf`, `x264`, and `libwebsockets` with Homebrew. After setup, grant Screen Recording and Accessibility to the app that starts screen-relay; see [macOS](references/macos.md).

## Pick a backend

On macOS there is nothing to pick: `screen-relay up -d` uses the `macos` backend, attaches to the logged-in user's display, and starts no virtual display or desktop. `--display` is rejected there. Details are in [macOS](references/macos.md).

On Linux, `screen-relay up` uses X11 unless you choose Wayland. Set up the backend you need first, for example with `screen-relay install --backend wayland --yes`. `screen-relay up -d` starts a virtual X11 display with XFCE. `screen-relay up -d --backend wayland` starts a headless sway desktop with foot:

```sh
screen-relay up -d
screen-relay up -d --backend wayland
```

To show a compositor you already run, start screen-relay from a terminal inside that session. Use the Wayland backend and the socket name from the environment:

```sh
screen-relay up -d --backend wayland --display "$WAYLAND_DISPLAY"
```

`--display` takes an X display such as `:0` on x11, or a Wayland socket such as `wayland-1` with `--backend wayland`. A `--display` without a colon, such as `wayland-1`, selects the Wayland backend on its own. Attach mode uses the display's size and starts no desktop. For compositor setup, output names and limits, see [Wayland](references/wayland.md).

The backend comes from `--backend`, then `SCREEN_RELAY_BACKEND`, then the config file's `backend` key, then the default. To switch backends, run `screen-relay down` first. A session name stays in use while its session runs, so a second `up` fails with `already_running`.

## Where commands run

- VM commands (`install`, `up`, `down`, `logs`, `run`, `doctor`) manage the session on the Linux or macOS machine that shows the desktop. `up`, `down` and `run` fail with `unsupported_platform` on other systems.
- Client commands (`status`, `screenshot`, `click`, `move`, `scroll`, `key`, `type`, `input`) reach the engine on that machine, either through the local session or with `--url` and a token.

`skills` and `help` work anywhere and never contact an engine.

On the VM, run every command directly. From another machine, only client commands work, and each needs `--url` plus a token file (`--token-file` or `SCREEN_RELAY_TOKEN_FILE`). See [Client target](references/cli.md#client-target).

## Start a session

```sh
screen-relay up -d
screen-relay status --json
```

`up -d` returns once the display, desktop and engine are ready. Piped, it prints the viewer URL, including the `#token=` fragment when the session has a token; treat that URL as a secret.

`status --json` prints `{"session": {...}}`. Read `session.state` (`starting`, `ready`, `stopped`, `failed`), `session.running`, `session.url`, `session.display`. An existing session exits 0 whatever its state; a missing session exits 1 with reason `not_running`.

## Control loop

Work in a loop: screenshot, decide from the image, act, screenshot again to verify.

```sh
screen-relay screenshot /tmp/relay.png
screen-relay click 0.5 0.5
screen-relay type "echo hello"
screen-relay key Enter
screen-relay screenshot /tmp/relay-after.png
```

A complete run that opens a terminal, focuses it, types, and verifies. This uses `xfce4-terminal`, the terminal on X11; on Wayland, use `foot`; on macOS, start an app with `screen-relay run -- open -a Terminal`:

```sh
screen-relay up -d
screen-relay run -- xfce4-terminal
sleep 1
screen-relay screenshot /tmp/relay.png
screen-relay click 0.5 0.5
screen-relay type "echo hello"
screen-relay key Enter
screen-relay screenshot /tmp/relay-after.png
```

- `screen-relay run -- APP [ARGS...]` starts an app on the session desktop and returns its pid at once; the window appears a moment later. Poll `screen-relay screenshot` until you can see it. Read app output with `screen-relay logs apps`. Apps stop with `screen-relay down`.
- `screen-relay screenshot [file]` writes a PNG, default `screen.png`. Pass `-` to write PNG bytes to stdout. View the file; success means the engine saved the frame, not that an app responded.
- Click to focus a window before typing into it. A click also moves the pointer.
- Input success means the engine applied the events, not that the application reacted. Always take another screenshot.

Read a value off the screen by taking a screenshot and reading the pixels or text in the image. `--json` reports geometry and sizes, not OCR:

```json
{"screenshot":{"path":"/tmp/relay.png","width":1920,"height":1080,"bytes":48213},"outcome":"saved"}
```

Scroll a list or page:

```sh
screen-relay scroll 0.5 0.5 --dy 5
screen-relay screenshot /tmp/relay-scrolled.png
```

`--dy` is vertical wheel notches, positive down; `--dx` is horizontal, positive right. At least one must be nonzero. Scrolling moves the pointer to the given point first.

## Coordinates

Coordinates are fractions of the screen from `0` to `1`, measured from the top-left. Convert a pixel from a screenshot:

```text
x = pixel_x / image_width
y = pixel_y / image_height
```

For a 1920x1080 screenshot, pixel `480,810` is `screen-relay click 0.25 0.75`; the center is `screen-relay click 0.5 0.5`. Read `width` and `height` from `screen-relay screenshot file.png --json`, or use the image size directly.

## type versus key

- `screen-relay type <text>` sends layout-neutral text events, one per Unicode scalar value. The remote keyboard layout decides each character, so accented letters, symbols and non-US layouts work. Use it for text and content.
- `screen-relay key <combo>...` sends physical key combinations: `screen-relay key ctrl+l`, `screen-relay key alt+Tab`, `screen-relay key cmd+shift+t`, `screen-relay key Enter`. Use it for shortcuts, arrows, function keys and Escape. Modifiers are `ctrl`, `shift`, `alt`, `super`; `cmd`, `meta` and `win` are aliases of `super`. Press several combos in one call to send them in order.
- A long `screen-relay type` is split into batches of at most 256 events. If a later batch fails, the JSON error carries `data.applied`, the number of events the engine confirmed. When the engine answered with the error (`busy`, `invalid_input`, `unsupported_input`), resend only the remaining text. When the reply was lost (`timeout`, `unreachable`, `disconnected`), the last batch may already be on screen: take a screenshot before resending anything.

## JSON

Add `--json` to any command. Success writes exactly one document with a trailing newline to stdout and leaves stderr empty; pretty-printed with two spaces on a TTY, compact otherwise.

| Command | Shape |
| --- | --- |
| `screen-relay up -d --json` | `{"session":{...},"outcome":"started"}` |
| `screen-relay down --json` | `{"session":{...},"outcome":"stopped"}` or `"unchanged"` |
| `screen-relay install --json` | `{"install":{"backends":["x11"],"engine":"..."},"outcome":"installed"}` or `"unchanged"` |
| `screen-relay status --json` | `{"session":{...}}` |
| `screen-relay screenshot file.png --json` | `{"screenshot":{"path","width","height","bytes"},"outcome":"saved"}` |
| `screen-relay click`, `move`, `scroll`, `key`, `type`, `input` | `{"input":{"events":N},"outcome":"sent"}` |
| `screen-relay run -- APP --json` | `{"app":{"pid":N,"command":["APP"]},"outcome":"started"}` |
| `screen-relay logs engine --json` | `{"logs":{"engine":"..."}}` |
| `screen-relay doctor --json` | `{"checks":[...],"summary":{"ok","passed","warnings","failed"}}` |
| `screen-relay skills list --json` | `{"skills":[{"name","description"}]}` |

Success may also carry `warnings: [{reason, message}]` and `next: [{command, argv}]`.

On failure, stdout is empty and stderr has one compact document:

```json
{"status":"error","reason":"busy","message":"Another controller holds control of the desktop.","data":{"httpStatus":409}}
{"status":"action_required","reason":"invalid_input","message":"Invalid x: '2'.","next":[{"command":"screen-relay help click","argv":["screen-relay","help","click"]}]}
```

- `status` is `action_required` when the command stopped before any effect and input would let it run; otherwise `error`.
- `reason` is the stable snake_case code. Match it, not the message.
- `next` is optional. `command` is the full command line and `argv` is the same command split, starting with `screen-relay`. Run `next[0].command` when present.
- `data` carries context: `component` and `logs` after a component failure, `applied` after a partial input batch, `httpStatus` from the engine.

Exit codes: 0 success (including `status` of any existing session), 1 runtime, network, permission, config or missing-session failure, 2 usage or missing input, 130 interrupted, 128+n for signal n.

## Reasons and recovery

| Reason | Meaning | Recovery |
| --- | --- | --- |
| `busy` | Another controller holds input, or a screenshot is already running. | See [One controller](#one-controller). Screenshots still work. |
| `unauthorized` | Missing or wrong token. | Pass `--token-file FILE` or set `SCREEN_RELAY_TOKEN_FILE`; open the `#token=` viewer link. |
| `forbidden` | The engine rejected `Host` or `Origin`. | Use the `--public` URL or loopback. |
| `unreachable` | Cannot connect to the address, one of `Connection refused.`, `The host name did not resolve.` or `The TLS certificate was rejected.` | Check the address, then `screen-relay status --url <URL>`. |
| `timeout` | No reply within `--timeout`, or `up` was not ready in time. | Raise `--timeout`; for `up`, read the component log. |
| `not_running` | No session or logs with that name. | `screen-relay up -d`. |
| `not_found` | No running session for `run` or a skill, or an unknown engine endpoint. | Start the session, or `screen-relay skills list`. |
| `already_running` | A session with that name is already running. | `screen-relay down --name N`, or pick another name and port. |
| `component_failed` | display, desktop, engine, supervisor or an app exited. `data.component` and `data.logs` are set. | `screen-relay logs <component>`. |
| `missing_dependency` | A host program or the engine binary is missing. | `screen-relay install --yes`, with `--backend wayland` for Wayland, or `screen-relay doctor`. |
| `missing_input` from `up` | Setup is needed and there is no terminal to ask (exit 2). | `screen-relay install --yes`, then `screen-relay up -d`; or `screen-relay up -d --yes`. |
| `missing_command` | `run` was given no app (exit 2). | `screen-relay run -- APP`. |
| `spawn_failed` | `run` could not start the app. | Check the app name and `screen-relay logs apps`. |
| `unsupported_input` | The backend cannot produce a character or apply the input. | Use `screen-relay type` for layout-neutral text. |
| `unsupported_platform` | `up`, `down` or `run` off Linux and macOS. | Run host commands on the Linux or macOS machine. |
| `invalid_config` | A config key or value is invalid; the message names the file and key. | Fix the file and start again. |
| `invalid_input`, `invalid_option`, `unknown_command` | Usage error (exit 2). | Read the `next` command, usually `screen-relay help <command>`. |
| `internal` | A bug in screen-relay. | Report it with the command you ran. |

## One controller

Only one controller sends input at a time: a browser viewer, an SDK control session, or your CLI. A second controller gets `reason: "busy"` with the message `Another controller holds control of the desktop.`; nothing is applied. Screenshots, `status` and `capabilities` keep working. Do not retry in a loop; wait for the other controller to close, then retry once.

## Config

Settings come from flags, `SCREEN_RELAY_*` variables, or the config file at `${XDG_CONFIG_HOME:-~/.config}/screen-relay/config.yaml`, which `screen-relay up` reads when it exists. The keys, defaults and precedence are in [references/config.md](references/config.md).

## Troubleshooting

- Start with `screen-relay doctor`. On Linux it checks the x11 backend unless `SCREEN_RELAY_BACKEND` or the config `backend` key says otherwise; for Wayland, run `SCREEN_RELAY_BACKEND=wayland screen-relay doctor`. On macOS it checks the macOS version, the engine and the permissions. Each failing check prints a fix. Some fixes are manual; see [references/troubleshooting.md](references/troubleshooting.md).
- `screen-relay logs` prints the last 200 lines of every component log; `screen-relay logs engine` (or `display`, `dbus`, `desktop`, `apps`) selects one. `-f` follows.
- `component_failed` or `timeout` from `up`: read `data.component` and `data.logs`, then `screen-relay logs <component>`.
- Port already in use: `screen-relay down` the old session, or use another `--port`.
- `Couldn't reach <host>. Connection refused.` for a local session: nothing is listening; `screen-relay up -d`.
- `Couldn't reach <host>. The host name did not resolve.` or `The TLS certificate was rejected.` for a remote session: check the URL, DNS, certificate and proxy, then `screen-relay status --url <URL>`.
- `unauthorized`: pass the token with `--token-file` or `SCREEN_RELAY_TOKEN_FILE`.
- A viewer that cannot connect through a proxy: the proxy must forward WebSocket upgrades and keep `Host`, `Origin` and `Authorization`.

## References

- `references/cli.md`: commands, options and output.
- `references/config.md`: configuration keys and precedence.
- `references/wayland.md`: Wayland compositors, attaching to one, and its limits.
- `references/macos.md`: macOS attach behaviour, permissions, `--output` display IDs and limits.
- `references/troubleshooting.md`: symptoms and fixes.
- `screen-relay skills get vercel-sandbox`: run screen-relay inside a Vercel Sandbox.
- https://relay.labs.vercel.dev/docs: the published documentation.
