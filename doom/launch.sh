#!/bin/bash
set -euo pipefail

export DISPLAY=:1
# SDL's window-surface fallback otherwise creates a costly llvmpipe presenter on Xvfb.
export SDL_FRAMEBUFFER_ACCELERATION=0
dbus-run-session -- /opt/native/session.sh native &
session_pid=$!
cleanup() {
  kill -TERM "$session_pid" 2>/dev/null || true
  wait "$session_pid" 2>/dev/null || true
}
trap cleanup EXIT

for attempt in {1..100}; do
  if ! kill -0 "$session_pid" 2>/dev/null; then
    wait "$session_pid"
    exit 1
  fi
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo >/dev/null
sleep 3

config=/tmp/native-doom-crispy.cfg
cat > "$config" <<'EOF'
fullscreen 1
fullscreen_width 0
fullscreen_height 0
force_software_renderer 1
crispy_uncapped 1
crispy_fpslimit 60
crispy_vsync 0
EOF

/usr/games/crispy-doom \
  -iwad /usr/share/games/doom/freedoom1.wad \
  -skill 3 -warp 1 1 \
  -nomouse \
  -extraconfig "$config"
