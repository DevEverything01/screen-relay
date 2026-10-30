# Protocol

Wire format and HTTP API of the engine. All integers are unsigned big-endian unless marked signed. One binary WebSocket message is one protocol message. Reject text messages, unknown types or versions, bad lengths and malformed records. Never cast incoming bytes to native structs.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /`, `GET /index.html`, `GET /viewer.js` | Viewer |
| `WS /stream` | Video, cursor and human input. Subprotocol `nsl1`. |
| `WS /control` | Agent input. Subprotocol `nsl1`. Exclusive with `/stream`. |
| `POST /input` | Batch of input records over HTTP |
| `GET /screenshot.png` | Fresh native PNG |
| `GET /capabilities` | Backend, dimensions, features |
| `GET /metrics` | Transport and cgroup metrics (JSON) |

## Auth

| Mode | Rule |
| --- | --- |
| `Host` | Must be loopback (`127.0.0.1` or `localhost`, any port) or the `--public-origin` authority. Otherwise HTTP 403. |
| `Origin` | Optional for native agents. When sent, it must be loopback with a loopback `Host`, or equal `--public-origin` when a token is set. Otherwise HTTP 403. `/stream` requires an `Origin`. |
| Token | HTTP: `Authorization: Bearer TOKEN`, else HTTP 401. WebSocket: offer `nsl1` and `bearer.TOKEN`; the server selects `nsl1`. |
| No token | Only for a `127.0.0.1` listener. The engine refuses a non-loopback bind without a token. |

Tokens are 64 lowercase hex characters. One viewer or one agent owns control at a time.

## Common header (20 bytes)

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 4 | Magic `NSL1` |
| 4 | 1 | Version `1` |
| 5 | 1 | Type: 1 frame, 2 ACK, 3 input, 4 control ready, 5 input response, 6 cursor image |
| 6 | 2 | Flags. Zero, except frame bit 0 = keyframe. |
| 8 | 4 | Generation |
| 12 | 4 | Sequence |
| 16 | 4 | Payload length |

Generation starts at 1 and increments per connection. Zero is invalid. Sequence starts at 1 per generation and increases by one per frame. A new generation invalidates earlier ACKs and queued frames. At sequence `UINT32_MAX` the server stops admitting frames and the client must reconnect. At generation `UINT32_MAX` the server refuses connections until restart.

## Frame (type 1, server to viewer)

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 2 | Width, 1 to 1920 |
| 2 | 2 | Height, 1 to 1080 |
| 4 | 8 | Capture timestamp, microseconds |
| 12 | 1 to 8,388,608 | H.264 Annex B access unit |

Payload length is `12 + access unit length`. Maximum message 8,388,640 bytes. First and recovery frames are IDRs with SPS/PPS. The viewer decodes every frame in order and sends the ACK when the frame is drawn or discarded as superseded. Presentation is paced to the display: a decoded frame draws immediately while nothing has been drawn since the last animation frame, and otherwise waits in a small queue that presents at most one frame per animation frame, so an ACK means the frame was drawn or superseded by the page.

## ACK (type 2, viewer to server)

Payload length zero. Generation and sequence name the oldest sent frame. The viewer sends an ACK for every frame in sequence order when that frame is drawn or discarded as superseded. Only an exact match restores credit. Stale and future ACKs are ignored.

## Cursor image (type 6, server to viewer, `/stream` only)

Sent after the generation's first frame. Flags and sequence are zero. Payload: four `uint16` (width, height, hotspot X, hotspot Y), then `width * height * 4` bytes of straight-alpha RGBA, row order.

- Maximum 256x256. The hotspot must lie inside the image.
- An 8-byte all-zero payload restores the local arrow.
- A fully transparent image is a blank cursor.
- No credit and no ACK. One pending image is kept; newer replaces older.
- A new connection gets the current shape.
- Remote pointer warps are not synchronized.

## Input (type 3)

Payload is exactly 16 bytes. On `/stream` the header sequence is zero. On `/control` it is a nonzero request ID, echoed in the response. Use the current generation.

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 1 | Event: 1 key down, 2 key up, 3 pointer move, 4 button down, 5 button up, 6 wheel, 7 release all, 8 text |
| 1 | 1 | Reserved, zero |
| 2 | 2 | Code: HID usage (key), button 1 to 3, 0 for move, wheel axis (0 vertical, 1 horizontal) |
| 4 | 4 | Signed value: wheel delta or text codepoint, otherwise zero |
| 8 | 2 | X, 0 to 65535 |
| 10 | 2 | Y, 0 to 65535 |
| 12 | 2 | Button mask, low 5 bits only |
| 14 | 2 | Modifier mask, HID bits 0 to 7 |

- Key usages are 0x00 to 0xE7 (231). Larger values are rejected. Unmapped usages within range return status 2.
- Key codes name physical keys, so the remote layout decides the character. A text event has code 0 and a value that is one Unicode scalar value, 1 to 0x10FFFF and not 0xD800 to 0xDFFF; its masks are zero and coordinates are ignored. Text returns status 2 when the backend cannot type the character. Text 0x0A is the Return key and 0x09 is the Tab key, so applications see the named keys rather than those control characters.
- Wheel delta is in steps of 120, magnitude at most 1200. Vertical wheel maps to X buttons 4/5, horizontal to 6/7.
- Release all needs code, value and masks zero. Coordinates are ignored.
- Held key and button sets are authoritative. Repeated transitions are deduplicated. A text event never changes held keys.
- Fragmented control messages are accumulated up to 36 bytes.

### How text is typed

A character the layout has is typed with its own key, so no mapping changes. A character the layout lacks, such as CJK on `us`, is typed by binding one of the empty spare keycodes to its keysym, tapping it, and leaving the binding in place so an application that reads the mapping late still gets the right character. With no empty keycode at all, the character is unsupported.

The guarantee and its limit: a binding stays valid for at least 50 ms and until 16 newer characters needed spares. An application that stays frozen longer than that can miss characters typed during the freeze, because by then its keycode reads a different keysym. This is a limit of X11 itself, not of relay: a client resolves keysyms when it gets round to the event, using whatever mapping the server has at that moment.

Held modifiers are lifted for the tap and pressed again right after, so held Shift or Ctrl never changes the typed character. The held key set does not change, and a repeated release still reaches the backend once.

## Agent control (`/control`)

1. Server sends type 4 (control ready): nonzero generation, sequence zero, payload is 4 bytes width and height.
2. Client sends type 3 requests. Server replies type 5 with the request sequence and one status byte: 0 applied, 1 invalid, 2 unsupported. The reply is written only after the backend applied the request, so a client that waits for it before the next request is paced by the desktop.
3. At most 32 replies are queued. Protocol violations close the connection and release held input.
4. No video session starts. Reconnect never replays requests. Applied does not mean the application reacted.

## POST /input

Body: 1 to 256 type-3 records, 16 bytes each, same encoding as the `/control` payload (no WebSocket header). `Content-Length` is required. Auth: bearer token.

| Result | Body | Meaning |
| --- | --- | --- |
| 200 | `{"applied":N}` | Every record was applied. |
| 400 | `{"error":"invalid_input","index":I}` | Record `I` is invalid. Records before it were applied. Also returned, without `index`, when the length is zero or not a multiple of 16. |
| 422 | `{"error":"unsupported_input","index":I}` | Record `I` is valid but unsupported, such as an unmapped key or a codepoint the backend cannot type. Records before it were applied. |
| 401 | `{"error":"unauthorized"}` | Missing or wrong token. |
| 403 | `{"error":"forbidden"}` | `Host` or `Origin` rejected. |
| 409 | `{"error":"busy"}` | A viewer or `/control` session owns input, or the session ended before the batch was applied. Nothing is applied. |
| 411, 413 | `length_required`, `too_large` | No `Content-Length`, or more than 256 records. |

Records are applied in order and stop at the first failure. The response is written only after the backend applied the records, so a client that awaits it knows the desktop received them, and a long batch of slow characters returns when its last character is typed. Held keys and buttons are released when the batch ends or fails. If the session ends before a queued batch is applied, its queued text and moves are dropped and the request fails as `busy`; key and button releases still run. The server never retries.

## GET /screenshot.png

Fresh native PNG, independent of who owns control. Works with a viewer connected. The cursor overlay is not included.

- One screenshot at a time. A busy request gets HTTP 503 with a JSON error.
- 5 s response timer. At most 8 MiB, written in chunks.
- Errors complete the HTTP transaction so the connection can be reused.

## GET /capabilities

JSON. Real output:

```json
{"version":1,"backend":"x11","width":1280,"height":720,"fps":60,"input":{"keyboard":true,"pointer":true,"buttons":true,"wheel":true},"screenshot":"/screenshot.png","control":"/control","wayland":false,"max_input_pending":32,"cursor":true,"input_endpoint":"/input","max_input_batch":256,"audio":false,"clipboard":false,"resize":false,"ime":false}
```

`fps` is the configured capture frame rate. `cursor` says whether `/stream` sends cursor images. `max_input_batch` is the `POST /input` record limit.

## GET /metrics

Uncached JSON.

```json
{"usage_usec":1002503,"memory_current":130478080,"inactive_file":98304,"inflight_frames":0,"inflight_bytes":0,"window_frames":1,"target_bitrate_bps":8000000,"ack_rtt_ms":0.000000,"oldest_frame_ms":0.000000,"frames_acked":0,"frames_encoded":0,"observed_busy_goodput_bps":0.000000,"max_inflight_frames":8,"max_inflight_bytes":8388608,"max_frame_bytes":8388608,"admission_age_ms":250,"no_ack_timeout_ms":3000,"max_frame_age_ms":3000}
```

CPU is cumulative microseconds. Memory is bytes, from the mounted cgroup v2. If cgroup data is missing: HTTP 200, `resources_available: false`, and those three fields are `null`. Flow fields are scoped to the current generation: `inflight_frames`, `inflight_bytes`, `window_frames`, `target_bitrate_bps`, `ack_rtt_ms`, `oldest_frame_ms`, `frames_acked`, `frames_encoded`, `observed_busy_goodput_bps`, plus the limits `max_inflight_frames`, `max_inflight_bytes`, `max_frame_bytes`, `admission_age_ms`, `no_ack_timeout_ms`, `max_frame_age_ms`.

## Limits

| Item | Value |
| --- | --- |
| Surface | Even width 320 to 1920, even height 240 to 1080 |
| Frame message | 8,388,640 bytes |
| Flow control | See [Architecture](architecture.md#flow-control) |
| Viewer first-frame and decoder deadline | 5 s |
| Viewer reconnect | 1, 2, 4, 8, 8 s, then stop after five attempts unless a draw succeeds |
| Hidden tab | Pauses. On return it reconnects with a new generation and an IDR. |
| Control replies queued | 32 |
| Input record | 16 bytes |
| `POST /input` batch | 256 records |
| Cursor image | 256x256 |

The server and viewer ship together. Older viewers that only know type 1 do not support the cursor extension.
