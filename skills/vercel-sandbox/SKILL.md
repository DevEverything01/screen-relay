---
name: vercel-sandbox
description: Run and control relay inside a Vercel Sandbox.
allowed-tools: Bash(relay:*)
---

# Relay in Vercel Sandbox

Create a Vercel Sandbox, then publish relay's port:

```sh
sandbox config ports <name> -p 8080
```

The command prints an HTTPS URL such as `https://<id>.vercel.run`. In the sandbox, copy the relay repository or install it with `./install.sh`, then start relay behind that URL:

```sh
relay up -d --public https://<id>.vercel.run
relay status --json
```

Piped, `up -d` prints the viewer URL, including its `#token=` fragment; treat the whole URL as a secret and share it only through the user's secret channel. `/` must resolve to `https://<id>.vercel.run`; run `relay up -d --public` once the edge URL exists, because the engine accepts only that origin.

Extend the sandbox lifetime when needed:

```sh
sandbox extend <name> 1h
```

## Control it

```sh
relay run -- xterm
relay screenshot /tmp/relay.png
relay click 0.5 0.5
relay type "echo hello"
relay key Enter
relay screenshot /tmp/relay-after.png
```

Coordinates are fractions from `0` to `1`. `type` sends layout-neutral text; `key` sends physical combos (`cmd` and `meta` alias `super`). Start apps with `relay run -- APP [ARGS...]`: it shares the desktop's display, D-Bus session bus (so accessibility tools can find the app) and runtime directories, and clears ambient capabilities. Apps stop with `relay down`.

## Errors in the sandbox

- `unreachable` with `Connection refused.`: the engine is not listening; `relay up -d`. With `The host name did not resolve.` or `The TLS certificate was rejected.`, check the edge URL and certificate, then `relay status --url https://<id>.vercel.run --token-file <FILE>`.
- `unauthorized`: use the session's token with `--token-file FILE` or `RELAY_TOKEN_FILE`.
- `forbidden`: `--public` does not match the URL you reached, or a proxy rewrote `Host`/`Origin`.
- `busy`: a viewer or client already holds control; close it and retry, or keep taking screenshots.
- `component_failed` or `timeout` from `up`: read `data.component`, then `relay logs <component>` and `relay doctor`.

Stop the desktop with `relay down` before stopping the sandbox. Load the full workflow with `relay skills get core`.
