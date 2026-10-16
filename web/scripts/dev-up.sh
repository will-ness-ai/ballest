#!/bin/bash
# pnpm dev:up <port> [database], in a cloud session: starts Postgres if a container restart
# stopped it, then `next dev` on <port> against a local database (default ballest_dev), in
# the background, after stopping whatever already holds that port. Returns once the
# homepage answers. After "An unexpected Turbopack error occurred" in its log, remove
# web/.next and start it again. Stop it with `pnpm dev:down <port>`: kill by port, since `pkill -f`
# with a pattern matches the shell that runs it too and kills that shell.
set -euo pipefail
command -v fuser >/dev/null || { echo "dev-up.sh needs fuser (psmisc)"; exit 1; }
port=${1:?usage: pnpm dev:up <port> [database]}
url=postgres://postgres:postgres@localhost:5432/${2:-ballest_dev}
cd "$(dirname "$0")/.."
scripts/pg-up.sh
fuser -k -n tcp "$port" >/dev/null 2>&1 || true
while fuser -n tcp "$port" >/dev/null 2>&1; do sleep 0.2; done
log=$(mktemp -t "dev-$port-XXXX.log")
DATABASE_URL=$url setsid nohup pnpm dev -p "$port" >"$log" 2>&1 </dev/null &
for _ in $(seq 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$port/" || true)
  [ "$code" = 200 ] && { echo "dev on :$port ($log)"; exit 0; }
  sleep 1
done
tail -30 "$log"
exit 1
