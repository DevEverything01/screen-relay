# Native desktop streaming lab

An experimental Linux desktop streaming framework with a browser viewer, typed Node SDK and CLI, and replaceable capture/input backends. The implemented backend streams Xfce/X11 as H.264 at 1280×720, targeting up to 60 FPS. Actual delivery depends on the application, encoder and connection; a configured rate is not a measured rate. Wayland is future work.

## Run

From this directory:

    docker build -t native-stream-lab:standalone .
    docker run --name native-stream-lab --cpus=2 --memory=1536m --memory-swap=1536m --shm-size=512m -p 127.0.0.1:18094:8080 native-stream-lab:standalone

Open [the viewer](http://127.0.0.1:18094) in Chrome with H.264 WebCodecs support. The image builds the native server/tests and starts Xvfb/Xfce. It needs no runtime browser, Node server, Selkies, KasmVNC or separate FFmpeg process. The Debian base digest is pinned; apt repositories are not a full reproducible-build snapshot.

Normal startup opens the XFCE desktop without a benchmark application. Benchmark runners explicitly copy their fixture into the dedicated test container before starting it.

This is an unauthenticated local development profile. Publish to host loopback and use an isolated desktop. Anyone able to reach the service can observe/control it. Host/Origin checks do not replace authentication or TLS.

## Agent control

Close the viewer before acquiring control: one browser **or** one agent owns input at a time. The optional `snapshot({ url }, path)` export and CLI snapshot command take a single native PNG without acquiring control, including while the viewer is connected. Continuous desktop streaming uses H.264.

    import { connect } from 'native-stream-lab';
    const desktop = await connect({ url: 'http://127.0.0.1:18094' });
    try {
      console.log(await desktop.capabilities());
      await desktop.input({ type: 'pointerMove', x: 0.5, y: 0.5 });
      await desktop.snapshot('screen.png');
    } finally {
      desktop.close();
    }

Node 22+ is required; the SDK has no runtime npm dependencies. Coordinates use [0,1], keys use USB HID usages. ACK means submitted input, not application completion. Connection loss releases held controls when observed by the server; reconnect never replays input.

    NATIVE_STREAM_URL=http://127.0.0.1:18094 node sdk/cli.js capabilities
    NATIVE_STREAM_URL=http://127.0.0.1:18094 node sdk/cli.js snapshot screen.png

CLI results are JSON on stdout, errors are JSON on stderr, and failures exit nonzero. See [the framework API](docs/framework-api.md) for types, batches, errors and lifecycle.

## Backend boundaries

CaptureSource supplies CPU pixels and damage notifications. InputBackend applies events and releases held controls. X11 code lives in src/x11-capture.cpp and src/x11-input.cpp; the encoder and server consume the interfaces. A separate PNG worker uses the capture factory without a video session.

These are C++ source interfaces, not a stable cross-language plugin ABI. An injected source with no X11 linkage drives the actual H.264 encoder and checks independently decoded pixels, fresh IDRs, idle behavior and invalid-frame recovery. See [backend contracts and Wayland requirements](docs/backends.md).

The stream uses persistent libx264 via libavcodec, scalar/ARM NEON BT.709 conversion, and libwebsockets. An RTT-derived window admits up to eight frames with at most 8 MiB logical encoded payload. Additional codec, transport and browser allocations are separate. Feedback adjusts the VBV ceiling without workload-name branches. See [flow control](docs/flow-control.md) and [the wire/build contract](docs/build-contract.md).

## Verification

    npm ci --ignore-scripts
    npm test
    TEST_CONTAINER=native-stream-lab TEST_URL=http://127.0.0.1:18094 npm run test:integration
    TEST_CONTAINER=native-stream-lab TEST_URL=http://127.0.0.1:18094 npm run test:framework
    TEST_CONTAINER=native-stream-lab TEST_URL=http://127.0.0.1:18094 npm run test:cursor

Integration needs installed Google Chrome and a dedicated container; tests temporarily cover its desktop. Playwright/PNG tooling are local development dependencies. Docker builds run color, flow-policy and injected-backend tests. See [test evidence and limits](tests/README.md).

The general3 candidate passed 12 browser/video and five framework checks in release and ASAN/UBSAN builds. Graceful sanitizer termination exited zero with no reported leak/runtime error; system libraries were not instrumented. Ten SDK tests cover validation, ACKs, disconnect, pending limits, malformed replies, body/file errors and snapshot commands that do not acquire control.

The [modular baseline report](optimize/general-engine-report.md) ([HTML](optimize/general-engine-report.html)) includes real Thunar and Freedoom comparisons, the broader network matrix, verification logs and remaining limitations. Reproduce it from the portable evidence with `python3 qualification/report.py optimize/evidence/general/qualification/results/general-final/manifest.json --root optimize/evidence/general`.

The [initial nine-session comparison](optimize/native-stream-report.md) ([HTML](optimize/native-stream-report.html)) remains narrow historical evidence. [Broader qualification](qualification/README.md) records CPU, RAM, bandwidth, delivered updates, latency and fidelity together. Comparative runs require separately prepared competitor images and credentials. No universal winner follows from unequal-quality operating points.

The viewer receives actual X11 cursor images and hotspots, including text and window-resize cursors, independently of video frames. Cursor images scale with the desktop; the local pointer supplies their position. Images larger than 256×256 fall back to the local arrow. See the [cursor protocol](docs/build-contract.md#cursor-image-type-6).

Current limits: CPU capture, fixed 720p, one controller, mapped keyboard subset. No Wayland backend, authentication, TLS, IME, audio, clipboard, resize, remote pointer-warp synchronization, relative pointer, hardware encoding or simultaneous viewer/agent control. GNOME, physical presentation, packet loss and browser/VM resources are unverified. C++ was chosen for direct native-library integration; no Rust-versus-C++ benchmark was performed.

For a live keyboard-controlled game, see [Freedoom](doom/README.md).

External automation stays independent: agent-desktop can use the graphical session's AT-SPI interfaces, and agent-browser can connect to a browser's CDP endpoint. Neither tool is a dependency of this framework, and this lab has not run those integrations.

## Repository map

| Directory | Responsibility |
| --- | --- |
| `src/` | Native capture/input interfaces, X11 implementations, encoder, flow control and HTTP/WebSocket service |
| `viewer/` | Browser H.264 decoding, rendering and human input |
| `sdk/` | Typed Node client, CLI and protocol/error tests |
| `tests/` | Native unit checks and real browser/X11 integration |
| `qualification/` | Broad diagnostics, real-application comparisons and explicit evidence reporting |
| `bench/` | Original benchmark, retained separately for regressions |
| `probes/` | Isolated codec/runtime investigations |
| `docs/` | Backend, protocol, flow and development contracts |
| `optimize/` | Published reports and portable evidence |

See [engineering and extension rules](docs/engineering.md) before changing a backend or claiming a performance improvement.
