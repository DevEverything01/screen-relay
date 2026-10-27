# Native lab design and limits

This describes the implemented prototype, not an optimization verdict. See the [implemented contract](build-contract.md), [verification recipes](../tests/README.md), [metrics checks](../tests/live-metrics-README.md), and [initial narrow report](../optimize/native-stream-report.md).

## Data ownership

A capture worker owns a `CaptureSource`, reusable YUV frame and persistent libavcodec/libx264 encoder. The X11 capture source owns its X connection, XDamage object and MIT-SHM image. The transport thread owns its WebSocket context and an `InputBackend`, currently XTest on a separate X connection. A separate snapshot worker owns another capture source. See [backend boundaries](backends.md). A bounded handoff transfers encoded packet ownership; no writer rewrites storage still held by a reader.

Capture admission requires damage, an available browser credit, and the frame deadline. Damage resets before capture on the same X connection so subsequent drawing remains pending. Capture and conversion are full-frame; regional conversion savings are not implemented. Pixel masks/stride are validated and encoder input is made writable before reuse.

Pending damage stays latched while credit is unavailable: NonEmpty events are transitions. Initial/reconnected sessions force a frame, restored credit wakes the worker, and capture failure retains pending work. The Docker reference session pins Xfce compositing off; child windows, popups, and scrolling require verification against root capture.

Use low-delay H.264 with no B frames or lookahead. Preserve the reference chain: stop before generating extra frames rather than dropping dependent encoded packets. The browser decodes and draws, sends ACK to release credit, and closes each VideoFrame after drawing or on reset. A draw acknowledgement is not a physical presentation timestamp. The initial window is one frame; after an ACK an RTT-derived window ranges from two to eight. Encoded frame count and bytes are bounded; see [flow control](flow-control.md).

IDR followed by silence needs an actual-browser check: WebCodecs low-latency preference does not guarantee immediate output. A decoder retaining its first frame cannot make progress under one-credit admission. The page configures the decoder and uses first-frame/decode deadlines rather than per-frame flushes. ACK timeout and hidden-tab recovery reconnect with a new generation and IDR. Only the transport thread writes sockets; worker completion wakes it.

Reconnect resets generation and sends an IDR with parameter sets. The server validates inbound sizes, input ranges, and acknowledgements, and releases held controls on blur/disconnect. Pointer scaling, modifier keys, and wheel events are implemented. Cursor-shape streaming remains unsupported.

## Libraries used

The reference image provides libavcodec ABI 61, libavutil, and libswscale development packages. Startup requires `avcodec_find_encoder_by_name("libx264")` to succeed and returns an error otherwise.

The Dockerfile installs the compiler and development packages: build-essential, pkg-config, libx11-dev, libxext-dev, libxdamage-dev, libxfixes-dev, libxtst-dev, libwebsockets-dev. It builds the daemon directly against these libraries, without invoking Selkies, KasmVNC, or an FFmpeg process. H.264 decoding capability must be checked in the actual browser. YUV420 discards chroma detail and may fail the colored-text quality constraint.

## Primary references

- [XDamage protocol](https://xorg.freedesktop.org/archive/current/doc/damageproto/damageproto.txt): region subtraction and damage reporting.
- [MIT-SHM](https://xorg.freedesktop.org/archive/current/doc/xextproto/shm.html): image storage and capture semantics; SHM still entails a framebuffer copy.
- [FFmpeg send/receive API](https://ffmpeg.org/doxygen/7.0/avcodec_8h_source.html): reference ownership and encoder draining. The reference image uses libavcodec ABI 61.
- [WebCodecs AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/): Annex B, keyframes and parameter sets.
- [libwebsockets write API](https://libwebsockets.org/lws-api-doc-main/html/lws-write_8h.html): writable callbacks and required buffer padding.
- [XTest](https://www.x.org/releases/X11R7.5/doc/Xext/xtestlib.html): synthetic input.

## Implemented conversion and failure behavior

Little-endian BGRA uses limited-range BT.709 conversion in `src/color.cpp`, with AArch64 NEON eight-pixel luma and 2×2 chroma blocks plus scalar tail/fallback. It respects source and destination strides. Averaging each 2×2 block places chroma at its center, so the codec and frame signal CENTER; left-sited metadata would misdescribe these pixels. Big-endian ARGB uses libswscale with left-sited chroma metadata. These paths require their own verification evidence.

Persistent x264 currently uses CRF 10, ultrafast/zerolatency, two threads, no B frames/lookahead, GOP 600, and repeated SPS/PPS in Annex B. YUV420 still loses chroma detail; low CRF cannot recover it. Static similarity alone does not establish matched motion quality.

Capture/encode failure retains dirty work and forces IDR in the same generation. Two recovery attempts reopen the encoder and wait one second; the third consecutive failure, or failed reopen, is fatal. The server observes `CaptureEncoder::error()` and exits with failure. Reconnect increments generation. Sequence exhaustion stops admission and requires reconnect; automatic generation rotation is not implemented.

The surface is fixed 1280×720, one viewer. Input supports mapped HID keys, buttons 1..3, two wheel axes, held modifiers, and release-all. Cursor images and hotspots are sent separately from video using XFixes notifications. Layout/IME completeness, clipboard, audio, resize, remote pointer-warp synchronization, hardware encoding and multiple viewers remain outside this implementation. Adaptive flow and VBV control passed release and sanitizer integration; performance and fidelity are reported separately. The local profile uses loopback Host/Origin checks. Authenticated TLS deployment is specified in [portable setup](portable.md).

The HUD reports canvas draw FPS, H.264 payload rate, mounted-cgroup CPU normalized to one core, and cgroup working-set RAM. It excludes browser resource usage and does not isolate streaming CPU. The adaptive window depends on ACK turnaround; this implementation makes no WAN performance claim.

## Acceptance targets

Predeclared lab targets: ≤5% of one CPU core at idle, ≥50 browser-visible motion updates/s with the existing approximately 55/s producer, motion input p95 ≤45 ms, no input loss, bounded memory/backlog, and static text quality no worse than the measured baseline within the agreed tolerance. Report active CPU, memory and bandwidth even when a target fails. Equal configured FPS is not equal achieved FPS; static text similarity is not matched motion quality. No universal efficiency winner may be inferred from unmatched operating points.

## Verification status

The current multi-frame implementation has not yet completed runtime verification. Earlier 4b9ea36 benchmark and integration results do not validate it. Wire v1 layout remains unchanged, but old-viewer compatibility is not promised. Quiet-period refinement and an enforced fidelity floor are not implemented.

General3 passed 12 browser/video and five framework checks in release and ASAN/UBSAN builds; only Xfce on X11 has been tested.
