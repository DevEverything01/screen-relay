# relay

Relay streams a Linux or macOS desktop to a browser and lets people and agents control it from the `relay` CLI, a Node SDK, or an HTTP and WebSocket API.

## Quickstart

On a Debian, Ubuntu, Fedora, Arch, or Alpine VM, from a clone of this repository:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
relay up -d
```

`relay up` starts a virtual display, the desktop, and the engine, then prints a viewer link. Open it in a browser with H.264 WebCodecs: current Chrome, Edge, or Safari.

The engine listens on `127.0.0.1:8080`, so from your laptop, forward the port first:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

On a Mac, `./install.sh` and `relay up -d` attach to the display you are logged in to. See the [macOS page](https://relay.labs.vercel.dev/docs/macos).

For Wayland:

```sh
./install.sh --backend wayland
relay up -d --backend wayland
```

## Documentation

Install options, the CLI reference, configuration, remote access, Docker, agent skills, the Node SDK, and troubleshooting are at https://relay.labs.vercel.dev. The engine also runs on Windows; see the Windows page there.

## Contributing

To work on relay itself, see [CONTRIBUTING.md](CONTRIBUTING.md).
