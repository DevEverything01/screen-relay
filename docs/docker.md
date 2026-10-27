# Docker

The `Dockerfile` builds with the same `install.sh` as a VM. The entrypoint runs `native-stream up` as a non-root user.

```sh
docker build -t native-stream .
docker run --init --rm --shm-size=512m -p 127.0.0.1:8080:8080 native-stream
```

Open `http://127.0.0.1:8080`. The viewer link and token are in `docker logs`.

| Flag | Why |
| --- | --- |
| `--init` | Reaps child processes (Xvfb, desktop). |
| `--shm-size=512m` | X11 shared-memory capture needs it. |
| `-p 127.0.0.1:8080:8080` | Publish on host loopback only. |

Inside the container the server listens on all interfaces so the published port reaches it. Publishing `-p 8080:8080` exposes the desktop to the host network. Keep the host side on `127.0.0.1` and put a [TLS proxy](remote-access.md) in front for remote use.

Resource limits used in testing: `--cpus=2 --memory=1536m --memory-swap=1536m`.

## Control from the host

```sh
docker exec <container> native-stream snapshot - > screen.png
docker exec <container> native-stream click 0.5 0.5
```

Or run the CLI on the host with `NATIVE_STREAM_URL=http://127.0.0.1:8080`.
