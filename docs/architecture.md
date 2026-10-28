# Architecture

```text
X11 display
  -> CaptureSource (XDamage, MIT-SHM)
  -> CaptureEncoder (BGRA/ARGB to NV12, x264)
  -> flow control (ACK credit)
  -> WebSocket /stream
  -> browser VideoDecoder -> canvas

browser or agent input -> InputBackend (XTest)
```

## Folders

| Path | Contents |
| --- | --- |
| `src/core/` | Backend-neutral pipeline: `CaptureSource`, `InputBackend`, encoder, color conversion, flow control |
| `src/server/` | `main.cpp` (entry point), `config` (arguments, token and origin policy), `wire` (NSL1 encoding), `server` (session, writes, libwebsockets callback, HTTP routes), `metrics` (cgroup parsing), `screenshot` |
| `src/backends/x11/` | X11 capture (XDamage, MIT-SHM, XFixes cursor) and XTest input |
| `viewer/` | Browser decoder, renderer, cursor overlay, human input |
| `sdk/` | Node client library |
| `scripts/` | The `relay` CLI: `relay` is a thin launcher, `relaycli/` holds the commands, session supervision and client |
| `tests/` | Unit and integration tests |

## Interfaces

- `CaptureSource` (`src/core/capture-source.hpp`): `fd()`, `drainDamage()`, `pixelFormat()`, `capture()`. A frame is a non-owning CPU view (BGRA or ARGB), valid until the next capture. Optional `cursorSupported()` and `cursor(force)`.
- `InputBackend` (`src/core/input.hpp`): `apply`, `releaseAll`, `dimensions`, `name`.
- `CaptureEncoder` takes a `CaptureSourceFactory`, so tests can inject a source with no X11.
- The worker requires a valid fd, a fixed 1280x720 surface and stride 5120 to 10240 bytes.

## Threads and ownership

- The service thread owns libwebsockets, the `InputBackend`, flow-control state and all socket writes.
- The capture worker owns its `CaptureSource`, a reusable YUV frame and the x264 encoder. It publishes owning `EncodedFrame` vectors to a bounded queue and wakes the service thread with `lws_cancel_service`.
- A separate screenshot worker owns its own `CaptureSource`.
- Each X11 backend object owns its own X connection. Xlib threading is initialized once by `initializeNativeBackend()`.
- Workers finish before the resources they use are destroyed.
- A full queue fails the generation. It never drops an encoded reference frame.
- Held keys and buttons are released on blur, disconnect, timeout and generation change.

## Flow control

| Rule | Value |
| --- | --- |
| Initial credit | 1 frame |
| Window after first ACK | `clamp(ceil(ack_rtt / 16.667 ms) + 1, 2, 8)` |
| ACK RTT | EWMA, `0.875 * old + 0.125 * sample` |
| In flight | At most 8 frames and 8 MiB |
| Admission pause | Oldest outstanding capture reaches 250 ms |
| Generation closed | No ACK progress for 3 s, or oldest capture 3 s old (checked every 100 ms) |
| x264 | ultrafast, zerolatency, CRF 10, no B frames, no lookahead, GOP 600, 1 thread |
| Bitrate target | Starts 8 Mbps, clamped 1 to 40 Mbps. VBV buffer is target/4. |
| Decrease | Target x 0.75 (and at most 90% of measured goodput) when 2+ frames and enough bytes are outstanding, oldest capture is 200 ms old, and 500 ms since the last decrease. Floor 1 Mbps. |
| Increase | Target x 1.10 after a busy 1 s sample, oldest under 100 ms, 1 s since last increase, 2 s since last decrease. |

ACK time includes network, decode and scheduling. It is not pure RTT. Drawing is paced separately to the display, so an ACK no longer waits for a presented frame. Paths with latency near 200 ms can back off repeatedly.

Failure handling: a capture or encode failure keeps pending work and forces an IDR in the same generation. The first two consecutive failures reopen the encoder after 1 s. The third, or a failed reopen, is fatal and the server exits.

Color: little-endian BGRA and big-endian ARGB convert to NV12 with limited-range BT.709 in `src/core/color.cpp` (NEON on AArch64, SSE2 on x86, scalar elsewhere), chroma signaled as center-sited. 4:2:0 loses colored-text detail.

`GET /metrics` exposes the flow counters. See [Protocol](protocol.md#get-metrics).

## Adding a backend

1. Create `src/backends/<name>/` implementing `initializeNativeBackend`, `makeCaptureSource` and `makeInputBackend`.
2. Add `BACKEND_PKGS_<name>` (pkg-config modules) to the `Makefile`.
3. Build with `make BACKEND=<name>`. The Makefile builds exactly one backend (default `x11`).
4. `src/core/` and `src/server/` must not include backend headers.

A Wayland backend must also handle portal authorization and revocation, negotiated format and dimensions, the notification fd, frame ownership, and separately authorized input. It must turn permission denial and session closure into explicit failures and release held input. The CPU-view, 1280x720 interface may need revising. No Wayland code exists.

## Build

C++17. The engine needs `libx264`, `libwebsockets` with TLS, and `libx11`, `libxext`, `libxdamage`, `libxfixes`, `libxtst`. It does not link FFmpeg. `make test` runs the color, flow, server and backend unit tests; `make test-backend` also needs FFmpeg 7 development libraries (`libavcodec` ABI 61, `libavutil`, `libswscale`; no FFmpeg 8-only APIs) to decode the encoder output.

`make install` puts the engine, viewer and CLI in `<prefix>/lib/relay/` and links `<prefix>/bin/relay` and `<prefix>/bin/relay-engine`.
