# Initial implementation scope

This is a proposed design to approve, not a validated implementation or an optimization finding.

## Data ownership

A capture worker owns an X connection, XDamage object, MIT-SHM image, reusable YUV frame and persistent libavcodec/libx264 encoder. The transport thread owns its WebSocket context and a separate X connection for XTest input. A bounded handoff transfers encoded packet ownership; no writer rewrites storage still held by a reader.

Capture admission requires damage, an available browser credit, and the frame deadline. Transfer/reset damage before capture on the same X connection so a concurrent subsequent draw remains pending. Start with full-frame capture and conversion; do not claim regional conversion savings. Respect pixel masks, stride and SHM allocation lifetime. Make encoder input writable before reuse.

Latch pending damage even while credit is unavailable: NonEmpty events are transitions. Force an initial/reconnect frame, wake on restored credit, and restore pending work after capture failure. Pin Xfce compositing off, as in both baseline sessions; verify child windows, popups and scrolling reach root capture.

Use low-delay H.264 with no B frames or lookahead. Preserve the reference chain: stop before generating extra frames rather than dropping dependent encoded packets. The browser decodes, draws and closes every VideoFrame; its acknowledgement releases credit. A draw acknowledgement is not a physical presentation timestamp. One in-flight frame deliberately bounds state; its WAN round-trip ceiling is a limitation of this local experiment.

Before relying on one-frame credit, test IDR followed by silence: WebCodecs low-latency preference does not guarantee immediate output. A decoder retaining the first frame would deadlock this policy. Do not paper over it with per-frame flush. Reject unsupported configurations or use a measured bounded-credit policy. Implement ACK timeout/hidden-tab recovery with a new generation and IDR. Only the transport thread may write sockets; worker completion wakes it.

On reconnect, reset the stream generation and send an IDR with parameter sets. Validate inbound message sizes, input ranges and acknowledgements. Release held keys and buttons on blur/disconnect. Include pointer scaling, modifier keys and wheel events. Cursor shape fidelity needs explicit implementation or an honest recorded limitation.

## Libraries proposed for approval

The current shared image already contains libavcodec, libavutil and libswscale development packages. A live capability check confirmed `avcodec_find_encoder_by_name("libx264")` succeeds in libavcodec.so.61.

Proposed additional container packages: build-essential, pkg-config, libx11-dev, libxext-dev, libxdamage-dev, libxfixes-dev, libxtst-dev, libwebsockets-dev. None is approved or installed for this prototype yet. H.264 decoding capability must be checked in the actual browser. YUV420 discards chroma detail and may fail the colored-text quality constraint.

## Primary references

- [XDamage protocol](https://xorg.freedesktop.org/archive/current/doc/damageproto/damageproto.txt): region subtraction and damage reporting.
- [MIT-SHM](https://xorg.freedesktop.org/archive/current/doc/xextproto/shm.html): image storage and capture semantics; SHM still entails a framebuffer copy.
- [FFmpeg send/receive API](https://ffmpeg.org/doxygen/8.0/avcodec_8h_source.html): reference ownership and encoder draining. Installed FFmpeg version must be respected during implementation.
- [WebCodecs AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/): Annex B, keyframes and parameter sets.
- [libwebsockets write API](https://libwebsockets.org/lws-api-doc-main/html/lws-write_8h.html): writable callbacks and required buffer padding.
- [XTest](https://www.x.org/releases/X11R7.5/doc/Xext/xtestlib.html): synthetic input.

## What would constitute success

Predeclared lab targets: ≤5% of one CPU core at idle, ≥50 browser-visible motion updates/s with the existing approximately 55/s producer, motion input p95 ≤45 ms, no input loss, bounded memory/backlog, and static text quality no worse than the measured baseline within the agreed tolerance. Report active CPU, memory and bandwidth even when a target fails. Equal configured FPS is not equal achieved FPS; static text similarity is not matched motion quality. No universal efficiency winner may be inferred from unmatched operating points.
