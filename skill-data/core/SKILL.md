---
name: core
description: Control a relay desktop from an agent using screenshots and input commands.
allowed-tools: Bash(relay:*)
---

# Relay core workflow

Relay starts a Linux desktop and provides a browser viewer and CLI control. Load this skill from the installed CLI so its instructions match that version.

## Install and start

On Debian or Ubuntu, install the engine and CLI with `./install.sh`, then add `~/.local/bin` to `PATH` if needed. `./install.sh --client-only` installs only the CLI; the engine itself runs on Linux.

Start a local session with `relay up -d`. It prints the viewer link and any session token; treat both as secrets. For remote access through a TLS proxy, use `relay up -d --public https://desktop.example.com`; the proxy must forward WebSocket upgrades and preserve the required request headers. Docker starts Relay in the foreground; see `docs/docker.md` for the image and loopback port-publish pattern.

## Control loop

1. Capture the current screen: `relay screenshot /tmp/relay.png`.
2. Choose an action based on that image. Use normalized `0..1` screen coordinates with `relay click X Y`, `relay move X Y`, or `relay scroll X Y --dy N`. Use `relay type 'text'` for text or `relay key ctrl+l` for physical key combinations.
3. Capture another screenshot and verify the result before continuing.

Use `relay status --json` to inspect session state. Only one controller can send input at a time; if a viewer or another client holds control, commands can fail with `busy`. Screenshots remain available.

Start GUI applications with `relay run -- APP [ARGS...]`, for example `relay run -- xterm`. This gives the app the managed desktop's display and session environment while clearing ambient capabilities; it also uses the desktop's D-Bus session, which accessibility tools may require. Apps started this way are not supervised and stop with `relay down`.

`type` sends layout-neutral text. `key` sends physical keys, so shortcuts are interpreted using the configured remote keyboard layout.

## Configuration and recovery

The default config is `~/.config/relay/config.yaml`. Resolution can be set up to `1920x1080`; `stream.fps`, bitrate, and `keyboard.layout` are also configurable. Changes apply after restarting the session with `relay down` and `relay up`.

For startup or connection problems, start with `relay doctor`, then inspect `relay logs` or `relay logs COMPONENT`. Check that the CLI is on `PATH`, that the requested port is available, that any proxy preserves `Host` and `Origin`, and that the matching token is used. See the references for command details, configuration, and troubleshooting.

## References

- `references/cli.md`
- `references/config.md`
- `references/troubleshooting.md`
