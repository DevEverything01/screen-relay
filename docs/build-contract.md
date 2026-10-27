# Native stream build contract

This document is the shared interface contract for the capture/encode, transport/input, and viewer work. It keeps the prototype to the existing C++17, X11, FFmpeg, libwebsockets, and browser APIs. It is not evidence that the design has built or met its targets.

## Build boundary

- Compile as C++17. Link the image's installed FFmpeg development libraries: `libavcodec` ABI 61 (FFmpeg 7), `libavutil`, and `libswscale`. Do not use FFmpeg 8-only APIs or assume its ABI. Use `pkg-config` for library flags.
- The proposed additional packages remain the ones in `native-design.md`: `build-essential`, `pkg-config`, `libx11-dev`, `libxext-dev`, `libxdamage-dev`, `libxfixes-dev`, `libxtst-dev`, and `libwebsockets-dev`. This contract does not install them or change the benchmark image.
- Keep the executable and modules in the existing lab; no framework, protocol dependency, or additional package is needed. The shared wire definitions below are byte operations, not serialized C++ structs.

## Native ownership and interfaces

Use one `StreamSession` owned by the main thread. `CaptureEncoder` is constructed and stopped by that thread, then runs its X11/XDamage/XShm capture and persistent encoder on one worker. `WebSocketServer` owns the libwebsockets context, service loop, and a separate XTest display connection on the service thread. Only that thread calls libwebsockets APIs that operate on a connection, including `lws_write`.

The smallest shared interface is:

```cpp
struct EncodedFrame {
  uint32_t generation;
  uint32_t sequence;
  uint64_t pts_us;
  uint16_t width;
  uint16_t height;
  bool keyframe;
  std::vector<uint8_t> annex_b;
};

class FrameSink {
public:
  virtual ~FrameSink() = default;
  virtual void publish(EncodedFrame frame) = 0; // transfers ownership
  virtual void request_idr(uint32_t generation) = 0;
};

class CaptureEncoder {
public:
  bool start(FrameSink& sink, uint32_t generation);
  void set_credit(bool available, uint32_t generation);
  void force_frame(uint32_t generation); // initial frame / reconnect
  void stop(); // joins worker before releasing X, SHM, or codec state
};
```

`publish` moves the packet bytes into a bounded queue; a full queue is an error/recovery condition, never permission to discard an encoded reference packet. Queue capacity is one frame for the initial one-credit policy. The worker signals the service loop using a thread-safe wake mechanism; the service thread dequeues and writes. The `EncodedFrame` vector remains alive and unchanged through the synchronous `lws_write` call and may be released once that call returns. Construct the actual LWS buffer with `LWS_PRE` writable bytes before the payload; do not pass the vector's `data()` directly as an LWS-prefixed buffer.

`CaptureEncoder` retains X connection, XDamage object, SHM image, reusable conversion/encoder frame, and codec context for its lifetime. It owns and unreferences the `AVPacket` after copying/moving its bytes into `EncodedFrame`; it does not hand an `AVPacket*` or borrowed encoder storage to transport. Make the reusable `AVFrame` writable before filling it. Drain all available output packets after each successful `avcodec_send_frame` until `AVERROR(EAGAIN)`; treat other negative returns as failure. This matches the FFmpeg 7 send/receive API and caller-owned input-frame semantics.

On each damage notification, latch pending work even without credit. Consume/reset XDamage before capture on the same X connection. Capture only when damage or a forced frame is pending, credit is available, and the frame deadline has arrived. On capture/encode failure preserve pending work and recover through a new generation and IDR; do not silently lose the change.

The service thread validates and handles ACK/input messages and applies XTest events. Track pressed key/button state per connection. On blur, disconnect, generation change, or timeout, release every held key and button before clearing that state. Use USB HID keyboard usage values `0x00..0xE7` as the explicit lab key range and map supported usages to X keycodes; unsupported usages are rejected. Pointer coordinates are unsigned normalized `0..65535` in each axis and scale to the current frame dimensions. Support pointer move, button down/up (buttons 1..5 only), vertical/horizontal wheel deltas, and modifier state. This is a lab input subset, not a claim of full keyboard-layout or IME support.

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

Generation starts at 1 and increments for reconnect or recovery; zero is invalid. Sequence starts at 1 within each generation and increases by one per emitted frame. A new generation invalidates all prior ACKs and queued frames. Compare sequence numbers only within the same generation. Reject stale/future ACKs; only an ACK matching the one outstanding frame restores credit. Do not wrap sequence numbers: start a new generation first.

### Frame, type 1

The common payload begins with 12 bytes of metadata, followed by one H.264 Annex B access unit:

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 2 | Width, `1..1280` |
| 2 | 2 | Height, `1..720` |
| 4 | 8 | Capture presentation timestamp in microseconds |
| 12 | 1..16,777,216 | Annex B access unit |

Common payload length must equal `12 + access-unit length`; whole message maximum is 16,777,248 bytes. Initial and recovery frames are IDRs and include the SPS/PPS needed by a fresh decoder. The viewer decodes each access unit, draws the resulting frame, closes every `VideoFrame`, then sends its ACK. That ACK means “decoded and drawn by the page,” not physical display presentation.

### ACK, type 2

Payload length is zero. The common generation and sequence identify the sole outstanding frame. Ignore ACKs that do not exactly match it. No other message grants credit.

### Input, type 3

Payload is exactly 16 bytes; common sequence is zero. Use the current generation. Reject other sequence values, reserved bits, out-of-range coordinates/buttons/usages, and unsupported event codes.

| Payload offset | Size | Field |
| --- | ---: | --- |
| 0 | 1 | Event: 1 key down, 2 key up, 3 pointer move, 4 button down, 5 button up, 6 wheel |
| 1 | 1 | Reserved, zero |
| 2 | 2 | Code: HID usage for key events; button number `1..5` for button events; zero for move/wheel |
| 4 | 4 | Signed value: zero for key/pointer/button; signed wheel delta for wheel |
| 8 | 2 | Normalized X, `0..65535` |
| 10 | 2 | Normalized Y, `0..65535` |
| 12 | 2 | Button mask; only low five bits may be set |
| 14 | 2 | Modifier mask; only HID modifier bits 0..7 may be set |

For wheel, the signed value is a bounded integer delta in 120-unit steps; reject magnitude above 1200. For key transitions, the modifier mask describes current modifiers and must agree with tracked held-key state. The server must bound message accumulation before reassembly; allow at most the maximum frame message size above, and at most 64 KiB for any non-frame input/control message.

## Shared browser behavior

The viewer requests low-latency H.264 decoding where available, but that preference is not a guarantee that an IDR is output without later input. Before relying on one-frame credit, verify that an IDR is delivered under the actual browser. Do not add per-frame decoder flushes to force output. If the browser withholds the first frame, record the failure and revisit the measured bounded-credit policy. On hidden-tab/ACK timeout, stop accepting old-generation input, release held controls, reconnect with a new generation, and require an IDR.

## Limits retained from the design

- Fixed maximum capture surface is 1280×720, matching `desktop-stream-bench/session.sh`; resize is disabled in the reference sessions.
- Capture/conversion starts full-frame. No regional conversion savings are claimed.
- H.264 uses low delay with no B frames/lookahead. YUV420 may reduce colored-text fidelity.
- One outstanding frame bounds memory but makes update rate sensitive to browser ACK round-trip time. A drawn ACK is not a presentation timestamp.
- Cursor shape fidelity and unsupported keyboard/layout behavior must be recorded as limitations unless implemented and measured.
- Do not run Docker, builds, browser automation, or benchmark sessions as part of preparing this contract. Do not edit the benchmark files or dependency list here.

## References

- [FFmpeg 7.0 libavcodec send/receive API](https://ffmpeg.org/doxygen/7.0/group__lavc__decoding.html)
- [libwebsockets coding and event loop guidance](https://github.com/warmcat/libwebsockets/blob/main/READMEs/README.coding.md)
- [XDamage protocol](https://xorg.freedesktop.org/archive/current/doc/damageproto/damageproto.txt)
- [MIT-SHM protocol](https://xorg.freedesktop.org/archive/current/doc/xextproto/shm.html)
- [XTest library](https://www.x.org/releases/X11R7.5/doc/Xext/xtestlib.html)
- [WebCodecs AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)
