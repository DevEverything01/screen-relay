"""Publish the equal-frame-limit sensitivity check alongside the full defaults run."""
import json
import math
from pathlib import Path
from statistics import mean, median

root = Path(__file__).resolve().parent
base = json.loads((root / "results/desktop-comparison/raw.json").read_text())
tuned = json.loads((root / "results/kasm-60-check/raw.json").read_text())
assert base.get("completed") and tuned.get("completed")
cases = {(c["desktop"], c["engine"]): c for c in base["cases"] if c["engine"] == "selkies"}
cases.update({(c["desktop"], c["engine"]): c for c in tuned["cases"]})
order = [("xfce", "selkies"), ("gnome", "selkies"), ("xfce", "kasm"), ("gnome", "kasm")]
assert set(cases) == set(order)
for c in tuned["cases"]:
    assert c["clientSettings"]["after"]["framerate_streaming_mode"] == "60"
    assert c["clientSettings"]["before"]["framerate_streaming_mode"] == "24"
    assert len(c["runs"]) == 2 and len(c["fps"]) == 1
    frames = c["fps"][0]["observed"]["frames"]
    assert all(0 < (b["id"]-a["id"]) % 4096 < 2048 for a, b in zip(frames, frames[1:]))

def p95(values):
    return sorted(values)[math.ceil(.95 * len(values)) - 1]

def metric(case, mode, field):
    return mean(r[field] for r in case["runs"] if r["mode"] == mode)

table = [["Metric · 60-FPS target", "Selkies · Xfce", "Selkies · GNOME", "KasmVNC · Xfce", "KasmVNC · GNOME"]]
for mode in ("idle", "motion"):
    for name, reduce in (("median", median), ("p95", p95)):
        table.append([f"{mode.title()} input latency · {name}"] + [f'{reduce(cases[k]["latency"][mode]):.1f} ms' for k in order])
    for field, label, unit in (("cpuPercent", "CPU", "%"), ("memoryMiB", "memory", " MiB"), ("mbps", "bandwidth", " Mbps")):
        table.append([f"{mode.title()} · {label}"] + [f'{metric(cases[k],mode,field):.3f}{unit}' if field == "mbps" else f'{metric(cases[k],mode,field):.1f}{unit}' for k in order])
for field, label in (("visibleUpdatesPerSecond", "visible updates/s"), ("producerUpdatesPerSecond", "app-produced updates/s")):
    table.append([f"Motion · {label}"] + [f'{next(f for f in cases[k]["fps"] if f["mode"]=="motion")[field]:.1f}' for k in order])
table.append(["Text PSNR · higher is closer"] + [f'{cases[k]["text"]["psnrDb"]:.1f} dB' for k in order])
table.append(["Text ink error · lower is closer"] + [f'{cases[k]["text"]["textInkMeanAbsoluteError"]:.2f}' for k in order])
summary = {
    "title": "Corrected comparison · both clients target 60 FPS",
    "state": "Benchmarks complete. Kasm's default 24-FPS cap was identified and retested at 60 FPS. Both live GNOME desktops are restored.",
    "table": table,
    "note": "CPU: 100% = one core; memory includes the desktop and app. Selkies resource values average three 12-second runs; Kasm 60-FPS values are one 12-second sensitivity check per workload. Each latency condition has 30 trials. Visible updates/s is measured from native frame IDs; the app produced about 48–57 updates/s, so this is not a maximum-FPS test. Both use software H.264, with different quality/rate-control settings. Original default-setting results are retained separately. The live viewers retain their existing client preferences."
}
(root / "results/summary.json").write_text(json.dumps(summary, indent=2))
(root / "results/kasm-60-check/summary.json").write_text(json.dumps(summary, indent=2))
markdown = "\n".join("| " + " | ".join(row) + " |" for row in [table[0], ["---"]*5, *table[1:]])
defaults = (root / "results/desktop-comparison/table.md").read_text()
report = f'''# Xfce vs GNOME streaming comparison — October 26, 2026

**Recommendation: build the runtime on Selkies/pixelflux, with Xfce as the default for CPU-only sandboxes.** In this test it provides the fastest response, the highest received update rate, and lower motion bandwidth. GNOME is available when its desktop experience is needed, at a higher session cost. Selkies' major weakness here is idle CPU; KasmVNC is substantially cheaper when idle and uses less memory.

## Corrected comparison

The first four-configuration run used fresh default browser clients. Inspection then showed KasmVNC's client selected software H.264 and capped both frame-rate controls at 24 FPS, overriding the server's 60-FPS ceiling. Those measurements are valid defaults, **not** evidence of a 24-FPS engine limit. A separate check selected the custom preset, raised the client cap to 60, and asserted that stream mode and image-quality controls stayed unchanged. The settings before/after are retained in its raw results.

{markdown}

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

{defaults}

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
'''
(root / "GNOME-COMPARISON.md").write_text(report)
print(markdown)
