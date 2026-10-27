#!/bin/bash
set -euo pipefail
mkdir -p /run/dbus /tmp/.ICE-unix
chmod 1777 /tmp/.ICE-unix
dbus-daemon --system --fork --nopidfile
/usr/lib/systemd/systemd-logind > /tmp/logind.log 2>&1 &
exec runuser -u bench -- dbus-run-session -- /opt/bench/session.sh "$@"
