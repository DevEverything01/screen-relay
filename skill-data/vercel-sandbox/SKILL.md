---
name: vercel-sandbox
description: Run and control relay inside a Vercel Sandbox.
allowed-tools: Bash(relay:*)
---

# Relay in Vercel Sandbox

Create a Vercel Sandbox, then publish Relay's default port:

```sh
sandbox config ports <name> -p 8080
```

The command prints an HTTPS URL such as `https://<id>.vercel.run`. In the sandbox, copy the Relay repository or install it with `./install.sh`, then start Relay behind that URL:

```sh
relay up -d --public https://<id>.vercel.run
```

Open the viewer link printed by Relay. It contains the session token in the URL fragment; treat the full link as a secret. Extend the sandbox lifetime when needed:

```sh
sandbox extend <name> 1h
```

Stop the desktop with `relay down` before stopping the sandbox. Agents controlling apps inside the sandbox need the desktop's environment: start applications with `relay run -- APP [ARGS...]`. Accessibility tools that use D-Bus need the desktop's `DBUS_SESSION_BUS_ADDRESS`.
