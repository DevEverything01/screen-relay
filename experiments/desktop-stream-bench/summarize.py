"""Produce the viewer's measured table from the retained raw observations."""
import json
import math
from pathlib import Path
from statistics import mean, median

root = Path(__file__).resolve().parent
raw = json.loads((root / "results/raw.json").read_text())
assert len(raw["runs"]) == 18, "Require all three repeats of every workload"
table = [["Measured metric", "Selkies", "KasmVNC"]]
for label, percentile in (("Input → decoded pixel · median", 0.5), ("Input → decoded pixel · p95", 0.95)):
    cells = [label]
    for engine in ("selkies", "kasm"):
        values = sorted(raw["engines"][engine]["latencyMs"])
        assert len(values) == 30 and all(v > 0 for v in values)
        result = median(values) if percentile == 0.5 else values[math.ceil(len(values) * percentile) - 1]
        cells.append(f"{result:.1f} ms")
    table.append(cells)
for mode in ("idle", "scroll", "motion"):
    for key, label, unit in (("cpuPercent", "CPU", "%"), ("memoryMiB", "memory", " MiB"), ("mbps", "sent bandwidth", " Mbps")):
        cells = [f"{mode.title()} · {label}"]
        for engine in ("selkies", "kasm"):
            runs = [r for r in raw["runs"] if r["engine"] == engine and r["mode"] == mode and not r.get("excludedReason")]
            assert 2 <= len(runs) <= 3
            value = mean(r[key] for r in runs)
            cells.append(f"{value:.3f}{unit}" if key == "mbps" else f"{value:.1f}{unit}")
        table.append(cells)
table.append(["Settled text ROI · PSNR (higher is closer)"] + [f'{raw["engines"][e]["text"]["psnrDb"]:.1f} dB' for e in ("selkies", "kasm")])
table.append(["Text ink error · 0–255 (lower is closer)"] + [f'{raw["engines"][e]["text"]["textInkMeanAbsoluteError"]:.2f}' for e in ("selkies", "kasm")])
summary = {"state": "Xfce baseline complete: 30 input trials per engine; three 12-second repeats (Kasm motion: two; concurrent-viewer run excluded).", "table": table, "note": "Historical Xfce baseline, not GNOME measurements. 100% CPU = one core; each container can use two. Memory is the container working set. Scroll/motion affect a 1072 × 140 region. These are local Docker/Chrome results with default client quality settings, not WAN, GPU, full-screen video, or codec-matched results."}
(root / "results/summary.json").write_text(json.dumps(summary, indent=2))
print("\n".join(" | ".join(row) for row in table))
