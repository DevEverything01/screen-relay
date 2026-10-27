---
name: native-stream
description: Start a streamed Linux X11 desktop and control it with the native-stream CLI (snapshot, click, type, key). Use when an agent needs to see and operate a GUI on a Linux VM, sandbox or container.
---

# native-stream

Streams a Linux X11 desktop (1280x720) to a browser and lets you control it from the CLI.

## Setup

On a Debian/Ubuntu machine, from the repo:

```sh
./install.sh
native-stream up -d
native-stream status --json
```

`status --json` gives `url` and `state`. Run `native-stream doctor` if anything fails. Do not use `xhost +` or delete X lock files. To use an existing display: `native-stream up -d --display :0`.

## Operate

```sh
native-stream snapshot screen.png
native-stream click 0.5 0.5
native-stream type "hello"
native-stream key ctrl+l Enter
native-stream scroll 0.5 0.5 --dy 3
```

- Coordinates are 0 to 1 from the top-left.
- Take a snapshot, act, then take another to confirm. A successful command means submitted, not done.
- Add `--json` to parse output.
- `type` is US layout only.

## Remote use

Behind an HTTPS proxy: `native-stream up -d --public https://HOST`. Share the viewer link or token through the user's secret channel, never in logs or URLs. See `docs/remote-access.md`.

## Stop

```sh
native-stream down
```

## Errors

With `--json`, errors are `{"error":{"code","message","hint"}}` on stderr.

| Code | Fix |
| --- | --- |
| `busy` | A viewer or another client holds control. Close it and retry. |
| `unauthorized` | Pass `--token-file` or set `NATIVE_STREAM_TOKEN_FILE`. |
| `unreachable` | Check `native-stream status` and the URL. |
| `invalid_argument` | Fix coordinates, key combo or characters. |
| `component_failed` | Read `native-stream logs <component>`. |

Limits: X11 only, fixed 1280x720, one controller, no audio or clipboard.
