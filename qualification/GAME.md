# Live Freedoom qualification

This runner exercises the same live Freedoom episode 1, map 1 at skill 3 with real browser ArrowRight and Control input for native, Selkies 2.1.0 and KasmVNC 1.5.2. It does not play a recording. Each fresh session uses 1280×720, the same software SDL presentation fallback (`SDL_FRAMEBUFFER_ACCELERATION=0`), a configured 60 FPS cap, no mouse, 2 CPUs, 1536 MiB memory with no extra swap, and 512 MiB shared memory.

Build only when the serial Docker scheduler authorizes it, from the workspace root:

```sh
rtk docker build -f native-stream-lab/qualification/Dockerfile.games -t native-stream-lab:games native-stream-lab
rtk node native-stream-lab/qualification/game.mjs --self-check
rtk node native-stream-lab/qualification/game.mjs native
rtk node native-stream-lab/qualification/game.mjs selkies
rtk node native-stream-lab/qualification/game.mjs kasm
```

Run engines sequentially with other benchmark sessions stopped by the coordinating operator. The runner never stops unrelated containers. It retains its own stopped container for inspection; it does not delete containers. The build extends `native-stream-lab:final2`, preserving its native core and pinned competitor binaries. It requires the original `desktop-stream-bench/.env` with BENCH_PASSWORD and the installed benchmark Playwright dependency. Chrome uses the original headless local executable (or CHROME_PATH), a 1280×720 viewport and device scale 1. Kasm uses HTTP Basic authentication as bench. Kasm's original 60 FPS comparison settings are applied once: video quality 10 and image frame rate 60; streaming frame rate must already be 60. Other quality fields are captured and asserted unchanged. Session entrypoints and native code are unchanged.

After settling, measurements cover 20 seconds stationary and 20 seconds holding turn right plus fire. The same browser-pixel observer downsizes the streaming surface to 160×90 and hashes RGB pixels at requestAnimationFrame for every engine. Raw hash samples, timestamps, nonblack fractions, resource-counter endpoints, image identity, before/after screenshots with SHA-256, browser errors, source/runner hashes, independent X11 held-key state and container logs are saved under `qualification/results/game-ENGINE-TIMESTAMP`. Held keys are released in finally, including failure paths.

Useful visual changes per second count changes in sampled pixels, not decoded frames or producer FPS. Compression noise may increase this count; identical or short-lived frames may be missed. Actual producer rate is unknown: the configured cap is not a measurement. CPU includes the live game, desktop and streaming stack. Memory is cgroup working set at phase end, and bandwidth is container eth0 transmit bytes. There is no gaming latency or physical display claim. The initial map and settings match, but live AI, timing and random events mean successive sessions are not frame-identical. Independent repeats are required before a broad performance conclusion.

The offline self-check protects resource arithmetic and rejects reversed counters. The live checks require a game process, a nonblack surface, advancing pixels under input, changed before/after game hashes and independent XQueryKeymap proof that right/control reached X11 and remain held across the live phase. Browser errors are recorded separately for triage; native/video decoder failures are rejected. This goes beyond the native-only diagnostic by applying one observable metric to all three engines. No engine-specific statistics are compared. No live measurements are implied by passing the offline check.
