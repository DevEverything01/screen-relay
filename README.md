# relay

Stream a Linux X11 desktop to a browser, and control it from the command line.

## Quickstart

On a Debian/Ubuntu VM or sandbox, from this directory:

```sh
./install.sh
export PATH="$HOME/.local/bin:$PATH"
relay up
```

`install.sh` installs `relay` in `~/.local/bin`, which a fresh shell often does not have on `PATH`. `up` prints a viewer link. Open it in a browser with H.264 WebCodecs (Chrome, Edge, Safari). From your laptop, tunnel first:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Docker:

```sh
docker build -t relay .
docker run --rm -p 127.0.0.1:8080:8080 relay
```

The viewer link with its token is in the container output.

## Docs

Read the [documentation](https://relay.vercel.app/docs) for installation, the CLI reference, configuration, remote access, Docker, agent skills, the Node SDK, the protocol, architecture, and troubleshooting.

The test layers are described in [tests/README.md](tests/README.md).
