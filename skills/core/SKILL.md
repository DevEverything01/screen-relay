---
name: core
description: Control a relay desktop from an agent using screenshots and input commands.
allowed-tools: Bash(relay:*)
---

# Relay core workflow

Relay runs a Linux desktop on X11 or Wayland and gives you a browser viewer plus CLI control.

## Install

On the Linux machine that will show the desktop, from a clone of the repository:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
```

- `./install.sh --backend x11|wayland|all` picks the display server to install. The default is `x11`. `wayland` installs sway, XWayland and foot; `all` installs both.
- `--no-deps` skips system packages, so you install the dependencies yourself. `--no-desktop` skips the XFCE desktop packages, D-Bus and fonts on x11. `--prefix DIR` installs under another absolute directory instead of `~/.local`.
- `--client-only` installs only the CLI, for controlling a session on another machine with `--url` and a token file. It has no engine, so `up` does not work there.

Automatic package installation supports Debian, Ubuntu, Fedora, Arch and Alpine, and needs root or passwordless `sudo`. On another distribution, install the dependencies yourself and pass `--no-deps`. The installer ends by running `relay doctor`, and it is safe to run again.

## Pick a backend

`relay up` uses X11 unless you choose Wayland. Install the backend you need first. `relay up -d` starts a virtual X11 display with XFCE. `relay up -d --backend wayland` starts a headless sway desktop with foot:

```sh
relay up -d
relay up -d --backend wayland
```

To show a compositor you already run, start relay from a terminal inside that session. Use the Wayland backend and the socket name from the environment:

```sh
relay up -d --backend wayland --display "$WAYLAND_DISPLAY"
```

`--display` takes an X display such as `:0` on x11, or a Wayland socket such as `wayland-1` with `--backend wayland`. A `--display` without a colon, such as `wayland-1`, selects the Wayland backend on its own. Attach mode uses the display's size and starts no desktop. For compositor setup, output names and limits, see [Wayland](references/wayland.md).

The backend comes from `--backend`, then `RELAY_BACKEND`, then the config file's `backend` key, then the default. To switch backends, run `relay down` first. A session name stays in use while its session runs, so a second `up` fails with `already_running`.

## Where commands run

- VM commands (`up`, `down`, `logs`, `run`, `doctor`) manage the session on the Linux machine that shows the desktop. `up`, `down` and `run` fail with `unsupported_platform` on other systems.
- Client commands (`status`, `screenshot`, `click`, `move`, `scroll`, `key`, `type`, `input`) reach the engine on that machine, either through the local session or with `--url` and a token.

`skills` and `help` work anywhere and never contact an engine.

On the VM, run every command directly. From another machine, only client commands work, and each needs `--url` plus a token file (`--token-file` or `RELAY_TOKEN_FILE`). See [Client target](references/cli.md#client-target).

## Start a session

```sh
relay up -d
relay status --json
```

`up -d` returns once the display, desktop and engine are ready. Piped, it prints the viewer URL, including the `#token=` fragment when the session has a token; treat that URL as a secret.

`status --json` prints `{"session": {...}}`. Read `session.state` (`starting`, `ready`, `stopped`, `failed`), `session.running`, `session.url`, `session.display`. An existing session exits 0 whatever its state; a missing session exits 1 with reason `not_running`.

## Control loop

Work in a loop: screenshot, decide from the image, act, screenshot again to verify.

```sh
relay screenshot /tmp/relay.png
relay click 0.5 0.5
relay type "echo hello"
relay key Enter
relay screenshot /tmp/relay-after.png
```

A complete run that opens a terminal, focuses it, types, and verifies. This uses `xfce4-terminal`, the terminal on X11; on Wayland, use `foot`:

```sh
relay up -d
relay run -- xfce4-terminal
sleep 1
relay screenshot /tmp/relay.png
relay click 0.5 0.5
relay type "echo hello"
relay key Enter
relay screenshot /tmp/relay-after.png
```

- `relay run -- APP [ARGS...]` starts an app on the session desktop and returns its pid at once; the window appears a moment later. Poll `relay screenshot` until you can see it. Read app output with `relay logs apps`. Apps stop with `relay down`.
- `relay screenshot [file]` writes a PNG, default `screen.png`. Pass `-` to write PNG bytes to stdout. View the file; success means the engine saved the frame, not that an app responded.
- Click to focus a window before typing into it. A click also moves the pointer.
- Input success means the engine applied the events, not that the application reacted. Always take another screenshot.

Read a value off the screen by taking a screenshot and reading the pixels or text in the image. `--json` reports geometry and sizes, not OCR:

```json
{"screenshot":{"path":"/tmp/relay.png","width":1920,"height":1080,"bytes":48213},"outcome":"saved"}
```

Scroll a list or page:

```sh
relay scroll 0.5 0.5 --dy 5
relay screenshot /tmp/relay-scrolled.png
```

`--dy` is vertical wheel notches, positive down; `--dx` is horizontal, positive right. At least one must be nonzero. Scrolling moves the pointer to the given point first.

## Coordinates

Coordinates are fractions of the screen from `0` to `1`, measured from the top-left. Convert a pixel from a screenshot:

```text
x = pixel_x / image_width
y = pixel_y / image_height
```

For a 1920x1080 screenshot, pixel `480,810` is `relay click 0.25 0.75`; the center is `relay click 0.5 0.5`. Read `width` and `height` from `relay screenshot file.png --json`, or use the image size directly.

## type versus key

- `relay type <text>` sends layout-neutral text events, one per Unicode scalar value. The remote keyboard layout decides each character, so accented letters, symbols and non-US layouts work. Use it for text and content.
- `relay key <combo>...` sends physical key combinations: `relay key ctrl+l`, `relay key alt+Tab`, `relay key cmd+shift+t`, `relay key Enter`. Use it for shortcuts, arrows, function keys and Escape. Modifiers are `ctrl`, `shift`, `alt`, `super`; `cmd`, `meta` and `win` are aliases of `super`. Press several combos in one call to send them in order.
- A long `relay type` is split into batches of at most 256 events. If a later batch fails, the JSON error carries `data.applied`, the number of events the engine confirmed. When the engine answered with the error (`busy`, `invalid_input`, `unsupported_input`), resend only the remaining text. When the reply was lost (`timeout`, `unreachable`, `disconnected`), the last batch may already be on screen: take a screenshot before resending anything.

## JSON

Add `--json` to any command. Success writes exactly one document with a trailing newline to stdout and leaves stderr empty; pretty-printed with two spaces on a TTY, compact otherwise.

| Command | Shape |
| --- | --- |
| `relay up -d --json` | `{"session":{...},"outcome":"started"}` |
| `relay down --json` | `{"session":{...},"outcome":"stopped"}` or `"unchanged"` |
| `relay status --json` | `{"session":{...}}` |
| `relay screenshot file.png --json` | `{"screenshot":{"path","width","height","bytes"},"outcome":"saved"}` |
| `relay click`, `move`, `scroll`, `key`, `type`, `input` | `{"input":{"events":N},"outcome":"sent"}` |
| `relay run -- APP --json` | `{"app":{"pid":N,"command":["APP"]},"outcome":"started"}` |
| `relay logs engine --json` | `{"logs":{"engine":"..."}}` |
| `relay doctor --json` | `{"checks":[...],"summary":{"ok","passed","warnings","failed"}}` |
| `relay skills list --json` | `{"skills":[{"name","description"}]}` |

Success may also carry `warnings: [{reason, message}]` and `next: [{command, argv}]`.

On failure, stdout is empty and stderr has one compact document:

```json
{"status":"error","reason":"busy","message":"Another controller holds control of the desktop.","data":{"httpStatus":409}}
{"status":"action_required","reason":"invalid_input","message":"Invalid x: '2'.","next":[{"command":"relay help click","argv":["relay","help","click"]}]}
```

- `status` is `action_required` when the command stopped before any effect and input would let it run; otherwise `error`.
- `reason` is the stable snake_case code. Match it, not the message.
- `next` is optional. `command` is the full command line and `argv` is the same command split, starting with `relay`. Run `next[0].command` when present.
- `data` carries context: `component` and `logs` after a component failure, `applied` after a partial input batch, `httpStatus` from the engine.

Exit codes: 0 success (including `status` of any existing session), 1 runtime, network, permission, config or missing-session failure, 2 usage or missing input, 130 interrupted, 128+n for signal n.

## Reasons and recovery

| Reason | Meaning | Recovery |
| --- | --- | --- |
| `busy` | Another controller holds input, or a screenshot is already running. | See [One controller](#one-controller). Screenshots still work. |
| `unauthorized` | Missing or wrong token. | Pass `--token-file FILE` or set `RELAY_TOKEN_FILE`; open the `#token=` viewer link. |
| `forbidden` | The engine rejected `Host` or `Origin`. | Use the `--public` URL or loopback. |
| `unreachable` | Cannot connect to the address, one of `Connection refused.`, `The host name did not resolve.` or `The TLS certificate was rejected.` | Check the address, then `relay status --url <URL>`. |
| `timeout` | No reply within `--timeout`, or `up` was not ready in time. | Raise `--timeout`; for `up`, read the component log. |
| `not_running` | No session or logs with that name. | `relay up -d`. |
| `not_found` | No running session for `run` or a skill, or an unknown engine endpoint. | Start the session, or `relay skills list`. |
| `already_running` | A session with that name is already running. | `relay down --name N`, or pick another name and port. |
| `component_failed` | display, desktop, engine, supervisor or an app exited. `data.component` and `data.logs` are set. | `relay logs <component>`. |
| `missing_dependency` | A host program or the engine binary is missing. | `./install.sh` or `relay doctor`. |
| `missing_command` | `run` was given no app (exit 2). | `relay run -- APP`. |
| `spawn_failed` | `run` could not start the app. | Check the app name and `relay logs apps`. |
| `unsupported_input` | The backend cannot produce a character or apply the input. | Use `relay type` for layout-neutral text. |
| `unsupported_platform` | `up`, `down` or `run` off Linux. | Run host commands on the Linux machine. |
| `invalid_config` | A config key or value is invalid; the message names the file and key. | Fix the file and start again. |
| `invalid_input`, `invalid_option`, `unknown_command`, `missing_input` | Usage error (exit 2). | Read the `next` command, usually `relay help <command>`. |
| `internal` | A bug in relay. | Report it with the command you ran. |

## One controller

Only one controller sends input at a time: a browser viewer, an SDK control session, or your CLI. A second controller gets `reason: "busy"` with the message `Another controller holds control of the desktop.`; nothing is applied. Screenshots, `status` and `capabilities` keep working. Do not retry in a loop; wait for the other controller to close, then retry once.

## Config

Settings come from flags, `RELAY_*` variables, or the config file at `${XDG_CONFIG_HOME:-~/.config}/relay/config.yaml`, which `relay up` reads when it exists. The keys, defaults and precedence are in [references/config.md](references/config.md).

## Troubleshooting

- Start with `relay doctor`. It checks the x11 backend unless `RELAY_BACKEND` or the config `backend` key says otherwise; for Wayland, run `RELAY_BACKEND=wayland relay doctor`. Each failing check prints a fix. Some fixes are manual; see [references/troubleshooting.md](references/troubleshooting.md).
- `relay logs` prints the last 200 lines of every component log; `relay logs engine` (or `display`, `dbus`, `desktop`, `apps`) selects one. `-f` follows.
- `component_failed` or `timeout` from `up`: read `data.component` and `data.logs`, then `relay logs <component>`.
- Port already in use: `relay down` the old session, or use another `--port`.
- `Couldn't reach <host>. Connection refused.` for a local session: nothing is listening; `relay up -d`.
- `Couldn't reach <host>. The host name did not resolve.` or `The TLS certificate was rejected.` for a remote session: check the URL, DNS, certificate and proxy, then `relay status --url <URL>`.
- `unauthorized`: pass the token with `--token-file` or `RELAY_TOKEN_FILE`.
- A viewer that cannot connect through a proxy: the proxy must forward WebSocket upgrades and keep `Host`, `Origin` and `Authorization`.

## References

- `references/cli.md`: commands, options and output.
- `references/config.md`: configuration keys and precedence.
- `references/wayland.md`: Wayland compositors, attaching to one, and its limits.
- `references/troubleshooting.md`: symptoms and fixes.
- `relay skills get vercel-sandbox`: run relay inside a Vercel Sandbox.
- https://relay.labs.vercel.dev/docs: the published documentation.
