# Troubleshooting

Start with `native-stream doctor`. It prints the fix command for each problem it finds. Logs: `native-stream logs [display|desktop|engine]`.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `invalid token` or the engine exits right after start | Token must be 64 lowercase hex characters. | Let `up` generate it. For a manual token: `openssl rand -hex 32`. |
| XFCE aborts with `default_icon_at_size` assertion (libwnck) | Fresh Ubuntu 26.04. gdk-pixbuf 2.44 decodes images through `glycin-loaders`, which `--no-install-recommends` skips. Glycin's bubblewrap also refuses to run when an unprivileged user holds ambient capabilities. | Re-run `./install.sh`. It installs the loaders. `up` clears ambient capabilities for desktop processes. `doctor` reports both. By hand: `sudo apt-get install glycin-loaders`. |
| `up` reports a failed component | A process exited during startup or the settle window. | The error names the component, exit code and log tail. Read `native-stream logs <component>`. |
| Port already in use | Another session or process owns the port. | `native-stream up --port 8081`, or `native-stream down` the old session. |
| Blank page, "WebCodecs" or decoder error | Browser lacks H.264 WebCodecs, or the page is not a secure context. | Use current Chrome, Edge or Safari over `https://` or `http://127.0.0.1`. |
| Viewer or command says busy (HTTP 409) | One controller at a time. A viewer, an SDK session or an earlier `input` holds control. | Close the other viewer or SDK session, then retry. Snapshots are not affected. |
| Viewer cannot connect through a proxy | Proxy drops WebSocket upgrades, rewrites `Host` or `Origin`, or the `--public` URL does not match. | See [Remote access](remote-access.md#behind-a-tls-proxy). |
| 401 from the API | Missing or wrong token. | Pass `--token-file` or set `NATIVE_STREAM_TOKEN_FILE`. Open the viewer from the `#token=` link. |
| Snapshot returns 503 | A snapshot is already running. | Retry. Only one runs at a time. |
| `up` fails on a non-apt distro | `install.sh` only installs apt packages. | Install the equivalent libraries, then `./install.sh --no-deps`. |
| `Cannot open display` with `--display` | Missing `XAUTHORITY` for that display. | Export the session's `XAUTHORITY`. Never run `xhost +`. |
| Docker: black screen or crashes | Missing shared memory. | Add `--shm-size=512m`. |
| Metrics show `resources_available: false` | No cgroup v2 counters. | Harmless. Streaming is unaffected. |
