"""Summarize independently observed desktop pixels and cgroup resource counters."""
import json
import math
from pathlib import Path
from statistics import mean, median

root = Path(__file__).resolve().parent
directory = root / "results/desktop-comparison"
raw = json.loads((directory / "raw.json").read_text())
assert raw.get("completed"), "Do not publish an incomplete comparison"
cases = {(c["desktop"], c["engine"]): c for c in raw["cases"]}
order = [("xfce", "selkies"), ("gnome", "selkies"), ("xfce", "kasm"), ("gnome", "kasm")]
assert set(cases) == set(order)

def p95(values):
    return sorted(values)[math.ceil(len(values) * .95) - 1]

table = [["Metric", "Selkies · Xfce", "Selkies · GNOME", "KasmVNC · Xfce", "KasmVNC · GNOME"]]
for mode in ("idle", "motion"):
    for label, reducer in (("median", median), ("p95", p95)):
        row = [f"{mode.title()} input latency · {label}"]
        for key in order:
            values = cases[key]["latency"][mode]
            assert len(values) == 30 and all(v > 0 for v in values)
            row.append(f"{reducer(values):.1f} ms")
        table.append(row)
for mode in ("idle", "scroll", "motion"):
    for metric, label, unit in (("cpuPercent", "CPU", "%"), ("memoryMiB", "memory", " MiB"), ("mbps", "bandwidth", " Mbps")):
        row = [f"{mode.title()} · {label}"]
        for key in order:
            runs = [r for r in cases[key]["runs"] if r["mode"] == mode]
            assert len(runs) == 3 and all(r["seconds"] >= 12 for r in runs)
            value = mean(r[metric] for r in runs)
            row.append(f"{value:.3f}{unit}" if metric == "mbps" else f"{value:.1f}{unit}")
        table.append(row)
for mode in ("scroll", "motion"):
    for metric, label in (("visibleUpdatesPerSecond", "browser-visible updates/s"), ("producerUpdatesPerSecond", "app-produced updates/s")):
        row = [f"{mode.title()} · {label}"]
        for key in order:
            result = next(f for f in cases[key]["fps"] if f["mode"] == mode)
            frames = result["observed"]["frames"]
            steps = [(b["id"] - a["id"]) % 4096 for a, b in zip(frames, frames[1:])]
            assert all(0 < d < 2048 for d in steps), "Frame IDs must advance without backward/mixed-code artifacts"
            result["probeObservedFraction"] = (len(frames)-1) / sum(steps)
            gaps = [b["t"] - a["t"] for a, b in zip(frames, frames[1:])]
            result["updateGapP95Ms"] = p95(gaps)
            result["updateGapMaxMs"] = max(gaps)
            row.append(f"{result[metric]:.1f}")
        table.append(row)
table.append(["Text PSNR · higher is closer"] + [f'{cases[k]["text"]["psnrDb"]:.1f} dB' for k in order])
table.append(["Text ink error · lower is closer"] + [f'{cases[k]["text"]["textInkMeanAbsoluteError"]:.2f}' for k in order])
summary = {
    "title": "Measured comparison · Xfce vs GNOME · 1280 × 720",
    "state": "Comparison complete: four configurations, 240 input trials, 36 resource runs, and eight received-frame tests.",
    "table": table,
    "note": "100% CPU = one core; each container has a two-core quota. Memory includes the desktop and app. Visible updates/s counts unique native frame IDs received in browser pixels, sampled at browser animation-frame cadence; it is not maximum encoder FPS. FPS tests use a small marker and are separate from resource averages. Local ARM64 Docker, software rendering/encoding, default client quality. No WAN/GPU/full-screen-video result is implied."
}
(directory / "summary.json").write_text(json.dumps(summary, indent=2))
(directory / "analyzed.json").write_text(json.dumps(raw, indent=2))
(root / "results/summary.json").write_text(json.dumps(summary, indent=2))
markdown = "\n".join("| " + " | ".join(row) + " |" for row in [table[0], ["---"] * 5, *table[1:]])
(directory / "table.md").write_text(markdown + "\n")
print(markdown)
