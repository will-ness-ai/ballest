#!/bin/bash
# Readies a cloud session for the repo's checks: the local Postgres the site's tests, the
# collector's tests and `pnpm dev` run against (AGENTS.md, "Running it"), the pnpm that
# package.json pins, every package's dependencies and the Ruff CI pins, so a lint run never
# mixes a missing install's errors, or a newer Ruff's, into real ones. A container restart stops Postgres, so this runs on
# every start; each step is a no-op when already done.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# run by hand after a container restart, it finds the repo from its own path
cd "${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"

# the commit identity CODING_STANDARDS.md asks for
git config user.name will-ness-ai
git config user.email n3s.online@gmail.com
# the pre-push check (docs/linting.md); a root `pnpm install` that changes nothing skips prepare
git config core.hooksPath .githooks

web/scripts/pg-up.sh
su postgres -c "psql -qc \"alter user postgres password 'postgres'\"" >/dev/null
for db in ballest_dev smoke; do
  su postgres -c "psql -qtAc \"select 1 from pg_database where datname = '$db'\"" | grep -q 1 ||
    su postgres -c "createdb $db"
done

# corepack can't run pnpm 12 here, so install the pinned version with npm
want=$(node -p 'require("./package.json").packageManager.split("@")[1]')
[ "$(pnpm --version 2>/dev/null)" = "$want" ] || npm install -g -q "pnpm@$want" >/dev/null
for dir in . web discord-bot; do
  (cd "$dir" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
done
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev node web/scripts/migrate.mjs >/dev/null
# the route types lint reads (docs/linting.md)
(cd web && pnpm exec next typegen >/dev/null)
python3 -m pip install -q --root-user-action=ignore -r tools/requirements-test.txt
# the Ruff CI pins (check.yml): a newer one fails `pnpm check` on rules main doesn't follow
# (docs/linting.md). The image's uv tool ruff comes first on PATH, so replace that one.
v=$(grep -om1 'ruff==[0-9.]*' .github/workflows/check.yml | cut -d= -f3)
if [ "$(ruff --version 2>/dev/null)" != "ruff $v" ]; then
  if command -v uv >/dev/null; then
    uv tool install -q --force "ruff@$v"
  else
    python3 -m pip install -q --root-user-action=ignore "ruff==$v"
  fi
fi

# the review gate (.claude/hooks/review-gate.mjs): a project thread starts outside the repo, so
# it never reads .claude/settings.json; give it the same hooks as user settings
node .claude/hooks/install-user-hooks.mjs "$HOME/.claude/settings.json"
# and its Skill tool can't see the repo's skills, so the gate's /codebase-design (and tdd...) were
# "Unknown skill" there (PR #331, #336, #363). Links in ~/.claude/skills (#338) never reached a
# thread's Skill tool, which sees the skills synced from the account there. The thread's project is
# the main checkout's parent (/home/user), so link them into its .claude/skills, replacing a link
# left dangling and never one of the same name. Every start does it, as the setup script can't
# tell whether the next session starts in the repo or above it.
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
skills="$(dirname "$main")/.claude/skills"
mkdir -p "$skills"
for skill in "$main"/.claude/skills/*/; do
  [ -d "$skill" ] || continue
  link="$skills/$(basename "$skill")"
  [ -L "$link" ] && [ ! -e "$link" ] && rm "$link"
  [ -e "$link" ] || ln -s "${skill%/}" "$link"
done
