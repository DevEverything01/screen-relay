#!/bin/sh
set -eu
desktop=0
deps=1
prefix=${PREFIX:-"$HOME/.local"}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --desktop) desktop=1 ;;
    --no-deps) deps=0 ;;
    --prefix) shift; prefix=${1:?--prefix requires a directory} ;;
    --help) echo 'Usage: ./install.sh [--desktop] [--no-deps] [--prefix DIR]'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[ "$(uname -s)" = Linux ] || { echo 'Run this installer inside the target Linux VM or sandbox.' >&2; exit 1; }
case "$prefix" in /*) ;; *) echo '--prefix must be absolute' >&2; exit 2 ;; esac
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$deps" = 1 ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo 'Automatic dependencies support Debian/Ubuntu. Install the dependencies in docs/portable.md, then use --no-deps.' >&2
    exit 1
  fi
  elevate=''
  if [ "$(id -u)" != 0 ]; then
    sudo -n true || { echo 'Dependency installation needs root or noninteractive sudo; alternatively provision dependencies and use --no-deps.' >&2; exit 1; }
    elevate='sudo -n'
  fi
  $elevate apt-get update
  $elevate env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential pkg-config libx11-dev libxext-dev libxdamage-dev libxfixes-dev \
    libxtst-dev libavcodec-dev libavutil-dev libswscale-dev libwebsockets-dev
  if [ "$desktop" = 1 ]; then
    $elevate env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 xvfb xauth x11-utils dbus-x11 at-spi2-core xfce4-session xfwm4 xfce4-panel \
      xfdesktop4 xfce4-settings thunar fonts-dejavu-core
  fi
fi
make -j2
make install PREFIX="$prefix"
printf '\nInstalled engine: %s/bin/native-stream-engine\n' "$prefix"
if [ "$desktop" = 1 ]; then printf 'Start a desktop: %s/bin/native-stream-desktop\n' "$prefix"; fi
