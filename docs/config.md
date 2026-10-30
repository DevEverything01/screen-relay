# Config

`relay up` reads an optional YAML file. Every key is optional, and no file means the defaults.

## Location

| Order | Source |
| --- | --- |
| 1 | `relay up --config FILE` |
| 2 | `$RELAY_CONFIG` |
| 3 | `${XDG_CONFIG_HOME:-~/.config}/relay/config.yaml`, when it exists |

A file named by `--config` or `RELAY_CONFIG` that is missing is an error. The default path is used only when it exists.

Reading needs PyYAML (`python3-yaml` on Debian/Ubuntu). `./install.sh` installs it with the engine; `--client-only` does not.

## Keys

| Key | Default | Allowed |
| --- | --- | --- |
| `display.resolution` | `1280x720` | `WIDTHxHEIGHT`; width even 320..1920, height even 240..1080 |
| `stream.fps` | `60` | integer 10..60 |
| `stream.bitrate.min` | `1M` | bits per second 250000..100000000; integer or a `k` or `M` suffix (1000-based) |
| `stream.bitrate.start` | `8M` | same range; `min <= start <= max` |
| `stream.bitrate.max` | `40M` | same range |
| `server.port` | `8080` | integer 1..65535 |
| `server.bind` | `127.0.0.1`, or `0.0.0.0` when `server.public` is set | listen address; `--bind` overrides it |
| `server.public` | unset | HTTPS origin such as `https://desktop.example.com` |
| `server.tls_cert` | unset | certificate file |
| `server.tls_key` | unset | private key for the certificate |
| `desktop` | `xfce`; `none` with `--display` | `xfce`, `none`, or a command |

Unknown keys are an error and name the dotted path. Wrong types and out-of-range values are errors too.

## Precedence

Command-line flags beat the file, and the file beats the defaults. `relay up --port 9000` uses 9000 even when the file sets another port.

`--display :N` attaches to an existing display. The CLI uses that display's size and ignores `display.resolution`; it prints one line to stderr when the file sets it.

## Example

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
  bind: 127.0.0.1
  public: https://desktop.example.com
  tls_cert: /path/fullchain.pem
  tls_key: /path/key.pem
desktop: xfce
```

## Restart

Every key applies when `relay up` starts. There is no live reload and no live resize: stop the session with `relay down`, change the file, then start it again.
