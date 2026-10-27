# native-stream

Stream a Linux X11 desktop to a browser, and control it from the command line.

## Quickstart

On a Debian/Ubuntu VM or sandbox, from this directory:

```sh
./install.sh
native-stream up
```

`up` prints a viewer link. Open it in a browser with H.264 WebCodecs (Chrome, Edge, Safari). From your laptop, tunnel first:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Docker:

```sh
docker build -t native-stream .
docker run --init --rm --shm-size=512m -p 127.0.0.1:8080:8080 native-stream
```

See [Docker](docs/docker.md).

## Remote access

Behind an HTTPS gateway or proxy:

```sh
native-stream up -d --public https://desktop.example.com
```

`--public` binds `0.0.0.0`, generates a token and expects a TLS proxy in front. Use `--tls-cert` and `--tls-key` for native TLS. See [Remote access](docs/remote-access.md).

## Agent control

```sh
native-stream snapshot screen.png
native-stream click 0.5 0.5
native-stream type "hello"
native-stream key ctrl+l
native-stream status --json
native-stream down
```

Coordinates are 0 to 1. See the [CLI reference](docs/cli.md) and the [agent skill](skills/native-stream/SKILL.md).

## Limits

| Area | Limit |
| --- | --- |
| Display server | X11 only. Wayland is planned behind the same interfaces. |
| Resolution | 1280x720, fixed. No resize. |
| Control | One controller at a time: a browser viewer or one agent. Snapshots work any time. |
| Not supported | Audio, clipboard, IME, relative pointer, hardware encoding |
| Auth | One shared token per session. No multi-user identity. |
| Install | `install.sh` supports apt (Debian/Ubuntu). Verified on Ubuntu 24.04 ARM64, Ubuntu 26.04 x86_64 and Debian trixie. |

Experimental. Not tested on other distributions, WAN links or long runs.

## Docs

| Page | Contents |
| --- | --- |
| [CLI reference](docs/cli.md) | Every command and flag |
| [Remote access](docs/remote-access.md) | SSH tunnel, TLS proxy, native TLS, tokens |
| [Docker](docs/docker.md) | Build and run the image |
| [Troubleshooting](docs/troubleshooting.md) | Symptom, cause, fix |
| [Architecture](docs/architecture.md) | Pipeline, folders, adding a backend |
| [Protocol](docs/protocol.md) | Wire format and HTTP endpoints |
| [Node SDK](docs/sdk.md) | Library for Node 22+ |
| [Tests](tests/README.md) | Running each test layer |
| [Experiments](experiments/README.md) | Benchmarks and reports (not part of the engine) |
