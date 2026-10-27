# Streaming benchmark

Run from any directory after the controlling process reserves the host and stops the live sessions:

```sh
ENGINE=selkies node native-stream-lab/bench/run.mjs
ENGINE=kasm node native-stream-lab/bench/run.mjs
node native-stream-lab/bench/run.mjs --self-check
```

Each invocation starts one fresh container using `desktop-stream-bench:local`, the original `.env`, and loopback port 18093; it stops and retains the unique container. Run three independent invocations per engine. The final stdout line is a flat JSON object; `valid: false` means it must not be scored. Raw observations, errors and static source/decoded images are in `bench/results/<id>/raw.json` and its directory. The Kasm browser receives the existing bench credentials and its FPS cap is set to 60. Native integration can set `ENGINE=native BENCH_IMAGE=<image> BENCH_COMMAND=<entrypoint-argument>` but must provide the same fixture, display, status files, viewer, and container layout.

Measurements are 30-second idle, scroll and motion cgroup/network windows, with frame-marker sampling during scroll and motion, plus 40 idle and 40 motion input attempts. Latency is browser-event to decoded pixel, not physical input/display latency. CPU, memory and transmitted bytes include the container desktop and fixture and exclude browser, proxy, and host overhead. Static text fidelity is reported, not motion quality; matching FPS caps does not match delivered FPS or quality. The fixture and browser sampling cap observed updates, so this is not a maximum-FPS test. Overload/recovery, held-out workloads, WAN, GPU, and client resource measurements are deferred.
