# Remote access

The default listener is `127.0.0.1` with no token. Anyone who holds the token can see and control the desktop. One token per session, no user identity.

## SSH tunnel

Run on your laptop:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Open `http://127.0.0.1:8080`. No token needed.

## Behind a TLS proxy

Use this for any gateway that terminates HTTPS and forwards to the VM (a cloud sandbox port, nginx, Caddy, a tunnel).

```sh
relay up -d --public https://desktop.example.com
```

`--public` binds `0.0.0.0`, generates a token, and accepts only that origin. The engine serves plain HTTP and expects the proxy to terminate TLS; `up` prints `Expects a TLS proxy in front: ...` as a reminder. Run it only where the port is reachable just by the proxy. `up` prints the viewer link with the token in the URL fragment.

The proxy must:

- forward `/`, `/viewer.js`, `/stream`, `/control`, `/input`, `/screenshot.png`, `/capabilities`, `/metrics` with no path prefix
- forward WebSocket upgrades over HTTP/1.1
- keep the `Host`, `Origin` and `Authorization` headers and the WebSocket subprotocol header unchanged
- not log `Authorization` or the subprotocol header (the token travels in both)

The engine reads no `X-Forwarded-*` headers.

## Native TLS

```sh
relay up -d --tls-cert fullchain.pem --tls-key key.pem --public https://desktop.example.com
```

The engine serves HTTPS itself, so `up` prints no TLS proxy line. Use a certificate your clients trust, with a hostname matching the public URL. Native TLS speaks HTTP/1.1 only; clients that negotiate HTTP/2 must fall back. Client commands on the same machine trust the session's certificate file without a hostname check.

## Tokens

- 256 random bits, 64 lowercase hex characters, from `secrets.token_hex(32)`. A token is generated when the bind address is not `127.0.0.1` or `--public` is set.
- Stored in `<state dir>/token`, mode 0600 (the path is `tokenFile` in `status --json`). The engine refuses a token file that is not owned by its user or that others can read.
- `up` prints the token once. `status` hides it unless `--show-token`.
- The viewer reads `#token=...` from the link, removes it from the address bar with `history.replaceState`, then connects. It uses the token only on `https://` or loopback pages. Fragments are not sent to servers.
- HTTP clients send `Authorization: Bearer TOKEN`. WebSocket clients offer the subprotocols `nsl1` and `bearer.TOKEN`. The token is never put in a request URL.

Each `up` generates a new token. Rotate by running `relay down` then `up` again; existing connections end.

## Client from your laptop

Install the CLI with `./install.sh --client-only`. Copy the token from the VM (`relay status --show-token`) into a file, then:

```sh
export RELAY_URL=https://desktop.example.com
export RELAY_TOKEN_FILE=./token
relay status
relay screenshot screen.png
```

Remote plain HTTP is refused. Redirects are not followed. Rules and flags: [CLI reference](cli.md#client-target).

## Checks

| Request | Result |
| --- | --- |
| Wrong or missing token | HTTP 401; WebSocket handshake rejected |
| `Host` that is not loopback or the public URL's host | HTTP 403 |
| Browser `Origin` that is not loopback (with a loopback `Host`) or the public URL | HTTP 403 |
| Non-loopback bind without a token | Engine refuses to start |
