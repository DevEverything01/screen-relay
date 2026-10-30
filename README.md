# relay

Stream a Linux X11 desktop to a browser, and control it from the command line.

## Quickstart

On a Debian/Ubuntu VM or sandbox, from this directory:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
relay up
```

`install.sh` puts `relay` in `~/.local/bin`, which a fresh shell often does not have on `PATH`. `up` prints a viewer link. Open it in a browser with H.264 WebCodecs (Chrome, Edge, Safari). From your laptop, tunnel first:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Docker:

```sh
docker build -t relay .
docker run --rm -p 127.0.0.1:8080:8080 relay
```

The viewer link with its token is in the container output. See [Docker](docs/docker.md).

## Config

`relay up` reads `~/.config/relay/config.yaml` when it exists, or a file named by `--config FILE` or `$RELAY_CONFIG`. Every key is optional: the defaults are 1280x720 at 60 fps. A bad file stops `up` with an error naming the key, and changes apply on the next `relay up`. See [Config](docs/config.md).

## Remote access

Behind an HTTPS gateway or proxy:

```sh
relay up -d --public https://desktop.example.com
```

See [Remote access](docs/remote-access.md) for what `--public` does, native TLS and tokens.

## Agent control

```sh
relay screenshot screen.png
relay click 0.5 0.5
relay type "hello"
relay key ctrl+l
relay status --json
relay down
```

Coordinates are 0 to 1. See the [CLI reference](docs/cli.md) and the [agent skill](skills/relay/SKILL.md).

## Limits

| Area | Limit |
| --- | --- |
| Display server | X11 only. Wayland is planned behind the same interfaces. |
| Resolution | Up to 1920x1080, set in the config ([Config](docs/config.md)). No live resize. |
| Control | One controller at a time: a browser viewer or one agent. Screenshots work any time. |
| Not supported | Audio, clipboard, IME, relative pointer, hardware encoding |
| Auth | One shared token per session. No multi-user identity. |
| Install | The engine installs on Linux only, and automatic dependencies need apt (Debian/Ubuntu). `--client-only` installs the CLI on any OS with Node 20 or newer. |

Experimental. The v1 CLI was verified in two places. On a fresh Vercel Sandbox (Ubuntu 26.04 x86_64): install, `up -d --public`, the viewer link, remote screenshot, click, type and key, `busy` while a viewer is open, `tests/smoke.sh` passing, and a clean `down`. In Docker (Debian trixie arm64), as non-root and as root. Earlier Ubuntu 24.04 ARM64 results came from the previous launcher. Not tested on other distributions, WAN links or long runs.

## Docs

| Page | Contents |
| --- | --- |
| [CLI reference](docs/cli.md) | Every command, flag, output and error code |
| [Config](docs/config.md) | File location, keys, defaults, precedence |
| [Remote access](docs/remote-access.md) | SSH tunnel, TLS proxy, native TLS, tokens |
| [Docker](docs/docker.md) | Build and run the image |
| [Troubleshooting](docs/troubleshooting.md) | Symptom, cause, fix |
| [Architecture](docs/architecture.md) | Pipeline, folders, adding a backend |
| [Protocol](docs/protocol.md) | Wire format and HTTP endpoints |
| [Node SDK](docs/sdk.md) | Library for Node 20+ (control sessions need Node 22+) |
| [Tests](tests/README.md) | Running each test layer |
