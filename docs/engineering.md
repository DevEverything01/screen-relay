# Developing the baseline

The production path is `CaptureSource → CaptureEncoder → bounded flow control → WebSocket → browser VideoDecoder`. Human and SDK input share `InputBackend`. X11 owns display-specific calls; the encoder and transport use the declared interfaces. See [backend ownership and lifetimes](backends.md), [wire/build contract](build-contract.md), [flow policy](flow-control.md) and [public SDK](framework-api.md).

The code targets C++17 with compiler warnings enabled. Follow the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines), especially explicit interface contracts, RAII for resources (R.1), scoped thread lifetimes (CP.23) and synchronization of shared state. Native C handles belong to their wrapper object; keep allocation and cleanup paired, including partial startup failures. Workers must finish before the resources they access are destroyed. Keep borrowed frame ownership explicit and do not move display calls into the encoder or network layer. This is guidance for changes, not a claim of complete guideline conformance.

## Verification

1. Build the image using the root README. Its build runs color, congestion-policy and real-encoder/injected-source checks before producing the server.
2. Run `npm ci --ignore-scripts` and `npm test` for the client API. The runtime SDK has no npm dependencies.
3. Run the documented browser/video and framework integration commands against a dedicated container. These inspect decoded pixels, actual X11 input and resource counters; a successful ACK alone does not prove application completion.
4. For native ownership or concurrency changes, repeat the integration checks in an ASAN/UBSAN build and inspect graceful shutdown. Linked system libraries are not instrumented.
5. For performance changes, freeze the source/image identity and run measurements serially. Preserve invalid observations, report independent repetitions, and keep delivery, latency, resource cost and fidelity together.

Synthetic fixtures test narrow contracts and help isolate regressions. They do not establish superiority over another engine. Use real applications as well: [Thunar desktop work](../qualification/APPLICATIONS.md) uses the same hashed real files in every engine; [Freedoom](../qualification/game.mjs) exercises a running application with real browser keyboard input and independent X11 key-state observations. Pixel-change rates are not decoded FPS. Real-application results still have limited workload coverage, and game fidelity and input latency remain unmeasured.

The fixture, runner, app data and competitor configuration are part of the measurement contract. A change to any of them requires a fresh comparison or an explicit incompatibility note. Never tune an engine by workload name, accept a stale screenshot because it is nonblack, or omit a failed competitor result to manufacture a win.

## Next steps

1. Fix the measured limited-bandwidth video fidelity and tail-latency weaknesses in the [final comparison](../optimize/general-engine-report.md). Compare at matched quality and measure recovery after congestion. Then broaden evidence to natural video and real browser/editor workloads, hardware presentation and input latency, long sessions, packet loss, more resolutions and architectures. Include client decoding CPU/GPU and memory in the end-to-end budget.
2. Add an actual Wayland capture/input implementation behind the current boundaries. Resolve portal permission and revocation, negotiated frame ownership/format, resize and held-input cleanup; validate on GNOME and the intended compositor. Revise the CPU-frame contract deliberately if GPU buffers are needed.
3. Before exposure beyond loopback, implement and test authentication, authorization and TLS, then address multi-user/session isolation. Audio, clipboard, IME, resize and hardware encoding each need an explicit contract and end-to-end evidence.

Do not infer feature parity with Selkies or KasmVNC from this smaller baseline. Keep external AT-SPI and CDP tools independent of the transport.
