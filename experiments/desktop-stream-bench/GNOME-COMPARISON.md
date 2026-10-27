# Xfce vs GNOME streaming comparison — October 26, 2026

**Recommendation: build the runtime on Selkies/pixelflux, with Xfce as the default for CPU-only sandboxes.** In this test it provides the fastest response, the highest received update rate, and lower motion bandwidth. GNOME is available when its desktop experience is needed, at a higher session cost. Selkies' major weakness here is idle CPU; KasmVNC is substantially cheaper when idle and uses less memory.

## Corrected comparison

The first four-configuration run used fresh default browser clients. Inspection then showed KasmVNC's client selected software H.264 and capped both frame-rate controls at 24 FPS, overriding the server's 60-FPS ceiling. Those measurements are valid defaults, **not** evidence of a 24-FPS engine limit. A separate check selected the custom preset, raised the client cap to 60, and asserted that stream mode and image-quality controls stayed unchanged. The settings before/after are retained in its raw results.

| Metric · 60-FPS target | Selkies · Xfce | Selkies · GNOME | KasmVNC · Xfce | KasmVNC · GNOME |
| --- | --- | --- | --- | --- |
| Idle input latency · median | 25.2 ms | 25.5 ms | 54.9 ms | 57.7 ms |
| Idle input latency · p95 | 29.3 ms | 27.5 ms | 76.8 ms | 60.7 ms |
| Idle · CPU | 45.9% | 45.7% | 4.0% | 4.3% |
| Idle · memory | 218.2 MiB | 470.2 MiB | 160.1 MiB | 420.9 MiB |
| Idle · bandwidth | 0.207 Mbps | 0.231 Mbps | 0.000 Mbps | 0.000 Mbps |
| Motion input latency · median | 24.6 ms | 26.7 ms | 44.1 ms | 76.7 ms |
| Motion input latency · p95 | 39.8 ms | 44.0 ms | 77.4 ms | 79.2 ms |
| Motion · CPU | 46.0% | 74.2% | 45.5% | 69.0% |
| Motion · memory | 220.3 MiB | 466.6 MiB | 160.5 MiB | 418.0 MiB |
| Motion · bandwidth | 1.866 Mbps | 1.455 Mbps | 4.001 Mbps | 3.852 Mbps |
| Motion · visible updates/s | 54.5 | 54.7 | 47.0 | 49.8 |
| Motion · app-produced updates/s | 54.7 | 55.6 | 51.5 | 52.8 |
| Text PSNR · higher is closer | 38.5 dB | 37.8 dB | 38.8 dB | 38.1 dB |
| Text ink error · lower is closer | 3.99 | 4.33 | 3.79 | 4.13 |

Selkies resource values average three 12-second windows. The Kasm 60-FPS sensitivity check has one 12-second window each for idle and motion; treat small CPU differences as preliminary. Each latency condition has 30 successful real input trials. FPS observations are separate 12-second tests with a small frame-ID marker. Both codecs are software H.264, but rate-control and quality operating points are not identical. Static text fidelity is similar; this does not establish matched quality during motion.

## What the measurements say

- Raising Kasm's client cap materially improves its received update rate: approximately 24 becomes 47–50. This correction must precede any architectural comparison.
- Selkies still delivers roughly 55 visible updates/s, near this app's production rate, and has lower median/p95 input latency. The fixture does not test the maximum achievable FPS of either engine.
- Under the 60-FPS target, GNOME adds roughly 246 MiB to the Selkies motion session and 258 MiB to Kasm's. Motion CPU increases by about 28 and 24 percentage points of one core, respectively. Those costs include software desktop composition and services, not just streaming.
- Kasm's idle CPU is about 4% of one core, versus about 46% for Selkies. This is the clearest reason to prefer Kasm for mostly idle session density, and the clearest measured optimization target if building on Selkies.
- At the 60-FPS target, Kasm used approximately 4.00/3.85 Mbps for Xfce/GNOME motion, versus Selkies' 1.87/1.46 Mbps. These are traffic rates for this workload, not network-capacity measurements.

The concrete build choice is an embeddable runtime around the existing Selkies/pixelflux capture/encoding core, with effort directed at measured idle work and session overhead. There is no evidence here that writing a new codec or complete remote-desktop protocol is necessary. Pixelflux already supplies native capture/encoding and display backends. [Selkies](https://docs.selkies.io/latest/), [pixelflux](https://pixelflux.selkies.io/pixelflux/index.html).

## Original default-client results

These four configurations each have three resource repeats. Kasm is at its default 24-FPS client cap in this table.

| Metric | Selkies · Xfce | Selkies · GNOME | KasmVNC · Xfce | KasmVNC · GNOME |
| --- | --- | --- | --- | --- |
| Idle input latency · median | 25.2 ms | 25.5 ms | 59.9 ms | 75.5 ms |
| Idle input latency · p95 | 29.3 ms | 27.5 ms | 83.3 ms | 87.9 ms |
| Motion input latency · median | 24.6 ms | 26.7 ms | 73.2 ms | 75.2 ms |
| Motion input latency · p95 | 39.8 ms | 44.0 ms | 76.7 ms | 77.7 ms |
| Idle · CPU | 45.9% | 45.7% | 3.7% | 4.2% |
| Idle · memory | 218.2 MiB | 470.2 MiB | 158.0 MiB | 398.7 MiB |
| Idle · bandwidth | 0.207 Mbps | 0.231 Mbps | 0.000 Mbps | 0.000 Mbps |
| Scroll · CPU | 47.4% | 74.5% | 40.0% | 48.6% |
| Scroll · memory | 219.0 MiB | 466.8 MiB | 158.9 MiB | 394.9 MiB |
| Scroll · bandwidth | 2.601 Mbps | 2.452 Mbps | 2.430 Mbps | 2.323 Mbps |
| Motion · CPU | 46.0% | 74.2% | 38.1% | 49.6% |
| Motion · memory | 220.3 MiB | 466.6 MiB | 158.8 MiB | 395.4 MiB |
| Motion · bandwidth | 1.866 Mbps | 1.455 Mbps | 1.599 Mbps | 1.558 Mbps |
| Scroll · browser-visible updates/s | 55.3 | 55.7 | 24.3 | 24.4 |
| Scroll · app-produced updates/s | 55.8 | 56.9 | 49.7 | 52.7 |
| Motion · browser-visible updates/s | 54.5 | 54.7 | 24.3 | 24.4 |
| Motion · app-produced updates/s | 54.7 | 55.6 | 48.1 | 49.1 |
| Text PSNR · higher is closer | 38.5 dB | 37.8 dB | 38.8 dB | 38.1 dB |
| Text ink error · lower is closer | 3.99 | 4.33 | 3.82 | 4.13 |


## Method and practical limits

- Native ARM64 Docker Desktop on this Mac; one test container and one isolated Chrome viewer at a time. The live GNOME containers were stopped and normal viewers received a temporary reservation page. Only the original two live containers remain afterward.
- Every session has 2 CPUs, a 1.5-GiB memory limit, 512-MiB shared memory, and a 1280 × 720 display. Software rendering and encoding; Xfce compositing is disabled, while GNOME runs its normal software compositor. This is not a GPU-accelerated GNOME comparison.
- Same instrumented Tk fixture for every new run. Its source geometry is read from the native application, so GNOME/Xfce window decorations do not shift the quality ROI or input probe.
- Input crosses the actual browser/server/native-app path. The test checks both received red/green pixels and the native toggle count. Latency begins at the browser mouse event and ends when the decoded pixel changes; physical mouse/display latency is excluded.
- CPU uses cgroup time deltas; 100% means one core. Memory subtracts inactive file cache. Bandwidth uses container transmitted bytes. Host browser, proxy, and Docker-VM overhead are excluded. A small identical sampler is included in container measurements.
- Motion/scrolling affect a 1072 × 140 area. Separate FPS tests embed a monotonically advancing 12-bit marker in the actual native pixels. Browser animation-frame sampling counts distinct received IDs; all marker sequences were checked for invalid/backward transitions. This does not count encoder output directly, and the app's production rate limits the result.
- Text compares a settled decoded frame with a direct display PNG at the same coordinates. The text ROI and raw source/decoded images are retained. PSNR and text-ink error are pixel-fidelity checks, not human readability scores.
- One GNOME/Selkies resource window recorded 41.4 ms of cgroup CPU throttling; the others in the default comparison recorded none. Short windows and host scheduling limit precision.
- No WAN congestion/loss/jitter, full-screen video, GPU path, sustained multi-session capacity, audio, or end-to-end client resource benchmark was performed. A local result cannot support a universal claim of superiority.

## Reproduction and evidence

`compare.mjs` runs the four default configurations; `KASM_60=1 node compare.mjs` runs the two 60-FPS Kasm sensitivity checks. It preserves the live containers, removes temporary containers, and restores the viewer in its finalizer. `summarize-comparison.py` and `summarize-tuned.py` validate and publish the results.

Raw files: `results/desktop-comparison/raw.json` and `results/kasm-60-check/raw.json`. The former also has analyzed frame-gap data, screenshots, and server logs. The latter records the exact Kasm control values before and after changing the cap. Image IDs, browser user agent, and fixture SHA-256 are recorded in the raw runs. Earlier results in `results/raw.json` and `RESULTS.md` remain as historical observations.
