# screen-relay

screen-relay streams a Linux or macOS desktop to a browser and lets people and agents control it from the `screen-relay` CLI, a Node SDK, or an HTTP and WebSocket API.

## Quickstart

On a Debian, Ubuntu, Fedora, Arch, or Alpine VM, or on a Mac, with Node 22 or newer:

```sh
npm install -g screen-relay
screen-relay up -d
```

On a terminal, the first `screen-relay up` asks before it installs system packages. It then starts a virtual display, the desktop, and the engine, and prints a viewer link. Open it in a browser with H.264 WebCodecs: current Chrome, Edge, or Safari.

The engine listens on `127.0.0.1:8080`, so from your laptop, forward the port first:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

On a Mac, `screen-relay up -d` attaches to the display you are logged in to. See the [macOS page](https://relay.labs.vercel.dev/docs/macos).

For Wayland:

```sh
screen-relay up -d --backend wayland
```

## Documentation

Install options, the CLI reference, configuration, remote access, Docker, agent skills, the Node SDK, and troubleshooting are at https://relay.labs.vercel.dev. The engine also runs on [Windows](https://relay.labs.vercel.dev/docs/windows).

## Contributing

To work on screen-relay itself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

screen-relay is licensed under [Apache-2.0](LICENSE). The engine links x264, which is licensed under GPL-2.0-or-later, from your system when `screen-relay install` builds it. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
