# Tests

Use disposable desktops. Integration tests send real input and cover the screen. New results go to `tests/results/` (untracked). Older receipts are in [experiments/engine-evaluation/test-receipts](../experiments/engine-evaluation/test-receipts/).

| Layer | Command | Needs |
| --- | --- | --- |
| Native unit (color, flow, injected source through the real encoder) | `make test` | Build dependencies. No X11. |
| SDK | `npm ci --ignore-scripts && npm test` | Node 22+ |
| SDK types | `tsc --noEmit --strict --module NodeNext --target ES2022 tests/unit/sdk-types.mts` | TypeScript |
| Smoke, any target | `tests/smoke.sh` | A running `native-stream up` session |
| Browser video and input | `TEST_CONTAINER=<name> TEST_URL=http://127.0.0.1:8080 npm run test:integration` | Chrome, Docker container, Python/Tk in it |
| SDK against a real desktop | `TEST_CONTAINER=<name> TEST_URL=... npm run test:framework` | Same |
| Remote cursor | `TEST_CONTAINER=<name> TEST_URL=... npm run test:cursor` | Clean XFCE image with Thunar |
| Native Linux VM, no Docker | see below | SSH to a disposable VM, Chrome |

The integration tests inspect decoded pixels, real X11 key and pointer state and held-input release. An input ACK alone is not treated as proof. They do not measure throughput, latency or soak behavior.

## Native VM run

```sh
TEST_SSH_CONFIG=/path/to/ssh.config TEST_SSH_TARGET=my-test-vm \
  TEST_REMOTE_ROOT=/home/test/native-stream-src \
  npm run test:portable
```

Install the source on the VM first (`./install.sh`; the input fixture also needs `python3-tk`, the TLS test needs `openssl`). The runner writes `tests/results/portable/verification.json`.

## Recorded results

Ubuntu 24.04 ARM64 VM, no Docker, 2026-10-27. Receipts: [release](../experiments/engine-evaluation/test-receipts/portable/release/verification.json), [sanitizer](../experiments/engine-evaluation/test-receipts/portable/sanitizer/verification.json).

| Suite | Result |
| --- | --- |
| Portable scenarios, release build | 10/10 |
| Portable scenarios, ASAN/UBSAN build | 10/10, no sanitizer reports |
| SDK tests | 11/11 |
| Native unit suites | pass |
| Docker run: video/input, framework, cursor | 12, 5 and 13 checks pass |

The 10 scenarios: XFCE and Xvfb-only displays, port conflict, attach to an existing display, SDK pixels and input, browser decode and input, refusal of a public bind without a token, native TLS with credentials and origin checks, browser HTTPS with a wrong token rejected, a TLS-terminating proxy in front, and stopping one session while another runs.

Not verified: other distributions and architectures, cloud sandbox gateways, Wayland, WAN, long runs. System libraries were not sanitizer-instrumented. Performance reports describe earlier builds and were not rerun.
