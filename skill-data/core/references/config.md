# Configuration

`relay up` reads `--config FILE`, then `$RELAY_CONFIG`, then `${XDG_CONFIG_HOME:-~/.config}/relay/config.yaml` when present. Command-line flags override file values; file values override defaults. A missing explicitly selected file, unknown key, invalid type, or out-of-range value stops startup.

Relevant settings:

- `display.resolution`: default `1280x720`; even width `320..1920` and height `240..1080`.
- `stream.fps`: default `60`, range `10..60`.
- `stream.bitrate.min/start/max`: defaults `1M`, `8M`, `40M`.
- `keyboard.layout`: default `us`; Linux display layout for text and physical key interpretation.
- `server.port`, `server.bind`, and `server.public`: listener configuration.

There is no live reload or resize. Run `relay down`, update the file, and start the session again.
