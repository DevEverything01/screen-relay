# Native integration check

Run against an already started native container; this test never builds, starts,
stops, or deletes a container:

```sh
TEST_CONTAINER=<native-container-name> TEST_URL=http://127.0.0.1:18094 rtk proxy node tests/integration.mjs
```

Requires installed Google Chrome, the sibling `desktop-stream-bench` Playwright
installation, Docker access, and Python/Tk with X11 in the container. The fixture
temporarily covers the 1280×720 desktop, so run outside benchmark measurement.
Its process is terminated in `finally`; uniquely named fixture/state files remain
in the container as evidence. JSON reports and screenshots remain in `results/`.

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

There was no pre-existing integration suite in this lab. No production seams,
exports, dependency additions, or mock implementations are required. Assertions
use public protocol fields, actual pixels, and independently queried X11 state.
The final ten checks passed against `native-stream-lab-asan2` at
`http://127.0.0.1:18095` on 2026-10-27 UTC, with the native executable built
using address and undefined-behavior sanitizers. Graceful shutdown produced no
ASAN, UBSAN, or LeakSanitizer diagnostic. See
`results/integration-sanitize2.json` and `results/sanitize2.log` for evidence.
The metrics check reads counters without changing cgroups. System libraries are
not instrumented; these checks do not substitute for fuzzing or a long soak.

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

## Live game diagnostic

`TEST_CONTAINER=native-doom-final TEST_URL=http://127.0.0.1:18096 TEST_LABEL=final-engine node tests/doom-live-check.mjs` samples ten seconds without a viewer, ten stationary seconds, and fifteen seconds holding turn/fire through the real browser input path. It requires an already-running live game. `node tests/doom-live-check.mjs --self-check` validates resource arithmetic.

It preserves counters, process attribution, drawn-frame counts and screenshots. A changed screenshot and zero decoder errors establish a live visible stream; they do not independently prove every game action or measure input latency. This is one diagnostic per configuration, not a repeated three-engine gaming comparison. Completed release/sanitizer and game evidence is exported in [optimize/evidence](../optimize/evidence/).
