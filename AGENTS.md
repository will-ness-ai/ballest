# Ballest community tools

`CLAUDE.md` is a symlink to this file, so git sees an edit to either as `AGENTS.md`:
stage `AGENTS.md`.

The public monorepo for **Ballest of Them All** (appid `3339810`) community tools. Its
main tool is a static, read-only mirror of the game's Steam leaderboards, live at
https://ballestrecords.com on Vercel (the old ballest.willness.dev redirects there). The
game's leaderboards are not exposed through any public web API, so a collector reads them
from Steam directly and writes the results to a Postgres database the site reads. The
database is the only copy: nothing is committed as JSON since phase 5 of
`docs/nextjs-migration.md`, and `data/`'s git history holds the scores up to then.

`CONTEXT.md` is the domain glossary (Map, Track, Match, ...); use its terms. Decisions
that shape the repo are recorded in `docs/adr/`; read them before restructuring anything.

## Layout

- `web/` — the site: a Next.js app (App Router, server components, `"use cache: remote"`)
  reading the Postgres database the collector writes (ADR 0004, ADR 0005), which Vercel builds and
  serves (project `ballest`, Root Directory `web`). No JS CDN: the only external requests
  are Google Fonts and the Plausible analytics script, served from our own instance on
  Railway. Its layout, caching, routes and the theme: `docs/site.md`. Read it before
  editing the site. It also serves the root site files below, copied into `web/public/`
  at build time by `web/scripts/sync-site.mjs`, so the files to edit stay the ones at the
  root. That script's `SITE` list is what gets published, and `pnpm smoke` (run by
  `web.yml` in CI) fails when a page loads a file it leaves out. Every push to `main`
  deploys, and every other branch gets a preview; `web/vercel.json`'s `ignoreCommand`
  skips commits that touch no site file.
- `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og.png` — the lime-marble icon
  and the 1200×630 link-preview image. Rendered once and committed; `og.png` bakes in its
  text, so the collector never touches it.
- `circuit/<board name>.webp` — each Circuit track's screenshot from the game files; how
  they are made and what pairs with them: `docs/site.md`.
- `docs/data.md` — the database the collector writes and the site reads, table by table,
  and how a Refresh gets there. Read it before changing a table or the write path.
- `tools/campaign_common.py` — the board table and every shared collector helper.
- `tools/steampy_collect.py` — the collector CI runs. **This is the live path.** It reads
  the Circuit boards and keeps the Workshop boards current (`collect_workshop`).
- `tools/steampy_common.py` — the steam.py leaderboard requests the collector and the
  Discord script share: read a board by ID, find a board by name.
- `tools/db_writer.py` — the collector's database write (ADR 0005): `write_refresh` puts
  one Refresh into Postgres in one transaction as change-only Score history, and
  `record_refresh` is the step `on_ready` calls; `load_memory` reads back what the collector
  remembers between runs (names, each Map's board ID and counters, the last full sweep).
  `tools/db_backfill.py` replays the git history of `data/` through the same writer. Their
  tests are `tools/tests/`. The tables: `docs/data.md`.
- `tools/ghosts.py` — the collector's Ghost step, after the database write: reads each top
  run's Ghost once for its ball Skin, which the boards draw from `skins/<asset>.webp`
  (`docs/data.md`, "Ghosts"; `docs/site.md`, "Ball skins").
- `tools/map_files.py` — the collector's Map file step, after the Ghost step: downloads each
  Workshop Map's new or changed file into `map_files` for the 3D view (`docs/data.md`, "Map files").
  `map-files.yml`, by hand, runs it alone for an hour to fill a backlog.
- `tools/workshop_maps.py` — finds a Campaign's Maps (a maker's, a collection's, or a list of
  Workshop links) and prints the `maps:` line; `docs/site.md`, "Campaigns".
- `.github/workflows/refresh.yml` — cron `0 */3 * * *`, writes the Refresh to the database
  and revalidates the site's cached reads; it commits nothing. `backfill.yml`, by hand only,
  runs the backfill against an empty production (cloud sessions can't reach Neon) in the
  same concurrency group. `migrate.yml`, by hand with Will's OK, applies a branch's
  migrations to production before it merges.
- `.github/workflows/vercel-usage.yml` — daily, runs `tools/vercel_usage.py`, which reports the
  Vercel team's plan and renewal, this cycle against Pro's Flat Rate CDN tier, and whether the
  last 30 days would fit Hobby, to the private ops channel (`OPS_WEBHOOK_URL`). It posts on
  Mondays and whenever something nears a limit. Run it by hand to post the numbers anyway.
- `tools/ue4ss_mod/` — BallestGrindStats, a UE4SS Lua mod that shows per-map grind stats
  inside the game. Local-only, nothing on the site reads it; `tools/ue4ss_mod/README.md`
  covers install and how it hooks the game. Its card now ships in AnythingGoes's Grind Stats
  plugin, and the mod is switched off in Will's game.
- `tools/sync_plugin_forks.py` — fast-forwards Will's plugin forks to upstream (see Plugins below).
- `leth/` — a second, self-contained page at `/leth/`: a 3D ghost-route viewer for the
  Leth Trial #1 event board. Frozen snapshots, its own `data/`, not touched by the
  collector; `leth/README.md` covers it.
- `prefabs/samples/` — the two Prefab files Will shared before uploads existed, exactly as
  the game saved them; `web/scripts/prefab-samples.ts` adds them to a database once. The site
  hosts players' Prefabs from the database it writes itself (ADR 0009, `docs/site.md`).
- `discord-bot/` — Multiballs, the unofficial Discord Match bot (TypeScript, Effect 3,
  Node 22, pnpm; ADR 0003, spec in issue #21). Not deployed with the site: it runs on
  Fly.io, deployed by `.github/workflows/bot.yml`; its own `AGENTS.md` covers running it
  locally (dev app only) and production. It also posts the Daily Report in #stats-by-will
  every day, read from the database (ADR 0006, spec #126).
- `multiballs/` — the bot's Terms of Service and Privacy Policy, published with the site at
  `/multiballs/` because the Discord Developer Portal links to them.
- Everything else under `tools/` is the legacy Steamworks-SDK path or a one-off
  reverse-engineering spike. Read `tools/README-hosting.md` before touching any of it.

## Running it

The site runs from `web/` against a local Postgres (never `vercel env pull`: its
development variables point at production):

```bash
cd web
pnpm install
echo DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev > .env.local
pnpm dev
```

(or use the `ballest` config in `.claude/launch.json`, which runs `pnpm dev` on whatever
port it is given). In a cloud session, use `pnpm dev:up <port>` and `pnpm dev:down <port>`
(`docs/site.md`, "Checking a change").

A project thread starts outside the repo, where `.claude/hooks/session-start.sh` (Postgres,
installs, the pinned Ruff) runs only through the cloud environment's setup script; when
Postgres is down or Ruff is the wrong version, run its line from `docs/linting.md`.

A database with real boards comes from backfilling `data/`'s history into it, a tiny one from
`pnpm db:seed tiny` (`docs/data.md`). A page you want to look at but not commit goes in
`scratch/`, which is gitignored. Refreshing data locally needs a
Steam refresh token; the mint-and-collect runbook is `tools/README-hosting.md`. The
secrets (`.env`, `tools/refresh_token.txt`) live in the main checkout and are found from
a worktree.

The collector writes only the database, and reads its memory from it first, so it never
runs without one. A run writes `DATABASE_URL` (production, set only in CI). From a feature
branch, run it with `--dev`, which ignores `DATABASE_URL` and writes only
`DEV_DATABASE_URL`, a local Postgres for now, not a Neon branch. Create a database and
migrate it with
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev node web/scripts/migrate.mjs`,
backfill it so the run starts from real boards rather than looking up every Map's board, then run
`DEV_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev python tools/steampy_collect.py --dev`.

Every file is formatted by Prettier or Ruff and linted by ESLint or Ruff; run `pnpm check`
at the root before pushing (the pre-push hook runs it too), and read `docs/linting.md` for setup, a disabled rule, or a
branch from before the reformat. The collector has no type checks, and its tests are mostly the database writer's: `python -m pytest tools/tests` (deps in
`tools/requirements-test.txt`), against the Postgres at `TEST_DATABASE_URL` (default
`postgres://postgres:postgres@localhost:5432/postgres`), after `pnpm install` in `web/`,
since each test's database is built by `web/scripts/migrate.mjs`. `collector-tests` in
`check.yml` runs them in CI.
The site's checks are in `web/`: `npx tsc --noEmit`, `pnpm test` (vitest, against the same
local Postgres; each test file builds its own database, and qa's own test needs
Chromium: the cloud image has one, elsewhere `npx playwright-core install chromium`), and `pnpm smoke <url>` against a
build seeded with `stress` (as CI does; it holds all of `tiny`). Verify front-end changes
with `pnpm --silent qa check` (preview against production, every page at phone and desktop sizes; `docs/site.md`), and test a board's
infinite scroll with a real wheel scroll: a scripted `scrollTo` does not trigger it in
the preview pane. Verify collector changes with `python -m pytest tools/tests` (no Steam
needed), then a live `--dev` run if the read or write path changed.

`discord-bot/` has its own tests and type checks; `discord-bot/AGENTS.md` covers testing and
running the bot.

## Invariants worth knowing before you edit

**`score_ms` is two different things, and its name lies in both.** On `Map_*` boards it
is a run time in _hundred-thousandths of a second_ — seconds = `score_ms / 100000`, lower
is better — **not** milliseconds. On `Overall*` boards it is points and higher is better,
and the collector's sibling `time` field is meaningless for those rows. The site
discriminates on the name prefix alone (`isPoints` in `web/lib/rules.ts`); gap arithmetic, column
headers, and row nouns all flip off it. Renaming an Overall board, or adding an aggregate
board not named `Overall*`, silently renders a point total as a duration.

The unit is pinned by two independent checks, so don't "correct" it back: every Workshop
map publishes its own medal times in seconds, and under `/100000` each world record lands
10-56% faster than that map's author medal (under `/1000` each would be 27-90x _slower_
than author, which no finished run can be); and the board shapes come out right, with
`Map_Track13` reading 0:10.267 / 0:12.541 / 1:46 for best / median / worst. Do the
conversion through `SCORE_TICKS_PER_SECOND` (`tools/campaign_common.py`, `web/lib/rules.ts`)
rather than a bare literal — reading the field name as milliseconds is exactly the bug
that shipped 100x-too-long times to production once already.

**Adding a Steam board takes two edits, both in `tools/campaign_common.py`**: the tuple in
`BOARDS` (which is also the site's ordering and, for tracks, the in-game number) and the
numeric ID in `LEADERBOARD_IDS`. The collector reads by ID only, so a board missing from
the table is skipped without an error. steam.py's find-by-name does work for this app
once the message header's `routing_app_id` is set to the app (`find_board_id` in
`tools/steampy_common.py`); the collector predates that finding and has not
been switched over.

**Never let a read close a whole board.** A Circuit board whose read fails goes to
`record_refresh` in `failed`, with no rows, and a board that comes back empty is treated the
same: a failed read in `board_reads`, its Entries untouched. A run that reads no Circuit board
at all writes nothing and fails. The Workshop step never blocks the Circuit and never wipes a
Map: a failed Map read keeps its Entries and its old counters (so the next run retries it), a
Map the step skipped gets no `board_reads` row, and a catalogue that fails, comes back short of
Steam's total, or shrinks by more than `WORKSHOP_SHRINK_LIMIT` counts no Map as read. Only a
successful read moves `last_seen_refresh`. The whole Refresh is one transaction, so any error
leaves the database as it was, and a failed write fails the run: the database is the only
copy. Preserve that in any change to the write path. The pagination stop condition in
`fetch_board` is deliberately conservative for the same reason — don't simplify it.

The score stored is the raw `score_ms`, the derived boards are not stored, and `board_kind`
reads Overall from the name prefix, as `isPoints` does. A backfilled Entry's first seen is its
commit's time, so it reads as "no later than".

**Track list order is the in-game numbering.** The game labels Circuit tracks only
`01`..`NN` per season and never shows a name, so `display_name()` derives that number
from a track's position in `S1_TRACKS` / `S2_TRACKS`, and `track_tier()` derives Season
2's Beginner / Intermediate / Advanced heading from the same index in rows of four.
The site keeps the same order in `web/lib/circuit.ts`, and a test reads `BOARDS` to keep
the two together. Inserting or reordering a track renumbers everything after it on the
site. Append new
tracks in the game's own order and verify in-game: the pre-race screen shows each track's
top five, which is enough to match against the site's board.

## Data and git

The database is the only copy of the scores since phase 5 of `docs/nextjs-migration.md`;
`data/`'s git history (the last snapshot is the commit that removed it) holds them up to
then, and `tools/db_backfill.py` refuses to rebuild a database holding anything newer. Before
anything that could lose rows, such as a schema change that rewrites `entries` or the
developers resetting the leaderboards, snapshot production in Neon first (`docs/data.md`).

`CODING_STANDARDS.md` is the review checklist; it also holds the branch and commit
conventions.

## Agent skills

Matt Pocock's `grill-with-docs` (with the `grilling` and `domain-modeling` it calls), `to-spec`,
`to-tickets`, `implement-spec`, `tdd`, `codebase-design`, `code-review`, `wizard`, `retro` (with
`writing-for-agents`) and `setup-matt-pocock-skills` are vendored in `.claude/skills/` (MIT, from `mattpocock/skills`
at `d81f3a1`, recorded in `skills-lock.json`), so cloud sessions have them too. Their
`code-review` replaces the built-in `/code-review` here. `grill-design` comes from
`will-ness-ai/skills`, adapted to prototype in the running app on a worktree, and is
maintained here rather than reinstalled. `discord-sandbox` (ours) plays the bot in real Discord. `wizard` (also `mattpocock/skills`) is adapted the
same way: it delivers its scripts to Will's PC and keeps their values out of the repo's `.env`.
`writing-for-agents` (also `mattpocock/skills`) is adapted too: its `SKILL-MECHANICS.md` says how to word a call to another skill, and the vendored skills' calls follow it.
`agent-tools` (ours) builds commands for agents; `retro` hands it the call chains it finds.
`good-css` (MIT, from `vojtaholik/good-css` at `6d16d2f`, also recorded in `skills-lock.json`) loads on its own whenever you write or
review CSS. The site is dark-only (`docs/site.md`), so skip its light/dark token entry.

The Skill tool refuses those whose `SKILL.md` sets `disable-model-invocation`: `grill-with-docs`,
`implement-spec`, `retro`, `setup-matt-pocock-skills`, `to-spec` and `to-tickets`. When Will's
message names one of those, read `.claude/skills/<name>/SKILL.md` and follow it. Call every
other skill, `code-review` and `codebase-design` included, with the Skill tool.

### Building a feature or fixing a bug

Plan with `/grill-with-docs`, settle anything players will see with `/grill-design`, write
it up with `/to-spec` and `/to-tickets`, build it with `/implement-spec`, which opens the
draft PR, then a final `/code-review`, a `/codebase-design` pass over the code it touched,
and an updated PR. Once it is merged, run `/retro` on the sessions that built it. Each step, how it fits this repo, and which steps
a bug fix takes: `docs/agents/feature-workflow.md`.

A cloud session and a session on Will's PC often work one feature at once. Push to a branch you
made or were handed; before pushing to anyone else's, `git fetch` it and look for an open PR from
the other side, then push a merge on top of theirs, never a force.

### Issue tracker

GitHub issues and pull requests on `will-ness-ai/ballest`, through the `gh` CLI rather than
GitHub MCP tools, cloud sessions included. In a cloud session `gh auth status` always says the
token is invalid (it asks GraphQL, which is blocked there); check with `gh api user` instead.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Plugins

Changes to AnythingGoes's plugin manager or its plugins (Grind Stats) happen in Will's forks
beside this repo and go upstream as pull requests. Checkouts, fork rules, building the host and
testing in a sandboxed game copy: `docs/agents/plugins.md`.

## Do not publish the reverse-engineering material

`research/`, `capture/`, and the traffic-capture scripts are gitignored deliberately:
they document the game developers' internal backend hosts and endpoints. Never copy their
contents into a committed file, a commit message, or a PR description. The agreed stance
for this project is read-only, sourced from Steam rather than the developers' servers, at
a modest cadence. The one exception is the public API the developers gave us for the
Daily (ADR 0007): the collector asks it which Steam board is each day's Daily, with its
endpoint and key in GitHub secrets only, and still reads the scores from Steam.
