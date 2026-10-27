# Local desktop streaming comparison

Open **http://localhost:8030** for both interactive desktops. Individual viewers are at http://localhost:8031 (Selkies) and http://localhost:8032 (KasmVNC). Use the individual viewers to inspect text at native resolution. The comparison preview scales each desktop.

The current viewers run GNOME 48 on X11 using Dockerfile.gnome; they share the same Debian Trixie ARM64 image and GNOME desktop. The recorded benchmark used Xfce. Both variants use the same fonts, native Tk test application, 1280 × 720 display, 2-CPU quota, 1.5 GiB memory limit, and 512 MiB shared-memory limit. Selkies 2.1.0 uses Xvfb and software x264; KasmVNC 1.5.2 provides its own X server and adaptive browser client. Audio is not benchmarked. This compares these client configurations, not identical codec/quality operating points.

The services bind only to this Mac's loopback interface. The local proxy supplies Kasm's generated password from `.env`; the experiment disables transport encryption and RFB authentication behind that proxy. Do not publish these ports as a production service.

## Measurements

The latest corrected Xfce/GNOME comparison is in `GNOME-COMPARISON.md`. Run `node compare.mjs` for the four default-client configurations, then `KASM_60=1 node compare.mjs` for Kasm's 60-FPS sensitivity checks. Publish with `python3 summarize-comparison.py` followed by `python3 summarize-tuned.py`. This harness reserves the viewer, uses temporary containers, and restores the original GNOME pair afterward. Kasm's fresh browser defaults cap the client at 24 FPS despite the server's 60-FPS setting.

`results/raw.json` retains all input latencies and resource samples. `results/summary.json` supplies the measured table in the HTML page. `RESULTS.md` explains the findings.

- One engine runs at a time, with the other container stopped. One isolated headless Chrome viewer connects at device scale 1.
- Input latency: 30 browser mouse events travel through the real remote input path into the native application. A browser animation-frame callback detects the red/green change in the decoded video/canvas. The native application's final state is also checked. This excludes physical mouse hardware, compositor scanout, and monitor response. Browser-frame sampling introduces quantization.
- Resource tests: 3 repeats × 12 seconds for each workload, after 2 seconds of settling. CPU comes from cgroup CPU-time deltas; 100% means one core. Memory is cgroup current memory minus inactive file cache, sampled once per second. Bandwidth is container `eth0` transmitted-byte deltas, including protocol overhead. The small identical Python sampler is included in container resource use; host browser, proxy, and Docker VM overhead are excluded.
- Idle leaves the desktop unchanged except its clock and input caret. Scroll and motion animate a 1072 × 140 region inside the application. These are modest desktop workloads, not full-screen video.
- Text quality compares a settled decoded frame against a direct X-display PNG at identical screen coordinates. The ROI contains 9–16 pt monochrome text and a colored-text row. PSNR is a pixel-fidelity metric; the separate dark-ink error prevents the large background from hiding text differences. Neither is a human readability score.

The harness fails if it cannot find a 1280 × 720 decoded surface, if any input fails to change the received pixels, if the native final flash state is wrong, or if measurement windows are incomplete. The summary requires all 18 recorded runs and all 60 successful input trials; the final Kasm motion run is excluded from averages because a second viewer connected.

## Run again

The benchmark coordinates and retained results are for Xfce. Restore containers from desktop-stream-bench:local before rerunning; do not run it against the live GNOME sessions. With the Xfce containers and proxy running, close other viewers first:

```sh
node benchmark.mjs
python3 summarize.py
```

The benchmark stops/restarts only `desktop-bench-selkies` and `desktop-bench-kasm`, and leaves both started afterward. `session.sh` preserves stale X-display locks under timestamped names so restarting a stopped container works.

To resume the viewers after stopping them:

```sh
docker start desktop-bench-selkies desktop-bench-kasm
python3 serve.py
```

Run `serve.py` only when the previous proxy process is no longer running. To stop the desktops:

```sh
docker stop desktop-bench-selkies desktop-bench-kasm
```

`Dockerfile`, `fixture.py`, `session.sh`, `serve.py`, and `benchmark.mjs` contain the complete experiment. Unused setup containers were deleted at the user’s request. No host project directories are mounted into these desktops.

GNOME uses software Mesa rendering, a system D-Bus, standalone systemd-logind, and gnome-session’s non-systemd fallback. It does not run GDM or a complete systemd boot. Screen locking and hardware-dependent settings are not provided. The desktop is for local interaction testing; GNOME performance has not been benchmarked.
