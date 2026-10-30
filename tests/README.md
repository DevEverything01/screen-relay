# Tests

Use disposable desktops. Integration tests send real input and cover the screen. New results go to `tests/results/` (untracked).

Run `npm run build` before the SDK types, framework, or portable tests.

| Layer | Command | Needs |
| --- | --- | --- |
| Native unit (color, flow, the input controller with a fake backend, server config/wire/metrics, injected source through the real encoder) | `make test` | Build dependencies, including FFmpeg dev libraries for `test-backend`. No X11. |
| Config loader | `python3 -m unittest discover -s tests/unit -p 'test_*.py'` | Python 3 with PyYAML (`python3-yaml`). |
| SDK | `npm ci --ignore-scripts && npm test` | Node 22+ |
| SDK types | `tsc --noEmit --strict --module NodeNext --target ES2022 tests/unit/sdk-types.mts` | TypeScript |
| Smoke | `tests/smoke.sh` | An installed `relay` on Linux. It starts and stops its own session on port 18090 (`SMOKE_PORT`). |
| Browser video and input | `TEST_CONTAINER=<name> TEST_URL=http://127.0.0.1:8080 npm run test:integration` | Chrome, a container from this repo's image with test tools added (see below) |
| SDK against a real desktop | `TEST_CONTAINER=<name> TEST_URL=... npm run test:framework` | Same |
| Remote cursor | `TEST_CONTAINER=<name> TEST_URL=... npm run test:cursor` | Same, on a fresh container with no windows open |
| Native Linux VM, no Docker | see below | SSH to a disposable VM, Chrome |

The integration tests inspect decoded pixels, real X11 key and pointer state and held-input release. An input ACK alone is not treated as proof. They do not measure throughput, latency or soak behavior.

The Docker runners read the display, Xauthority and token from `relay status --show-token --json` inside the container. The image leaves out test-only tools, so add them first:

```sh
docker build -t relay:test .
docker run -d --name relay-test -p 127.0.0.1:8080:8080 relay:test
docker exec -u root relay-test sh -c 'apt-get update && apt-get install -y --no-install-recommends python3-tk xdotool'
```

The config loader needs PyYAML, which the macOS Python usually lacks. Run it in Docker:

```sh
docker run --rm -v "$PWD":/src -w /src debian:trixie-slim sh -c 'apt-get update -qq && apt-get install -y -qq python3 python3-yaml >/dev/null && python3 -m unittest discover -s tests/unit -p "test_*.py"'
```

## Native VM run

```sh
TEST_SSH_CONFIG=/path/to/ssh.config TEST_SSH_TARGET=my-test-vm \
  TEST_REMOTE_ROOT=/home/test/relay-src \
  npm run test:portable
```

Install the source on the VM first (`./install.sh`; the input fixture also needs `python3-tk`, the TLS test needs `openssl`). The runner writes `tests/results/portable/verification.json`.

Earlier verification results are kept outside the repository.
