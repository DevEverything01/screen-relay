#!/bin/bash
set -euo pipefail
engine=${1:?Pass selkies or kasm}
export DISPLAY=:1
# A stopped container can retain X-server locks after Docker's kill timeout.
for stale in /tmp/.X1-lock /tmp/.X11-unix/X1; do
  if [ -e "$stale" ] || [ -S "$stale" ]; then mv "$stale" "$stale.previous.$(date +%s%N)"; fi
done
if [ "$engine" = selkies ]; then
  Xvfb :1 -screen 0 1280x720x24 -nolisten tcp -noreset > /tmp/display.log 2>&1 &
elif [ "$engine" = kasm ]; then
  printf '%s\n%s\n' "$BENCH_PASSWORD" "$BENCH_PASSWORD" | vncpasswd -u bench -w -r
  Xvnc :1 -geometry 1280x720 -depth 24 -websocketPort 8080 -interface 0.0.0.0 -sslOnly 0 -SecurityTypes None -httpd /usr/share/kasmvnc/www -publicIP 127.0.0.1 -videoCodec h264 -KasmPasswordFile /home/bench/.kasmpasswd -FrameRate 60 > /tmp/display.log 2>&1 &
else
  echo 'Unknown engine' >&2
  exit 2
fi
for attempt in {1..100}; do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo >/dev/null
xset s off
xset -dpms || true
pulseaudio --start --exit-idle-time=-1
if [ "${DESKTOP:-xfce}" = gnome ]; then
  export XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_DESKTOP=gnome XDG_SESSION_TYPE=x11
  export LIBGL_ALWAYS_SOFTWARE=1
  gsettings set org.gnome.desktop.session idle-delay 0
  gsettings set org.gnome.desktop.screensaver lock-enabled false
  gnome-session --session=gnome > /tmp/desktop.log 2>&1 &
  sleep 5
else
  xfce4-session > /tmp/desktop.log 2>&1 &
  sleep 2
  xfconf-query -c xfwm4 -p /general/use_compositing -s false || true
fi
python3 /opt/bench/fixture.py > /tmp/fixture.log 2>&1 &
if [ "$engine" = selkies ]; then
  exec selkies --public --port=8080 --enable-https=false --enable-basic-auth=false --encoder=h264enc --use-cpu=true --enable-resize=false
fi
wait -n
