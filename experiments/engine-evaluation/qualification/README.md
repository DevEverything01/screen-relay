# Broader desktop qualification

This runner leaves the original benchmark and engine configurations unchanged. Each invocation starts a fresh container, copies this directory's fixture before startup, and records one engine's idle, scroll, real window movement, synthetic video, and mixed cases. All use 1280×720, two CPUs, 1536 MiB memory, 512 MiB shared memory, Chrome 156, and the original Kasm 60 FPS settings. Native uses `native-stream-lab:final2`; comparison engines use the pinned common-base image recorded in `run.mjs`.

```sh
ENGINE=native node native-stream-lab/experiments/engine-evaluation/qualification/run.mjs
ENGINE=selkies node native-stream-lab/experiments/engine-evaluation/qualification/run.mjs
ENGINE=kasm node native-stream-lab/experiments/engine-evaluation/qualification/run.mjs
```

`CASES=idle,video` selects a debug subset identically for every engine. `NET_PROFILE=delay` or `NET_PROFILE=bandwidth` enables the transparent TCP shaper documented in `network.mjs`; the default `local` connects directly on loopback port 18093. Shaped runs forward through port 18098. These are controlled transport experiments, not physical WAN or packet-loss tests.

Each case records twenty real pointer clicks with independently checked native toggle counts, then 21 one-second resource observations spanning at least twenty seconds. Visible 12-bit producer markers are sampled from decoded browser pixels. The `idle` case is idle-marker: it includes 30 Hz marker damage and must not be presented as true quiescent idle; original benchmark idle evidence remains separate. Slow delivery does not itself invalidate a run: one valid visible marker is sufficient, and performance numbers retain zero or low update rates. Invalid markers, nonmonotonic marker progression, missing inputs, missing resource samples, and fixture failures invalidate evidence and remain in raw JSON. Later cases continue after a case failure.

Results live under `qualification/results/<session>/`: raw observations, errors, image and fixture identities, browser version, CPU, working-set memory, transmitted bytes, producer rate, visible update rate, click latencies, and source/decoded frozen snapshots for each completed case. Snapshots wait up to thirty seconds for the decoded marker to match the frozen producer frame, then verify that the native frame stayed frozen. Full-frame frozen PSNR and mean absolute error describe static decoded pixels after settling; they do not establish motion fidelity. Synthetic video is not natural recorded video. Containers are stopped and retained for inspection, and any proxy is closed on exit.

Offline validation (no performance run):

```sh
node --check native-stream-lab/experiments/engine-evaluation/qualification/run.mjs
node native-stream-lab/experiments/engine-evaluation/qualification/run.mjs --self-check
```

The self-check protects evidence validity: it rejects duplicate/backward markers and missing click results while accepting wraparound and slow delivery. Real browser/container qualification and repeated independent sessions are required before drawing performance conclusions. See `PLAN.md` for claim limits and holdout requirements.

`MOTION_QUALITY=1` adds a separate fifteen-second sparse matched-frame fidelity pass for the continuously running video case after resource sampling. It records module identity, source/decoded pairs, match coverage and independent validity. Missing or invalid requested evidence invalidates the case; there is no quality-score threshold. This instrumented pass does not establish full-rate perceptual quality or interior frame atomicity; see `QUALITY.md`.

Window cases also preserve native X11 screenshots immediately before and after the resource interval. Each must contain over 10,000 exact window-background pixels in the expected vertical region, and their bounding boxes must differ; otherwise the window case is invalid. Capture overhead sits outside the resource interval.

Set `NATIVE_IMAGE=native-stream-lab:general3` to qualify the frozen general-engine candidate; the default `final2` remains the original reference. Run `npm ci --ignore-scripts` for the local Playwright/PNG development dependencies. Source and browser hashes/versions remain recorded. Native telemetry is captured outside the measured interval to explain feedback behavior. Comparator images and credentials still come from the original benchmark setup.
