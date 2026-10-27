# Implemented native stream contract

This describes the current implementation, not a performance verdict. Authoritative source: [capture.hpp](../src/capture.hpp), [capture.cpp](../src/capture.cpp), [server.cpp](../src/server.cpp), and [viewer.js](../viewer/viewer.js). See [verification recipes](../tests/README.md), [metrics checks](../tests/live-metrics-README.md), and the [initial narrow report](../optimize/native-stream-report.md).

## Build boundary

- Compile as C++17. Link the image's installed FFmpeg development libraries: `libavcodec` ABI 61 (FFmpeg 7), `libavutil`, and `libswscale`. Do not use FFmpeg 8-only APIs or assume its ABI. Use `pkg-config` for library flags.
- The Dockerfile explicitly installs `build-essential`, `pkg-config`, `libx11-dev`, `libxext-dev`, `libxdamage-dev`, `libxfixes-dev`, `libxtst-dev`, and `libwebsockets-dev`, plus FFmpeg development libraries, and builds the daemon. These are implemented build requirements.
- The executable and modules stay within this lab. Wire definitions below are byte operations, not serialized C++ structs.

## Native ownership and interfaces

Main-thread `Server` owns libwebsockets, an `InputBackend`, and a bounded pending-frame queue. `CaptureEncoder` owns a worker with a `CaptureSource`, reusable YUV frame, and persistent encoder. The X11 backends own their respective X connections. See [backend boundaries](backends.md). Connection operations and writes stay on the service thread. Worker publication wakes it with `lws_cancel_service`; capture wakeups use eventfd.

The public interface in `capture.hpp` is:

```cpp
using Publish = std::function<bool(EncodedFrame&&)>;
explicit CaptureEncoder(Publish publish, CaptureSourceFactory factory = makeCaptureSource);
bool start(std::string& error);
void beginSession(uint32_t generation);
void endSession(uint32_t generation);
void acknowledge(uint32_t generation, uint32_t sequence);
void setFlowControl(uint32_t generation, unsigned window, uint64_t bitrate, bool paused, uint64_t admit_until_us);
CaptureStats stats() const;
std::string error() const;
void stop();
```

`EncodedFrame` contains `uint32_t generation, sequence`, `uint64_t pts_us`, `uint16_t width, height`, `bool keyframe`, and owning `std::vector<uint8_t> annex_b`. Publish runs outside the capture mutex and reports whether transport accepted the frame. Revision checking rejects encoded work for a replaced session. A rejected reference packet stalls that generation until transport recovery; a queue collision marks transport failed and closes the connection.

`publish` transfers ownership of packet bytes into a bounded queue; a full queue is an error/recovery condition, never permission to discard an encoded reference packet. Logical outstanding encoded payload is bounded to eight frames and 8 MiB total, including pending and sent frames. The initial credit is one; subsequent credit follows the RTT-derived window. See [flow control](flow-control.md). The worker signals the service loop using a thread-safe wake mechanism; the service thread dequeues and writes. The `EncodedFrame` vector remains alive and unchanged through the synchronous `lws_write` call and may be released once that call returns. Construct the actual LWS buffer with `LWS_PRE` writable bytes before the payload; do not pass the vector's `data()` directly as an LWS-prefixed buffer.

`CaptureEncoder` retains its source, reusable conversion/encoder frame, and codec context on its worker. The default X11 source owns its X connection, XDamage and SHM image. It owns and unreferences the `AVPacket` after copying/moving its bytes into `EncodedFrame`; it does not hand an `AVPacket*` or borrowed encoder storage to transport. Make the reusable `AVFrame` writable before filling it. Drain all available output packets after each successful `avcodec_send_frame` until `AVERROR(EAGAIN)`; treat other negative returns as failure. This matches the FFmpeg 7 send/receive API and caller-owned input-frame semantics.

On each damage notification, latch pending work even without credit. Consume/reset XDamage before capture on the same X connection. Capture only when damage or a forced frame is pending, credit is available, and the frame deadline has arrived. Capture/encode failure preserves pending work and forces IDR in the same generation. The first two consecutive failures reopen the encoder and delay one second; the third becomes fatal. Reopen failure is immediately fatal. Successful processing resets the failure count. Fatal text is exposed by `error()`; the server checks it in its service loop and exits with failure. Startup errors return through `start(error)`.

The service thread validates and handles ACK/input messages and applies XTest events. Track pressed key/button state per connection. On blur, disconnect, generation change, or timeout, release every held key and button before clearing that state. Use USB HID keyboard usage values `0x00..0xE7` as the explicit lab key range and map supported usages to X keycodes; usages above 231 are rejected and unsupported mappings within 0..231 are ignored by the viewer path and return status 2 on the agent control path. Pointer coordinates are unsigned normalized `0..65535` in each axis and scale to the current frame dimensions. Support pointer move, button down/up (buttons 1..3 only), vertical/horizontal wheel deltas, and modifier state. This is a lab input subset, not a claim of full keyboard-layout or IME support.

## Wire protocol (WebSocket binary messages)

All integers are unsigned big-endian unless marked signed. Do not cast incoming bytes to packed/native structs. Reject text messages, fragmented messages exceeding limits, unknown types/versions, invalid lengths, and malformed records. One complete binary WebSocket message is exactly one protocol message.

### Common header: 20 bytes

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 4 | ASCII magic `NSL1` |
| 4 | 1 | Version, `1` |
| 5 | 1 | Type: `1` frame, `2` ACK, `3` input, `4` control ready, `5` input response, `6` cursor image |
| 6 | 2 | Flags, zero for ACK/input; frame bit 0 is keyframe, all other bits zero |
| 8 | 4 | Stream generation |
| 12 | 4 | Sequence number |
| 16 | 4 | Payload byte count following the common header |

Generation starts at 1 and increments for each connection; encoder recovery retains the generation and forces IDR; zero is invalid. Sequence starts at 1 within each generation and increases by one per emitted frame. A new generation invalidates all prior ACKs and queued frames. Compare sequence numbers only within the same generation. Ignore well-formed stale/future ACKs; only an ACK matching the sent front frame restores credit. At UINT32_MAX sequence the worker stops admitting frames; automatic generation rotation is not implemented, so reconnect is required. At UINT32_MAX generation the server rejects connections until restart.

### Frame, type 1

The common payload begins with 12 bytes of metadata, followed by one H.264 Annex B access unit:

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 2 | Width, `1..1280` |
| 2 | 2 | Height, `1..720` |
| 4 | 8 | Capture presentation timestamp in microseconds |
| 12 | 1..8,388,608 | Annex B access unit |

Common payload length must equal `12 + access-unit length`; whole message maximum is 8,388,640 bytes. Initial and recovery frames are IDRs and include the SPS/PPS needed by a fresh decoder. The viewer decodes each access unit, draws the resulting frame, sends its ACK, and closes every `VideoFrame` after drawing or on reset. That ACK means “decoded and drawn by the page,” not physical display presentation.

### ACK, type 2

Payload length is zero. The common generation and sequence identify the sent front frame. Ignore ACKs that do not exactly match it. No other message grants credit.

### Cursor image, type 6

Server-to-viewer on `/stream` only, after the generation's first video frame.
Flags and sequence are zero; generation must match the current video generation.
The payload is four big-endian `uint16` values (width, height, hotspot X, hotspot Y)
followed by `width * height * 4` bytes of straight-alpha RGBA in row order.
Dimensions are bounded to 256×256 and the hotspot must lie inside the image.
An eight-byte all-zero payload restores the local arrow when a native image is
unavailable or exceeds the bound. A fully transparent nonempty image represents
a blank remote cursor. Incorrect lengths, dimensions, hotspots or generations
are rejected by the viewer.

Cursor updates neither consume video credit nor receive ACKs. One pending image
is retained, with newer changes replacing it; video and cursor writes alternate
when both are pending. A fresh connection receives the current shape even if it
has not changed. X11 cursor events wake the capture worker independently of
desktop damage and video admission. The browser renders an overlay at the local
pointer position, scales its image and hotspot with the desktop, and hides it
outside the desktop or on disconnect. Remote pointer warps are not synchronized.

X11 pixels follow the [XFixes cursor image contract](https://xorg.freedesktop.org/archive/current/doc/fixesproto/fixesproto.txt):
premultiplied ARGB in Xlib `unsigned long` elements. The backend converts to
straight RGBA before publication. Deploy server and viewer together; older
viewers that accept only type 1 do not support the cursor extension.

### Input, type 3

Payload is exactly 16 bytes. On `/stream`, common sequence is zero; on `/control`, it is a nonzero request ID echoed in the response. Use the current generation. Reject incorrect sequence form, reserved bits, invalid buttons/usages, and unsupported event codes.

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
- An RTT-derived bounded window permits multiple frames after the first ACK; memory and freshness remain bounded as described in [flow control](flow-control.md). A drawn ACK is not a presentation timestamp.
- Cursor shape fidelity and unsupported keyboard/layout behavior must be recorded as limitations unless implemented and measured.
- Without a token, `/stream` requires a loopback HTTP(S) Origin and all control/data routes require a loopback Host. In authenticated mode, data routes require the token, browser origins must exactly match `--public-origin`, and Host must match the configured authority or loopback. Native agents may omit Origin. WebSocket authentication uses the offered `bearer.TOKEN` subprotocol alongside `nsl1`; the selected protocol remains `nsl1`. One viewer or agent owns control. See [remote TLS and proxy requirements](portable.md).

## Current timing, color, and telemetry

The frame deadline is capture start plus 16,666,667 ns. `ppoll` waits on X/eventfd with a nanosecond deadline when admitted dirty work exists; otherwise it waits without a frame timer. Persistent x264 uses ultrafast/zerolatency, CRF 10, an adaptive VBV ceiling initially 8 Mbps, two threads, no B frames, GOP 600, no lookahead/scenecut, Annex B, and repeated headers. Output must immediately match the submitted PTS; no-output is a recoverable failure subject to the three-failure threshold.

Little-endian BGRA uses `bgraToYuv420`: limited-range BT.709, AArch64 NEON with scalar tail/fallback. Its 2×2 box-averaged chroma is signaled CENTER in codec and frame metadata. Big-endian ARGB uses libswscale with left-sited chroma metadata.

`CaptureStats` contains cumulative `captures`, `encoded`, `capture_ns`, `convert_ns`, and `encode_ns`, logged when the service exits. It counts successful encode attempts, including work subsequently discarded by revision checks; failed attempts are excluded. Stage boundaries are SHM capture completion, conversion completion, and packet assembly completion. Transport/browser time is excluded.

The server closes a generation after three seconds without ACK progress or three seconds of oldest captured-frame age, checked on a 100 ms service timer. The 250 ms threshold pauses new capture admission; it is not a hard display-age guarantee. Page first-frame and decoder deadlines are five seconds. Reconnect waits 1/2/4/8/8 seconds, stopping after five attempts unless a successful draw resets retries. Hidden pages pause; resuming reconnects with a fresh generation and IDR. The viewer derives AVC codec configuration from SPS, configures the decoder, ACKs after drawing and closes VideoFrames, and does not flush per frame.

`GET /metrics` returns uncached cgroup v2 JSON with additional generation-scoped flow fields documented in [flow control](flow-control.md):

```json
{"usage_usec":1234,"memory_current":5678,"inactive_file":90}
```

CPU is cumulative microseconds; memory fields are bytes. Missing/invalid resource data returns HTTP 200 with `resources_available: false` and null `usage_usec`, `memory_current` and `inactive_file` fields; transport metrics remain available. The HUD polls about once per second, permits one metrics request at a time, and aborts after two seconds. CPU is delta usage / elapsed browser time × 100, normalized to **one core** and potentially above 100%. RAM is max(0, memory_current − inactive_file) / 2^20 MiB: a working-set approximation, not process RSS. Both cover the mounted cgroup, including desktop/apps in the reference container; they are not process-only measurements. Drawn FPS counts canvas draws; stream Mbps counts H.264 payload bytes, excluding protocol overhead. These are observational counters, not WAN or physical-presentation guarantees.

## References

- [FFmpeg 7.0 libavcodec send/receive API](https://ffmpeg.org/doxygen/7.0/group__lavc__decoding.html)
- [libwebsockets coding and event loop guidance](https://github.com/warmcat/libwebsockets/blob/main/READMEs/README.coding.md)
- [XDamage protocol](https://xorg.freedesktop.org/archive/current/doc/damageproto/damageproto.txt)
- [MIT-SHM protocol](https://xorg.freedesktop.org/archive/current/doc/xextproto/shm.html)
- [XTest library](https://www.x.org/releases/X11R7.5/doc/Xext/xtestlib.html)
- [WebCodecs AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)

## Verification status

General3 passed all 12 browser/video and five framework checks in release and ASAN/UBSAN builds. Earlier 4b9ea36 results apply only to that earlier core. The v1 wire layout is unchanged, but the frame cap and concurrency semantics changed; compatibility with old viewers is not promised. There is no static quiet-period refinement or guaranteed quality floor. The historical General3 run predates authenticated TLS; see [portable setup](portable.md) for the current remote access contract.

Backend extraction also passed an injected CPU-source test through the actual H.264 encoder, linked without X11. See [backend boundaries and status](backends.md).

## Agent control and snapshots

`/control` uses subprotocol `nsl1`, exclusively with `/stream`. It sends type 4 with nonzero generation, sequence zero and four-byte width/height payload. Each valid type-3 input request receives type 5, echoing its request sequence with one status byte: 0 submitted, 1 invalid, 2 unsupported. There are at most 32 queued replies. Structural protocol violations close the connection and release controls. Submitted does not mean the application reacted; reconnect never replays requests. The agent connection starts no H.264 video session.

`GET /capabilities` exposes backend/dimensions and feature availability. `GET /snapshot.png` captures a fresh native PNG independently of viewer/controller ownership. One worker/result slot remains occupied through capture and HTTP delivery; a busy request receives JSON HTTP 503. Each HTTP snapshot has a five-second response timer and at most 8 MiB encoded output, written in bounded chunks. The worker owns a separate source and codec; a disconnected request discards its eventual result. X11 calls are not interruptible, so the response timer is not a hard worker-completion bound. Structured errors complete the normal HTTP transaction for safe connection reuse. See [SDK and CLI contracts](framework-api.md).
