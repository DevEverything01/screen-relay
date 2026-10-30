# CLI reference

Start a managed desktop with `relay up [-d]`. Useful options include `--name`, `--config`, `--port`, `--desktop`, `--display`, `--public`, `--tls-cert`, `--tls-key`, `--bind`, and `--timeout`. `--public` accepts an HTTPS origin and expects a TLS proxy unless native TLS certificates are configured.

Use `relay status --json` for machine-readable session state, `relay logs [COMPONENT]` for component logs, `relay doctor` for host checks, and `relay down` to stop the session. `relay run -- APP [ARGS...]` starts an application inside the managed desktop environment.

For interaction, `relay screenshot FILE` saves a PNG; `relay click X Y`, `relay move X Y`, and `relay scroll X Y --dy N` use normalized `0..1` coordinates. `relay type TEXT` sends text; `relay key COMBO` sends physical keys. Client commands accept `--url`, `--token-file`, and `--timeout` when targeting a remote session.
