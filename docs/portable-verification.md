# Portable engine verification — 2026-10-27

The engine was built, installed and exercised **directly in an Ubuntu 24.04 ARM64
VM**, with Linux 6.8.0-142-generic and systemd as PID 1. The target had no Docker
CLI or `/.dockerenv`; `systemd-detect-virt --container` reported `none` and exited 1.
Lima/Apple Virtualization supplied the test VM, with containerd disabled and no
host-directory mounts. Lima is test infrastructure, not an engine dependency.

The documented `./install.sh --desktop` and `~/.local/bin/native-stream-desktop`
commands installed and started the desktop. Standard SSH forwarding connected
the host browser/SDK to it. The desktop and engine also ran independently.

| Gate | Result |
| --- | --- |
| Native VM release build | 10/10 integration scenarios passed; cleanup passed |
| Native VM ASAN/UBSAN build | 10/10 scenarios passed; no reported sanitizer diagnostics in engine logs; cleanup passed |
| SDK tests | 11/11 passed, including redirect and plaintext credential protections |
| Native color, flow and injected-source/encoder suites | All three passed directly in the VM |
| Optional Docker compatibility | 12 video/input, 5 framework and 13 cursor checks passed in a separate test container |
| Coding-agent skill | Frontmatter/structure validation passed; installed in Codex's skill directory |

The ten VM scenarios exercised:

1. An XFCE desktop and a separate Xvfb-only display with independent credentials.
2. Port-conflict failure without falsely reporting readiness or stopping the original display.
3. Attaching the engine to an existing display, then stopping it without destroying that display.
4. Fresh PNG pixels, actual application text entry, and held-key release through the SDK.
5. Decoded moving browser frames and browser keyboard input reaching the application.
6. Rejection of a public listener without the required security configuration.
7. Native TLS, HTTP credentials, authenticated WSS input, snapshots and rejected credentials/origins.
8. Browser HTTPS streaming, with an incorrect token unable to receive frames.
9. The same engine behind an independent TLS terminator, with authenticated WebSocket video and PNG snapshots.
10. Stopping one managed session while another remains usable.

Evidence:

- [Release receipt](../tests/results/portable/release/verification.json)
- [Sanitizer receipt](../tests/results/portable/sanitizer/verification.json)
- [Actual VM desktop PNG](../tests/results/portable/vm-desktop.png)
- [Initial installation log](../tests/results/portable/native-stream-install.log)
- [Final installation log](../tests/results/portable/native-stream-final-install.log)
- [Native suites log](../tests/results/portable/native-stream-unit.log)

The receipts retain the environment, native binary SHA-256, relevant source
hashes, application observations, timings and cleanup results. Engine logs are
stored beside each receipt. System libraries were not sanitizer-instrumented.
Browser tests trusted only the generated test certificate/key; production needs
its own trusted certificate or provider HTTPS gateway.

The tests exposed an Xvfb display-number pipe race and an occupied-port readiness
race, which were fixed. The cleanup probe initially counted itself and was
corrected. Native TLS now explicitly advertises HTTP/1.1: advertising HTTP/2
exposed an unverified multiplexed-response lifecycle. HTTP/2 is not claimed.

This is evidence for the tested Linux/runtime combination and generic gateway
pattern. **Vercel Sandbox itself, other distributions/architectures, arbitrary
provider gateways, Wayland, WAN reliability and long-duration production operation
were not verified.** The existing performance matrix was not rerun. No release
was published and no deployment was made to an existing application.
