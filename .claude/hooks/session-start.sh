#!/bin/bash
# Readies a cloud session for the repo's checks: the local Postgres the site's tests, the
# collector's tests and `pnpm dev` run against (AGENTS.md, "Running it"), the pnpm that
# package.json pins, and every package's dependencies, so a lint run never mixes a missing
# install's errors into real ones. A container restart stops Postgres, so this runs on
# every start; each step is a no-op when already done.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

service postgresql start >/dev/null
su postgres -c "psql -qc \"alter user postgres password 'postgres'\"" >/dev/null
for db in ballest_dev smoke; do
  su postgres -c "psql -qtAc \"select 1 from pg_database where datname = '$db'\"" | grep -q 1 ||
    su postgres -c "createdb $db"
done

# corepack can't run pnpm 12 here, so install the pinned version with npm
want=$(node -p 'require("./package.json").packageManager.split("@")[1]')
[ "$(pnpm --version 2>/dev/null)" = "$want" ] || npm install -g -q "pnpm@$want" >/dev/null
for dir in . web discord-bot; do
  (cd "$dir" && pnpm install --prefer-offline >/dev/null)
done
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev node web/scripts/migrate.mjs >/dev/null
# the route types lint reads (docs/linting.md)
(cd web && pnpm exec next typegen >/dev/null)
python3 -m pip install -q --root-user-action=ignore -r tools/requirements-test.txt
