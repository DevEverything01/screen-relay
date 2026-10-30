# Tests

Use disposable desktops. New results go to `tests/results/` (untracked).

Run `npm test` for the TypeScript unit tests; it builds `dist/` first. `make test` runs the native ones.

| Layer | Command | Needs |
| --- | --- | --- |
| Native unit (color, flow, the input controller with a fake backend, server config/wire/metrics, injected source through the real encoder) | `make test` | Build dependencies, including FFmpeg dev libraries for `test-backend`. No X11. |
| Protocol golden bytes, key combos, config validation, SDK, viewer ACK | `npm ci && npm test` | Node 20 or newer |
| SDK types | `tsc --noEmit --strict --module NodeNext --target ES2022 tests/unit/sdk-types.mts` | TypeScript |
| Smoke | `tests/smoke.sh` | An installed `relay` on Linux. It starts and stops its own session on port 18090 (`SMOKE_PORT`). |

The smoke test starts a session, takes a screenshot, opens `xterm` (installing it with apt when missing), clicks and types into it, checks the text arrived, starts apps with `run` and `--restart`, then stops the session and checks nothing is left running.
