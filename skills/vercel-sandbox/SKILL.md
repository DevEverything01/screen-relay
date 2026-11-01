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

With the default install, the desktop is X11 with XFCE, so start a terminal with `xfce4-terminal`:

```sh
relay run -- xfce4-terminal
relay screenshot /tmp/relay.png
relay click 0.5 0.5
relay type "echo hello"
relay key Enter
relay screenshot /tmp/relay-after.png
```

The rules for coordinates, `type`, `key`, apps and control are in `relay skills get core`.

## Errors in the sandbox

- `unreachable` with `Connection refused.`: the engine is not listening; `relay up -d`. With `The host name did not resolve.` or `The TLS certificate was rejected.`, check the edge URL and certificate, then `relay status --url https://<id>.vercel.run --token-file <FILE>`.
- `unauthorized`: use the session's token with `--token-file FILE` or `RELAY_TOKEN_FILE`.
- `forbidden`: `--public` does not match the URL you reached, or a proxy rewrote `Host`/`Origin`.
- `busy`: another controller holds input. See One controller in `relay skills get core`.
- `component_failed` or `timeout` from `up`: read `data.component`, then `relay logs <component>` and `relay doctor`.

Stop the desktop with `relay down` before stopping the sandbox. Load the full workflow with `relay skills get core`.
