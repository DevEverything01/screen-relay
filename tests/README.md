# Native integration check

Run against an already started native container; this test never builds, starts,
stops, or deletes a container:

```sh
TEST_CONTAINER=<native-container-name> TEST_URL=http://127.0.0.1:18094 rtk proxy node tests/integration.mjs
```

Requires installed Google Chrome, local development dependencies (`npm ci --ignore-scripts`), Docker access, and Python/Tk with X11 in the container. The fixture
temporarily covers the 1280×720 desktop, so run outside benchmark measurement.
Its process is terminated in `finally`; uniquely named fixture/state files remain
in the container as evidence. JSON reports and screenshots remain in `results/`.
The integration test temporarily SIGSTOPs the dedicated container's exact
`/opt/bench/fixture.py` producer and resumes it in `finally`, preventing covered
benchmark windows from contaminating idle-damage evidence. It does not resume
producers already stopped before the test. The input fixture covers the actual
screen size, disables caret blinking, and changes its background only once.

The test-audit authoring gate is satisfied at the real browser/X11 boundary:

| Contract | Credible regression | Independent evidence |
| --- | --- | --- |
| Real decoded desktop | Encoder/decoder stalls, black or stale canvas | Known Tk background pixels plus screenshots, with draw counters as secondary evidence |
| Live resource metrics | Fabricated/stale counters, HTTP lifecycle errors, unavailable HUD or metrics starves video | Two same-page HTTP fetches bracketed independently by Docker reads of cgroup CPU usage, validated JSON/cache headers, eventual numeric CPU/RAM HUD, and a subsequent rendered frame |
| Keyboard/pointer/wheel | HID mapping, scaling, or forwarding breaks | Tk entry text and received events in the container |
| Held-control cleanup | Modifier/button remains pressed | XQueryKeymap and XQueryPointer, independent of browser held-state bookkeeping |
| Reconnect | New session receives stale state or undecodable initial frame | Fresh browser decoder and changed Tk desktop color |
| Single viewer | A rejected connection disrupts the owner | First viewer renders a subsequent independent color change |
| Untrusted/malformed clients | Origin or length validation breaks; server dies | Handshake refusal, bounded socket closure, and subsequent decoded recovery |
| Backpressure timeout | Missing ACK leaves session owned indefinitely or holds native controls | Raw receiver presses Shift/button, independently observes both held, withholds every ACK, observes one frame and closure near three seconds, independently observes both released, then a fresh decoder succeeds |
| Pipeline credit and no-progress bounds | Stop-and-wait survives, invalid ACKs grant credits, or bogus traffic prevents timeout | Actual alternating Tk damage, first ACK delayed 120 ms, at least two subsequent ordered frames without another valid ACK, at most eight unacknowledged frames and 8 MiB payload, duplicate/future/wrong-generation ACK traffic, bounded closure and independent X11 control release |
| Continuous decoding and idle recovery | Referenced frame loss corrupts decoder or damage polling produces an idle storm | Independently specified alternating patch colors observed through decoded canvas, zero decode errors, then at most two draws over a settled idle second |

There was no pre-existing integration suite in this lab. No production seams,
exports, dependency additions, or mock implementations are required. Assertions
use public protocol fields, actual pixels, and independently queried X11 state.
The earlier ten checks passed against `native-stream-lab-asan2` at
`http://127.0.0.1:18095` on 2026-10-27 UTC, with the native executable built
using address and undefined-behavior sanitizers. Graceful shutdown produced no
ASAN, UBSAN, or LeakSanitizer diagnostic. See
`results/integration-sanitize2.json` and `results/sanitize2.log` for evidence.
The metrics check reads counters without changing cgroups. System libraries are
not instrumented; these checks do not substitute for fuzzing or a long soak.
The two pipeline checks were added afterward; their validation results must be
read from the current run's `results/integration.json`, not the earlier report.
The pipeline credit test intentionally fails a stop-and-wait server because one
valid ACK permits only one subsequent frame there. The raw receiver never claims
to decode video; the separate changing-pixel check owns decoder validity.

Earlier failed reports are retained. They exposed two test setup defects:
Tk's logical entry focus differed from XGetInputFocus until the fixture explicitly
focused its mapped entry; Chrome's local network guard blocked synthetic raw
probe pages before their handshakes reached the server. The fixture now sets
native input focus on entry click, and raw contexts grant local network access.
The untrusted-origin page uses HTTPS so that permission is effective. Raw probes
retain console diagnostics and reject browser network-guard failures as evidence.

Limits: these are local CPU/Chrome functional checks, not throughput, latency,
memory-soak, keyboard-layout, or physical-presentation measurements. Closing the
viewer also permits its unload/blur cleanup, so the disconnect case checks the
end-to-end guarantee rather than proving which cleanup layer released controls.
The raw stalled receiver has no browser input cleanup and separately proves
server-side held-control cleanup on timeout.

## Framework integration

Run `TEST_CONTAINER=<container> TEST_URL=http://127.0.0.1:18094 rtk proxy node tests/framework-integration.mjs`
against a dedicated container with the framework endpoints implemented. It uses
the actual SDK and server without a mock: PNG signature and independently known
Tk pixels before and after a desktop change without a viewer, acknowledged input
observed in Tk/X11, exclusive ownership in both directions, disconnect release,
the ready envelope and malformed-message closure, Host/Origin rejection, and a
bounded concurrent snapshot burst while real video continues decoding.
Results are saved to `results/framework-integration.json`. Syntax checks alone
do not establish these native behaviors. The burst checks completion and live
video, not a precise native memory bound or sustained snapshot throughput.

## Live game diagnostic

`TEST_CONTAINER=native-doom-final TEST_URL=http://127.0.0.1:18096 TEST_LABEL=final-engine node tests/doom-live-check.mjs` samples ten seconds without a viewer, ten stationary seconds, and fifteen seconds holding turn/fire through the real browser input path. It requires an already-running live game. `node tests/doom-live-check.mjs --self-check` validates resource arithmetic.

It preserves counters, process attribution, drawn-frame counts and screenshots. A changed screenshot and zero decoder errors establish a live visible stream; they do not independently prove every game action or measure input latency. This is one diagnostic per configuration, not a repeated three-engine gaming comparison. Completed release/sanitizer and game evidence is exported in [optimize/evidence](../optimize/evidence/).

## General2b validation

All 12 video/input checks and five framework checks passed in release and ASAN/UBSAN builds. The instrumented server exited zero on SIGTERM with no ASAN, UBSAN or LeakSanitizer diagnostic; linked system libraries were not instrumented. Evidence: `results/integration-general2b.json`, `results/framework-general2b-focus.json`, `results/integration-general2b-asan.json`, `results/framework-general2b-asan.json`, and `results/general2b-asan.log`. Earlier failures are retained: REST error transaction completion needed repair, and the framework input check now waits for independently observed X11 entry focus before typing because ACK means queued input.

`make test-backend` links the real encoder with an injected CPU source and codec libraries, without X11. It checks independently decoded pixels, new-session IDRs, damage order, no idle work, termination and bounded invalid-frame failures. The Docker build runs it with color and flow-policy tests. `npm test` covers SDK behavior separately from native/browser integration.

## Frozen general3 verification

The final congestion-policy correction passed all 12 video/input and five framework checks in both release and ASAN/UBSAN builds. Graceful instrumented termination exited zero without an OOM kill or sanitizer/leak diagnostic. See `results/integration-general3.json`, `results/framework-general3.json`, `results/integration-general3-asan.json`, `results/framework-general3-asan.json`, `results/general3-asan.log` and `results/general3-asan-build.log`. The public CLI returned capabilities and a 1280×720 native PNG with no browser connection (`results/general3-cli.png`). Ten SDK tests pass on Node 22.22.2 and Node 26.12.0 (`results/sdk-node22.log` and `results/sdk-tests.log`).

## Clean desktop release verification

The runnable `native-stream-lab:baseline` image starts plain XFCE; it contains no
benchmark fixture. Both this release and `baseline-asan` passed all 12 video/input
checks and five framework checks using Node 22.22.2. The updated framework check
takes a public SDK snapshot while the viewer holds Shift, checks independent X11
key state and PNG pixels, then verifies continued streaming. Both servers exited
zero on graceful termination, with no reported sanitizer diagnostics.

Evidence: `results/baseline-verification.json`, `results/integration-baseline-release.json`,
`results/integration-baseline-asan.json`, `results/framework-final-sdk.json`,
`results/framework-final-sdk-asan.json`, and `results/baseline-asan.log`.
`results/binary-equivalence.json` proves the native executable and installed
package database are identical to the general3 comparison image. An additional
real runner invocation explicitly copied its fixture before boot and passed
(`results/baseline-fixture-smoke.json`). These packaging checks are not extra
independent performance repetitions.

The local package was installed into a separate consumer without network access;
bare imports and the installed CLI were exercised on Node 22 and Node 26.
`results/package-smoke.json` records that check and the TypeScript consumer check.
With an installed TypeScript compiler, run:

```sh
tsc --noEmit --strict --module NodeNext --target ES2022 tests/sdk-types.mts
```

The compiler check validates public package/type resolution and rejects invalid
input shapes; it does not contact a desktop. Real Thunar and Freedoom comparisons
are described in `qualification/` and reported separately from these contract tests.

## Remote cursor verification

Run `TEST_CONTAINER=<dedicated-container> TEST_URL=<local-url> npm run test:cursor`
against a clean image with the pinned XFCE/Thunar environment. This opens the real
file manager, reads its actual cursor through an independent Xlib/XFixes observer,
and compares browser-rendered pixels, alpha, dimensions and hotspot placement.
It checks arrow, text and resize shapes, half-size desktop scaling, reconnect,
leaving the desktop, video-credit exhaustion and five malformed wire cases.
No test application supplies the expected cursor image.

The old baseline failed because no remote cursor was rendered. The cursor update
passed all 13 checks in release and ASAN/UBSAN builds, plus the existing 12 video
and five framework checks in each build. Both instrumented and release servers
exited zero; no sanitizer diagnostics were reported. Local receipts are
`results/cursor-before.json`, `results/cursor-release.json`,
`results/cursor-asan.json` and `results/cursor-verification.json`.
The live desktop's arrow, text and resize screenshots are in
`results/cursor-live-*.png`; its deployed executable and viewer hashes match the
tested release. Existing performance reports describe the earlier frozen build;
the benchmark matrix was not rerun for this cursor change.
