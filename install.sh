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
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 26 ? 0 : 1)' >/dev/null 2>&1
}
fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"; else wget -qO- "$1"; fi
}
checksum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
node_bin=''
if ! node_ok; then
  node_version=$(cat .node-version)
  case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) platform=linux-x64 ;;
    Linux:aarch64|Linux:arm64) platform=linux-arm64 ;;
    Darwin:x86_64) platform=darwin-x64 ;;
    Darwin:arm64) platform=darwin-arm64 ;;
    *) echo 'relay needs Node 26 or newer; this OS and architecture has no Node download. Install Node 26 from https://nodejs.org/ and run this again.' >&2; exit 1 ;;
  esac
  if [ "$apt" = 1 ]; then apt_install ca-certificates curl libatomic1; fi
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    echo 'Downloading Node 26 needs curl or wget.' >&2
    exit 1
  fi
  archive="node-v$node_version-$platform.tar.gz"
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' 0
  echo "Downloading Node $node_version for $platform"
  fetch "https://nodejs.org/dist/v$node_version/$archive" > "$scratch/$archive"
  fetch "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" > "$scratch/SHASUMS256.txt"
  (cd "$scratch" && grep " $archive\$" SHASUMS256.txt | checksum -c -) || {
    echo "Node $node_version failed checksum verification." >&2
    exit 1
  }
  tar -xzf "$scratch/$archive" -C "$scratch"
  install -d "$prefix/lib/relay"
  rm -rf "$prefix/lib/relay/node"
  mv "$scratch/node-v$node_version-$platform" "$prefix/lib/relay/node"
  node_bin="$prefix/lib/relay/node/bin"
  PATH="$node_bin:$PATH"
  export PATH
  echo "Installed Node $node_version in $prefix/lib/relay/node"
  if ! node_ok; then
    echo "Node $node_version in $prefix/lib/relay/node does not run:" >&2
    "$prefix/lib/relay/node/bin/node" --version >&2 || true
    echo 'Install the missing system libraries (Debian: libatomic1) and run this again.' >&2
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

npm ci --include=dev
npm run build

on_path() {
  case ":$PATH:" in *":$prefix/bin:"*) ;; *) printf 'Not on PATH; add it with: export PATH="%s/bin:$PATH"\n' "$prefix" ;; esac
}
install_cli() {
  install -d "$prefix/bin" "$prefix/lib/relay"
  install -m 0755 dist/cli/relay.mjs "$prefix/lib/relay/relay.mjs"
  install -d "$prefix/lib/relay/skills"
  cp -R skills/. "$prefix/lib/relay/skills/"
  cat > "$prefix/bin/relay" <<EOF
#!/bin/sh
node='$prefix/lib/relay/node/bin/node'
[ -x "\$node" ] || node=node
exec "\$node" '$prefix/lib/relay/relay.mjs' "\$@"
EOF
  chmod 0755 "$prefix/bin/relay"
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
