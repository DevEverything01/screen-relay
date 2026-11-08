# Configuration

The published reference is at https://relay.labs.vercel.dev/docs/configuration.

`relay up` reads `--config FILE`, then `RELAY_CONFIG`, then `${XDG_CONFIG_HOME:-~/.config}/relay/config.yaml` when it exists. A flag beats its `RELAY_*` variable, which beats the file, which beats the default. A missing explicitly selected file, an unknown key, an invalid type or an out-of-range value stops startup before any process starts, and every problem is reported at once.

| Key | Default | Range or meaning | Environment |
| --- | --- | --- | --- |
| `display.resolution` | `1280x720` | `WIDTHxHEIGHT`; even width `320..16384`, even height `240..16384` | `RELAY_RESOLUTION` |
| `stream.fps` | `60` | `10..120` | `RELAY_FPS` |
| `stream.bitrate.min` | `1M` | Bits per second, `250000..100000000`; a `k` or `M` suffix is 1000-based | `RELAY_BITRATE_MIN` |
| `stream.bitrate.start` | `8M` | As above | `RELAY_BITRATE_START` |
| `stream.bitrate.max` | `40M` | As above; require min <= start <= max | `RELAY_BITRATE_MAX` |
| `server.port` | `8080` | `1..65535` | `RELAY_PORT` |
| `server.bind` | `127.0.0.1` | Listen address | `RELAY_BIND` |
| `server.public` | none | HTTPS origin without a path, query or credentials | `RELAY_PUBLIC` |
| `server.tls_cert` | none | Certificate file; `server.tls_key` must be set too | `RELAY_TLS_CERT` |
| `server.tls_key` | none | Private key file | `RELAY_TLS_KEY` |
| `keyboard.layout` | `us` | Comma-separated XKB layout such as `fr,us` | `RELAY_KEYBOARD_LAYOUT` |
| `backend` | Linux: `x11` when the engine has it, else `wayland`. macOS: `macos` | `x11`, `wayland` or `macos`; `--backend` overrides it | `RELAY_BACKEND` |
| `desktop` | `xfce` (x11) or `foot` (wayland) | `xfce`, `none`, or a desktop command; defaults to `none` with `--display`; always `none` on macOS | `RELAY_DESKTOP` |

Example:

```yaml
display:
  resolution: 1600x900
stream:
  fps: 30
  bitrate:
    min: 1M
    start: 8M
    max: 40M
server:
  port: 8080
keyboard:
  layout: us
```

There is no live reload or resize. Run `relay down`, edit the file, then `relay up -d`. `--display` ignores `display.resolution` and uses the existing display's size; `up` warns about this. macOS ignores `display.resolution` the same way and warns. Client commands use `RELAY_URL` and `RELAY_TOKEN_FILE` instead of the config file.
