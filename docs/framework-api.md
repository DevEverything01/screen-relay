# Local framework API

The Node SDK targets Node 22 or newer and has no runtime npm dependencies. The server uses a local, unauthenticated trust profile: publish the Docker port on loopback only, and use an isolated desktop. Anyone able to reach the server can control that desktop. Host and browser Origin checks reduce browser-based exposure; they do not provide authentication or secure remote access. Wayland, audio, clipboard, IME and remote deployment are not provided.

```js
import { connect } from "./sdk/index.js";
const desktop = await connect({ url: "http://127.0.0.1:18094" });
try {
  console.log(await desktop.capabilities(), desktop.surface);
  await desktop.input({ type: "pointerMove", x: 0.5, y: 0.5 });
  await desktop.input({ type: "buttonDown", button: 1, x: 0.5, y: 0.5 });
  await desktop.input({ type: "buttonUp", button: 1, x: 0.5, y: 0.5 });
  await desktop.snapshot("screen.png");
} finally { desktop.close(); }
```

`connect` acquires the exclusive control connection and waits for a ready message. Closing or losing the connection releases held keys and buttons. Reconnect explicitly with a new `connect`; input is never replayed. Input resolves when the server acknowledges it; this does not guarantee an application has processed it. `snapshot()` returns PNG bytes and optionally writes them to a path. It captures the native X11 surface rather than a browser canvas. `capabilities()` and `status()` are also exported independently, so discovery does not require control. Status is the existing cgroup metrics endpoint and can be unavailable where cgroup metrics are unsupported.

Input types are `keyDown` and `keyUp` with a USB HID `key`; `pointerMove` with normalized `x`, `y`; `buttonDown` and `buttonUp` with `button` 1–3 and coordinates; `wheel` with `axis`, a signed `delta` in multiples of 120 within ±1200, and coordinates; and `releaseAll`. Coordinates must be finite numbers from 0 to 1. The X11 input implementation defines supported HID mappings; capabilities does not enumerate them. Errors expose a `code`, including `INVALID_ARGUMENT`, `UNSUPPORTED`, `NETWORK_ERROR`, `DISCONNECTED`, `PROTOCOL_ERROR`, `TIMEOUT`, `BUSY`, `HTTP_ERROR`, and `IO_ERROR`.

The CLI uses `NATIVE_STREAM_URL` (default `http://127.0.0.1:8080`) and emits JSON on stdout; errors are JSON on stderr with nonzero exit status. Run it directly from the repository or install the package locally:

```sh
node sdk/cli.js capabilities
node sdk/cli.js status
node sdk/cli.js snapshot screen.png
node sdk/cli.js input '[{"type":"keyDown","key":4},{"type":"keyUp","key":4}]'
```

The input command holds one connection for the whole batch and closes it even on failure. One owner controls the desktop at a time: a viewer or an SDK control connection. A viewer cannot connect concurrently with an agent controller. Snapshots are available independently of the viewer; one snapshot can be outstanding globally, and a busy or unavailable snapshot returns HTTP 503 without blocking the streaming event loop. `close()` starts closing the socket; the server releases controls when it observes the closure.

## Protocol and verification

`/control` uses WebSocket subprotocol `nsl1` and the existing big-endian NSL1 envelope. Ready is type 4 with nonzero generation and a four-byte width/height payload. Input is type 3 with a nonzero request sequence and the existing 16-byte input payload. Type 5 echoes that sequence and contains a status byte: 0 success, 1 invalid, 2 unsupported. The SDK rejects malformed messages and times out pending requests. Discovery and PNG are `GET /capabilities` and `GET /snapshot.png`; existing `GET /metrics` supplies status. The human viewer uses the same native input validation and ownership contract.

Run `node --test sdk/index.test.js` for SDK protocol and lifecycle checks. Full integration additionally requires the native server and checks fresh PNG pixels without a viewer, input parity and held-control release, controller conflicts, malformed input, Host/Origin handling, and streaming flow while snapshots run. The SDK tests alone do not establish those native or browser behaviors.
