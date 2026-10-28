# stream-bench

Headless engine benchmark used by the `stream-efficiency` optimization run. It builds the
engine from a source tree inside a 2-CPU, 1.5 GiB container, drives Xvfb with deterministic
workloads (idle, typing at 30 Hz, scrolling at 60 Hz, full-screen motion at 60 Hz), receives the
stream with a client that ACKs every frame at once, decodes it with ffmpeg and prints one JSON
object.

```sh
experiments/stream-bench/run.sh SOURCE_DIR [CPUSET] [PLATFORM]
```

| Key | Meaning |
| --- | --- |
| `active_cpu_pct` | Engine + Xvfb CPU (% of one core) summed over typing, scroll and motion |
| `delivered_fps` | Frames received per second, summed over typing, scroll and motion |
| `engine_peak_rss_mib` | Peak engine resident memory |
| `*_psnr` | Median RGB PSNR of sampled decoded frames against generator references (changed area) |
| `settled_psnr` | Last decoded frame against the final static desktop |
| `stage_*_ms_per_frame` | Engine-reported capture, conversion and encode time per frame |

The client ACKs before decoding, so this measures server cost with an ideal receiver. Browser
cost, real networks and GPU encoders are out of scope.
