#!/bin/bash
# pnpm dev:up <port> [database], in a cloud session: starts Postgres if it is down, then
# `next dev` on <port> against a local database (default ballest_dev), in the background,
# after stopping whatever already holds that port. Returns once the homepage answers.
# `pnpm dev:down <port>` stops it.
set -euo pipefail
port=${1:?usage: pnpm dev:up <port> [database]}
url=postgres://postgres:postgres@localhost:5432/${2:-ballest_dev}
cd "$(dirname "$0")/.."
scripts/pg-up.sh
scripts/free-port.sh "$port"
log=$(mktemp -t "dev-$port-XXXX.log")
DATABASE_URL=$url setsid nohup pnpm dev -p "$port" >"$log" 2>&1 </dev/null &
pid=$!
for _ in $(seq 120); do
  curl -s -o /dev/null "localhost:$port/" && { echo "dev on :$port ($log)"; exit 0; }
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
tail -30 "$log"
exit 1
