# macOS

On macOS, `relay up -d` streams the logged-in user's display. It starts no virtual display and no desktop.

## Install

```sh
./install.sh
```

The installer uses Homebrew for `pkgconf`, `x264` and `libwebsockets` and builds the `macos` backend. `--backend` accepts only `macos`. Without Homebrew, install the packages yourself and pass `--no-deps`. Node 26 or newer is required. The installer's Node download requires macOS 13.5 or later; on macOS 12.3 through 13.4, install a compatible Node version first.

## Permissions

Grant both to the app that starts relay, such as your terminal, then restart that app:

- Screen Recording: System Settings > Privacy & Security > Screen & System Audio Recording.
- Accessibility: System Settings > Privacy & Security > Accessibility.

`relay doctor` reports them in the `permissions` check. macOS 12.3 or later is required.

## Start a session

```sh
relay up -d
relay run -- open -a Terminal
```

- `--display` fails with `invalid_input`, and `display.resolution` is ignored with a warning.
- `--desktop` has no effect; the desktop is always `none`.
- `relay run` starts apps on your display and clears `DISPLAY`, `WAYLAND_DISPLAY` and `XAUTHORITY`.

## Choose a display

Without `--output`, relay streams the main display. `--output` takes a CGDirectDisplayID, a number. If the ID is not an active display, `up` fails and the engine log lists the active display IDs.

```sh
relay up -d --output 69733382
```

## Limits

- The stream uses the display's native pixel size, halved until it fits the engine's maximum frame size.
- The pointer is not drawn into the video. The viewer shows its own arrow.
- If the display's size, position or ID changes, the engine stops the stream. Run `relay down` and `relay up -d` again.
