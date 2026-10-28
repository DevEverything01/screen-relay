# Node SDK

A library for Node 22+ with no runtime dependencies. The SDK has no CLI. Use [`relay`](cli.md) for command-line control.

```sh
npm install /absolute/path/to/this/repo
```

```js
import { connect } from 'relay';

const desktop = await connect({ url: 'http://127.0.0.1:8080' });
try {
  await desktop.input({ type: 'pointerMove', x: 0.5, y: 0.5 });
  await desktop.snapshot('screen.png');
} finally {
  desktop.close();
}
```

## Options

Every function takes `{ url, timeout, token }`.

| Option | Rule |
| --- | --- |
| `url` | Default `http://127.0.0.1:8080`. Origin only: no path, credentials, query or fragment. Plain HTTP only for `localhost` and `127.0.0.1`. Other hosts need HTTPS. |
| `token` | 64 lowercase hex characters. Required for remote hosts. |
| `timeout` | Milliseconds per request. Default 5000. |

Redirects are not followed. Token handling: [Remote access](remote-access.md#tokens).

## Functions

| Function | Needs control | Returns |
| --- | --- | --- |
| `connect(opts)` | Takes it | Session with `input`, `snapshot`, `capabilities`, `status`, `close`, `surface` |
| `capabilities(opts)` | No | Backend, dimensions, features |
| `status(opts)` | No | Transport metrics. Resource counters are `null` when unavailable. |
| `snapshot(opts, path?)` | No | PNG bytes. Writes to `path` if given. Works while a viewer is connected. |

`connect` waits for the ready message. Closing or losing the connection releases held keys and buttons. Input is never replayed on reconnect. A resolved `input` means the server accepted it, not that the application acted.

## Input events

| Type | Fields |
| --- | --- |
| `keyDown`, `keyUp` | `key`: USB HID usage (0 to 231) |
| `pointerMove` | `x`, `y` in 0 to 1 |
| `buttonDown`, `buttonUp` | `button` 1 to 3, `x`, `y` |
| `wheel` | `axis` `"vertical"` or `"horizontal"`, `delta` multiple of 120 within +-1200, `x`, `y` |
| `releaseAll` | none |

## Errors

Errors have a `code`: `INVALID_ARGUMENT`, `UNSUPPORTED`, `NETWORK_ERROR`, `DISCONNECTED`, `PROTOCOL_ERROR`, `TIMEOUT`, `BUSY`, `UNAUTHORIZED`, `HTTP_ERROR`, `IO_ERROR`. A rejected WebSocket handshake is `NETWORK_ERROR`.

## Notes

- One owner at a time: a viewer or one SDK session.
- Snapshots capture the X11 surface. They do not include the viewer's cursor overlay.
- Wire details: [Protocol](protocol.md).
