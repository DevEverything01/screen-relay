# Relay MCP App

A prototype that shows a relay desktop inside an MCP App. The resource embeds the built viewer directly and connects to the relay server over WebSocket, so it does not need a nested iframe.

| File | Role |
| --- | --- |
| `server.ts` | Builds the server and serves it over stdio or streamable HTTP |
| `tools.ts` | Registers `open_desktop`, `desktop_screenshot`, `desktop_action`, and `browser_action` |
| `viewer.ts` | Registers the `ui://` resource and its CSP metadata |
| `direct-viewer.ts` | Adapts the built viewer bundle at request time |
| `direct-ui.js` | Bridges MCP messages to the embedded viewer |
| `config.ts` | Reads and validates the relay origin and token |
| `sandbox.ts` | Runs automation commands in the sandbox |

## Setup

Build relay first (the prototype reads `dist/viewer/` and imports `dist/sdk/index.js`). Run the desktop in a Linux VM or Vercel Sandbox, not on your host display.

```sh
npm run build
cd examples/mcp-app && npm install
```

## Run

Set the relay origin. It must match the origin in the URL passed to `open_desktop`.

```sh
RELAY_ORIGIN=https://your-sandbox.vercel.run RELAY_TOKEN="$RELAY_TOKEN" npm run start:http
```

The MCP endpoint is `http://localhost:3001/mcp`. Without `--http`, the server uses stdio.

The HTTP mode listens on loopback only, rejects any request whose `Host` is not this server, and rejects an `Origin` that is not served from this machine. That stops DNS rebinding from reaching the desktop tools while letting a local host such as `http://localhost:8080` connect.

For the ext-apps basic host:

```sh
cd /path/to/ext-apps/examples/basic-host
npm install && npm run start
```

Open `http://localhost:8080`, choose `open_desktop`, and call it with the viewer URL. Use `desktop_screenshot` afterwards to capture the same session.

Configure `RELAY_TOKEN` in the MCP server environment, then omit the `token` tool argument. The result carries the token only in `_meta`, not model-visible content. Supplying a token as a tool argument exposes it to the conversation.

## Claude rendering

The tested Claude host blocked a nested iframe, despite the resource declaring the relay origin in `frameDomains`. The resource therefore declares the HTTPS and WSS origins in `connectDomains` and renders the viewer inline.

The adapter changes the built viewer in memory: it takes the token from the tool result, waits for MCP initialization, and targets the relay origin explicitly. It retains the viewer's trusted-page check. Neither `viewer/` nor `src/` is changed. If the viewer bundle changes enough that the adapter cannot identify its startup code, resource loading fails with an error.

## Desktop and browser tools

Two tools drive the same sandbox the stream comes from. `desktop_action` runs [agent-desktop](https://github.com/vercel-labs/agent-desktop), and `browser_action` runs [agent-browser](https://agent-browser.dev). Each takes an `args` array and returns the command's stdout and stderr.

Set `RELAY_SANDBOX` to the sandbox name, and `RELAY_SANDBOX_SCOPE` when it belongs to a team:

```sh
RELAY_SANDBOX=relay-hi RELAY_SANDBOX_SCOPE=team_xxx npm run start:http
```

Install both tools in the sandbox, then copy the wrapper that loads the desktop environment:

```sh
npm install -g agent-desktop
~/relay/node_modules/.bin/agent-browser install --with-deps
```

Copy `relay-env` to `/vercel/.local/bin/relay-env` and make it executable. It reads `display`, `xauthority`, and the session D-Bus address from relay's `session.json` before running a command, which is what lets these tools reach the running desktop.

```json
{ "name": "desktop_action", "arguments": { "args": ["list-windows"] } }
{ "name": "browser_action", "arguments": { "args": ["open", "https://example.com"] } }
```

agent-desktop reads the accessibility tree, so it only sees apps that publish one. A GTK app started on the desktop bus with `GTK_MODULES=gail:atk-bridge` appears in `list-windows`; SDL games such as Doom never do. agent-browser controls its own headless Chrome, so it is unaffected by what the desktop shows.

## Verification

From this directory, with the server environment set:

```sh
node check.mjs
```

Alternatively, `RELAY_TOKEN_FILE` can point to the sandbox session's token file for the check. The check reads the resource through MCP, checks that credentials stay out of model-visible results, exercises both UI initialization orders, captures a screenshot, and tests a WebSocket upgrade with a foreign HTTPS Origin. It does not decode video or drive a browser.

The check passed against a Vercel Sandbox with a 1280×720 screenshot, including after a fresh relay build. In Claude Desktop's Code chat, the resource rendered inline, reported `Live · click to control`, and displayed the sandbox desktop. Its generated frame policy included both configured connection origins. Codex rendered the same resource inline at 1280×720.

The direct viewer's optional capabilities and metrics fetches are cross-origin and remain subject to the engine's CORS policy. WebSocket streaming does not use that HTTP CORS flow. Mouse and keyboard, fullscreen, and clipboard still need host testing; the viewer source currently has no clipboard integration.
