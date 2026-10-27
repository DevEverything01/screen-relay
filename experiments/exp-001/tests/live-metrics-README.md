# Live interactive metrics

Run the helper while the user plays in an **already open** visible Chromium viewer. It attaches to that browser through an existing Chrome DevTools Protocol endpoint; it does not open a viewer or send input. The browser must have been started with remote debugging enabled and the exact viewer URL must identify one page.

```sh
CONTAINER=<running-container> CDP_URL=http://127.0.0.1:<debug-port> VIEWER_URL=http://127.0.0.1:<viewer-port>/ SECONDS=60 OUTPUT=/tmp/live-metrics.json node native-stream-lab-exp1/tests/live-metrics.mjs
node native-stream-lab-exp1/tests/live-metrics.mjs --self-check
```

It prints one JSON sample per interval and persists samples and errors to OUTPUT. It reads `nativeStats.drawn` after WebCodecs decode and canvas draw, so `drawnPerSecond` is a decoded-and-drawn rate, not physical display FPS. `receivedPerSecond` counts received encoded frames. Input-to-visible latency is unmeasured: arbitrary game input and ensuing visual changes cannot be reliably paired by this observer. CPU, memory and transmitted bytes cover the whole container, including desktop and game; they exclude browser and host overhead. Resource and viewer reads are approximately concurrent rather than synchronized. A counter reset or missing viewer stats invalidates the remainder and is recorded as an error. Avoid navigating or replacing the viewer during sampling.
