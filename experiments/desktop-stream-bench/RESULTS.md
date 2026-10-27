# Xfce baseline — October 26, 2026

These are the original **Xfce** results, not measurements of the subsequent GNOME experiment. Selkies responded faster locally; KasmVNC used less idle CPU and memory. Settled text fidelity was similar.

| Metric | Selkies 2.1.0 | KasmVNC 1.5.2 |
|---|---:|---:|
| Input → decoded pixel, median / p95 | 24.6 / 35.4 ms | 71.0 / 87.9 ms |
| Idle CPU, one core = 100% | 45.3% | 6.7% |
| Scrolling CPU | 45.8% | 38.2% |
| Motion CPU | 46.8% | 36.7% |
| Idle working-set memory | 219.3 MiB | 145.3 MiB |
| Scrolling working-set memory | 219.5 MiB | 145.6 MiB |
| Motion working-set memory | 219.7 MiB | 145.6 MiB |
| Idle transmitted bandwidth | 0.231 Mbps | 0.131 Mbps |
| Scrolling transmitted bandwidth | 2.615 Mbps | 2.507 Mbps |
| Motion transmitted bandwidth | 1.882 Mbps | 1.764 Mbps |
| Settled text ROI PSNR | 39.2 dB | 39.5 dB |
| Text-ink error, 0–255 | 3.67 | 3.51 |

All 60 input trials changed the native application's state and a pixel in the decoded browser stream. Keyboard typing was visually verified in screenshots. Resource figures average three 12-second runs, except Kasm motion: its last run overlapped an additional viewer and is excluded. The excluded observation is retained and annotated in `results/raw.json`. No measured run reported CPU quota throttling.

## Improvement opportunities

- **Selkies idle work:** its idle CPU was almost as high as its animated-workload CPU. Kasm used about 85% less idle CPU here. Investigate capture cadence, damage tracking, unchanged-frame work, and caret/clock updates; this test does not isolate the responsible component.
- **Kasm input latency:** the local median gap was about 46 ms. Investigate client quality/frame scheduling and encoding/flush queues before rebuilding the server. That is an observed gap, not a promised tuning gain.
- **Session memory:** Kasm saved roughly 74 MiB in this light desktop. Real browser applications and GNOME can change the total substantially.
- **Bandwidth:** Kasm used roughly 4% less for scrolling and 6% less for this small motion region. Neither result predicts full-screen video.
- **Text:** both settled images were close to the source. Inspect the native-resolution screenshots; these numbers do not establish readability while scrolling or lossless color reproduction.

Tune and measure the existing engines before writing a new streaming stack. A replacement needs to improve the measured latency/resource tradeoff enough to justify its maintenance cost.

## Environment and limits

Docker Desktop 29.4.0, native aarch64 Linux 6.12.76-linuxkit; VM: 6 CPUs and 4,109,111,296 bytes RAM. Both measured containers used image `sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712`, 2-CPU quotas, 1.5 GiB memory limits, 512 MiB shared memory, and 1280 × 720 displays.

Selkies logs confirmed software x264, I420, a 60 fps target, and its default 8,000 kbps setting. Kasm used its default adaptive browser client with server H.264 support enabled. Codec and perceptual quality were **not matched**. Host Chrome, proxy, and Docker VM overhead are excluded from container CPU/memory.

Scroll and motion animate only a 1072 × 140 area in a native Tk application. No WAN delay/loss, congestion, GPU, full-screen video, physical input-to-photon timing, long-duration reliability, audio, or clipboard/file-transfer benchmark was performed. See `README.md`, `benchmark.mjs`, and `results/` for methodology, assertions, raw observations, and source/decoded screenshots.
