# Bring your own Linux environment

[Start](#two-line-desktop-startup) · [Existing display](#stream-a-display-you-already-have) ·
[Requirements](#compatible-linux-means) · [Remote access](#authenticated-remote-access) ·
[Vercel](#vercel-sandbox-example) · [Agent skill](#coding-agent-setup-skill) ·
[Verification](#repeat-the-non-docker-verification) · [Main README](../README.md)

The streaming engine attaches to a display. It does not provision a VM, choose a
sandbox provider, install a desktop at runtime, or depend on Docker or XFCE.
`native-stream-desktop` is an optional convenience recipe that starts Xvfb and a
desktop session, runs the engine, and supervises their lifetime.

## Two-line desktop startup

With this source directory already copied into a compatible Debian/Ubuntu VM or
sandbox, run as the user who will own the desktop:

```sh
./install.sh --desktop
~/.local/bin/native-stream-desktop
```

The first command installs system dependencies with root or noninteractive sudo,
builds the native executable, and installs into `~/.local`. It can take several
minutes on a fresh machine. There is no published binary download or hidden
provider provisioning step. Use `--prefix /absolute/path` to choose the install
location; use `--no-deps` when dependencies are already provisioned. Installation
does not register the engine as a service or modify shell startup files.

The second command stays in the foreground and prints a JSON readiness record
only after its own engine has bound its port and returned a fresh PNG. It includes
the viewer URL, display, Xauthority path, process IDs and private log directory.
Stop it with Ctrl-C or SIGTERM. A provider's detached-command facility or your
existing service manager can supervise it; no systemd requirement is imposed.
Each invocation allocates an unused X display, private Xauthority credentials,
private D-Bus session, runtime directory and desktop configuration. Concurrent
sessions need different `--port` values. Logs remain in the reported private
directory after exit for diagnosis.

The URL is on **the Linux machine's loopback**, not automatically on your laptop.
Use an existing secure tunnel or configure authenticated remote access below.
For an SSH-capable target, the connection step on your laptop is:

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-vm
```

Then open `http://127.0.0.1:8080`. Environment provisioning, copying the source,
and establishing a remote route are separate from the two Linux startup commands.

## Stream a display you already have

Install the engine without installing XFCE, then attach with the graphical
session's own display and authorization:

```sh
./install.sh
DISPLAY=:0 XAUTHORITY=/path/to/session/Xauthority ~/.local/bin/native-stream-engine
```

This mode does not start or stop Xvfb, XFCE, D-Bus, or applications. The caller owns
that display's lifetime. `--port`, `--bind`, and `--viewer-dir` configure the server;
assets normally live beside the real executable, so the install can be relocated.
The engine discovers its actual executable location even when launched by a symlink.

For the convenience launcher, `--session 'openbox'` selects another installed
desktop/window-manager command; `--no-desktop` starts Xvfb and the engine only.
The command is split into arguments without running a shell. This does not imply
that every desktop environment has been verified.

## Compatible Linux means

- Native Linux processes and an architecture/compiler supported by the installed
  dependencies. The first verified non-container target is Ubuntu 24.04 ARM64.
- X11 at **1280×720**, with XDamage, XFixes, XTest and MIT-SHM, and permission to
  connect using the session's Xauthority. The current backend requires shared
  memory with the X server; forwarding `DISPLAY` over SSH to a different host is
  not a supported capture path.
- FFmpeg with the libx264 encoder, TLS-enabled libwebsockets, and the X11 libraries. Builds
  need a C++17 compiler, make, pkg-config and their development headers. The
  installer checks through the real build, and the engine fails clearly when a
  required display feature is missing.
- For the optional desktop recipe: Python 3, Xvfb, xauth; D-Bus and the selected
  desktop command unless `--no-desktop` is used.
- A long-lived process and a route supporting HTTP and WebSocket upgrades. A
  short-lived function or an environment forbidding native processes/shared
  memory does not meet this contract.
- A browser with H.264 WebCodecs in a secure context (HTTPS or localhost).

Automatic package installation currently covers Debian/Ubuntu via apt. On other
distributions, provision equivalent libraries using that system's package manager
or base image, then run `./install.sh --no-deps`. The engine has no provider API
calls. Other distributions and architectures still require their own verification.
Missing cgroup resource counters do not stop streaming or make SDK status fail;
the response reports null counters while retaining transport metrics.

## Authenticated remote access

The default bind is `127.0.0.1`, with the local Host/Origin checks retained.
For remote access generate a per-session 256-bit token in a file readable only by
the service user. Do not put it in a URL, command argument, report or access log:

```sh
umask 077
openssl rand -hex 32 > /private/path/session.token
```

Use a unique absolute location, not a pre-existing user's credential file. The
engine requires the file to be owned by its current user with no group/other
permissions. Anyone holding this token can observe and control this desktop.
This is one session's shared credential, not a multi-tenant authorization system.

For a sandbox HTTPS gateway, forward the following engine's private port and
preserve the original Host, Origin, Authorization and WebSocket subprotocol headers:

```sh
DISPLAY=:0 ~/.local/bin/native-stream-engine --bind 0.0.0.0 --port 8080 \
  --token-file /private/path/session.token \
  --public-origin https://your-sandbox-gateway.example \
  --behind-tls-proxy
```

Use `--behind-tls-proxy` only when that listener is on a private network behind
the trusted TLS gateway. The flag does not create or verify a gateway, and the
engine does not trust arbitrary forwarded headers. The gateway must forward the
root URL and `/control`, `/stream`, `/snapshot.png`, `/capabilities`, `/metrics`;
path-prefix hosting is not supported. Providers needing their own extra gateway
credentials must arrange those at the gateway/tunnel layer.

For direct TLS instead, supply `--tls-cert /path/fullchain.pem --tls-key
/path/key.pem` in place of `--behind-tls-proxy`. Use a certificate trusted by your
clients whose hostname matches the public origin. The optional desktop launcher
accepts the same remote connection flags. Native TLS advertises HTTP/1.1 for HTTP
and WebSocket upgrades; HTTP/2 clients must negotiate HTTP/1.1. A gateway can
serve HTTP/2 to browsers and forward HTTP/1.1 to the engine.

Open the viewer at that HTTPS origin, paste the token into **Access token (remote)**,
then click **Reconnect**. The viewer keeps it in page memory only; reloading needs
the token again. HTTP APIs use `Authorization: Bearer TOKEN`; WebSocket clients
offer `nsl1` and `bearer.TOKEN` subprotocols (the selected protocol remains `nsl1`).
Configure gateways not to log Authorization or the offered subprotocol header.
Unexpected browser origins, missing credentials and wrong credentials are rejected.

The Node SDK uses the same connection contract everywhere:

```js
import { readFile } from 'node:fs/promises';
import { connect } from 'native-stream-lab';
const desktop = await connect({
  url: 'https://your-sandbox-gateway.example',
  token: (await readFile('/private/path/session.token', 'utf8')).trim(),
});
try { await desktop.snapshot('screen.png'); } finally { desktop.close(); }
```

The CLI accepts `NATIVE_STREAM_URL` and `NATIVE_STREAM_TOKEN_FILE`. Remote plaintext
HTTP is rejected by the SDK, and authenticated HTTP redirects are not followed.
Keep tokens out of source control. Rotate by replacing the token file and
restarting the engine; existing sessions end with the restart.

The Docker recipe explicitly uses `--insecure-local` to preserve its isolated,
loopback-published development profile. That opt-in disables the remote credential
requirement; it is not the portable remote deployment path.

### Vercel Sandbox example

Docker is not needed inside Vercel Sandbox. Its current managed Ubuntu images
support apt installation and native processes. Given an existing sandbox with
port 8080 exposed, copy this source into it, obtain that port's HTTPS URL, and
provision the private token file described above. Then run inside that sandbox:

```sh
./install.sh --desktop
~/.local/bin/native-stream-desktop --bind 0.0.0.0 --port 8080 --token-file /private/path/session.token --public-origin "$SANDBOX_HTTPS_ORIGIN" --behind-tls-proxy
```

Use the provider's detached-command facility for the second command and allow
enough session lifetime for the initial package installation/build. The sandbox
supplies the VM and HTTPS route; the engine supplies capture, input and streaming.
This recipe uses the same installer and launcher as any other compatible host.
It is based on [Vercel's sandbox documentation](https://vercel.com/docs/sandbox),
and is **not an end-to-end Vercel verification claim**. The provider gateway still
needs the header and WebSocket checks above; a running VM alone does not prove
the remote connection works.

## Coding-agent setup skill

[skills/native-stream/SKILL.md](../skills/native-stream/SKILL.md) guides a coding
agent through inspecting the target, installing only the missing components,
choosing an existing display or a new desktop, connecting securely and verifying
actual pixels/input. Copy that folder to the coding agent's supported skills
directory. It contains no provider SDK and does not provision a VM implicitly.

## Repeat the non-Docker verification

Install the source with `--desktop` on a disposable Linux VM. The independent
input fixture also needs `python3-tk`; the TLS test needs `openssl`. On the test
driver, install this repository's npm development dependencies and Google Chrome.
The runner uses standard SSH and a localhost tunnel, not the Docker CLI:

```sh
TEST_SSH_CONFIG=/path/to/ssh.config TEST_SSH_TARGET=my-test-vm \
  TEST_REMOTE_ROOT=/home/test/native-stream-src \
  node tests/integration/portable-integration.mjs
```

See the runner's environment defaults for ports and output paths. Only point it
at a disposable test environment: it launches fixture windows on its own displays.
It records environment identity, installed-code hashes, checks and cleanup status
in `tests/results/portable/verification.json`. Performance benchmarks are separate.
