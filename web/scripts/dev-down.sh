#!/bin/bash
# pnpm dev:down <port>: stops whatever serves <port> (dev-up.sh's `next dev`, or serve.sh's
# build), by port.
set -euo pipefail
port=${1:?usage: pnpm dev:down <port>}
fuser -k -n tcp "$port" >/dev/null 2>&1 || true
