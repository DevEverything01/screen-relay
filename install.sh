#!/bin/sh
set -eu
desktop=1
deps=1
client=0
prefix=${PREFIX:-"$HOME/.local"}
usage='Usage: ./install.sh [--prefix DIR] [--no-desktop] [--no-deps] [--client-only]'
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-desktop) desktop=0 ;;
    --no-deps) deps=0 ;;
    --client-only) client=1 ;;
    --prefix) shift; prefix=${1:?--prefix requires a directory} ;;
    --help) echo "$usage"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; echo "$usage" >&2; exit 2 ;;
  esac
  shift
done
case "$prefix" in /*) ;; *) echo '--prefix must be absolute' >&2; exit 2 ;; esac
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

elevate=''
apt_install() {
  $elevate env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}
apt=0
if [ "$deps" = 1 ] && [ "$(uname -s)" = Linux ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo 'Automatic dependencies support Debian/Ubuntu (apt). Install them yourself, then rerun with --no-deps.' >&2
    exit 1
  fi
  if [ "$(id -u)" != 0 ]; then
    sudo -n true || { echo 'Installing dependencies needs root or passwordless sudo; or install them yourself and use --no-deps.' >&2; exit 1; }
    elevate='sudo -n'
  fi
  $elevate apt-get update
  apt=1
fi

node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1
}
if ! node_ok; then
  if [ "$apt" = 1 ]; then apt_install nodejs npm; fi
  if ! node_ok; then
    echo 'relay needs Node 20 or newer with npm. Install Node 20+ and run this again.' >&2
    exit 1
  fi
fi

if [ "$apt" = 1 ] && [ "$client" = 0 ]; then
  apt_install util-linux build-essential pkg-config libx11-dev libxext-dev libxdamage-dev libxfixes-dev \
    libxtst-dev libx264-dev libwebsockets-dev xvfb xauth x11-utils x11-xkb-utils
  if [ "$desktop" = 1 ]; then
    apt_install dbus dbus-x11 at-spi2-core xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings \
      thunar xfce4-terminal fonts-dejavu-core librsvg2-common
    if apt-cache show glycin-loaders >/dev/null 2>&1; then apt_install glycin-loaders; fi
    if apt-cache show libgdk-pixbuf2.0-bin >/dev/null 2>&1; then apt_install libgdk-pixbuf2.0-bin; fi
  fi
fi

npm ci
npm run build

on_path() {
  case ":$PATH:" in *":$prefix/bin:"*) ;; *) printf 'Not on PATH; add it with: export PATH="%s/bin:$PATH"\n' "$prefix" ;; esac
}
install_cli() {
  install -d "$prefix/bin" "$prefix/lib/relay"
  install -m 0755 dist/cli/relay.mjs "$prefix/lib/relay/relay.mjs"
  install -d "$prefix/lib/relay/skill-data"
  cp -R skill-data/. "$prefix/lib/relay/skill-data/"
  ln -sfn ../lib/relay/relay.mjs "$prefix/bin/relay"
}
if [ "$client" = 1 ]; then
  install_cli
  printf '\nInstalled client: %s/bin/relay\n' "$prefix"
  on_path
  exit 0
fi
[ "$(uname -s)" = Linux ] || { echo 'The engine builds on Linux only; use --client-only on this machine.' >&2; exit 1; }
make -j2
make install PREFIX="$prefix"
install_cli
printf '\nInstalled: %s/bin/relay (engine: %s/bin/relay-engine)\n' "$prefix" "$prefix"
on_path
printf '\n'
"$prefix/bin/relay" doctor
