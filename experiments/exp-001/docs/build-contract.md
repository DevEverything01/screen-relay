# Implemented native stream contract

This describes the current implementation, not a performance verdict. Authoritative source: [capture.hpp](../src/capture.hpp), [capture.cpp](../src/capture.cpp), [server.cpp](../src/server.cpp), and [viewer.js](../viewer/viewer.js). See [verification recipes](../tests/README.md), [metrics checks](../tests/live-metrics-README.md), and the [final report](../optimize/native-stream-report.md) (pending publication).

## Build boundary

- Compile as C++17. Link the image's installed FFmpeg development libraries: `libavcodec` ABI 61 (FFmpeg 7), `libavutil`, and `libswscale`. Do not use FFmpeg 8-only APIs or assume its ABI. Use `pkg-config` for library flags.
- The Dockerfile explicitly installs `build-essential`, `pkg-config`, `libx11-dev`, `libxext-dev`, `libxdamage-dev`, `libxfixes-dev`, `libxtst-dev`, and `libwebsockets-dev`, plus FFmpeg development libraries, and builds the daemon. These are implemented build requirements.
- The executable and modules stay within this lab. Wire definitions below are byte operations, not serialized C++ structs.

## Native ownership and interfaces

Main-thread `Server` owns libwebsockets, a separate XTest display, held controls, and one pending frame. `CaptureEncoder` owns a worker with its X connection, damage object, SHM image, reusable YUV frame, and persistent encoder. Connection operations and writes stay on the service thread. Worker publication wakes it with `lws_cancel_service`; capture wakeups use eventfd.

The public interface in `capture.hpp` is:

```cpp
using Publish = std::function<bool(EncodedFrame&&)>;
explicit CaptureEncoder(Publish publish);
bool start(std::string& error);
void beginSession(uint32_t generation);
void endSession(uint32_t generation);
void acknowledge(uint32_t generation, uint32_t sequence);
CaptureStats stats() const;
std::string error() const;
void stop();
```

`EncodedFrame` contains `uint32_t generation, sequence`, `uint64_t pts_us`, `uint16_t width, height`, `bool keyframe`, and owning `std::vector<uint8_t> annex_b`. Publish runs outside the capture mutex and reports whether transport accepted the frame. Revision checking rejects encoded work for a replaced session. A rejected reference packet stalls that generation until transport recovery; a queue collision marks transport failed and closes the connection.

`publish` transfers ownership of packet bytes into a bounded queue; a full queue is an error/recovery condition, never permission to discard an encoded reference packet. Queue capacity is one frame for the initial one-credit policy. The worker signals the service loop using a thread-safe wake mechanism; the service thread dequeues and writes. The `EncodedFrame` vector remains alive and unchanged through the synchronous `lws_write` call and may be released once that call returns. Construct the actual LWS buffer with `LWS_PRE` writable bytes before the payload; do not pass the vector's `data()` directly as an LWS-prefixed buffer.

`CaptureEncoder` retains X connection, XDamage object, SHM image, reusable conversion/encoder frame, and codec context for its lifetime. It owns and unreferences the `AVPacket` after copying/moving its bytes into `EncodedFrame`; it does not hand an `AVPacket*` or borrowed encoder storage to transport. Make the reusable `AVFrame` writable before filling it. Drain all available output packets after each successful `avcodec_send_frame` until `AVERROR(EAGAIN)`; treat other negative returns as failure. This matches the FFmpeg 7 send/receive API and caller-owned input-frame semantics.

On each damage notification, latch pending work even without credit. Consume/reset XDamage before capture on the same X connection. Capture only when damage or a forced frame is pending, credit is available, and the frame deadline has arrived. Capture/encode failure preserves pending work and forces IDR in the same generation. The first two consecutive failures reopen the encoder and delay one second; the third becomes fatal. Reopen failure is immediately fatal. Successful processing resets the failure count. Fatal text is exposed by `error()`; the server checks it in its service loop and exits with failure. Startup errors return through `start(error)`.

The service thread validates and handles ACK/input messages and applies XTest events. Track pressed key/button state per connection. On blur, disconnect, generation change, or timeout, release every held key and button before clearing that state. Use USB HID keyboard usage values `0x00..0xE7` as the explicit lab key range and map supported usages to X keycodes; usages above 231 are rejected and unsupported mappings within 0..231 are ignored. Pointer coordinates are unsigned normalized `0..65535` in each axis and scale to the current frame dimensions. Support pointer move, button down/up (buttons 1..3 only), vertical/horizontal wheel deltas, and modifier state. This is a lab input subset, not a claim of full keyboard-layout or IME support.

## Wire protocol (WebSocket binary messages)

All integers are unsigned big-endian unless marked signed. Do not cast incoming bytes to packed/native structs. Reject text messages, fragmented messages exceeding limits, unknown types/versions, invalid lengths, and malformed records. One complete binary WebSocket message is exactly one protocol message.

### Common header: 20 bytes

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 4 | ASCII magic `NSL1` |
| 4 | 1 | Version, `1` |
| 5 | 1 | Type: `1` frame, `2` ACK, `3` input |
| 6 | 2 | Flags, zero for ACK/input; frame bit 0 is keyframe, all other bits zero |
| 8 | 4 | Stream generation |
| 12 | 4 | Sequence number |
| 16 | 4 | Payload byte count following the common header |

Generation starts at 1 and increments for each connection; encoder recovery retains the generation and forces IDR; zero is invalid. Sequence starts at 1 within each generation and increases by one per emitted frame. A new generation invalidates all prior ACKs and queued frames. Compare sequence numbers only within the same generation. Ignore well-formed stale/future ACKs; only an ACK matching the one outstanding frame restores credit. At UINT32_MAX sequence the worker stops admitting frames; automatic generation rotation is not implemented, so reconnect is required. At UINT32_MAX generation the server rejects connections until restart.

### Frame, type 1

The common payload begins with 12 bytes of metadata, followed by one H.264 Annex B access unit:

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 2 | Width, `1..1280` |
| 2 | 2 | Height, `1..720` |
| 4 | 8 | Capture presentation timestamp in microseconds |
| 12 | 1..16,777,216 | Annex B access unit |

Common payload length must equal `12 + access-unit length`; whole message maximum is 16,777,248 bytes. Initial and recovery frames are IDRs and include the SPS/PPS needed by a fresh decoder. The viewer decodes each access unit, draws the resulting frame, sends its ACK, and closes every `VideoFrame` in a finally block. That ACK means “decoded and drawn by the page,” not physical display presentation.

### ACK, type 2

Payload length is zero. The common generation and sequence identify the sole outstanding frame. Ignore ACKs that do not exactly match it. No other message grants credit.

### Input, type 3

Payload is exactly 16 bytes; common sequence is zero. Use the current generation. Reject other sequence values, reserved bits, out-of-range coordinates/buttons/usages, and unsupported event codes.

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 1 | Event: 1 key down, 2 key up, 3 pointer move, 4 button down, 5 button up, 6 wheel, 7 release all |
| 1 | 1 | Reserved, zero |
| 2 | 2 | Code: HID usage for key events; button number `1..3`; zero for move; wheel axis 0 vertical / 1 horizontal |
| 4 | 4 | Signed value: zero for key/pointer/button; signed wheel delta for wheel |
| 8 | 2 | Normalized X, `0..65535` |
| 10 | 2 | Normalized Y, `0..65535` |
| 12 | 2 | Button mask; only low five bits may be set |
| 14 | 2 | Modifier mask; only HID modifier bits 0..7 may be set |

For wheel, the signed value is a bounded integer delta in 120-unit steps; reject magnitude above 1200. Held key/button sets are authoritative; modifier masks need not agree at transitions. Repeated transitions are deduplicated. Release-all requires zero code, value, and masks; coordinates are ignored. The server accumulates fragmented control messages only up to 36 bytes. A separate 64 KiB fragment check does not enlarge this complete-record limit. Wheel synthesizes X buttons 4/5 vertically and 6/7 horizontally.

## Shared browser behavior

The viewer requests low-latency H.264 decoding where available, but that preference is not a guarantee that an IDR is output without later input. Before relying on one-frame credit, verify that an IDR is delivered under the actual browser. Do not add per-frame decoder flushes to force output. If the browser withholds the first frame, record the failure and revisit the measured bounded-credit policy. On hidden-tab/ACK timeout, stop accepting old-generation input, release held controls, reconnect with a new generation, and require an IDR.

## Limits retained from the design

- Fixed maximum capture surface is 1280×720, matching `desktop-stream-bench/session.sh`; resize is disabled in the reference sessions.
- Capture/conversion starts full-frame. No regional conversion savings are claimed.
- H.264 uses low delay with no B frames/lookahead. YUV420 may reduce colored-text fidelity.
- One outstanding frame bounds memory but makes update rate sensitive to browser ACK round-trip time. A drawn ACK is not a presentation timestamp.
- Cursor shape fidelity and unsupported keyboard/layout behavior must be recorded as limitations unless implemented and measured.
- The listener requires a localhost/127.0.0.1 HTTP(S) Origin and one viewer; this is not authentication. Publish the container port to host loopback only.

## Current timing, color, and telemetry

The frame deadline is capture start plus 16,666,667 ns. `ppoll` waits on X/eventfd with a nanosecond deadline when admitted dirty work exists; otherwise it waits without a frame timer. Persistent x264 uses ultrafast/zerolatency, CRF 10, two threads, no B frames, GOP 600, no lookahead/scenecut, Annex B, and repeated headers. Output must immediately match the submitted PTS; no-output is a recoverable failure subject to the three-failure threshold.

Little-endian BGRA uses `bgraToYuv420`: limited-range BT.709, AArch64 NEON with scalar tail/fallback. Its 2×2 box-averaged chroma is signaled CENTER in codec and frame metadata. Big-endian ARGB uses libswscale with left-sited chroma metadata.

`CaptureStats` contains cumulative `captures`, `encoded`, `capture_ns`, `convert_ns`, and `encode_ns`, logged when the service exits. It counts successful encode attempts, including work subsequently discarded by revision checks; failed attempts are excluded. Stage boundaries are SHM capture completion, conversion completion, and packet assembly completion. Transport/browser time is excluded.

The server closes an outstanding frame after three seconds without ACK. Page first-frame and decoder deadlines are five seconds. Reconnect waits 1/2/4/8/8 seconds, stopping after five attempts unless a successful draw resets retries. Hidden pages pause; resuming reconnects with a fresh generation and IDR. The viewer derives AVC codec configuration from SPS, checks decoder support, ACKs after drawing and closes VideoFrames in a finally block, and does not flush per frame.

`GET /metrics` returns uncached cgroup v2 JSON:

```json
{"usage_usec":1234,"memory_current":5678,"inactive_file":90}
```

CPU is cumulative microseconds; memory fields are bytes. Missing/invalid data returns HTTP 503 and `{"error":"cgroup_v2_unavailable"}`. The HUD polls about once per second, permits one metrics request at a time, and aborts after two seconds. CPU is delta usage / elapsed browser time × 100, normalized to **one core** and potentially above 100%. RAM is max(0, memory_current − inactive_file) / 2^20 MiB: a working-set approximation, not process RSS. Both cover the whole container, including desktop/apps. Drawn FPS counts canvas draws; stream Mbps counts H.264 payload bytes, excluding protocol overhead. These are observational counters, not WAN or physical-presentation guarantees.

## References

- [FFmpeg 7.0 libavcodec send/receive API](https://ffmpeg.org/doxygen/7.0/group__lavc__decoding.html)
- [libwebsockets coding and event loop guidance](https://github.com/warmcat/libwebsockets/blob/main/READMEs/README.coding.md)
- [XDamage protocol](https://xorg.freedesktop.org/archive/current/doc/damageproto/damageproto.txt)
- [MIT-SHM protocol](https://xorg.freedesktop.org/archive/current/doc/xextproto/shm.html)
- [XTest library](https://www.x.org/releases/X11R7.5/doc/Xext/xtestlib.html)
- [WebCodecs AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)
