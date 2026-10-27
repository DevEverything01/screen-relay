# Moving-frame fidelity qualification

Status: `motion-quality.mjs` implements a separate continuous-motion pilot; its offline scorer self-check passes. No real browser/X11 run has been executed for this implementation. Marker update counts do not prove that the rest of the desktop refreshed.

Integration: call `measureMotionQuality({page, container, directory, docker})` while `video fps` is active and `window.surface` references the decoded surface. It returns evidence and validity, writes `motion-quality.json`, retains at most 60 matched source/decoded PNG pairs plus one latest-source scratch PNG, and requires at least 10 matches. This is an evidence sufficiency gate, not a quality threshold. Sampling stops at 60 matches or the requested duration, whichever comes first. Two pending maps retain at most 60 compressed PNGs each; evictions are counted. The first observation of an ID is retained; decoded refinements under one ID are counted, never selected for better scores. Changed source pixels under one ID invalidate the pass.

The implementation samples at a 100 ms target with actual observation timestamps, and encodes browser PNGs during sampling to keep retained memory bounded. This adds browser CPU and may reduce sampling cadence. It scores the complete frame except a declared 48×40 bottom-left cursor region after parking the pointer at (10,700). Markers and latency control remain scored. Inspect the source fixture and recorded exclusion before comparing engines. Producer frame progress must remain positive and below 2048; workload, marker mode, freeze state and input-toggle state must remain stable.

## Independent capture

Run a separate 10-second fidelity pass per engine/profile after warm-up, with the synthetic video continuously advancing at its normal target rate. Never freeze, slow, or single-step it for this pass. Keep the performance-pass engine settings. Source screenshots and browser readback add work: their resource metrics must not replace the uninstrumented performance results.

Capture actual X11 root pixels using an independent screenshot tool already in the container, such as the existing `scrot` path. Do not use engine capture helpers, encoder input, a fixture framebuffer, or expected synthetic images as the reference. Save original PNG files and timestamps. A persistent source capture process avoids Docker exec overhead, but is unnecessary for an initial correctness probe.

Independently copy the complete decoded video/canvas surface into a 1280×720 browser canvas in one synchronous `drawImage` call. Decode markers from that copy, not an earlier marker-only read. Retain the first sampled observation of each new ID with its browser timestamp. A future full-rate recorder can defer PNG encoding; that requires a memory budget because one RGBA image costs 3.52 MiB and 60 images cost approximately 211 MiB.

Start with a bounded 60-pair pilot. Capture source images at a sustainable measured cadence and sample browser images at a declared fixed target cadence. Record actual counts and intervals. Sparse sampling does not establish full-rate fidelity. If source capture misses most delivered IDs, improve independent X11 recording; never substitute nearest timestamps or nearest-looking frames.

## Identity and geometry

Use the 12-bit frame ID only within a workload epoch shorter than its wrap period (136.5 seconds at 30 FPS). Save workload/epoch metadata and reset the join at every workload transition. Status-file counters are producer diagnostics, not screenshot identity.

The fixture provides replicated marker origins at desktop coordinates (24,540) and (1144,700), each with fourteen 8×12 cells: black/white sentinels and twelve ID bits. Read interior cell pixels from every saved source and decoded image. Require both IDs and sentinels to agree before pairing. Report invalid markers and spatial disagreements separately; never silently exclude them from a headline score. Two agreeing markers detect some partial updates but cannot prove interior consistency. If geometry changes, use recorded fixture coordinates rather than assuming these positions.

Join exact epoch/ID pairs. If repeated source screenshots with one ID disagree in scored content, identity is unstable: fix the fixture/capture protocol before scoring. Never choose the best-scoring reference. Preserve ambiguous images. Actual X11 screenshots expose rendering defects without assuming that expected fixture pixels reached X11 atomically.

Require source and decoded buffers of 1280×720, browser device scale factor 1, and matching intrinsic surface and CSS dimensions. Reject scaling, cropping, letterboxing, unexpected geometry, or out-of-bounds regions. Never resize images to manufacture a match. Keep the pointer outside scored content and prevent window movement during this synthetic-video pass. Window movement requires its own geometry-aware validation.

## Scores and missing delivery

Score RGB pixels over the declared region. The pilot publishes each pair's RGB PSNR and per-channel mean absolute error; aggregate median and worst-decile matched-frame quality when presenting results. Represent lossless equality explicitly as infinite PSNR. RGB error includes chroma-subsampling damage; optional luma error must not replace RGB. Use identical regions across engines. These scores quantify pixel error, not perceptual equivalence or readability.

Publish alongside quality:

- Produced frame delta and actual producer rate during this instrumented pass.
- Unique source and decoded IDs, matched IDs, duplicates, invalid markers and spatial-marker disagreements.
- Unmatched IDs with denominators and timestamps. Sparse source capture is not evidence of engine loss.
- Decoded-ID cadence and gaps from the independent cadence pass. Distinguish producer skips, receiver loss and unobserved frames where possible.
- Sampling coverage across the full interval. An engine cannot pass through a handful of easy frames while omitting difficult ones.

Declare coverage and quality thresholds before comparison. Until a pilot establishes sustainable capture and meaningful coverage, publish raw evidence with limitations and no passing threshold. Matched quality alone cannot establish overall quality when delivery is incomplete. Compare speed and bandwidth alongside observed quality distributions; equal settings do not establish equal quality.

## Minimal verification

An offline scorer self-check must cover identical images (zero error/infinite PSNR), one known channel error with exact MAE/MSE, mismatched IDs, wrap/epoch separation, marker disagreement, dimension mismatch and no matching IDs (insufficient evidence, never a pass). One small generated-image test can cover these invariants.

Inspect saved source/decoded pairs from each engine, including a deliberately mismatched negative control. Frozen screenshots remain useful for static text but cannot satisfy this gate. Natural video, dense text readability, game content and physical WAN conditions still require separate evidence before a broad performance claim.
