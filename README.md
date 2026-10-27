# Native desktop streaming lab

A small Linux desktop-to-browser streaming server, built around the platform capture APIs and codec/transport libraries. It runs Xfce at 1280×720, captures X11 damage, encodes H.264 in-process, and serves one local browser viewer with keyboard and pointer input.

## Build and run

Build the standalone Debian image from this directory:

```sh
docker build -t native-stream-lab:standalone .
```

Run it with the same resource bounds used by the lab and publish the port on host loopback only:

```sh
docker run --name native-stream-lab \
  --cpus=2 --memory=1536m --memory-swap=1536m --shm-size=512m \
  -p 127.0.0.1:18094:8080 \
  native-stream-lab:standalone
```

Open [http://127.0.0.1:18094](http://127.0.0.1:18094) in current Google Chrome with H.264 WebCodecs decoding support. The viewer uses the browser's WebCodecs decoder; it does not bundle or install a browser in the container. The server permits one viewer at a time and checks that the WebSocket Origin is loopback. Keep the port mapping on `127.0.0.1`.

The Dockerfile builds the native executable and viewer in the default Debian Trixie image. It installs the required X11, FFmpeg, and libwebsockets development packages, and invokes the native server directly. It does not install or start Selkies, KasmVNC, or a separate FFmpeg process. Xvfb and Xfce provide the desktop platform.

## Architecture

- An XDamage event latches frame work. The capture worker uses MIT-SHM to read the 1280×720 X11 root surface, then converts BGRA to limited-range BT.709 YUV420 with the project's scalar/ARM NEON converter.
- A persistent libx264 encoder is accessed through the installed FFmpeg `libavcodec`/`libavutil` APIs. The encoder runs low-delay with no B frames/lookahead; packet bytes move into a bounded queue without dropping reference packets.
- A single libwebsockets service thread owns WebSocket writes and a separate XTest connection for synthetic keyboard, pointer, button, and wheel input. The browser decodes and draws each frame, then returns an ACK that releases the one-frame credit.
- A three-second ACK timeout ends the viewer generation and releases held controls. A reconnect starts a new generation and receives an IDR with parameter sets.

See [the protocol and ownership contract](docs/build-contract.md) for byte layouts, limits, and thread boundaries. See [integration checks](tests/README.md) for the real browser/X11 test coverage and its limits.

## Validation status

- The live integration suite passed all ten checks: decoded desktop pixels, independently checked live resource counters, keyboard/pointer/wheel, held-control cleanup, reconnect, single-viewer behavior, malformed/untrusted client handling, and ACK-timeout recovery. The timeout probe independently observed held Shift/button state and subsequent release. Details and limits are in [tests/README.md](tests/README.md).
- The ARM64 Docker color-conversion unit suite passed its BT.709 reference, chroma, stride, tail, and guard checks, including the NEON path.
- The color suite and ten browser/X11 checks also passed with address and undefined-behavior sanitizers. Graceful shutdown produced no sanitizer or leak diagnostic. System libraries were not instrumented.
- A previous CRF 18 experiment is exploratory evidence only. The final CRF 10 performance/fidelity report is pending; do not treat it as a completed comparison or a universal efficiency claim.

The standalone server is a local lab prototype, not WAN proof or a generally superior replacement for existing streaming systems. It has one local viewer and no authentication, TLS, IME/full keyboard-layout support, audio, clipboard, resizing, or relative-pointer mode. The desktop surface is fixed at 720p; CPU-only local validation does not establish WAN latency, hardware-encoder behavior, physical presentation latency, or performance on other workloads.

Live, keyboard-controlled Freedoom is available as a separate image; see [`doom/README.md`](doom/README.md).
