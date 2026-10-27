# Test receipts

Ubuntu 24.04 ARM64 VM, no Docker, 2026-10-27. Receipts: [release](portable/release/verification.json), [sanitizer](portable/sanitizer/verification.json).

| Suite | Result |
| --- | --- |
| Portable scenarios, release build | 10/10 |
| Portable scenarios, ASAN/UBSAN build | 10/10, no sanitizer reports |
| SDK tests | 11/11 |
| Native unit suites | pass |
| Docker run: video/input, framework, cursor | 12, 5 and 13 checks pass |

The 10 scenarios: XFCE and Xvfb-only displays, port conflict, attach to an existing display, SDK pixels and input, browser decode and input, refusal of a public bind without a token, native TLS with credentials and origin checks, browser HTTPS with a wrong token rejected, a TLS-terminating proxy in front, and stopping one session while another runs.

Not verified: other distributions and architectures, cloud sandbox gateways, Wayland, WAN, long runs. System libraries were not sanitizer-instrumented. Performance reports describe earlier builds and were not rerun.

Other files here are saved outputs from earlier integration, sanitizer and cursor runs.
