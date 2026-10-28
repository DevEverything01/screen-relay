# Docker

The `Dockerfile` builds on `debian:trixie-slim` with the same `install.sh` as a VM, runs the unit tests, and installs into `/usr/local`. The container runs as the non-root user `stream`. The entrypoint is `tini -- relay up --bind 0.0.0.0`: tini reaps child processes, and `relay up` runs in the foreground as the supervisor.

```sh
docker build -t relay .
docker run -d --name desk -p 127.0.0.1:8080:8080 relay
docker logs desk
```

`docker logs` shows the viewer link with the token (shortened here):

```text
relay "default" is ready
  url:     http://127.0.0.1:8080
  viewer:  http://127.0.0.1:8080/#token=<64 hex>
  token:   <64 hex>  (shown once; status --show-token prints it again)
  display: :0
  logs:    /home/relay/.local/state/relay/default
Listening on 0.0.0.0:8080; reach it through a loopback port publish or SSH tunnel.
Stop with Ctrl-C or `relay down`.
```

Open the viewer link. If you publish a different host port, change the port in the link. To print the token again: `docker exec desk relay status --show-token`.

`docker run` needs no extra flags. tini is already the entrypoint, so `--init` is not needed. The default 64 MB `/dev/shm` is enough: MIT-SHM capture uses SysV shared memory, not `/dev/shm`. `docker stop` shuts the session down cleanly.

## Bind and publish

| Side | Address | Why |
| --- | --- | --- |
| Container | `0.0.0.0:8080` | The published port must reach the engine. A non-loopback bind always generates a token. |
| Host | `-p 127.0.0.1:8080:8080` | Publish on host loopback only. |

The engine accepts only a loopback `Host` (`127.0.0.1` or `localhost`) unless it runs with `--public`, and the viewer uses the link's token only on `https://` or loopback pages. So `-p 8080:8080` does not make the desktop usable from the network; it only exposes the port. For remote use, put a [TLS proxy](remote-access.md) in front. Arguments after the image name are added to `up`:

```sh
docker run -d --name desk -p 127.0.0.1:8080:8080 relay --public https://desk.example.com
```

To run as root, add `--user root`. State then lives in `/root/.local/state/relay/`.

## Control from the host

Inside the container, client commands find the session on their own:

```sh
docker exec desk relay snapshot - > screen.png
docker exec desk relay click 0.5 0.5
```

The CLI on the host needs the URL and the token, because the container's `0.0.0.0` bind generated one. Setting only `RELAY_URL` fails with `unauthorized`.

```sh
docker exec desk sh -c 'cat ~/.local/state/relay/default/token' > token
export RELAY_URL=http://127.0.0.1:8080
export RELAY_TOKEN_FILE=$PWD/token
relay status
relay snapshot screen.png
```

The host CLI can be installed with `./install.sh --client-only`. The token file is only read by the client, so its mode does not matter there. A new container generates a new token.
