# Native desktop streaming lab

First lab: implement a native Linux display-to-browser service and compare it with Selkies 2.1.0 and KasmVNC 1.5.2 on the same local CPU-only sandbox.

Status: measurement preparation. No native implementation or performance claim yet. The ce-optimize implementation approval is pending.

The service will own X11 damage admission, shared-memory capture, frame scheduling, codec lifetime, transport backpressure, and injected input. It will call established codec and transport libraries directly, without starting Selkies, KasmVNC, or an FFmpeg process. Xvfb and Xfce remain platform components.

Initial scope: one 1280×720 Xfce desktop, one browser viewer, software H.264, keyboard/pointer input, reconnect, and bounded frame ownership. GNOME, audio, clipboard, WAN transport, multi-user authentication, hardware encoding, and provider integration are later work. Bind the lab endpoint to loopback.

The baseline uses the same two-core quota and 1536 MiB memory limit as the earlier comparison. Container resource figures include Xfce, the test application, and the streaming implementation. They exclude the host browser, proxy, and Docker VM. Browser-visible frame IDs measure delivered updates, not maximum throughput or physical display latency.

See [measurement contract](bench/README.md). Raw runs are retained under `bench/results/`; interrupted and invalid runs remain evidence, not wins. Implementation experiments begin only after the invoked ce-optimize approval gate.
