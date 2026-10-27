# Native desktop engine: modular baseline and comparison evidence

Selected evidence: 49 runs; 3 excluded run/workload observations. Final image: native-stream-lab:baseline / sha256:75ba2cb566ef9b63dcf1dd9e270eeb86f44c81e891e6efd9cd9bb6e92368378c. Source commit: bf54721bb2d4778c77530dd25e50cdfb32aabeec.

This report describes the explicit manifest selection. It does not infer a universal winner or equal motion quality.

[Initial nine-session desktop benchmark](native-stream-report.md) is separate context; its measurements are not pooled here.

## Findings

The baseline has implemented capture and input interfaces, X11/Xfce backends, a browser H.264 viewer, bounded transport flow, a typed Node SDK and CLI. It is a local experimental framework, not feature parity with the comparison products.

The runnable baseline starts plain XFCE without the benchmark application. The comparison image bundled the fixture; both images contain an identical native executable and installed package database. Existing benchmark callers explicitly inject the same fixture, and that startup branch is verified separately. Real-application comparisons include the same inactive benchmark application in the background for all engines; do not treat them as measurements of a clean default desktop.

Real Thunar scroll medians (native / Selkies / KasmVNC): CPU 13.4% / 48.5% / 12.1%, RAM 166.0 MiB / 238.4 MiB / 179.8 MiB, container transmit 1.02 Mbps / 1.35 Mbps / 0.96 Mbps. Native has lower RAM in this workload; CPU, bandwidth and settled quality must be compared separately. Scroll pixel-change frequency is an activity diagnostic, not a smoothness ranking.

Real Freedoom turn/fire medians (native / Selkies / KasmVNC): CPU 100.9% / 72.8% / 103.7%, RAM 200.0 MiB / 267.1 MiB / 204.6 MiB, container transmit 38.55 Mbps / 5.85 Mbps / 83.02 Mbps. Selkies uses less CPU and bandwidth than native here; native transmits substantially less than KasmVNC. Motion fidelity is unmeasured in this application, so these are operating points rather than equal-quality efficiency rankings.

The limited-bandwidth synthetic video case remains a weakness: native median frozen PSNR 14.22 dB versus Selkies 34.62 dB, sparse matched-motion median PSNR 18.64 versus 21.58 dB, and input p95 210.1 versus 109.7 ms. Native has three sessions; Selkies has one. Only 11–12 native motion pairs and 24 Selkies pairs matched, so inspect coverage counters and raw evidence. These are not quality-matched comparisons; preserving delivered update rate has not solved fidelity or tail latency.

Real Thunar and Freedoom sessions are reported separately from custom synthetic diagnostics. Each real-application engine has three fresh sessions. The Thunar data are identical real files with checked hashes; actual X11 content and decoded correspondence validate navigation and scrolling. Game checks independently observe held/released native keys and live pixels; they do not establish equal gaming fidelity or input latency.

Three general-engine variants were measured. Variant 1 introduced bounded pipelining and adaptive VBV; variant 2 repaired cap-relative recovery; variant 3 corrected two congestion masks caused by queue-inflated RTT and an excessive queued-byte guard. The final core is frozen at 143d4ee. No workload names appear in engine policy. Additional time after the original two-hour optimization window is validation requested by the user, not unbounded variant tuning.

The final original-fixture median is 50.36 visible updates/s against 50.78 producer updates/s; input p95 43.4 ms, CPU 40.2% of one core, RAM 146.4 MiB, container TX 1.27 Mbps. Quiescent idle CPU is 3.26%. The 60 FPS configuration is not proof of sustained 60 FPS.

The broader synthetic fixture targets 30 Hz and usually produces 27–29 updates/s. Its idle case includes marker damage and is not quiescent idle. Local references have n=1; the final candidate has n=3. The earlier original three-engine sessions are historical and not pooled with broad or real-application workloads.

Lower resource usage must be read with fidelity and latency. No universal winner, equal-quality result, held-out workload claim, WAN claim or Rust-versus-C++ performance claim follows from these measurements.

## bandwidth / scroll

| Metric | Native final · candidate · native | Selkies 2.1.0 · reference · selkies |
| --- | --- | --- |
| CPU (% one core) | 40.504 [40.325–41.953], n=3 | 67.856 [67.856–67.856], n=1 |
| RAM (MiB) | 284.638 [282.743–294.861], n=3 | 357.933 [357.933–357.933], n=1 |
| Container transmit (Mbps) | 5.368 [5.218–5.776], n=3 | 6.734 [6.734–6.734], n=1 |
| Visible updates/s | 26.173 [26.020–26.542], n=3 | 28.182 [28.182–28.182], n=1 |
| Producer updates/s | 27.584 [26.803–27.795], n=3 | 28.775 [28.775–28.775], n=1 |
| Observed visual changes/s | unmeasured | unmeasured |
| Frozen PSNR (dB) | 30.337 [29.312–30.676], n=3 | 33.301 [33.301–33.301], n=1 |
| Frozen MAE | 2.942 [2.706–3.229], n=3 | 1.441 [1.441–1.441], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured |
| Input median (ms) | 88.400 [87.450–91.950], n=3 | 92.100 [92.100–92.100], n=1 |
| Input p95 (ms) | 108.100 [96.700–109.100], n=3 | 111.000 [111.000–111.000], n=1 |
| Input trials | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 |

## bandwidth / video

| Metric | Native final · candidate · native | Selkies 2.1.0 · reference · selkies |
| --- | --- | --- |
| CPU (% one core) | 52.038 [49.732–55.337], n=3 | 76.278 [76.278–76.278], n=1 |
| RAM (MiB) | 290.385 [289.502–297.070], n=3 | 364.801 [364.801–364.801], n=1 |
| Container transmit (Mbps) | 6.027 [4.771–6.585], n=3 | 5.191 [5.191–5.191], n=1 |
| Visible updates/s | 27.207 [26.033–27.519], n=3 | 28.598 [28.598–28.598], n=1 |
| Producer updates/s | 27.326 [26.033–27.627], n=3 | 28.991 [28.991–28.991], n=1 |
| Observed visual changes/s | unmeasured | unmeasured |
| Frozen PSNR (dB) | 14.220 [12.668–18.833], n=3 | 34.619 [34.619–34.619], n=1 |
| Frozen MAE | 36.682 [19.820–45.456], n=3 | 2.205 [2.205–2.205], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured |
| Motion median PSNR (dB) | 18.641 [14.477–20.609], n=3 | 21.580 [21.580–21.580], n=1 |
| Motion worst-decile PSNR (dB) | 17.895 [13.308–19.892], n=3 | 21.428 [21.428–21.428], n=1 |
| Motion median MAE | 20.251 [15.224–35.335], n=3 | 13.595 [13.595–13.595], n=1 |
| Motion pairs | 11.000 [11.000–12.000], n=3 | 24.000 [24.000–24.000], n=1 |
| Motion source samples | 77.000 [75.000–77.000], n=3 | 72.000 [72.000–72.000], n=1 |
| Motion decoded samples | 139.000 [139.000–140.000], n=3 | 133.000 [133.000–133.000], n=1 |
| Input median (ms) | 78.800 [76.900–93.950], n=3 | 94.350 [94.350–94.350], n=1 |
| Input p95 (ms) | 210.100 [207.100–210.700], n=3 | 109.700 [109.700–109.700], n=1 |
| Input trials | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 |

## delay / scroll

| Metric | Native final · candidate · native | Native baseline · reference · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 47.176 [44.730–47.371], n=3 | 33.541 [33.541–33.541], n=1 | 66.486 [66.486–66.486], n=1 | 46.583 [46.583–46.583], n=1 |
| RAM (MiB) | 287.373 [286.013–289.198], n=3 | 296.864 [296.864–296.864], n=1 | 357.799 [357.799–357.799], n=1 | 293.671 [293.671–293.671], n=1 |
| Container transmit (Mbps) | 16.293 [16.083–16.637], n=3 | 10.728 [10.728–10.728], n=1 | 6.740 [6.740–6.740], n=1 | 29.507 [29.507–29.507], n=1 |
| Visible updates/s | 28.537 [27.997–28.864], n=3 | 14.578 [14.578–14.578], n=1 | 28.807 [28.807–28.807], n=1 | 25.006 [25.006–25.006], n=1 |
| Producer updates/s | 28.609 [27.993–28.876], n=3 | 26.823 [26.823–26.823], n=1 | 28.810 [28.810–28.810], n=1 | 26.169 [26.169–26.169], n=1 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | 32.831 [32.787–32.950], n=3 | 33.121 [33.121–33.121], n=1 | 33.305 [33.305–33.305], n=1 | 33.346 [33.346–33.346], n=1 |
| Frozen MAE | 1.794 [1.740–1.816], n=3 | 1.635 [1.635–1.635], n=1 | 1.441 [1.441–1.441], n=1 | 1.728 [1.728–1.728], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 77.150 [77.100–78.350], n=3 | 92.600 [92.600–92.600], n=1 | 88.300 [88.300–88.300], n=1 | 126.950 [126.950–126.950], n=1 |
| Input p95 (ms) | 94.800 [93.200–94.900], n=3 | 116.000 [116.000–116.000], n=1 | 94.600 [94.600–94.600], n=1 | 142.900 [142.900–142.900], n=1 |
| Input trials | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 |

## local / idle

| Metric | Native baseline · reference · native | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 26.799 [26.799–26.799], n=1 | 28.937 [28.912–29.613], n=3 | 52.417 [52.417–52.417], n=1 | 37.802 [37.802–37.802], n=1 |
| RAM (MiB) | 283.770 [283.770–283.770], n=1 | 273.575 [273.432–276.343], n=3 | 346.350 [346.350–346.350], n=1 | 274.899 [274.899–274.899], n=1 |
| Container transmit (Mbps) | 0.141 [0.141–0.141], n=1 | 0.148 [0.148–0.153], n=3 | 0.233 [0.233–0.233], n=1 | 1.106 [1.106–1.106], n=1 |
| Visible updates/s | 26.797 [26.797–26.797], n=1 | 26.860 [26.759–27.036], n=3 | 28.794 [28.794–28.794], n=1 | 26.845 [26.845–26.845], n=1 |
| Producer updates/s | 26.783 [26.783–26.783], n=1 | 26.849 [26.769–27.036], n=3 | 28.882 [28.882–28.882], n=1 | 26.977 [26.977–26.977], n=1 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | 42.933 [42.933–42.933], n=1 | 42.920 [42.917–42.920], n=3 | 42.912 [42.912–42.912], n=1 | 41.150 [41.150–41.150], n=1 |
| Frozen MAE | 0.442 [0.442–0.442], n=1 | 0.448 [0.448–0.448], n=3 | 0.446 [0.446–0.446], n=1 | 0.834 [0.834–0.834], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 27.200 [27.200–27.200], n=1 | 26.800 [26.800–27.100], n=3 | 26.150 [26.150–26.150], n=1 | 43.100 [43.100–43.100], n=1 |
| Input p95 (ms) | 43.200 [43.200–43.200], n=1 | 44.200 [43.700–51.000], n=3 | 40.600 [40.600–40.600], n=1 | 75.800 [75.800–75.800], n=1 |
| Input trials | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 |

## local / mixed

| Metric | Native baseline · reference · native | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 27.863 [27.863–27.863], n=1 | 29.546 [29.133–30.105], n=3 | 54.665 [54.665–54.665], n=1 | 37.958 [37.958–37.958], n=1 |
| RAM (MiB) | 300.602 [300.602–300.602], n=1 | 288.837 [282.834–291.632], n=3 | 362.804 [362.804–362.804], n=1 | 289.096 [289.096–289.096], n=1 |
| Container transmit (Mbps) | 0.518 [0.518–0.518], n=1 | 0.525 [0.498–0.527], n=3 | 1.243 [1.243–1.243], n=1 | 1.645 [1.645–1.645], n=1 |
| Visible updates/s | 26.837 [26.837–26.837], n=1 | 27.021 [25.434–27.080], n=3 | 28.614 [28.614–28.614], n=1 | 27.064 [27.064–27.064], n=1 |
| Producer updates/s | 26.847 [26.847–26.847], n=1 | 27.011 [25.412–27.087], n=3 | 28.715 [28.715–28.715], n=1 | 27.040 [27.040–27.040], n=1 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | 38.935 [38.935–38.935], n=1 | 38.919 [38.919–38.921], n=3 | 38.898 [38.898–38.898], n=1 | 37.199 [37.199–37.199], n=1 |
| Frozen MAE | 0.624 [0.624–0.624], n=1 | 0.634 [0.633–0.634], n=3 | 0.629 [0.629–0.629], n=1 | 1.213 [1.213–1.213], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 26.650 [26.650–26.650], n=1 | 26.650 [26.550–27.150], n=3 | 26.450 [26.450–26.450], n=1 | 42.950 [42.950–42.950], n=1 |
| Input p95 (ms) | 43.100 [43.100–43.100], n=1 | 43.100 [42.800–43.600], n=3 | 42.800 [42.800–42.800], n=1 | 75.900 [75.900–75.900], n=1 |
| Input trials | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 |

## local / scroll

| Metric | Native baseline · reference · native | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 44.206 [44.206–44.206], n=1 | 43.999 [40.876–44.464], n=3 | 70.066 [70.066–70.066], n=1 | 48.677 [48.677–48.677], n=1 |
| RAM (MiB) | 294.614 [294.614–294.614], n=1 | 282.196 [281.332–284.968], n=3 | 358.361 [358.361–358.361], n=1 | 286.817 [286.817–286.817], n=1 |
| Container transmit (Mbps) | 26.134 [26.134–26.134], n=1 | 15.064 [14.547–15.510], n=3 | 6.664 [6.664–6.664], n=1 | 31.010 [31.010–31.010], n=1 |
| Visible updates/s | 27.050 [27.050–27.050], n=1 | 27.311 [27.060–27.421], n=3 | 28.872 [28.872–28.872], n=1 | 26.383 [26.383–26.383], n=1 |
| Producer updates/s | 27.091 [27.091–27.091], n=1 | 27.350 [27.130–27.445], n=3 | 28.846 [28.846–28.846], n=1 | 27.474 [27.474–27.474], n=1 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | 33.168 [33.168–33.168], n=1 | 32.363 [32.350–33.046], n=3 | 33.306 [33.306–33.306], n=1 | 33.267 [33.267–33.267], n=1 |
| Frozen MAE | 1.579 [1.579–1.579], n=1 | 1.937 [1.705–1.951], n=3 | 1.440 [1.440–1.440], n=1 | 1.744 [1.744–1.744], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 27.300 [27.300–27.300], n=1 | 27.050 [26.900–39.750], n=3 | 26.300 [26.300–26.300], n=1 | 72.300 [72.300–72.300], n=1 |
| Input p95 (ms) | 44.000 [44.000–44.000], n=1 | 43.200 [43.000–44.100], n=3 | 55.600 [55.600–55.600], n=1 | 89.300 [89.300–89.300], n=1 |
| Input trials | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 |

## local / video

| Metric | Native baseline · reference · native | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 70.514 [70.514–70.514], n=1 | 60.463 [58.555–61.529], n=3 | 78.006 [78.006–78.006], n=1 | 69.841 [69.841–69.841], n=1 |
| RAM (MiB) | 300.703 [300.703–300.703], n=1 | 290.471 [288.947–291.673], n=3 | 362.628 [362.628–362.628], n=1 | 289.009 [289.009–289.009], n=1 |
| Container transmit (Mbps) | 45.445 [45.445–45.445], n=1 | 18.597 [18.509–18.853], n=3 | 5.127 [5.127–5.127], n=1 | 55.759 [55.759–55.759], n=1 |
| Visible updates/s | 27.695 [27.695–27.695], n=1 | 27.433 [27.318–27.786], n=3 | 29.085 [29.085–29.085], n=1 | 23.618 [23.618–23.618], n=1 |
| Producer updates/s | 27.782 [27.782–27.782], n=1 | 27.453 [27.301–27.807], n=3 | 29.110 [29.110–29.110], n=1 | 27.714 [27.714–27.714], n=1 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | 34.034 [34.034–34.034], n=1 | 31.773 [31.683–31.864], n=3 | 34.621 [34.621–34.621], n=1 | 28.525 [28.525–28.525], n=1 |
| Frozen MAE | 2.765 [2.765–2.765], n=1 | 4.167 [4.117–4.240], n=3 | 2.198 [2.198–2.198], n=1 | 6.848 [6.848–6.848], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | 33.563 [33.563–33.563], n=1 | 30.415 [30.255–30.416], n=3 | 22.218 [22.218–22.218], n=1 | 28.459 [28.459–28.459], n=1 |
| Motion worst-decile PSNR (dB) | 33.521 [33.521–33.521], n=1 | 30.163 [30.034–30.201], n=3 | 22.123 [22.123–22.123], n=1 | 28.408 [28.408–28.408], n=1 |
| Motion median MAE | 3.040 [3.040–3.040], n=1 | 4.969 [4.961–5.057], n=3 | 12.571 [12.571–12.571], n=1 | 6.934 [6.934–6.934], n=1 |
| Motion pairs | 21.000 [21.000–21.000], n=1 | 25.000 [22.000–28.000], n=3 | 23.000 [23.000–23.000], n=1 | 19.000 [19.000–19.000], n=1 |
| Motion source samples | 64.000 [64.000–64.000], n=1 | 66.000 [62.000–68.000], n=3 | 70.000 [70.000–70.000], n=1 | 60.000 [60.000–60.000], n=1 |
| Motion decoded samples | 128.000 [128.000–128.000], n=1 | 129.000 [127.000–133.000], n=3 | 137.000 [137.000–137.000], n=1 | 135.000 [135.000–135.000], n=1 |
| Input median (ms) | 41.150 [41.150–41.150], n=1 | 42.400 [40.800–42.450], n=3 | 26.650 [26.650–26.650], n=1 | 75.550 [75.550–75.550], n=1 |
| Input p95 (ms) | 46.000 [46.000–46.000], n=1 | 44.900 [43.900–51.200], n=3 | 43.500 [43.500–43.500], n=1 | 90.300 [90.300–90.300], n=1 |
| Input trials | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 |

## local / window

| Metric | Native baseline · reference · native | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 37.479 [37.479–37.479], n=1 | 41.059 [40.117–41.271], n=3 | 52.562 [52.562–52.562], n=1 | 40.763 [40.763–40.763], n=1 |
| RAM (MiB) | 283.603 [283.603–283.603], n=1 | 274.636 [271.855–277.280], n=3 | 345.478 [345.478–345.478], n=1 | 276.006 [276.006–276.006], n=1 |
| Container transmit (Mbps) | 1.061 [1.061–1.061], n=1 | 1.111 [1.098–1.122], n=3 | 1.711 [1.711–1.711], n=1 | 2.186 [2.186–2.186], n=1 |
| Visible updates/s | 28.054 [28.054–28.054], n=1 | 27.997 [27.971–28.139], n=3 | 28.881 [28.881–28.881], n=1 | 26.915 [26.915–26.915], n=1 |
| Producer updates/s | 28.020 [28.020–28.020], n=1 | 28.004 [27.974–28.151], n=3 | 28.945 [28.945–28.945], n=1 | 26.968 [26.968–26.968], n=1 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | 42.550 [42.550–42.550], n=1 | 42.483 [42.431–42.566], n=3 | 42.425 [42.425–42.425], n=1 | 40.795 [40.795–40.795], n=1 |
| Frozen MAE | 0.491 [0.491–0.491], n=1 | 0.504 [0.493–0.510], n=3 | 0.498 [0.498–0.498], n=1 | 0.916 [0.916–0.916], n=1 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 27.250 [27.250–27.250], n=1 | 27.400 [27.150–27.500], n=3 | 26.650 [26.650–26.650], n=1 | 75.350 [75.350–75.350], n=1 |
| Input p95 (ms) | 31.900 [31.900–31.900], n=1 | 43.300 [32.300–43.800], n=3 | 42.400 [42.400–42.400], n=1 | 90.600 [90.600–90.600], n=1 |
| Input trials | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=3 | 20.000 [20.000–20.000], n=1 | 20.000 [20.000–20.000], n=1 |

## original fixture / idle

| Metric | Native final · candidate · native | Selkies 2.1.0 (earlier) · historical · selkies | Native baseline · historical · native | KasmVNC 1.5.2 (earlier) · historical · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 3.260 [3.230–3.477], n=3 | 45.840 [45.800–45.933], n=3 | 4.061 [3.797–4.280], n=3 | 3.926 [3.850–4.129], n=3 |
| RAM (MiB) | 145.374 [145.340–145.609], n=3 | 219.200 [216.984–230.940], n=3 | 154.942 [152.717–155.382], n=3 | 146.018 [144.563–154.608], n=3 |
| Container transmit (Mbps) | 0.006 [0.005–0.006], n=3 | 0.256 [0.218–0.295], n=3 | 0.004 [0.002–0.004], n=3 | 0.000 [0.000–0.001], n=3 |
| Visible updates/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Producer updates/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text PSNR (dB) | 38.478 [38.474–38.478], n=3 | 38.477 [38.475–38.479], n=3 | 38.450 [38.450–38.450], n=3 | 38.776 [38.776–38.776], n=3 |
| Original static-text ink MAE | 4.063 [4.061–4.068], n=3 | 3.999 [3.998–3.999], n=3 | 4.097 [4.097–4.097], n=3 | 3.792 [3.792–3.792], n=3 |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 24.900 [23.950–25.300], n=3 | 25.700 [25.250–26.100], n=3 | 24.650 [23.800–26.400], n=3 | 53.400 [43.250–54.800], n=3 |
| Input p95 (ms) | 27.600 [27.100–39.500], n=3 | 28.300 [28.200–40.700], n=3 | 29.400 [26.400–39.700], n=3 | 60.400 [59.800–69.600], n=3 |
| Input trials | 40.000 [40.000–40.000], n=3 | 40.000 [40.000–40.000], n=3 | 40.000 [40.000–40.000], n=3 | 40.000 [40.000–40.000], n=3 |

## original fixture / motion

| Metric | Native final · candidate · native | Selkies 2.1.0 (earlier) · historical · selkies | Native baseline · historical · native | KasmVNC 1.5.2 (earlier) · historical · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 40.176 [39.843–40.361], n=3 | 47.758 [47.003–49.466], n=3 | 41.309 [39.124–43.552], n=3 | 46.491 [46.465–48.403], n=3 |
| RAM (MiB) | 146.405 [146.003–151.087], n=3 | 219.982 [219.680–224.856], n=3 | 155.443 [153.226–162.877], n=3 | 146.645 [144.854–165.236], n=3 |
| Container transmit (Mbps) | 1.270 [1.265–1.277], n=3 | 2.027 [2.014–2.091], n=3 | 1.287 [1.235–1.298], n=3 | 3.982 [3.890–4.084], n=3 |
| Visible updates/s | 50.358 [50.291–50.572], n=3 | 54.539 [54.216–54.629], n=3 | 52.907 [50.544–53.510], n=3 | 46.855 [45.581–49.284], n=3 |
| Producer updates/s | 50.780 [50.612–51.059], n=3 | 54.811 [54.651–54.973], n=3 | 53.148 [50.891–53.821], n=3 | 51.026 [49.901–52.781], n=3 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text PSNR (dB) | 38.478 [38.474–38.478], n=3 | 38.477 [38.475–38.479], n=3 | 38.450 [38.450–38.450], n=3 | 38.776 [38.776–38.776], n=3 |
| Original static-text ink MAE | 4.063 [4.061–4.068], n=3 | 3.999 [3.998–3.999], n=3 | 4.097 [4.097–4.097], n=3 | 3.792 [3.792–3.792], n=3 |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | 27.100 [26.900–27.200], n=3 | 25.800 [25.300–25.850], n=3 | 26.900 [26.050–27.050], n=3 | 44.800 [44.550–58.100], n=3 |
| Input p95 (ms) | 43.400 [43.000–43.600], n=3 | 40.400 [38.600–41.600], n=3 | 43.200 [41.800–43.900], n=3 | 77.000 [76.800–77.300], n=3 |
| Input trials | 40.000 [40.000–40.000], n=3 | 40.000 [40.000–40.000], n=3 | 40.000 [40.000–40.000], n=3 | 40.000 [40.000–40.000], n=3 |

## original fixture / scroll

| Metric | Native final · candidate · native | Selkies 2.1.0 (earlier) · historical · selkies | Native baseline · historical · native | KasmVNC 1.5.2 (earlier) · historical · kasm |
| --- | --- | --- | --- | --- |
| CPU (% one core) | 42.333 [42.295–43.971], n=3 | 47.768 [46.550–48.443], n=3 | 43.013 [40.476–44.904], n=3 | 49.864 [49.762–50.062], n=3 |
| RAM (MiB) | 145.999 [145.775–147.147], n=3 | 219.778 [219.459–231.360], n=3 | 155.246 [152.999–159.648], n=3 | 146.635 [145.037–163.996], n=3 |
| Container transmit (Mbps) | 1.968 [1.966–1.975], n=3 | 2.758 [2.736–2.785], n=3 | 1.954 [1.907–2.057], n=3 | 6.243 [5.811–6.273], n=3 |
| Visible updates/s | 52.163 [51.721–52.253], n=3 | 55.859 [55.592–55.984], n=3 | 53.839 [51.967–54.996], n=3 | 51.113 [47.595–51.395], n=3 |
| Producer updates/s | 52.585 [52.388–52.680], n=3 | 56.258 [55.954–56.742], n=3 | 54.586 [52.610–55.449], n=3 | 55.168 [51.963–55.355], n=3 |
| Observed visual changes/s | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Frozen MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Original static-text PSNR (dB) | 38.478 [38.474–38.478], n=3 | 38.477 [38.475–38.479], n=3 | 38.450 [38.450–38.450], n=3 | 38.776 [38.776–38.776], n=3 |
| Original static-text ink MAE | 4.063 [4.061–4.068], n=3 | 3.999 [3.998–3.999], n=3 | 4.097 [4.097–4.097], n=3 | 3.792 [3.792–3.792], n=3 |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured | unmeasured |
| Input median (ms) | unmeasured | unmeasured | unmeasured | unmeasured |
| Input p95 (ms) | unmeasured | unmeasured | unmeasured | unmeasured |
| Input trials | unmeasured | unmeasured | unmeasured | unmeasured |

## real desktop / desktop

| Metric | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- |
| CPU (% one core) | 13.428 [13.080–13.573], n=3 | 48.505 [47.966–49.264], n=3 | 12.125 [12.094–12.554], n=3 |
| RAM (MiB) | 165.988 [164.695–177.621], n=3 | 238.430 [233.594–239.645], n=3 | 179.770 [178.531–181.238], n=3 |
| Container transmit (Mbps) | 1.016 [0.963–1.056], n=3 | 1.351 [1.345–1.354], n=3 | 0.960 [0.960–0.963], n=3 |
| Visible updates/s | unmeasured | unmeasured | unmeasured |
| Producer updates/s | unmeasured | unmeasured | unmeasured |
| Observed visual changes/s | 6.379 [6.187–6.384], n=3 | 38.278 [23.067–40.451], n=3 | 4.708 [4.675–4.745], n=3 |
| Frozen PSNR (dB) | 46.418 [46.304–46.432], n=3 | 46.632 [46.631–46.636], n=3 | 46.061 [46.061–46.083], n=3 |
| Frozen MAE | 0.198 [0.198–0.224], n=3 | 0.193 [0.193–0.193], n=3 | 0.241 [0.241–0.242], n=3 |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured |
| Input median (ms) | unmeasured | unmeasured | unmeasured |
| Input p95 (ms) | unmeasured | unmeasured | unmeasured |
| Input trials | unmeasured | unmeasured | unmeasured |

## real game / liveInput

| Metric | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- |
| CPU (% one core) | 100.914 [100.747–101.766], n=3 | 72.798 [72.301–73.914], n=3 | 103.747 [101.374–105.716], n=3 |
| RAM (MiB) | 200.043 [198.969–201.492], n=3 | 267.074 [265.836–269.828], n=3 | 204.602 [201.906–212.418], n=3 |
| Container transmit (Mbps) | 38.554 [37.675–38.802], n=3 | 5.849 [5.833–5.870], n=3 | 83.016 [82.911–83.155], n=3 |
| Visible updates/s | unmeasured | unmeasured | unmeasured |
| Producer updates/s | unmeasured | unmeasured | unmeasured |
| Observed visual changes/s | 55.148 [54.303–55.633], n=3 | 57.894 [57.278–58.116], n=3 | 43.700 [42.048–48.316], n=3 |
| Frozen PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Frozen MAE | unmeasured | unmeasured | unmeasured |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured |
| Input median (ms) | unmeasured | unmeasured | unmeasured |
| Input p95 (ms) | unmeasured | unmeasured | unmeasured |
| Input trials | unmeasured | unmeasured | unmeasured |

## real game / stationary

| Metric | Native final · candidate · native | Selkies 2.1.0 · reference · selkies | KasmVNC 1.5.2 · reference · kasm |
| --- | --- | --- | --- |
| CPU (% one core) | 75.349 [74.428–77.835], n=3 | 77.533 [74.688–82.347], n=3 | 66.766 [66.058–67.008], n=3 |
| RAM (MiB) | 197.133 [195.066–200.512], n=3 | 266.504 [265.492–269.977], n=3 | 204.621 [202.348–209.426], n=3 |
| Container transmit (Mbps) | 2.264 [2.263–2.267], n=3 | 0.675 [0.624–0.932], n=3 | 13.109 [13.092–13.129], n=3 |
| Visible updates/s | unmeasured | unmeasured | unmeasured |
| Producer updates/s | unmeasured | unmeasured | unmeasured |
| Observed visual changes/s | 53.104 [52.934–53.351], n=3 | 53.472 [52.553–54.896], n=3 | 37.089 [36.408–37.953], n=3 |
| Frozen PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Frozen MAE | unmeasured | unmeasured | unmeasured |
| Original static-text PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Original static-text ink MAE | unmeasured | unmeasured | unmeasured |
| Motion median PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Motion worst-decile PSNR (dB) | unmeasured | unmeasured | unmeasured |
| Motion median MAE | unmeasured | unmeasured | unmeasured |
| Motion pairs | unmeasured | unmeasured | unmeasured |
| Motion source samples | unmeasured | unmeasured | unmeasured |
| Motion decoded samples | unmeasured | unmeasured | unmeasured |
| Input median (ms) | unmeasured | unmeasured | unmeasured |
| Input p95 (ms) | unmeasured | unmeasured | unmeasured |
| Input trials | unmeasured | unmeasured | unmeasured |

## Verification

| Check | Status | Evidence |
| --- | --- | --- |
| Frozen native source and release/sanitizer suites | 17 release + 17 sanitizer checks passed; no reported sanitizer diagnostics | tests/results/final-verification.json |
| SDK unit/protocol tests | 10 passed | tests/results/sdk-tests.log |
| Final SDK snapshot with active viewer | 5 framework checks passed against release image | tests/results/framework-final-sdk.json |
| Final SDK snapshot with active viewer, sanitizer | 5 framework checks passed against ASAN/UBSAN image | tests/results/framework-final-sdk-asan.json |
| Original contract regression | 14/14 targets and previous-native regression checks passed | qualification/results/general-final/original-regression.json |
| General serial matrix | 17 valid independent sessions | qualification/results/general-final/matrix.json |
| Real apps and refreshed references | 19/21 valid; invalid observations retained | qualification/results/real-final/matrix.json |
| Runner, relay and client provenance | SHA256 identities recorded | qualification/results/general-final/source-provenance.json |
| Shared real application data | Identical copied file manifests checked per run; symlinks omitted uniformly | qualification/results/real-final/documents-source.json |
| Clean XFCE startup and graceful shutdown | No benchmark fixture in default image; 17 release and 17 sanitizer checks passed on Node22 | tests/results/baseline-verification.json |
| Measured-to-clean artifact equivalence | Native binary and installed package database byte-identical | tests/results/binary-equivalence.json |
| Local package installation and Node support | Node22 and Node26 SDK tests; local consumer import and installed CLI verified | tests/results/package-smoke.json |
| SDK minimum-version test log | 10 passed on Node22.22.2 | tests/results/sdk-node22.log |
| Explicit benchmark fixture injection | Clean-image runner smoke passed | tests/results/baseline-fixture-smoke.json |
| Bounded variant and validation history | Three engine variants; final core frozen, real-application extension completed | qualification/results/general-final/experiment-log.json |
| Clean desktop release integration results | Recorded; see raw artifact | tests/results/integration-baseline-release.json |
| Clean desktop sanitizer integration results | Recorded; see raw artifact | tests/results/integration-baseline-asan.json |
| Clean desktop sanitizer runtime log | Recorded; see raw artifact | tests/results/baseline-asan.log |
| Clean desktop build and native self-checks | Recorded; see raw artifact | tests/results/baseline-build.log |
| Sanitizer build and native self-checks | Recorded; see raw artifact | tests/results/baseline-asan-build.log |
| Strict TypeScript consumer compilation | Recorded; see raw artifact | tests/results/package-types.log |

## Excluded observations

| Variant | Profile/workload | Disposition | Errors | Evidence |
| --- | --- | --- | --- | --- |
| Native baseline | bandwidth | entire run excluded | ["video: motion quality: Insufficient matched-frame evidence: fewer than 10 unique pairs"] | evidence/general/qualification/results/2026-10-27T08-13-25-019Z-native-b47febc8/raw.json |
| KasmVNC 1.5.2 | bandwidth | entire run excluded | ["scroll: Invalid marker or input observations", "video: Invalid marker or input observations", "video: motion quality: Insufficient matched-frame evidence: fewer than 10 unique pairs"] | evidence/general/qualification/results/2026-10-27T08-19-02-058Z-kasm-a9c0d638/raw.json |
| Thunar setup attempt: unsupported CLI option | real desktop | entire run excluded | ["AssertionError [ERR_ASSERTION]: Thunar did not expose a visible window within readiness deadline\n    at file:///Users/lahfir/Documents/Projects/sandbox-ui/native-stream-lab/qualification/applications.mjs:74:258"] | evidence/general/qualification/results/applications-native-1793087694834/result.json |

## Run provenance

| Variant | Kind | Engine | Profile | Image | Runner SHA256 | Fixture SHA256 |
| --- | --- | --- | --- | --- | --- | --- |
| Native final | candidate | native | bandwidth | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native baseline | reference | native | local | sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | local | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Selkies 2.1.0 | reference | selkies | local | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | delay | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | real game | sha256:e2843e81f0ecc751738f44635c4592e0035bffc014407a0ac7d30a3066b2e467 | unrecorded | unrecorded |
| Native final | candidate | native | local | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | bandwidth | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | delay | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | real game | sha256:e2843e81f0ecc751738f44635c4592e0035bffc014407a0ac7d30a3066b2e467 | unrecorded | unrecorded |
| Native final | candidate | native | local | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | bandwidth | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | delay | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native final | candidate | native | real game | sha256:e2843e81f0ecc751738f44635c4592e0035bffc014407a0ac7d30a3066b2e467 | unrecorded | unrecorded |
| Native final | candidate | native | original fixture | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | 1fba8531df4f2543feaa2970bfd4a4fb793acb9d41f236a0ee80e2776bd058e0 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Native final | candidate | native | original fixture | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | 1fba8531df4f2543feaa2970bfd4a4fb793acb9d41f236a0ee80e2776bd058e0 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Native final | candidate | native | original fixture | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | 1fba8531df4f2543feaa2970bfd4a4fb793acb9d41f236a0ee80e2776bd058e0 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Native final | candidate | native | real desktop | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| Selkies 2.1.0 | reference | selkies | real desktop | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| KasmVNC 1.5.2 | reference | kasm | real desktop | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| Selkies 2.1.0 | reference | selkies | real game | sha256:9d80a9d69f0f5c50965a92163ccedea8f95d3b71fc537141d6f24527d426b891 | unrecorded | unrecorded |
| KasmVNC 1.5.2 | reference | kasm | real game | sha256:9d80a9d69f0f5c50965a92163ccedea8f95d3b71fc537141d6f24527d426b891 | unrecorded | unrecorded |
| Native final | candidate | native | real desktop | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| Selkies 2.1.0 | reference | selkies | real desktop | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| KasmVNC 1.5.2 | reference | kasm | real desktop | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| Selkies 2.1.0 | reference | selkies | real game | sha256:9d80a9d69f0f5c50965a92163ccedea8f95d3b71fc537141d6f24527d426b891 | unrecorded | unrecorded |
| KasmVNC 1.5.2 | reference | kasm | real game | sha256:9d80a9d69f0f5c50965a92163ccedea8f95d3b71fc537141d6f24527d426b891 | unrecorded | unrecorded |
| Native final | candidate | native | real desktop | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| Selkies 2.1.0 | reference | selkies | real desktop | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| KasmVNC 1.5.2 | reference | kasm | real desktop | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0aed3d9e740a1489721d793e660771b3d8cf1c7eb54cc1e4d8f8f5cfcd9bce61 | unrecorded |
| Selkies 2.1.0 | reference | selkies | real game | sha256:9d80a9d69f0f5c50965a92163ccedea8f95d3b71fc537141d6f24527d426b891 | unrecorded | unrecorded |
| KasmVNC 1.5.2 | reference | kasm | real game | sha256:9d80a9d69f0f5c50965a92163ccedea8f95d3b71fc537141d6f24527d426b891 | unrecorded | unrecorded |
| Native baseline | reference | native | delay | sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Native baseline | reference | native | bandwidth | sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Selkies 2.1.0 | reference | selkies | delay | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Selkies 2.1.0 | reference | selkies | bandwidth | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| KasmVNC 1.5.2 | reference | kasm | delay | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| KasmVNC 1.5.2 | reference | kasm | bandwidth | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | fb2550505ba8adb05a61e724b395f1bf6af4d180c979c73fda73024bbbf01507 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| KasmVNC 1.5.2 | reference | kasm | local | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 0a95e86d964f67f5c90a33e3a9e4469c5e96aed42dbf0db45416832f24b08663 | 163ab51dfd3f78989c6af892696ba37e33d26a1e624eb3df742657f37812215c |
| Thunar setup attempt: unsupported CLI option | invalid setup | native | real desktop | sha256:bac60f6d460d68d742aef28140d0f9b34512d940dcea3300c2ada863d40b3662 | ecbc1e35000d1bd1cdb85a82f17ad78dbe1bc5630879e778644b52bde2f738df | unrecorded |
| Selkies 2.1.0 (earlier) | historical | selkies | original fixture | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Native baseline | historical | native | original fixture | sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| KasmVNC 1.5.2 (earlier) | historical | kasm | original fixture | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| KasmVNC 1.5.2 (earlier) | historical | kasm | original fixture | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Selkies 2.1.0 (earlier) | historical | selkies | original fixture | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Native baseline | historical | native | original fixture | sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Native baseline | historical | native | original fixture | sha256:780234be88b0d17e26ba828b9ba81cf99bb640e5851cd062892c54ab30eba15f | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| KasmVNC 1.5.2 (earlier) | historical | kasm | original fixture | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |
| Selkies 2.1.0 (earlier) | historical | selkies | original fixture | sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712 | 9a5a41259bb710cd25f1d12a1c7e5a9eded0d0c87a6fd00a89240c3569dd1a21 | 7d90298f678542d879826deb2b25dfd820ea526841c4817991a66c5996def3cc |

## Scope and limits

Only X11/Xfce is validated here. GNOME on X11 is unverified; a Wayland backend is not implemented. Typed SDK, CLI, developer experience and agent experience status come from manifest verification evidence. Rust versus C++ is an implementation choice, not a benchmark result.

Local unauthenticated lab profile; CPU-only 1280×720 capture and Chrome 156. Browser and VM resources are excluded from container CPU/RAM. No deployment or WAN readiness claim.

Network profiles use relay delays and rate limits; they do not establish WAN packet-loss behavior.

Continuous quality is sparsely sampled, exact-marker matched evidence. Matched-pair counts and available coverage counters accompany fidelity; this is not full-rate perceptual equivalence. Resource and quality passes are separate.

Frozen and continuous-motion quality measure different things. Latency and fidelity appear beside resource savings to avoid assuming equal quality.

No held-out workload claim is made unless the manifest explicitly supplies evidence. Selection and reporting can reuse the same workloads.

n counts independent selected runs for each metric. Ranges are observed minima/maxima, not confidence intervals. Missing metrics are unmeasured, never zero.

Game visual-change hashes are not decoded FPS or physical presentation. Game resources include the application and desktop; producer rate and input latency may be unmeasured.

Transmit Mbps is container eth0 TX upstream of the relay, not browser-delivered goodput. Relay queues and socket buffers can skew finite windows. Controlled delay adds 25 ms each direction; limited profile also caps downstream at 8 Mbps and upstream at 2 Mbps.

The final native and refreshed network references use the same runner and current relay. Older network runs and invalid earlier window cases are retained in qualification/results but are not selected as final comparisons. Kasm local reference has the corrected visible-window fixture and an older runner lacking native telemetry; it remains n=1 diagnostic context.

Congestion backoff uses a 200 ms absolute age budget. Paths with high propagation delay can trigger conservative backoff; broader WAN policy remains work.

All selected raw JSON is exported below. Full image-pair sets and original logs remain in qualification/results and bench/results; representative captures are exported beside raw JSON. Missing image files in the compact export are not missing from the local measurement directories.

Game motion quality, real-application input latency, natural video, browser/editor workloads, prolonged soak, audio, clipboard, IME, resize, hardware encoding, Wayland and GNOME remain outside the verified baseline.

## Evidence

- [Native final](evidence/general/qualification/results/2026-10-27T07-22-13-994Z-native-8d6bd366/raw.json)
- [Native baseline](evidence/general/qualification/results/2026-10-27T07-23-50-726Z-native-197d3bd3/raw.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-26-57-592Z-native-4d2268bc/raw.json)
- [Selkies 2.1.0](evidence/general/qualification/results/2026-10-27T07-30-04-192Z-selkies-5b593551/raw.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-33-10-848Z-native-69a68e00/raw.json)
- [Native final](evidence/general/qualification/results/game-native-1793086440278/result.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-34-55-351Z-native-39f8041e/raw.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-38-02-791Z-native-f12eb220/raw.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-39-40-358Z-native-7a54e7ce/raw.json)
- [Native final](evidence/general/qualification/results/game-native-1793086829611/result.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-41-24-707Z-native-30c25e86/raw.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-44-32-043Z-native-978bca5f/raw.json)
- [Native final](evidence/general/qualification/results/2026-10-27T07-46-08-707Z-native-edaa81bb/raw.json)
- [Native final](evidence/general/qualification/results/game-native-1793087217987/result.json)
- [Native final](evidence/general/bench/results/2026-10-27T07-47-53-853Z-native-76a14377/raw.json)
- [Native final](evidence/general/bench/results/2026-10-27T07-50-13-708Z-native-fa689dce/raw.json)
- [Native final](evidence/general/bench/results/2026-10-27T07-52-32-643Z-native-1c888a0e/raw.json)
- [Native final](evidence/general/qualification/results/applications-native-1793087865308/result.json)
- [Selkies 2.1.0](evidence/general/qualification/results/applications-selkies-1793087928083/result.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/applications-kasm-1793087990346/result.json)
- [Selkies 2.1.0](evidence/general/qualification/results/game-selkies-1793088052357/result.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/game-kasm-1793088107541/result.json)
- [Native final](evidence/general/qualification/results/applications-native-1793088162664/result.json)
- [Selkies 2.1.0](evidence/general/qualification/results/applications-selkies-1793088224455/result.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/applications-kasm-1793088286515/result.json)
- [Selkies 2.1.0](evidence/general/qualification/results/game-selkies-1793088348083/result.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/game-kasm-1793088403575/result.json)
- [Native final](evidence/general/qualification/results/applications-native-1793088458537/result.json)
- [Selkies 2.1.0](evidence/general/qualification/results/applications-selkies-1793088520562/result.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/applications-kasm-1793088583086/result.json)
- [Selkies 2.1.0](evidence/general/qualification/results/game-selkies-1793088645017/result.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/game-kasm-1793088700256/result.json)
- [Native baseline](evidence/general/qualification/results/2026-10-27T08-12-35-237Z-native-afe787c1/raw.json)
- [Native baseline](evidence/general/qualification/results/2026-10-27T08-13-25-019Z-native-b47febc8/raw.json)
- [Selkies 2.1.0](evidence/general/qualification/results/2026-10-27T08-15-43-671Z-selkies-d12fe7bd/raw.json)
- [Selkies 2.1.0](evidence/general/qualification/results/2026-10-27T08-16-34-627Z-selkies-17ea19ab/raw.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/2026-10-27T08-18-13-074Z-kasm-ea4db653/raw.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/2026-10-27T08-19-02-058Z-kasm-a9c0d638/raw.json)
- [KasmVNC 1.5.2](evidence/general/qualification/results/2026-10-27T06-03-55-016Z-kasm-72e2559a/raw.json)
- [Thunar setup attempt: unsupported CLI option](evidence/general/qualification/results/applications-native-1793087694834/result.json)
- [Selkies 2.1.0 (earlier)](evidence/general/optimize/evidence/2026-10-27T05-13-55-371Z-selkies-da43c484/raw.json)
- [Native baseline](evidence/general/optimize/evidence/2026-10-27T05-16-15-867Z-native-3d4a76e4/raw.json)
- [KasmVNC 1.5.2 (earlier)](evidence/general/optimize/evidence/2026-10-27T05-18-35-073Z-kasm-b90b156a/raw.json)
- [KasmVNC 1.5.2 (earlier)](evidence/general/optimize/evidence/2026-10-27T05-20-55-269Z-kasm-a1d326e6/raw.json)
- [Selkies 2.1.0 (earlier)](evidence/general/optimize/evidence/2026-10-27T05-23-14-378Z-selkies-230b6b49/raw.json)
- [Native baseline](evidence/general/optimize/evidence/2026-10-27T05-25-34-294Z-native-c33f4803/raw.json)
- [Native baseline](evidence/general/optimize/evidence/2026-10-27T05-27-53-133Z-native-c1047892/raw.json)
- [KasmVNC 1.5.2 (earlier)](evidence/general/optimize/evidence/2026-10-27T05-30-12-303Z-kasm-e05bfef3/raw.json)
- [Selkies 2.1.0 (earlier)](evidence/general/optimize/evidence/2026-10-27T05-32-33-433Z-selkies-bcf7d04d/raw.json)
- [Frozen native source and release/sanitizer suites](evidence/general/tests/results/final-verification.json)
- [SDK unit/protocol tests](evidence/general/tests/results/sdk-tests.log)
- [Final SDK snapshot with active viewer](evidence/general/tests/results/framework-final-sdk.json)
- [Final SDK snapshot with active viewer, sanitizer](evidence/general/tests/results/framework-final-sdk-asan.json)
- [Original contract regression](evidence/general/qualification/results/general-final/original-regression.json)
- [General serial matrix](evidence/general/qualification/results/general-final/matrix.json)
- [Real apps and refreshed references](evidence/general/qualification/results/real-final/matrix.json)
- [Runner, relay and client provenance](evidence/general/qualification/results/general-final/source-provenance.json)
- [Shared real application data](evidence/general/qualification/results/real-final/documents-source.json)
- [Clean XFCE startup and graceful shutdown](evidence/general/tests/results/baseline-verification.json)
- [Measured-to-clean artifact equivalence](evidence/general/tests/results/binary-equivalence.json)
- [Local package installation and Node support](evidence/general/tests/results/package-smoke.json)
- [SDK minimum-version test log](evidence/general/tests/results/sdk-node22.log)
- [Explicit benchmark fixture injection](evidence/general/tests/results/baseline-fixture-smoke.json)
- [Bounded variant and validation history](evidence/general/qualification/results/general-final/experiment-log.json)
- [Clean desktop release integration results](evidence/general/tests/results/integration-baseline-release.json)
- [Clean desktop sanitizer integration results](evidence/general/tests/results/integration-baseline-asan.json)
- [Clean desktop sanitizer runtime log](evidence/general/tests/results/baseline-asan.log)
- [Clean desktop build and native self-checks](evidence/general/tests/results/baseline-build.log)
- [Sanitizer build and native self-checks](evidence/general/tests/results/baseline-asan-build.log)
- [Strict TypeScript consumer compilation](evidence/general/tests/results/package-types.log)
