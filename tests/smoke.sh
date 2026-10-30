#!/bin/sh
set -eu
relay=${RELAY:-relay}
name=smoke-$$
port=${SMOKE_PORT:-18090}
work=$(mktemp -d)
xterm_pid=''

running() { [ -r "/proc/$1/stat" ] && [ "$(cut -d' ' -f3 "/proc/$1/stat")" != Z ]; }
step() { printf '== %s\n' "$*"; }
field() {
  file=$1
  shift
  node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(process.argv.slice(2).map(k=>d[k]).join(" "))' "$file" "$@"
}
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
[ "$(field "$work/status.json" running state)" = 'true ready' ] || fail "unexpected status: $(cat "$work/status.json")"
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
check='const d=require("fs").readFileSync(process.argv[1]); process.exit(d.includes(Buffer.from("\x1b[M")) && d.includes(Buffer.from("hello smoke\n")) ? 0 : 1);'
for _ in $(seq 25); do node -e "$check" "$work/typed" && break; sleep 0.2; done
node -e "$check" "$work/typed" || fail "xterm did not receive the click and text: $(od -c "$work/typed" | head -5)"
"$relay" screenshot --name "$name" "$work/after.png" >/dev/null || fail 'screenshot after input'

step 'run shares the desktop bus and restarts apps'
node - "$relay" "$name" "$logs/session.json" <<'NODE' || fail 'run environment or restart'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [relay, name, record] = process.argv.slice(2);
const session = JSON.parse(fs.readFileSync(record, 'utf8'));
const environment = (pid) => {
  const result = {};
  for (const item of fs.readFileSync(`/proc/${pid}/environ`).toString().split('\0')) {
    const at = item.indexOf('=');
    if (at > 0) result[item.slice(0, at)] = item.slice(at + 1);
  }
  return result;
};
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const desktop = environment(session.components.desktop.pid);
for (const options of [[], ['--restart']]) {
  const app = JSON.parse(execFileSync(relay, ['run', '--name', name, '--json', ...options, '--', 'xterm', '-T', `${name}-restart`], { encoding: 'utf8' }));
  const actual = environment(app.pid);
  for (const key of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'ICEAUTHORITY']) {
    if (actual[key] !== desktop[key]) throw new Error(`${key} differs: ${actual[key]} != ${desktop[key]}`);
  }
  if (!options.length) continue;
  const watcher = Number(fs.readFileSync(`/proc/${app.pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
  if (environment(watcher).RELAY_SESSION !== path.dirname(record)) throw new Error('watcher has no session marker');
  process.kill(app.pid, 'SIGTERM');
  const deadline = Date.now() + 10000;
  let restarted = false;
  while (Date.now() < deadline) {
    const children = fs.readFileSync(`/proc/${watcher}/task/${watcher}/children`, 'utf8').split(/\s+/).filter(Boolean);
    if (children.length && children[0] !== String(app.pid)) {
      if (environment(children[0]).DBUS_SESSION_BUS_ADDRESS !== desktop.DBUS_SESSION_BUS_ADDRESS) throw new Error('restarted app lost the bus');
      console.log(`Restarted xterm: ${app.pid} -> ${children[0]}`);
      restarted = true;
      break;
    }
    pause(100);
  }
  if (!restarted) throw new Error('xterm did not restart');
}
NODE

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
if node -e 'const s=require("net").connect(Number(process.argv[1]), "127.0.0.1"); s.on("connect", () => { s.destroy(); process.exit(0); }); s.on("error", () => process.exit(1));' "$port"; then
  fail "port $port still accepts connections"
fi
rm -rf "$work"
printf 'PASS\n'
