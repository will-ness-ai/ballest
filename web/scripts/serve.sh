#!/bin/bash
# pnpm serve <port> [database], in a cloud session: builds the site against a local
# database (default ballest_dev) and serves it on <port> in the background, after stopping
# whatever already holds that port. Stop it with `fuser -k -n tcp <port>`. Kill by port:
# `pkill -f "next start"` matches the shell that runs it too. One served build at a time,
# since each build replaces web/.next under any server still running.
set -euo pipefail
command -v fuser >/dev/null || { echo "serve.sh needs fuser (psmisc)"; exit 1; }
port=${1:?usage: pnpm serve <port> [database]}
url=postgres://postgres:postgres@localhost:5432/${2:-ballest_dev}
cd "$(dirname "$0")/.."
fuser -k -n tcp "$port" >/dev/null 2>&1 || true
while fuser -n tcp "$port" >/dev/null 2>&1; do sleep 0.2; done
log=$(mktemp -t "serve-$port-XXXX.log")
DATABASE_URL=$url pnpm build >"$log" 2>&1 || { tail -30 "$log"; exit 1; }
DATABASE_URL=$url nohup pnpm exec next start -p "$port" >>"$log" 2>&1 &
for _ in $(seq 60); do
  curl -s -o /dev/null "localhost:$port/" && { echo "serving on :$port ($log)"; exit 0; }
  sleep 1
done
tail -30 "$log"
exit 1
