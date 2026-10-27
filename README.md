# Native Stream

Stream a Linux desktop to a browser, or control it through a Node SDK and CLI.
The engine captures **X11 at 1280×720**, encodes H.264, and forwards keyboard,
mouse and cursor updates. **Docker and XFCE are optional.**

[Start](#start) · [Connect remotely](#connect-remotely) · [Agent control](#agent-control) · [Tests](#tests-and-evidence) · [Limits](#limits) · [File map](#file-map)

## Start

Copy this directory into a compatible **Debian/Ubuntu Linux VM or sandbox**, then:

```sh
./install.sh --desktop
~/.local/bin/native-stream-desktop
```

1. The installer installs dependencies, builds, and installs into `~/.local`.
   It needs root or noninteractive sudo for apt.
2. The launcher starts an isolated Xvfb/XFCE desktop and prints the viewer URL,
   display and log location. **Ctrl-C stops that session.**

Open **http://127.0.0.1:8080** from a browser on that machine, or connect remotely
below. Use a browser with H.264 WebCodecs support. The engine runs on Linux;
your browser can run on your work laptop.

| Already have… | Use |
| --- | --- |
| An X11 desktop | `./install.sh`, then `DISPLAY=:0 XAUTHORITY=/path/to/Xauthority ~/.local/bin/native-stream-engine` |
| System dependencies installed | `./install.sh --no-deps`; desktop dependencies must also be present to launch a new desktop |
| Another desktop/window manager | Launcher `--session 'openbox'`, or `--no-desktop` for Xvfb only |
| A coding agent | Copy [skills/native-stream](skills/native-stream/SKILL.md) into its supported skills directory |

The engine attaches to an existing display without owning its lifetime.
The optional launcher creates and supervises a new display.

Full instructions: [installation and compatibility](docs/portable.md).

## Connect remotely

For an SSH-accessible VM, run this **on your laptop**:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Then open **http://127.0.0.1:8080** on your laptop.

For a public HTTPS endpoint, configure a private token plus native TLS or a trusted
TLS gateway. Follow [authenticated remote access](docs/portable.md#authenticated-remote-access);
the [Vercel Sandbox recipe](docs/portable.md#vercel-sandbox-example) uses that same path.
Vercel itself has not been tested end to end.

### Optional Docker setup

```sh
docker build -t native-stream-lab:standalone .
docker run --name native-stream-lab --cpus=2 --memory=1536m \
  --memory-swap=1536m --shm-size=512m \
  -p 127.0.0.1:18094:8080 native-stream-lab:standalone
```

Open **http://127.0.0.1:18094**. This recipe starts a clean XFCE desktop and uses
the unauthenticated `--insecure-local` development profile. Keep the published
port on host loopback: anyone who can reach it can observe and control the desktop.

## Agent control

Requires **Node 22+**. From a consumer project, install the local package:

```sh
npm install /absolute/path/to/native-stream-lab
```

```js
import { connect } from 'native-stream-lab';

const desktop = await connect({ url: 'http://127.0.0.1:8080' });
try {
  await desktop.input({ type: 'pointerMove', x: 0.5, y: 0.5 });
  await desktop.snapshot('screen.png');
} finally {
  desktop.close();
}
```

From this repository, the CLI needs no npm runtime dependencies:

```sh
node sdk/cli.js capabilities
node sdk/cli.js snapshot screen.png
```

Set `NATIVE_STREAM_URL` for another endpoint; remote authentication uses
`NATIVE_STREAM_TOKEN_FILE`.

- **One controller:** close the browser viewer before acquiring SDK input control.
- **Snapshots:** independent PNG snapshots also work while the viewer is connected.
- **Input:** coordinates use 0–1; keys use USB HID usages. ACK means submitted,
  not application completion. Reconnect does not replay input.

See [SDK methods, types, errors and CLI commands](docs/framework-api.md).

## Tests and evidence

For local SDK checks:

```sh
npm ci --ignore-scripts
npm test
```

| Check | Where to go |
| --- | --- |
| Native Linux VM, without Docker | [Verification summary](docs/portable-verification.md) · [Rerun instructions](docs/portable.md#repeat-the-non-docker-verification) |
| Browser, input, framework and cursor tests | [Test guide](tests/README.md) |
| Native color, flow and backend suites | `make test` ([Makefile](Makefile)) |
| Performance results and explanations | [HTML report](experiments/engine-evaluation/optimize/general-engine-report.html) · [Markdown report](experiments/engine-evaluation/optimize/general-engine-report.md) |
| Benchmark workloads and reproduction | [Qualification guide](experiments/engine-evaluation/qualification/README.md) |
| Keyboard-controlled game demo | [Freedoom](experiments/engine-evaluation/doom/README.md) |

The recorded portable verification passed **10/10 scenarios in each of release
and ASAN/UBSAN builds on Ubuntu 24.04 ARM64**, plus **11 SDK tests**. The optional
Docker compatibility run passed 12 video/input, 5 framework and 13 cursor checks.
See the linked receipts for scope and environment; system libraries were not
sanitizer-instrumented.

Performance reports describe earlier frozen builds. Later correctness checks
are separate evidence; the performance matrix was not rerun for the portable changes.

## Limits

| Area | Current contract |
| --- | --- |
| Display | X11, fixed 1280×720, CPU capture/encoding; no Wayland or resize |
| Streaming | Targets up to 60 FPS; actual delivery depends on workload and network |
| Control | One browser **or** agent controller; mapped keyboard subset |
| Missing features | Audio, clipboard, IME, relative pointer, remote pointer-warp sync, hardware encoding |
| Authentication | One shared token per engine; no multi-tenant identity/authorization |
| Still unverified | Other architectures/distributions, provider gateways, WAN reliability, long-duration production use |

This is an experimental engine, not a production-readiness claim. External
AT-SPI/CDP automation tools are optional and their integration has not been verified.

## File map

```text
src/
  core/            Backend-agnostic pipeline: capture/input interfaces, encoder, color, flow control
  server/          HTTP/WebSocket transport, snapshots, engine entry point
  backends/x11/    X11 capture (XDamage, MIT-SHM, XFixes) and XTest input
viewer/            Browser decoding, rendering, cursor and human input
sdk/               Node client, TypeScript types, CLI
scripts/           Desktop launcher and the Docker image entrypoint
tests/unit/        Native C++ checks (`make test`) and the SDK type check
tests/integration/ Browser, framework, cursor and portable checks against a real desktop
docs/              Design, contracts and setup guides
skills/            Coding-agent setup instructions
experiments/       Benchmarks, comparisons, reports and retired prototypes (not part of the engine)
```

| Path | Start with |
| --- | --- |
| [src/](src/) | [Backend interfaces](docs/backends.md) |
| [tests/](tests/README.md) | Test guide |
| [docs/](docs/engineering.md) | Engineering and extension rules |
| [experiments/](experiments/README.md) | Index of qualification runs, reports, the Selkies/Kasm harness and exp-001 |

The build selects one backend at compile time: `make BACKEND=x11` (the default
and only backend today). A new backend adds `src/backends/<name>/` and its
pkg-config modules in the [Makefile](Makefile); see [backend interfaces](docs/backends.md#future-wayland-work).

For engine work: [backend interfaces](docs/backends.md) ·
[flow control](docs/flow-control.md) · [wire/build contract](docs/build-contract.md) ·
[native design](docs/native-design.md).
