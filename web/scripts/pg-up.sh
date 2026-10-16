#!/bin/bash
# Starts the local Postgres if it is down and waits until it takes connections. A cloud
# container is stopped and restarted while a session waits, which kills Postgres without a
# shutdown, and nothing starts it again; dev-up.sh, serve.sh and the session-start hook
# run this first.
set -euo pipefail
pg_isready -q -h localhost && exit 0
service postgresql start >/dev/null
for _ in $(seq 30); do
  pg_isready -q -h localhost && exit 0
  sleep 0.5
done
echo "Postgres did not start: see the log in /var/log/postgresql/" >&2
exit 1
