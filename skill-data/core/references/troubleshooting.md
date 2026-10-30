# Troubleshooting

- Start with `relay doctor`; inspect component output with `relay logs [COMPONENT]`.
- If `relay` is not found, add `<prefix>/bin` (default `~/.local/bin`) to `PATH`.
- For `component_failed` or `timeout`, read the error's component and log tail; `relay logs` has the full logs.
- If the port is occupied, stop the old session or choose another `--port`.
- For `busy`, close the other viewer or client controlling the session; screenshots are unaffected.
- For `unauthorized`, provide the session token with `--token-file` or `RELAY_TOKEN_FILE`.
- For a proxy connection failure, verify HTTPS origin, WebSocket upgrades, and preserved `Host` and `Origin` headers.
- For `Cannot open display`, check the display's `XAUTHORITY`; do not use `xhost +`.
