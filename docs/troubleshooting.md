# Troubleshooting

Start with `relay doctor`. It prints the fix command for each problem it finds. Logs: `relay logs [display|desktop|engine]`. Error codes: [CLI reference](cli.md#error-codes).

| Symptom | Cause | Fix |
| --- | --- | --- |
| `relay: command not found` after `./install.sh` | `~/.local/bin` (or `<prefix>/bin`) is not on `PATH`. `install.sh` prints a `Not on PATH` line. | `export PATH="$HOME/.local/bin:$PATH"`, or run `~/.local/bin/relay`. |
| XFCE aborts with `default_icon_at_size` assertion (libwnck) | Fresh Ubuntu 26.04. gdk-pixbuf 2.44 decodes images through `glycin-loaders`, which `--no-install-recommends` skips. Glycin's bubblewrap also refuses to run when an unprivileged user holds ambient capabilities. | Re-run `./install.sh`; it installs the loaders. `up` clears ambient capabilities for desktop processes. `doctor` checks icon decoding. By hand: `sudo apt-get install glycin-loaders`. |
| `component_failed` from `up`, or `status` shows `failed` | A component exited during startup or after ready. The session stops. | The error names the component, exit code and log tail. Read `relay logs <component>`. For `-d`, also `supervisor.log` in the state directory. |
| `timeout` from `up` | The engine or desktop was not ready within `--timeout` (default 30 s). | Read the log tail in the error. On a slow machine, raise `--timeout`. |
| `already_running` | A session with that name is running. | `relay down --name N`, or use another `--name` and `--port`. |
| `engine exited with code 1` and `Cannot listen on 127.0.0.1:8080` in the log | Another session or process owns the port. | `relay up --port 8081`, or `relay down` the old session. |
| Blank page, "WebCodecs" or decoder error | Browser lacks H.264 WebCodecs, or the page is not a secure context. | Use current Chrome, Edge or Safari over `https://` or `http://127.0.0.1`. |
| Viewer or command says busy (HTTP 409) | One controller at a time. A viewer or an SDK session holds control. | Close the other viewer or SDK session, then retry. Screenshots are not affected. A long `type` may have stopped partway; the error's `applied` says how far. |
| `busy` from `screenshot` (HTTP 503) | A screenshot is already running. | Retry. Only one runs at a time. |
| `unauthorized` (HTTP 401) | Missing or wrong token. | Pass `--token-file` or set `RELAY_TOKEN_FILE`. Open the viewer from the `#token=` link. From the host to a container: [Docker](docker.md#control-from-the-host). |
| `unauthorized` (HTTP 403) | `Host` or `Origin` is not loopback or the `--public` URL. | Connect through `127.0.0.1`/`localhost`, or through the `--public` URL with the proxy keeping `Host` and `Origin`. |
| Viewer cannot connect through a proxy | Proxy drops WebSocket upgrades, rewrites `Host` or `Origin`, or the `--public` URL does not match. | See [Remote access](remote-access.md#behind-a-tls-proxy). |
| `install.sh` fails on a non-apt distro | Automatic dependencies need apt. | Install the equivalent packages, then `./install.sh --no-deps`. |
| `Cannot open display` with `--display` | Missing `XAUTHORITY` for that display. | Export the session's `XAUTHORITY`. Never run `xhost +`. |
| Metrics show `resources_available: false` | No cgroup v2 counters. | Harmless. Streaming is unaffected. |
