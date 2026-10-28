#!/bin/sh
set -eu
relay=${RELAY:-relay}
name=smoke-$$
port=${SMOKE_PORT:-18090}
work=$(mktemp -d)
xterm_pid=''

running() { [ -r "/proc/$1/stat" ] && [ "$(cut -d' ' -f3 "/proc/$1/stat")" != Z ]; }
step() { printf '== %s\n' "$*"; }
field() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(*[d[k] for k in sys.argv[2:]])' "$@"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  "$relay" logs --name "$name" >&2 2>/dev/null || true
  "$relay" down --name "$name" >/dev/null 2>&1 || true
  [ -z "$xterm_pid" ] || kill "$xterm_pid" 2>/dev/null || true
  exit 1
}

step doctor
"$relay" doctor || fail 'doctor reported failures'

if ! command -v xterm >/dev/null 2>&1; then
  step 'install xterm (test-only dependency)'
  elevate=''
  [ "$(id -u)" = 0 ] || elevate='sudo -n'
  { $elevate apt-get update -qq && $elevate env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends xterm >/dev/null; } ||
    fail 'xterm is missing and could not be installed'
fi

step "up -d (session $name, port $port)"
"$relay" up -d --name "$name" --port "$port" --json > "$work/up.json" || fail 'up -d'

step 'status --json'
"$relay" status --name "$name" --json > "$work/status.json" || fail 'status reports the session is not running'
[ "$(field "$work/status.json" running state)" = 'True ready' ] || fail "unexpected status: $(cat "$work/status.json")"
set -- $(field "$work/status.json" display xauthority logs)
display=$1 xauthority=$2 logs=$3

step screenshot
"$relay" screenshot --name "$name" --json "$work/screen.png" > "$work/screenshot.json" || fail screenshot
[ "$(field "$work/screenshot.json" width height)" = '1280 720' ] || fail "screenshot is not 1280x720: $(cat "$work/screenshot.json")"

step 'start xterm with mouse reporting'
DISPLAY=$display XAUTHORITY=$xauthority xterm -T relay-smoke -geometry 60x8+200+150 \
  -e sh -c "printf '\\033[?1000h'; exec cat > '$work/typed'" > "$work/xterm.log" 2>&1 &
xterm_pid=$!
geometry=''
for _ in $(seq 50); do
  geometry=$(DISPLAY=$display XAUTHORITY=$xauthority xwininfo -name relay-smoke 2>/dev/null) && break
  sleep 0.2
done
[ -n "$geometry" ] || fail "xterm window did not appear: $(cat "$work/xterm.log")"
set -- $(printf '%s\n' "$geometry" | awk '/Absolute upper-left X/{x=$NF} /Absolute upper-left Y/{y=$NF} /Width:/{w=$NF} /Height:/{h=$NF}
  END{printf "%.4f %.4f", (x+w/2)/1280, (y+h/2)/720}')
step "click $1 $2, type, key Enter"
sleep 1
"$relay" click --name "$name" "$1" "$2" || fail click
"$relay" type --name "$name" 'hello smoke' || fail type
"$relay" key --name "$name" Enter || fail key
check='import sys; d=open(sys.argv[1],"rb").read(); sys.exit(0 if b"\x1b[M" in d and b"hello smoke\n" in d else 1)'
for _ in $(seq 25); do python3 -c "$check" "$work/typed" && break; sleep 0.2; done
python3 -c "$check" "$work/typed" || fail "xterm did not receive the click and text: $(od -c "$work/typed" | head -5)"
"$relay" screenshot --name "$name" "$work/after.png" >/dev/null || fail 'screenshot after input'

step 'run shares the desktop bus and restarts apps'
python3 - "$relay" "$name" "$logs/session.json" <<'PY' || fail 'run environment or restart'
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

relay, name, record = sys.argv[1:]
session = json.loads(Path(record).read_text())

def environment(pid):
    return dict(item.split(b'=', 1) for item in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in item)

desktop = environment(session['components']['desktop']['pid'])
for options in ([], ['--restart']):
    command = [relay, 'run', '--name', name, '--json', *options, '--', 'xterm', '-T', f'{name}-restart']
    app = json.loads(subprocess.check_output(command))
    actual = environment(app['pid'])
    for key in (b'DBUS_SESSION_BUS_ADDRESS', b'XDG_RUNTIME_DIR', b'XDG_CONFIG_HOME', b'XDG_CACHE_HOME', b'ICEAUTHORITY'):
        assert actual[key] == desktop[key], (key, actual, desktop)
    if options:
        watcher = Path(f'/proc/{app["pid"]}/stat').read_text().split(') ', 1)[1].split()[1]
        assert environment(watcher)[b'RELAY_SESSION'] == str(Path(record).parent).encode()
        os.kill(app['pid'], signal.SIGTERM)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            children = Path(f'/proc/{watcher}/task/{watcher}/children').read_text().split()
            if children and children[0] != str(app['pid']):
                assert environment(children[0])[b'DBUS_SESSION_BUS_ADDRESS'] == desktop[b'DBUS_SESSION_BUS_ADDRESS']
                print(f'Restarted xterm: {app["pid"]} -> {children[0]}')
                break
            time.sleep(0.1)
        else:
            raise AssertionError('xterm did not restart')
PY

step 'down (twice: must be idempotent)'
"$relay" down --name "$name" || fail down
"$relay" down --name "$name" || fail 'second down'

step 'nothing left running'
if "$relay" status --name "$name" > /dev/null; then fail 'status still reports running'; fi
left=$(grep -ls "RELAY_SESSION=$logs" /proc/[0-9]*/environ 2>/dev/null || true)
[ -z "$left" ] || fail "processes left: $left"
for _ in $(seq 25); do running "$xterm_pid" || break; sleep 0.2; done
if running "$xterm_pid"; then fail 'xterm still running after its display stopped'; fi
[ ! -e "/tmp/.X11-unix/X${display#:}" ] || fail "display socket $display still exists"
if python3 -c 'import socket,sys; socket.create_connection(("127.0.0.1", int(sys.argv[1])), 1)' "$port" 2>/dev/null; then
  fail "port $port still accepts connections"
fi
rm -rf "$work"
printf 'PASS\n'
