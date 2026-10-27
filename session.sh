#!/bin/bash
set -euo pipefail
engine=${1:-native}
if [ "$engine" != native ] || [ "$#" -gt 1 ]; then
  echo 'Usage: session.sh [native]' >&2
  exit 2
fi

export DISPLAY=:1
for stale in /tmp/.X1-lock /tmp/.X11-unix/X1; do
  if [ -e "$stale" ] || [ -S "$stale" ]; then mv "$stale" "$stale.previous.$(date +%s%N)"; fi
done
Xvfb :1 -screen 0 1280x720x24 -nolisten tcp -noreset > /tmp/display.log 2>&1 &
for attempt in {1..100}; do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo >/dev/null
xset s off
xset -dpms || true
pulseaudio --start --exit-idle-time=-1
xfce4-session > /tmp/desktop.log 2>&1 &
sleep 2
xfconf-query -c xfwm4 -p /general/use_compositing -s false || true
# Benchmark runners copy their fixture before startup; normal images contain none.
if [ -f /opt/bench/fixture.py ]; then
  python3 /opt/bench/fixture.py > /tmp/fixture.log 2>&1 &
fi
exec /opt/native/native-stream
