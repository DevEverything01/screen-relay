# Tests

See the [relay documentation](https://relay.labs.vercel.dev/docs) for installation and usage.

Use disposable desktops. New results go to `tests/results/` (untracked).

Run `npm test` for the TypeScript unit tests; it builds `dist/` first. `make test` runs the native ones.

| Layer | Command | Needs |
| --- | --- | --- |
| Native unit (color, flow, the input controller with a fake backend, server config/wire/metrics, injected source through the real encoder) | `make test` | Build dependencies, including FFmpeg dev libraries for `test-backend`. No X11. |
| Protocol golden bytes, key combos, config validation, SDK, viewer ACK | `npm ci && npm test` | Node 26 or newer |
| SDK types | `tsc --noEmit --strict --module NodeNext --target ES2022 tests/unit/sdk-types.mts` | TypeScript |
| Smoke | `tests/smoke.sh` | An installed `relay` on Linux. It starts and stops its own session on port 18090 (`SMOKE_PORT`). |
| Viewer end to end | `npm run test:e2e` | Docker, and Chrome or Chromium for `agent-browser` (once: `./node_modules/.bin/agent-browser install`). It runs in its own agent-browser session, builds `relay-e2e` (or uses `RELAY_E2E_IMAGE`), starts its own container, and removes the container and the browser afterwards. |

The smoke test starts a session, takes a screenshot, opens `xterm` (installing it with apt when missing), clicks and types into it, checks the text arrived, starts apps with `run` and `--restart`, then stops the session and checks nothing is left running.
