# Node SDK

A library with no runtime dependencies. HTTP functions work on Node 20+; persistent WebSocket sessions require Node 22+. Use [`relay`](cli.md) for command-line control.

```sh
(cd /absolute/path/to/this/repo && npm install && npm run build)
npm install /absolute/path/to/this/repo
```

```js
import { createClient } from 'relay';

const desktop = createClient({ url: 'http://127.0.0.1:8080' });
await desktop.click(0.5, 0.5);
await desktop.key('ctrl+l');
await desktop.type('Hello, 世界');
const png = await desktop.screenshot();
```

For a persistent control session:

```js
import { connect } from 'relay';

const desktop = await connect({ url: 'http://127.0.0.1:8080' });
try {
  await desktop.input({ type: 'pointerMove', x: 0.5, y: 0.5 });
  await desktop.screenshot('screen.png');
} finally {
  desktop.close();
}
```

## Options

`createClient`, `connect` and the standalone HTTP functions take `{ url, timeout, token, ca, connect }`.

| Option | Rule |
| --- | --- |
| `url` | Default `http://127.0.0.1:8080`. Origin only: no path, credentials, query or fragment. Plain HTTP only for `localhost` and `127.0.0.1`. Other hosts need HTTPS. |
| `token` | 64 lowercase hex characters. Required for remote hosts. |
| `timeout` | Milliseconds per request. Default 10000. |
| `ca` | Certificate file trusted for HTTPS requests, without a hostname check. Used for a local session's own certificate. |
| `connect` | Address to dial instead of the URL host, with the URL host kept as the `Host` header. Used for a session bound to one interface. |

Redirects are not followed. Token handling: [Remote access](remote-access.md#tokens).

## Functions

| Function | Needs control | Returns |
| --- | --- | --- |
| `createClient(opts)` | Only while sending input | HTTP client with `status`, `capabilities`, `screenshot`, `click`, `move`, `scroll`, `key`, `type`, `input` |
| `connect(opts)` | Takes it | Session with `input`, `screenshot`, `capabilities`, `status`, `close`, `surface` |
| `capabilities(opts)` | No | Backend, dimensions, features |
| `status(opts)` | No | Transport metrics. Resource counters are `null` when unavailable. |
| `screenshot(opts, path?)` | No | PNG bytes. Writes to `path` if given. Works while a viewer is connected. |

`connect` waits for the ready message. Closing or losing the connection releases held keys and buttons. Input is never replayed on reconnect. A resolved `input` means the server accepted it, not that the application acted.

## HTTP client

`createClient` returns a stateless client. Its methods use HTTP and never open a WebSocket. `status()` requests `/metrics`, `capabilities()` returns backend features including `fps` and `max_input_batch`, and `screenshot()` returns PNG bytes.

| Method | Behavior |
| --- | --- |
| `click(x, y, { button }?)` | Presses and releases `left` (default), `middle` or `right`. |
| `move(x, y)` | Moves the pointer. |
| `scroll(x, y, { dx, dy }?)` | Moves, then scrolls by integer wheel notches. Positive `dy` scrolls down; positive `dx` scrolls right. At least one must be nonzero. |
| `key(...combos)` | Presses physical key combinations, such as `ctrl+l`, `enter` or `cmd+shift+t`. `cmd` and `meta` alias `super`. |
| `type(text)` | Sends one text event per Unicode scalar value using the remote keyboard layout. Empty text sends nothing. |
| `input(events)` | Sends a nonempty array of raw input events. |

Coordinates are fractions from 0 to 1. Input methods return `{ events: number }`. The client reads `max_input_batch` from capabilities and validates every batch before sending any input. Key combinations stay together within a batch. The engine releases held input at each batch boundary, so raw events that hold a key across batches will not keep it held. A group larger than the server limit is rejected.

Input batches run in order and are never retried. If a later batch or event fails, earlier events may already have taken effect. A viewer or persistent control session causes HTTP input to fail with `BUSY`; status, capabilities and screenshots remain available.

A failed batch after earlier batches carries `applied`, the number of events already sent.

## Input events

| Type | Fields |
| --- | --- |
| `keyDown`, `keyUp` | `key`: USB HID usage (0 to 231) |
| `pointerMove` | `x`, `y` in 0 to 1 |
| `buttonDown`, `buttonUp` | `button` 1 to 3, `x`, `y` |
| `wheel` | `axis` `"vertical"` or `"horizontal"`, `delta` multiple of 120 within +-1200, `x`, `y` |
| `releaseAll` | none |
| `text` | `codepoint`: Unicode scalar value from 1 to 0x10FFFF, excluding surrogates |

`Session.input(event)` sends one event and waits for its matching acknowledgement. It resolves with no value and permits at most 32 pending requests. A timed-out acknowledgement closes the session and rejects the remaining requests. `Session.screenshot(path?)` and the standalone `screenshot(opts, path?)` can also write the returned bytes to a file.

## Errors

Errors are instances of the exported `RelayError` with a `code`, a shared snake_case `reason`, `class`, `exitCode`, `status` and optional `hint`, `data` and `next`. Codes include `INVALID_ARGUMENT`, `NOT_FOUND`, `UNSUPPORTED`, `NETWORK_ERROR`, `DISCONNECTED`, `PROTOCOL_ERROR`, `TIMEOUT`, `BUSY`, `UNAUTHORIZED`, `HTTP_ERROR`, `IO_ERROR`, `CONFIG_ERROR`, `INTERNAL` and `CANCELED`. A rejected WebSocket handshake is `NETWORK_ERROR`. Network failures carry a human message mapped from the Node error code: `Connection refused.`, `The host name did not resolve.`, `The request timed out.` or `The TLS certificate was rejected.`; the message is never a raw `fetch failed`.

The SDK and CLI use the same reason registry in `src/protocol`. Match `error.reason` against the [CLI reasons](cli.md#error-codes) when handling failures across both interfaces. CLI JSON errors expose `reason` directly, with `message`, `status` and optional `data` and `next`; they no longer wrap an `error.code`. SDK HTTP input methods still return `{ events: number }`; the CLI wraps that count as `{"input":{"events":1},"outcome":"sent"}`. A partially applied input failure carries `applied` on the SDK error and `data.applied` in CLI JSON. Never retry the whole input blindly.

## Notes

- One owner at a time: a viewer or one SDK session.
- Screenshots capture the X11 surface. They do not include the viewer's cursor overlay.
- Wire details: [Protocol](protocol.md).
