#!/bin/bash
# pnpm dev:down <port>, and the first step of dev-up.sh and serve.sh: stops whatever serves
# <port> and waits until the port is free. By port, since `pkill -f` with a pattern also
# matches the shell that runs it and kills that shell.
set -euo pipefail
command -v fuser >/dev/null || { echo "free-port.sh needs fuser (psmisc)"; exit 1; }
port=${1:?usage: pnpm dev:down <port>}
fuser -k -n tcp "$port" >/dev/null 2>&1 || true
while fuser -n tcp "$port" >/dev/null 2>&1; do sleep 0.2; done
