# Experiments

Supporting work for the engine. Nothing here is built, installed or tested by the
root `Makefile`, `install.sh` or `npm test`. Run commands from the repository root.

| Folder | What it is | How to run |
| --- | --- | --- |
| [engine-evaluation/optimize/](engine-evaluation/optimize/general-engine-report.html) | Final reports and the evidence they link | Open the HTML or Markdown report |
| [engine-evaluation/qualification/](engine-evaluation/qualification/README.md) | Comparative workloads vs Selkies/KasmVNC (fixture, Thunar, Freedoom, network) | `node experiments/engine-evaluation/qualification/run.mjs --self-check` |
| [engine-evaluation/bench/](engine-evaluation/bench/README.md) | Original benchmark runner | `node experiments/engine-evaluation/bench/run.mjs --self-check` |
| [engine-evaluation/probes/](engine-evaluation/probes/README.md) | Decoder and rate-control investigations | See folder README |
| [engine-evaluation/diagnostics/](engine-evaluation/diagnostics/README.md) | Live game, latency and metric helpers | `node experiments/engine-evaluation/diagnostics/live-metrics.mjs --self-check` |
| [engine-evaluation/doom/](engine-evaluation/doom/README.md) | Freedoom demo image | See folder README |
| [engine-evaluation/test-receipts/](engine-evaluation/test-receipts/) | Saved integration, sanitizer and portable outputs linked from the docs | None |
| engine-evaluation/candidate.json | Engine image the runners measure | None |
| [desktop-stream-bench/](desktop-stream-bench/README.md) | Earlier Selkies/KasmVNC/GNOME harness; its `.env` and `node_modules` are shared with qualification | See folder README |

Runners write to `results/` beside themselves (untracked). Comparison runs need
`desktop-stream-bench/.env` with a fresh `BENCH_PASSWORD` and the competitor images
built from `desktop-stream-bench/`. The retired first prototype lives in git history
as `origin/optimize-exp/native-stream/exp-001`.
