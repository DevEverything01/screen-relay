# Troubleshooting

The published guide is at https://relay.labs.vercel.dev/docs/troubleshooting.

Start with `relay doctor`; it prints a fix command for every failing check. Read logs with `relay logs [component]` (`display`, `dbus`, `desktop`, `engine`, `apps`; `-f` follows). Add `--json` for `{"logs": {...}}`.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `relay: command not found` | `<prefix>/bin` (default `~/.local/bin`) is not on `PATH`. | `export PATH="$HOME/.local/bin:$PATH"`. |
| `component_failed` from `up`, or `status` shows `failed` | A component exited during startup or after ready. The session stops. | Read `data.component`, then `relay logs <component>`. For `-d`, also read `supervisor.log` in the directory named by `session.logs` in `relay status --json`. |
| `timeout` from `up` | The engine or desktop was not ready within `--timeout` (default 30 s). | Read the log tail in the error; raise `--timeout` on a slow machine. |
| `already_running` | A session with that name is running. | `relay down --name NAME`, or use another `--name` and `--port`. |
| Engine log says `Cannot listen on 127.0.0.1:8080` | Another process owns the port. | `relay up --port 8081`, or stop the old session. |
| `busy` | A viewer or SDK session holds control, or a screenshot is already running. | See One controller in `relay skills get core`. Screenshots still work. A long `type` may have stopped partway; `data.applied` says how far. |
| `unauthorized` | Missing or wrong token. | Pass `--token-file FILE` or set `RELAY_TOKEN_FILE`; open the viewer from its `#token=` link. |
| `forbidden` | `Host` or `Origin` was rejected. | Use the `--public` URL, or connect through loopback. |
| `unreachable` with `Connection refused.` | Nothing is listening on the address. | Check the port; for a local session run `relay up -d`. |
| `unreachable` with `The host name did not resolve.` | DNS failure for the remote host. | Check the host name, then `relay status --url <URL>`. |
| `unreachable` with `The TLS certificate was rejected.` | The certificate is not trusted or names another host. | Use a trusted certificate for the public host, or pass the local session's certificate. |
| `not_running` / `not_found` | No session, logs or skill with that name. | `relay up -d`, or `relay skills list`. |
| `invalid_config` | A config key or value is invalid. The message names the file and key path. | Fix the file; every problem is reported at once. |
| `missing_dependency` | A host program or the engine binary is missing. | `./install.sh` with your `--backend`, or check `relay doctor`. |
| Engine log names a missing Wayland protocol (`zwlr_screencopy_manager_v1`, `zwp_virtual_keyboard_manager_v1` or `zwlr_virtual_pointer_manager_v1`) | The compositor from `--display` lacks it. | Attach to a supported compositor. See [Wayland](https://relay.labs.vercel.dev/docs/wayland). |
| Engine log shows `Unsupported root size` | The attached output is outside 320x240 to 16384x16384, or has an odd side. | Create a headless output of a supported size and pass its name with `--output`. |
| `missing_input` saying `XDG_RUNTIME_DIR is required` | `--display` on wayland without `XDG_RUNTIME_DIR`. | Export the compositor's runtime directory. If it is `/run/user/$(id -u)`, run `export XDG_RUNTIME_DIR=/run/user/$(id -u)`. |
| `component_failed` or `timeout` for `display` with `--backend wayland` | sway did not start or did not report its displays. | `RELAY_BACKEND=wayland relay doctor`, then `relay logs display`. |
| Blank viewer page or WebCodecs error | The browser lacks H.264 WebCodecs, or the page is not a secure context. | Use a current Chrome, Edge or Safari over `https://` or `http://127.0.0.1`. |
| Viewer cannot connect through a proxy | The proxy drops WebSocket upgrades or rewrites headers. | Forward `/stream`, `/control`, `/input` and the rest without a path prefix, and keep `Host`, `Origin` and `Authorization`. |
| `Cannot open display` with `--display` | Missing `XAUTHORITY` for that display. | Export the session's `XAUTHORITY`; never use `xhost +`. |
| `invalid_input` saying `--display is not supported on macOS` | macOS attaches to the current display on its own. | Remove `--display`; use `--output DISPLAY_ID` to pick a display. |
| Engine log says `Screen capture permission is missing`, `Screen Recording permission is missing` or `Accessibility permission is missing`, or `doctor` fails `permissions` | The app that started relay lacks the permission. | See macOS permissions below. |
| Engine log says `Display N not found; active displays: ...` | `--output` is not a CGDirectDisplayID of an active display. | Use one of the listed IDs. |
| Engine log says `The display changed from ... restart relay to stream it` | The display's size, position or ID changed during the session. The stream stops. | `relay down`, then `relay up -d`. |

## macOS permissions

Grant both permissions to the app that starts relay, such as your terminal, then restart that app and run `relay doctor` again:

- Screen Recording: System Settings > Privacy & Security > Screen & System Audio Recording.
- Accessibility: System Settings > Privacy & Security > Accessibility.

`relay doctor` reports them in the `permissions` check, which is skipped (a warning) until the `engine` check passes. The `Homebrew packages` check is fixed with `brew install pkgconf x264 libwebsockets`.

## Doctor checks that need a manual step

`relay doctor` prints the fix for each failing check. These checks need more than a package install:

| Check | Cause | Fix |
| --- | --- | --- |
| `libx264` on Ubuntu | The x264 package is in the `universe` component. | Rerun `./install.sh`. It adds `universe` to `/etc/apt/sources.list.d/ubuntu.sources` and updates apt. If that file does not exist, enable `universe` in your apt sources, run `sudo apt-get update`, then rerun `./install.sh`. |
| `libx264` on Fedora | x264 comes from RPM Fusion Free, which the installer stops on when it is not enabled. | Run `sudo dnf -y install https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm`, then rerun `./install.sh`. |
| `icon decoding` with `bubblewrap failed` | Image loaders sandbox themselves with `bwrap`, which needs unprivileged user namespaces. | Allow them for `bwrap`, with an AppArmor profile or `kernel.unprivileged_userns_clone=1`, then run `relay doctor` again. relay does not turn the sandbox off. |
