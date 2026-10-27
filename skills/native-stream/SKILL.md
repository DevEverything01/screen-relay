---
name: native-stream
description: Set up native-stream in an existing compatible Linux VM or sandbox, attach to an X11 display or create an optional desktop, and verify browser streaming and agent input. Use when a coding agent needs a streamed Linux desktop without depending on a sandbox provider.
---

# Native streaming in your environment

Use the user's existing Linux environment and their chosen connection mechanism.
The engine streams an X11 display; desktop installation and VM provisioning are
separate. Do not replace an existing desktop or assume Docker is available.

Locate the supplied native-stream source/release and read its `docs/portable.md`
for the current runtime contract and commands. If that document is unavailable,
obtain the matching release documentation before constructing installation steps.
This skill ships with the repository; it does not depend on a fixed checkout path.

1. Inspect Linux distribution, CPU architecture, package/install permissions,
   process lifetime, reachable ports/tunnels, and any existing `DISPLAY` and
   `XAUTHORITY`. The implemented backend needs a local 1280×720 X11 display with
   MIT-SHM, XDamage, XFixes and XTest. Wayland-only capture is not implemented.
2. If a compatible display exists, install only the engine with `./install.sh`
   and launch `native-stream-engine` with that session's display credentials.
   Leave its apps, desktop processes and display ownership with the user.
3. If a new desktop is wanted, the Debian/Ubuntu source-checkout path is:
   ```sh
   ./install.sh --desktop
   ~/.local/bin/native-stream-desktop
   ```
   This installs dependencies and builds before startup; it is not an instant
   binary download. For another distribution, use its package manager to provision
   equivalents, then `--no-deps`. Prefer a compatible pre-provisioned image when
   the sandbox has no package permissions. Use the optional launcher's `--session`
   or `--no-desktop` when XFCE is not desired. Never disable X access control with
   `xhost +` or overwrite existing X locks.
4. Keep the default loopback listener when using a secure tunnel. For remote
   HTTPS, use the documented private token file and exact public origin with
   either native TLS or the environment's trusted TLS gateway. Verify WebSocket
   upgrades and header preservation. `--behind-tls-proxy` is an explicit assumption
   about the private backend route; it does not provision TLS. Do not use the
   Docker-only `--insecure-local` profile for a public sandbox endpoint.
5. Wait for the readiness record and fetch a fresh screenshot. Open the viewer
   and verify decoded frames. In a disposable fixture window, send an input and
   observe the application's resulting state; an input ACK alone is insufficient.
   Missing cgroup counters mean unavailable resource telemetry, not a failed
   stream. Report display and browser compatibility failures explicitly.
6. Return the reachable viewer URL, connection instructions, log location and
   exact stop command. Share the token through the user's secret mechanism, never
   a URL or report. Stop only the processes this setup owns. A directly attached
   engine must leave the existing display running when stopped.

Human viewer and SDK controller are currently exclusive; independent snapshots
can run while the viewer owns control. Audio, clipboard, IME, Wayland and dynamic
resize are not implemented. A successful setup in one environment does not prove
support for every provider, distribution or gateway.
