#!/bin/sh
set -eu
src=$(cd "$1" && pwd)
cpuset=${2:-}
platform=${3:-linux/arm64}
here=$(cd "$(dirname "$0")" && pwd)
image=nsbench:$(cat "$here/Dockerfile" "$here/workload.c" "$here/bench.py" | shasum | cut -c1-12)-$(echo "$platform" | tr / -)
docker image inspect "$image" >/dev/null 2>&1 || docker build -q --platform "$platform" -t "$image" "$here" >/dev/null
exec docker run --rm --platform "$platform" --cpus=2 --memory=1536m --memory-swap=1536m --shm-size=512m \
  ${cpuset:+--cpuset-cpus=$cpuset} -v "$src:/src:ro" "$image"
