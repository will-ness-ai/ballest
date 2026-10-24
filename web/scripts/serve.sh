#!/bin/bash
# pnpm serve <port> [database], in a cloud session: starts Postgres if it is down, builds
# the site against a local database (default ballest_dev) and serves it on <port> in the
# background, after stopping whatever already holds that port. `pnpm dev:down <port>` stops
# it. One served build at a time, since each build replaces web/.next under any server
# still running. Its sessions are signed with the secret qa signs in with (qa/session.mjs):
# SESSION_SECRET, web/.env.local's or web/.env's, else qa-only, as in CI.
set -euo pipefail
port=${1:?usage: pnpm serve <port> [database]}
url=postgres://postgres:postgres@localhost:5432/${2:-ballest_dev}
cd "$(dirname "$0")/.."
SESSION_SECRET=$(scripts/qa-secret.mjs)
export SESSION_SECRET
scripts/pg-up.sh
scripts/free-port.sh "$port"
log=$(mktemp -t "serve-$port-XXXX.log")
DATABASE_URL=$url pnpm build >"$log" 2>&1 || { tail -30 "$log"; exit 1; }
DATABASE_URL=$url nohup pnpm exec next start -p "$port" >>"$log" 2>&1 &
for _ in $(seq 60); do
  curl -s -o /dev/null "localhost:$port/" && { echo "serving on :$port ($log)"; exit 0; }
  sleep 1
done
tail -30 "$log"
exit 1
