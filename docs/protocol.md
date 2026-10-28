# Protocol

Wire format and HTTP API of the engine. All integers are unsigned big-endian unless marked signed. One binary WebSocket message is one protocol message. Reject text messages, unknown types or versions, bad lengths and malformed records. Never cast incoming bytes to native structs.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /`, `GET /viewer.js` | Viewer |
| `WS /stream` | Video, cursor and human input. Subprotocol `nsl1`. |
| `WS /control` | Agent input. Subprotocol `nsl1`. Exclusive with `/stream`. |
| `POST /input` | Batch of input records over HTTP |
| `GET /snapshot.png` | Fresh native PNG |
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
| 0 | 2 | Width, 1 to 1280 |
| 2 | 2 | Height, 1 to 720 |
| 4 | 8 | Capture timestamp, microseconds |
| 12 | 1 to 8,388,608 | H.264 Annex B access unit |

Payload length is `12 + access unit length`. Maximum message 8,388,640 bytes. First and recovery frames are IDRs with SPS/PPS. The viewer decodes, draws, then sends the ACK, so an ACK means "drawn by the page".

## ACK (type 2, viewer to server)

Payload length zero. Generation and sequence name the oldest sent frame. Only an exact match restores credit. Stale and future ACKs are ignored.

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
| 0 | 1 | Event: 1 key down, 2 key up, 3 pointer move, 4 button down, 5 button up, 6 wheel, 7 release all |
| 1 | 1 | Reserved, zero |
| 2 | 2 | Code: HID usage (key), button 1 to 3, 0 for move, wheel axis (0 vertical, 1 horizontal) |
| 4 | 4 | Signed value: wheel delta, otherwise zero |
| 8 | 2 | X, 0 to 65535 |
| 10 | 2 | Y, 0 to 65535 |
| 12 | 2 | Button mask, low 5 bits only |
| 14 | 2 | Modifier mask, HID bits 0 to 7 |

- Key usages are 0x00 to 0xE7 (231). Larger values are rejected. Unmapped usages within range return status 2.
- Wheel delta is in steps of 120, magnitude at most 1200. Vertical wheel maps to X buttons 4/5, horizontal to 6/7.
- Release all needs code, value and masks zero. Coordinates are ignored.
- Held key and button sets are authoritative. Repeated transitions are deduplicated.
- Fragmented control messages are accumulated up to 36 bytes.

## Agent control (`/control`)

1. Server sends type 4 (control ready): nonzero generation, sequence zero, payload is 4 bytes width and height.
2. Client sends type 3 requests. Server replies type 5 with the request sequence and one status byte: 0 submitted, 1 invalid, 2 unsupported.
3. At most 32 replies are queued. Protocol violations close the connection and release held input.
4. No video session starts. Reconnect never replays requests. "Submitted" does not mean the application reacted.

## POST /input

Body: 1 to 256 type-3 records, 16 bytes each, same encoding as the `/control` payload (no WebSocket header). `Content-Length` is required. Auth: bearer token.

| Result | Body | Meaning |
| --- | --- | --- |
| 200 | `{"applied":N}` | Every record was applied. |
| 400 | `{"error":"invalid_input","index":I}` | Record `I` is invalid. Records before it were applied. Also returned, without `index`, when the length is zero or not a multiple of 16. |
| 422 | `{"error":"unsupported_input","index":I}` | Record `I` is valid but unsupported, such as an unmapped key. Records before it were applied. |
| 401 | `{"error":"unauthorized"}` | Missing or wrong token. |
| 403 | `{"error":"forbidden"}` | `Host` or `Origin` rejected. |
| 409 | `{"error":"busy"}` | A viewer or `/control` session owns input. Nothing is applied. |
| 411, 413 | `length_required`, `too_large` | No `Content-Length`, or more than 256 records. |

Records are applied in order and stop at the first failure. The request holds the control slot only while it is applied. Held keys and buttons are released when the batch ends or fails. The server never retries.

## GET /snapshot.png

Fresh native PNG, independent of who owns control. Works with a viewer connected. The cursor overlay is not included.

- One snapshot at a time. A busy request gets HTTP 503 with a JSON error.
- 5 s response timer. At most 8 MiB, written in chunks.
- Errors complete the HTTP transaction so the connection can be reused.

## GET /capabilities

JSON. Real output:

```json
{"version":1,"backend":"x11","width":1280,"height":720,"input":{"keyboard":true,"pointer":true,"buttons":true,"wheel":true},"snapshot":"/snapshot.png","control":"/control","wayland":false,"max_input_pending":32,"cursor":true,"input_endpoint":"/input","max_input_batch":256,"audio":false,"clipboard":false,"resize":false,"ime":false}
```

`cursor` says whether `/stream` sends cursor images. `max_input_batch` is the `POST /input` record limit.

## GET /metrics

Uncached JSON.

```json
{"usage_usec":1234,"memory_current":5678,"inactive_file":90}
```

CPU is cumulative microseconds. Memory is bytes, from the mounted cgroup v2. If cgroup data is missing: HTTP 200, `resources_available: false`, and those three fields are `null`. Flow fields are scoped to the current generation: `inflight_frames`, `inflight_bytes`, `window_frames`, `target_bitrate_bps`, `ack_rtt_ms`, `oldest_frame_ms`, `frames_acked`, `frames_encoded`, `observed_busy_goodput_bps`, plus the limits `max_inflight_frames`, `max_inflight_bytes`, `max_frame_bytes`, `admission_age_ms`, `no_ack_timeout_ms`, `max_frame_age_ms`.

## Limits

| Item | Value |
| --- | --- |
| Surface | 1280x720 |
| Frame message | 8,388,640 bytes |
| In flight | 8 frames, 8 MiB |
| Admission pause | oldest capture 250 ms |
| Generation timeout | 3 s without ACK progress or oldest capture 3 s old |
| Viewer first-frame and decoder deadline | 5 s |
| Viewer reconnect | 1, 2, 4, 8, 8 s, then stop after five attempts unless a draw succeeds |
| Hidden tab | Pauses. On return it reconnects with a new generation and an IDR. |
| Control replies queued | 32 |
| Input record | 16 bytes |
| `POST /input` batch | 256 records |
| Cursor image | 256x256 |

The server and viewer ship together. Older viewers that only know type 1 do not support the cursor extension.
