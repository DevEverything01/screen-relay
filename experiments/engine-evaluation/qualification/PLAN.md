# General-engine qualification

The original 720p small-region desktop comparison is complete. It is narrow evidence, not proof that the engine outperforms Selkies and KasmVNC generally. The user's 2026-10-27 direction requires broad workload performance without use-case-specific engine tuning.

Freeze native core `4b9ea36`, Selkies 2.1.0 and KasmVNC 1.5.2 while collecting qualification evidence. Use the same limits, application settings and browser for each engine. Keep one engine configuration across all cases; adaptive behavior already present in each engine remains enabled. Do not silently change quality settings between cases.

Coverage:

- Dense static monochrome and colored text.
- Large-area document scrolling.
- Real X11 window movement over static content.
- Full-frame synthetic video motion, explicitly distinguished from natural recorded video.
- Mixed text and animated graphics.
- Actual live Freedoom turn/fire input, with the same SDL presentation setting for every engine.
- Added transport delay and bandwidth constraints, distinguished from physical WAN and packet-loss tests.
- Existing malformed-client, stuck-control, disconnect and ACK-timeout checks.

Measure container CPU, working-set memory, wire bandwidth, observed useful updates, input-to-decoded-pixel latency and fidelity. Record producer rate so overloaded applications cannot be mistaken for streaming loss. Preserve individual cases and failures; averages cannot hide a failed case. Static/frozen-frame quality is not equivalent to motion quality.

Initial breadth runs locate limitations. Repeat final comparisons on independent sessions before making a general-performance claim. A configuration or core change after looking at these cases makes them development cases; reserve a new workload for subsequent holdout validation. No universal superiority claim follows from any finite suite.

The first four-variant optimization run remains closed to further optimization pending concrete findings and renewed bounded scope; this additional qualification changes no engine code. Original benchmark files and raw evidence remain intact.

Test authoring contract: these new cases protect delivery outside the small original animation region and under constrained transport. Credible failures include full-frame bitrate growth, producer/receiver divergence and round-trip-limited delivery. The original local small-region benchmark cannot expose those failures. Tests exercise native applications, browser pixels and independent resource counters without adding production seams.

## Authorized general-engine pass

The user subsequently approved up to two hours and six measured variants, ending 2026-10-27 08:07 UTC. General1 introduced bounded pipelining and VBV feedback; general2 added the modular framework and fixed recovery underutilization; general3 corrected queue-delay/byte feedback masks. The final source is frozen before repeated qualification. Backend/API correctness, sanitizers and source injection are separate gates from resource, latency and quality observations. No workload-specific encoder branch, Wayland implementation or external automation-tool dependency is added. Failed/intermediate observations remain evidence; none establishes a universal performance claim.
