#!/bin/bash
set -euo pipefail
engine=${1:?Pass native, selkies or kasm}
case "$engine" in
  native) session=/opt/native/session.sh ;;
  selkies|kasm) session=/opt/bench/session.sh ;;
  *) echo "Unknown engine: $engine" >&2; exit 2 ;;
esac
export DISPLAY=:1 SDL_FRAMEBUFFER_ACCELERATION=0
dbus-run-session -- "$session" "$engine" &
session_pid=$!
trap 'kill -TERM "$session_pid" 2>/dev/null || true; wait "$session_pid" 2>/dev/null || true' EXIT
for attempt in {1..100}; do
  kill -0 "$session_pid"
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo >/dev/null
sleep 4
cat > /tmp/game-crispy.cfg <<'EOF'
fullscreen 1
fullscreen_width 0
fullscreen_height 0
force_software_renderer 1
crispy_uncapped 1
crispy_fpslimit 60
crispy_vsync 0
EOF
/usr/games/crispy-doom -iwad /usr/share/games/doom/freedoom1.wad -skill 3 -warp 1 1 -nomouse -extraconfig /tmp/game-crispy.cfg
