# Experiments

Everything here supports or records the engine's evaluation. None of it is
built, installed or tested by the root `Makefile`, `install.sh` or `npm test`.

| Folder | Contents |
| --- | --- |
| [engine-evaluation/](engine-evaluation/) | Work on the current engine: benchmarks, qualification workloads, reports, probes and receipts |
| [desktop-stream-bench/](desktop-stream-bench/README.md) | Earlier Selkies/KasmVNC/GNOME comparison harness; its `.env` and `node_modules` are shared by the scripts above |
| [exp-001/](exp-001/README.md) | Retired first prototype (branch `optimize-exp/native-stream/exp-001`), kept as source and results |

## engine-evaluation/

| Path | Contents |
| --- | --- |
| [optimize/](engine-evaluation/optimize/general-engine-report.html) | Final reports and the evidence they link to |
| [qualification/](engine-evaluation/qualification/README.md) | Comparative workloads (fixture, Thunar, Freedoom, network) and raw results |
| [bench/](engine-evaluation/bench/README.md) | Original benchmark runner |
| [probes/](engine-evaluation/probes/README.md) | Isolated decoder and rate-control investigations |
| [diagnostics/](engine-evaluation/diagnostics/README.md) | Live game, latency and interactive metric helpers |
| [doom/](engine-evaluation/doom/README.md) | Freedoom demo image |
| [test-receipts/](engine-evaluation/test-receipts/) | Saved integration, sanitizer and portable verification outputs |
| dist/ | Earlier portable source tarball and its manifest |
| candidate.json | Engine image the runners measure |

Run these from the repository root, for example
`node experiments/engine-evaluation/qualification/run.mjs --self-check`.
Runners write to `results/` beside themselves; those folders are not tracked.
Comparison runs need `desktop-stream-bench/.env` with a fresh `BENCH_PASSWORD`
and the competitor images built from `desktop-stream-bench/`.
