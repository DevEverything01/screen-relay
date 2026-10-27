# Should we build a better desktop-streaming framework?

**A focused prototype is justified; a wholesale replacement is not yet justified.** The credible opportunity is a resource-efficient runtime for Linux application and agent sessions, with measurable latency and text-quality guarantees. Claiming superiority across GNOME, office work, games, GPUs, every browser, and every network would require much broader evidence.

The accompanying Xfce/GNOME comparison tests four concrete configurations. It compares their default client quality choices on local ARM64 Docker. It does not establish the best tuned operating point of either engine.

## Start with the actual costs

Total CPU is application rendering + desktop composition + capture + pixel conversion + encoding + transport. Total memory includes the application, desktop services, compositor, frame buffers, codec state, and queues. A streaming rewrite cannot remove the cost of running GNOME itself. Full GNOME requires preserving its desktop/compositor behavior; a lightweight application-only runtime is a different product mode.

The visible update rate is bounded by the slowest stage: application production, capture, encoding, network delivery, decoding, and presentation. If the test app produces only about 55 updates/s, receiving about 55 does not demonstrate a streaming bottleneck. Likewise, sending fewer Mbps is not automatically better if the viewer receives fewer useful updates or worse text.

Interaction latency is a different objective: input delivery + application response + waits for capture/encoding + queued work + network transit + decoding/presentation. A queue can preserve a high average FPS while showing old frames. Measure the age of the displayed state, latency percentiles, and long gaps alongside FPS.

At 1280 × 720, one BGRA frame is 3,686,400 bytes. Processing 60 full frames/s covers 221 MB/s of pixel payload for each complete pass; a copy reads and writes that payload. At 1080p60 the payload is about 498 MB/s per pass. These are arithmetic workloads, not measured memory bandwidth or promised speedups. Avoiding repeated capture, packing, and color conversion is useful only where those stages actually dominate.

## What is already solved by the incumbents

Selkies already has Rust capture/encoding, X11 and Wayland paths, software and hardware codecs, quality refinement, and congestion/backpressure controls. Its published pixelflux documentation describes bounded frame ownership and skipping capture when the encoder is saturated. “Rust,” “zero-copy,” or “damage-aware” would not independently distinguish a new project. The current pixelflux API docs describe version 2.2.1; they are architectural context, not proof that every capability exists in the exact binary benchmarked. [Selkies](https://docs.selkies.io/latest/), [pixelflux](https://pixelflux.selkies.io/pixelflux/index.html).

KasmVNC already adapts region quality and motion behavior; its configured maximum FPS is explicitly a ceiling, and clients can override many server defaults. We must first compare tuned alternatives at matched quality, not win by choosing a weaker baseline. [KasmVNC configuration](https://kasmweb.com/kasmvnc/docs/latest/configuration.html).

## The architecture worth testing

1. **Preserve changes from their source.** Carry damaged regions, frame generation, and buffer ownership from the display backend through encoding. Use existing display/compositor APIs first. Take consistent snapshots: removing a copy without protecting buffer lifetime can introduce torn or corrupted frames.
2. **Admit work before capture.** If the encoder or receiver cannot consume another update, avoid producing disposable work. Keep bounded pending state, union unsent damage, and retain a well-defined full-refresh path after resize or reconnect. Do not arbitrarily discard encoded interdependent frames; recovery must respect codec references.
3. **Choose representation by content.** Sparse UI changes need cheap regional updates and readable text. Sustained motion can justify video encoding. Test the transition cost and visual seams. Apply scrolling/copy optimizations only with correct framebuffer generations at both ends.
4. **Protect input responsiveness.** Keep input dispatch independent of expensive encoding and, where appropriate, bulk transfer. Track queue age and adapt before a slow receiver creates a backlog. A local WebSocket result cannot choose the best WAN transport; test congestion, loss, jitter, proxies, and fallback paths explicitly.
5. **Treat the browser as part of the system.** Bound decode/presentation queues and release frames promptly. WebCodecs exposes codec APIs and resource lifetimes; it does not eliminate the rest of the delivery system. Account for browser CPU and memory rather than moving costs out of the server measurement. [WebCodecs](https://www.w3.org/TR/webcodecs/).
6. **Make the runtime easy to embed.** One guest session, an authenticated viewer, clear health/capability reporting, reliable resize/reconnect/input, and provider adapters are useful product boundaries. Reuse codecs and existing compositor foundations. Start with one-viewer sessions; shared encoding is a separate optimization when multi-viewer demand is demonstrated.

## A concrete decision gate

First profile the existing engines stage by stage on representative target workloads. Include static desktop, typing, browser scrolling, window dragging, full-screen motion, and realistic native applications. Repeat on the intended cloud CPU architecture and on software/GPU paths where relevant. Hold resolution, visible update rate, and acceptable text fidelity constant.

Then build one narrow prototype around the dominant waste. A candidate target is at least a 30% reduction in **streaming-attributable** CPU at the same useful update rate and text fidelity, with no regression in p95 input latency, memory, or bandwidth. That percentage is a proposed go/no-go threshold, not an expected result. Also require near-quiescent static sessions, bounded queues under a slow receiver, and correct recovery after resize/reconnect. If a small change to an existing engine reaches the same result, prefer that change over owning a replacement.

Only expand into a framework after that win survives controlled A/B tests and representative multi-session load. Session orchestration, portability, observability, and a dependable viewer may be the better product even if its codec/capture core remains an established project.

The answer is therefore **yes, solid engineering can produce a better result for a defined workload**. The current evidence supports disciplined profiling and a small competing implementation; it does not support a promise of beating both projects on every metric at once.
