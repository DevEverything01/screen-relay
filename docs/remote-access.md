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
native-stream up -d --public https://desktop.example.com
```

`--public` does four things: binds `0.0.0.0`, generates a token, allows only that browser origin, and trusts the proxy's TLS. Run it only on a private network behind the proxy. `up` prints the viewer link with the token in the URL fragment.

The proxy must:

- forward `/`, `/stream`, `/control`, `/input`, `/snapshot.png`, `/capabilities`, `/metrics` (no path prefix)
- forward WebSocket upgrades over HTTP/1.1
- keep the `Host`, `Origin` and `Authorization` headers and the WebSocket subprotocol header unchanged
- not log `Authorization` or the subprotocol header (the token travels in both)

The engine does not trust arbitrary `X-Forwarded-*` headers.

## Native TLS

```sh
native-stream up -d --tls-cert fullchain.pem --tls-key key.pem --public https://desktop.example.com
```

Use a certificate your clients trust, with a hostname matching the public URL. Native TLS speaks HTTP/1.1 only. Clients that negotiate HTTP/2 must fall back.

## Tokens

- 256 random bits, 64 lowercase hex characters, from `secrets.token_hex(32)`.
- Stored in `<state dir>/token`, mode 0600. The engine rejects a token file that others can read.
- `up` prints the token once. `status` hides it unless `--show-token`.
- The viewer reads `#token=...` from the link, connects, then removes it from the address bar with `history.replaceState`. Fragments are not sent to servers.
- HTTP clients send `Authorization: Bearer TOKEN`. WebSocket clients offer the subprotocols `nsl1` and `bearer.TOKEN`. The token is never put in a request URL.

Rotate by running `native-stream down` then `up` again. The new token replaces the old one and existing connections end.

## Client from your laptop

```sh
export NATIVE_STREAM_URL=https://desktop.example.com
export NATIVE_STREAM_TOKEN_FILE=./token
native-stream status
native-stream snapshot screen.png
```

Remote plain HTTP is refused. Redirects are not followed.

## Checks

| Request | Result |
| --- | --- |
| Wrong or missing token | 401, WebSocket handshake rejected |
| Browser `Origin` that is not the public URL | Rejected |
| `Host` that is not the public URL or loopback | Rejected |
| Public bind without a token | Engine refuses to start |
