# relay

Relay streams a Linux desktop to a browser and lets people and agents control it from the `relay` command line, a Node SDK, or an HTTP and WebSocket API.

## Quickstart

On a Debian or Ubuntu VM, from a clone of this repository:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
relay up
```

`relay up` prints a viewer link. Open it in a browser with H.264 WebCodecs (Chrome, Edge, or Safari). From your laptop, forward the port first:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Control the desktop from the VM:

```sh
relay screenshot screen.png
relay click 0.5 0.5
relay type "hello"
```

To use Docker instead:

```sh
docker build -t relay .
docker run --rm -p 127.0.0.1:8080:8080 relay
```

The container prints the viewer link with its token.

## Documentation

Installation, the CLI reference, configuration, remote access, Docker, agent skills, the Node SDK, and troubleshooting are at https://relay.labs.vercel.dev.
