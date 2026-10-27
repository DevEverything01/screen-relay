# Initial desktop comparison

**Interim: completed initial desktop benchmark; broad general-engine qualification remains pending.** No universal winner or final completion claim.

[HTML companion](native-stream-report.html)

All 14 initial gates pass across nine fresh sessions and 720 inputs. Native saves resources versus Selkies with delivery and latency tradeoffs. Broad superiority over both engines is not established.

## Method and scope

Own native capture, scheduling, input and transport. No Selkies, KasmVNC or FFmpeg subprocess. Three fresh sessions per engine, same corrected runner and fixture, serial local measurement, median aggregation.

Initial desktop comparison only; broad qualification remains pending. No universal winner or final general-engine verdict.

Small foreground fixture with a 1072×140 active region on a 1280×720 desktop; no held-out workload. Selection and reporting reuse this fixture.

CPU is percent of one core; RAM is container working-set MiB; bandwidth is container transmit Mbps. Browser and Docker VM resources are excluded.

Canvas updates are useful visible delivery, not physical presentation FPS. Input latency starts at browser pointerdown with browser rAF sampling quantization.

Static text floors do not establish equal motion quality, maximum FPS, WAN performance or hardware encoder performance.

Runner SHA256 `9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21`; fixture SHA256 `7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc`. Nine unique valid runs, three per engine, 80 input trials per run, 720 total, zero reported errors. Benchmark image `native-stream-lab:final2@sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f`; standalone release `6d84d748`; core `4b9ea36`.

## All metrics

Medians [min–max]. Delta = native minus Selkies. Positive cost/latency delta is worse.

| Metric | Selkies | Native | Delta / delta % | KasmVNC | Native target |
|---|---:|---:|---:|---:|---|
| errors (count) | 0.0000 [0.0000–0.0000] | 0.0000 [0.0000–0.0000] | +0.0000 / n/a (zero baseline) | 0.0000 [0.0000–0.0000] | diagnostic |
| idle_cpuPercent (% core) | 45.8401 [45.7996–45.9333] | 4.0612 [3.7973–4.2799] | -41.7790 / -91.14% | 3.9263 [3.8499–4.1295] | 5 |
| idle_memoryMiB (MiB) | 219.2002 [216.9839–230.9400] | 154.9417 [152.7169–155.3817] | -64.2586 / -29.32% | 146.0175 [144.5631–154.6076] | diagnostic |
| idle_mbps (Mbps) | 0.2563 [0.2180–0.2947] | 0.0037 [0.0025–0.0037] | -0.2526 / -98.57% | 0.0001 [0.0000–0.0005] | diagnostic |
| idle_throttledMs (ms) | 0.0000 [0.0000–0.0000] | 0.0000 [0.0000–0.0000] | +0.0000 / n/a (zero baseline) | 0.0000 [0.0000–0.0000] | diagnostic |
| scroll_cpuPercent (% core) | 47.7677 [46.5501–48.4431] | 43.0128 [40.4760–44.9036] | -4.7549 / -9.95% | 49.8639 [49.7619–50.0623] | diagnostic |
| scroll_memoryMiB (MiB) | 219.7782 [219.4594–231.3595] | 155.2465 [152.9991–159.6481] | -64.5318 / -29.36% | 146.6353 [145.0368–163.9963] | diagnostic |
| scroll_mbps (Mbps) | 2.7577 [2.7358–2.7851] | 1.9542 [1.9068–2.0566] | -0.8035 / -29.14% | 6.2429 [5.8113–6.2730] | diagnostic |
| scroll_throttledMs (ms) | 0.0000 [0.0000–0.0000] | 0.0000 [0.0000–0.0000] | +0.0000 / n/a (zero baseline) | 0.0000 [0.0000–0.0000] | diagnostic |
| scroll_visibleUpdatesPerSecond (updates/s) | 55.8591 [55.5920–55.9836] | 53.8387 [51.9674–54.9963] | -2.0204 / -3.62% | 51.1126 [47.5954–51.3947] | 45 |
| scroll_producerUpdatesPerSecond (updates/s) | 56.2581 [55.9536–56.7422] | 54.5860 [52.6100–55.4491] | -1.6721 / -2.97% | 55.1682 [51.9632–55.3554] | diagnostic |
| motion_cpuPercent (% core) | 47.7582 [47.0034–49.4661] | 41.3087 [39.1241–43.5515] | -6.4494 / -13.50% | 46.4905 [46.4647–48.4029] | 50 |
| motion_memoryMiB (MiB) | 219.9816 [219.6803–224.8562] | 155.4433 [153.2263–162.8774] | -64.5383 / -29.34% | 146.6449 [144.8542–165.2358] | 225 |
| motion_mbps (Mbps) | 2.0272 [2.0143–2.0912] | 1.2867 [1.2345–1.2979] | -0.7405 / -36.53% | 3.9816 [3.8900–4.0837] | 2.5 |
| motion_throttledMs (ms) | 0.0000 [0.0000–1.3740] | 0.0000 [0.0000–0.0000] | +0.0000 / n/a (zero baseline) | 0.0000 [0.0000–3.4390] | diagnostic |
| motion_visibleUpdatesPerSecond (updates/s) | 54.5388 [54.2161–54.6292] | 52.9071 [50.5436–53.5102] | -1.6318 / -2.99% | 46.8549 [45.5812–49.2843] | 50 |
| motion_producerUpdatesPerSecond (updates/s) | 54.8109 [54.6511–54.9730] | 53.1475 [50.8905–53.8213] | -1.6634 / -3.03% | 51.0257 [49.9014–52.7806] | diagnostic |
| idle_latencyMedianMs (ms) | 25.7000 [25.3000–26.1000] | 24.7000 [23.8000–26.4000] | -1.0000 / -3.89% | 53.7000 [43.3000–55.0000] | diagnostic |
| idle_latencyP95Ms (ms) | 28.3000 [28.2000–40.7000] | 29.4000 [26.4000–39.7000] | +1.1000 / +3.89% | 60.4000 [59.8000–69.6000] | diagnostic |
| motion_latencyMedianMs (ms) | 25.8000 [25.3000–25.9000] | 27.0000 [26.1000–27.1000] | +1.2000 / +4.65% | 44.8000 [44.8000–59.6000] | diagnostic |
| motion_latencyP95Ms (ms) | 40.4000 [38.6000–41.6000] | 43.2000 [41.8000–43.9000] | +2.8000 / +6.93% | 77.0000 [76.8000–77.3000] | 45 |
| psnrDb (dB) | 38.4772 [38.4750–38.4793] | 38.4498 [38.4498–38.4501] | -0.0274 / -0.07% | 38.7759 [38.7757–38.7759] | 37.5 |
| textInkMeanAbsoluteError (MAE) | 3.9989 [3.9983–3.9992] | 4.0970 [4.0970–4.0975] | +0.0981 / +2.45% | 3.7918 [3.7917–3.7922] | 4.5 |

## All 14 gates

Costs, latency and MAE use ≤; delivery and PSNR use ≥. Aggregate medians do not guarantee each run meets regression limits.

| Gate | Limit | Observed | Result |
|---|---|---|---|
| idle_cpuPercent | 5 | 4.06117777598958 | PASS |
| motion_visibleUpdatesPerSecond | 50 | 52.907067441239924 | PASS |
| motion_latencyP95Ms | 45 | 43.19999980926514 | PASS |
| motion_cpuPercent | 50 | 41.30872703834629 | PASS |
| motion_memoryMiB | 225 | 155.44329637096774 | PASS |
| motion_mbps | 2.5 | 1.2866858869269702 | PASS |
| scroll_visibleUpdatesPerSecond | 45 | 53.838656420014345 | PASS |
| textInkMeanAbsoluteError | 4.5 | 4.097022641429807 | PASS |
| psnrDb | 37.5 | 38.44981249076661 | PASS |
| fps_regression | motion delivery ≥95% of Selkies | see comparison table | PASS |
| p95_regression | p95 ≤ Selkies +5 ms | see comparison table | PASS |
| motion_cpuPercent_regression | CPU ≤105% of Selkies | see comparison table | PASS |
| motion_memoryMiB_regression | RAM ≤105% of Selkies | see comparison table | PASS |
| motion_mbps_regression | bandwidth ≤105% of Selkies | see comparison table | PASS |

## Interpretation and experiment ledger

Native saves idle and motion resources versus Selkies, which delivers more motion updates and lower input p95. KasmVNC idle CPU is similar (3.93% versus 4.06%; about a 3.4% difference, within the 5% measurement threshold), while its RAM use is lower and static fidelity is closer; native delivers more motion updates with less latency and bandwidth.

Original baseline v1 mousedown clock is superseded: native pointerdown cancellation suppressed mousedown. All nine confirmation runs use the same corrected pointerdown runner.

All 14 absolute and regression gates pass aggregate medians. Observed ranges are not confidence intervals or guarantees for every run.

Four-variant cap reached: one error, one degenerate, one not selected and one kept. Core loop 04:17–05:35 UTC (~77 minutes); broader qualification remains pending.

SIMD forecast 75–95% conversion reduction was hypothetical. Exploratory active CPU fell ~94%→42.5%, but ink MAE 4.863 failed. CRF10 reduced MAE to 4.097 and raised bandwidth ~0.862→1.308 Mbps.

Precise ppoll pacing forecast timer-bound delivery nearer 60 Hz. Integrated confirmation does not isolate a pacing gain; no causal speedup is claimed.

Native static PSNR 38.45 dB / ink MAE 4.097 passes floors, but Selkies is slightly closer (38.48 / 3.999) and KasmVNC closer again (38.78 / 3.792). Equal motion quality was not measured.

| Variant | Outcome | Evidence |
|---|---|---|
| 1: Initial native engine | Error | Native pointer cancellation prevented the legacy mousedown observer from starting. CPU and text fidelity also missed targets. All engines were later remeasured with the corrected pointerdown clock. |
| 2: SIMD BT.709 conversion | Degenerate | Exploratory CPU fell from about 94% to 42.5% while delivering about 53.6 updates/s. Text ink MAE 4.863 exceeded the 4.5 limit, so this candidate was rejected. Earlier native latency values are invalid because its start clock did not fire. |
| 3: CRF 18 to CRF 10 | Not selected | Exploratory targets passed. Bandwidth rose from 0.862 to 1.308 Mbps while text ink MAE improved from 4.863 to 4.097. The integrated candidate superseded this exploratory result before confirmation. |
| 4: Precise ppoll pacing and resource HUD | Kept | The integrated candidate passed all confirmation gates. These runs do not isolate the effect of pacing. |

## Architecture and checks

Capture: Own C++ XDamage admission and MIT-SHM root capture.

Encode: ARM NEON BT.709 SIMD; persistent in-process libx264 via libavcodec.

Transport and input: libwebsockets bounded queue and ACK credit; XTest input.

Viewer: WebCodecs and canvas draw; reconnect IDR and timeout cleanup.

Release and ASAN+UBSAN browser/X11 suites passed 10/10 each: decoded canvas contains independent X11 fixture pixels; metrics match independent cgroup CPU counters and preserve live video; viewer pointer, keyboard, modifiers and wheel reach X11 application; held controls release on canvas blur with independent X server state; second viewer rejected while first remains live; disconnect releases held controls and reconnect renders fresh desktop; malformed receiver closes and subsequent session recovers; oversized receiver closes and subsequent session recovers; stall receiver closes and subsequent session recovers; non-loopback origin rejected at handshake. ARM64 color reference, chroma, stride, tail and guard tests passed including NEON. Graceful shutdown had no reported sanitizer or leak diagnostic. System libraries uninstrumented; no TSan, fuzzing or long soak. Nine final containers had no OOMKilled flag; wrapper stop has a short forced-stop deadline, daemon SIGTERM checked separately.

## Doom diagnostic (n=1)

Live keyboard-controlled Freedoom, n=1 per configuration: final live-input phase delivered 56.81 drawn fps, 108.41% CPU, 197.09 MiB and 69.95 Mbps over 15.14 seconds. Input latency unmeasured. Default framebuffer: 45.29 fps / 199.49% CPU; software framebuffer: 54.31 fps / 102.81% CPU. Configuration and input differ; these are diagnostics, not controlled engine comparisons. Container includes game and desktop. Full-frame CRF10 traffic approaches 70 Mbps. Stable 60 fps and cross-engine game superiority are not established. Framebuffer setup materially changes game CPU.

## Cost and tooling limits

No paid infrastructure was used. Actual package-download and model-usage costs are unavailable; unavailable cost is not a claim of zero cost. The core optimization phase ran about 77 minutes from 04:17 UTC; the original run began at 04:08 UTC and included baseline work before that phase.

The native engine produces the actual H.264 stream. Playwright only drives the browser and observes the viewer during tests; it is not the streaming engine.

## Evidence

- [confirmed-summary.json](evidence/confirmed-summary.json)
- [final-matrix.json](evidence/final-matrix.json)
- [experiment-log.yaml](evidence/experiment-log.yaml)
- [spec.yaml](evidence/spec.yaml)
- [integration-release.json](evidence/integration-release.json)
- [integration-sanitize2.json](evidence/integration-sanitize2.json)
- [sanitize2.log](evidence/sanitize2.log)
- [2026-10-27T05-13-55-371Z-selkies-da43c484](evidence/2026-10-27T05-13-55-371Z-selkies-da43c484/raw.json)
- [2026-10-27T05-16-15-867Z-native-3d4a76e4](evidence/2026-10-27T05-16-15-867Z-native-3d4a76e4/raw.json)
- [2026-10-27T05-18-35-073Z-kasm-b90b156a](evidence/2026-10-27T05-18-35-073Z-kasm-b90b156a/raw.json)
- [2026-10-27T05-20-55-269Z-kasm-a1d326e6](evidence/2026-10-27T05-20-55-269Z-kasm-a1d326e6/raw.json)
- [2026-10-27T05-23-14-378Z-selkies-230b6b49](evidence/2026-10-27T05-23-14-378Z-selkies-230b6b49/raw.json)
- [2026-10-27T05-25-34-294Z-native-c33f4803](evidence/2026-10-27T05-25-34-294Z-native-c33f4803/raw.json)
- [2026-10-27T05-27-53-133Z-native-c1047892](evidence/2026-10-27T05-27-53-133Z-native-c1047892/raw.json)
- [2026-10-27T05-30-12-303Z-kasm-e05bfef3](evidence/2026-10-27T05-30-12-303Z-kasm-e05bfef3/raw.json)
- [2026-10-27T05-32-33-433Z-selkies-bcf7d04d](evidence/2026-10-27T05-32-33-433Z-selkies-bcf7d04d/raw.json)

Each run directory includes source.png and decoded.png. Game directories include result.json and initial/end PNGs. Historical ledger paths refer to retained local exploratory artifacts; nine confirmation raw files and paired PNGs are portable here.
