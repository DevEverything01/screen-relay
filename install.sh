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
node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 26 ? 0 : 1)' >/dev/null 2>&1
}
apt_install() {
  $elevate env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}
dnf_install() {
  $elevate dnf -y install --setopt=install_weak_deps=False "$@"
}
pacman_install() {
  $elevate pacman -Syu --needed --noconfirm "$@"
}
apk_install() {
  $elevate apk add --no-cache "$@"
}
if [ "$deps" = 1 ] && [ "$(uname -s)" = Linux ]; then
  os_id=''
  os_like=''
  if [ -r /etc/os-release ]; then
    while IFS='=' read -r key value; do
      case "$key" in ID|ID_LIKE) ;; *) continue ;; esac
      case "$value" in
        \"*\") value=${value#\"}; value=${value%\"} ;;
        \'*\') value=${value#\'}; value=${value%\'} ;;
      esac
      case "$key" in ID) os_id=$value ;; ID_LIKE) os_like=$value ;; esac
    done < /etc/os-release
  fi
  family=''
  ubuntu=0
  set -f
  for distro in $os_id $os_like; do
    case "$distro" in
      ubuntu) family=apt; ubuntu=1; break ;;
      debian) family=apt; break ;;
      fedora) family=dnf; break ;;
      arch) family=pacman; break ;;
      alpine) family=apk; break ;;
    esac
  done
  set +f
  [ -n "$family" ] || { echo 'Automatic dependencies support Debian, Ubuntu, Fedora, Arch, and Alpine. Install them yourself, then rerun with --no-deps.' >&2; exit 1; }
  if [ "$(id -u)" != 0 ]; then
    sudo -n true || { echo 'Installing dependencies needs root or passwordless sudo; or install them yourself and use --no-deps.' >&2; exit 1; }
    elevate='sudo -n'
  fi
  if [ "$family" = apt ]; then $elevate apt-get update; fi

  packages=''
  optional_packages=''
  node_packages=''
  x264_package=''
  while IFS="$(printf '\t')" read -r group logical apt_package dnf_package pacman_package apk_package; do
    case "$group" in ''|\#*) continue ;; esac
    case "$family" in
      apt) package=$apt_package ;;
      dnf) package=$dnf_package ;;
      pacman) package=$pacman_package ;;
      apk) package=$apk_package ;;
    esac
    [ "$package" != - ] || continue
    if [ "$family" = dnf ] && [ "$logical" = curl ] && command -v curl >/dev/null 2>&1; then continue; fi
    case "$group:$logical" in
      core:x264-dev) x264_package=$package ;;
      core:ca-certificates|core:curl|core:libatomic|core:libstdc++|core:libgcc)
        node_packages="$node_packages $package" ;;
    esac
    case "$group" in
      core|x11) packages="$packages $package" ;;
      xfce)
        [ "$desktop" = 1 ] || continue
        case "$family:$logical" in
          apt:glycin-loaders|apt:gdk-pixbuf-bin)
            optional_packages="$optional_packages $package"; continue ;;
        esac
        packages="$packages $package" ;;
    esac
  done < packages.tsv

  if [ "$client" = 0 ]; then
    if [ "$family" = apt ] && [ "$ubuntu" = 1 ] &&
      ! LC_ALL=C apt-cache policy "$x264_package" | grep -q 'Candidate: [^ (]'; then
      if [ ! -f /etc/apt/sources.list.d/ubuntu.sources ]; then
        echo 'Enable the Ubuntu universe component, then rerun the installer.' >&2
        exit 1
      fi
      $elevate sed -i '/^Components:/{/universe/!s/$/ universe/}' /etc/apt/sources.list.d/ubuntu.sources
      $elevate apt-get update
      if ! LC_ALL=C apt-cache policy "$x264_package" | grep -q 'Candidate: [^ (]'; then
        echo "Cannot install $x264_package after enabling Ubuntu universe." >&2
        exit 1
      fi
    fi
    if [ "$family" = dnf ] && ! $elevate dnf -q repoquery --available "$x264_package" | grep -q .; then
      echo 'Enable RPM Fusion Free, then rerun the installer:' >&2
      echo "${elevate:+$elevate }dnf -y install https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-\$(rpm -E %fedora).noarch.rpm" >&2
      exit 1
    fi
    for package in $optional_packages; do
      if apt-cache show "$package" >/dev/null 2>&1; then packages="$packages $package"; fi
    done
    "${family}_install" $packages
  elif ! node_ok; then
    "${family}_install" $node_packages
  fi
fi

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
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    echo 'Downloading Node 26 needs curl or wget.' >&2
    exit 1
  fi
  node_url="https://nodejs.org/dist/v$node_version"
  case "$platform" in
    linux-*)
      for loader in /lib/ld-musl-*; do
        if [ -e "$loader" ]; then
          platform="$platform-musl"
          node_url="https://unofficial-builds.nodejs.org/download/release/v$node_version"
          break
        fi
      done ;;
  esac
  archive="node-v$node_version-$platform.tar.gz"
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' 0
  echo "Downloading Node $node_version for $platform"
  fetch "$node_url/$archive" > "$scratch/$archive"
  fetch "$node_url/SHASUMS256.txt" > "$scratch/SHASUMS256.txt"
  (cd "$scratch" && awk -v archive="$archive" '$2 == archive { print }' SHASUMS256.txt | checksum -c -) || {
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
    echo 'Install the missing system libraries and run this again.' >&2
    exit 1
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
