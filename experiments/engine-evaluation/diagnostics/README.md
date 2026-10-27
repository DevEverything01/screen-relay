# Diagnostics

One-off measurement helpers used during engine evaluation. They write to `results/` here.
See also [live interactive metrics](live-metrics-README.md) and `latency-profile.mjs`.

## Live game diagnostic

`TEST_CONTAINER=native-doom-final TEST_URL=http://127.0.0.1:18096 TEST_LABEL=final-engine node experiments/engine-evaluation/diagnostics/doom-live-check.mjs` samples ten seconds without a viewer, ten stationary seconds, and fifteen seconds holding turn/fire through the real browser input path. It requires an already-running live game. `node experiments/engine-evaluation/diagnostics/doom-live-check.mjs --self-check` validates resource arithmetic.

It preserves counters, process attribution, drawn-frame counts and screenshots. A changed screenshot and zero decoder errors establish a live visible stream; they do not independently prove every game action or measure input latency. This is one diagnostic per configuration, not a repeated three-engine gaming comparison. Completed release/sanitizer and game evidence is exported in [optimize/evidence](../optimize/evidence/).
