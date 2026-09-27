# Ballest community tools

The public monorepo for **Ballest of Them All** (appid `3339810`) community tools. Its
main tool is a static, read-only mirror of the game's Steam leaderboards, live at
https://ballest.willness.dev on GitHub Pages. The game's leaderboards are not exposed
through any public web API, so a collector reads them from Steam directly and commits the
results as JSON that the page fetches.

`CONTEXT.md` is the domain glossary (Map, Track, Match, ...); use its terms. Decisions
that shape the repo are recorded in `docs/adr/`; read them before restructuring anything.

## Layout

- `index.html` — the entire site. Vanilla JS and CSS in one file: no build step, no
  framework, no JS CDN (Google Fonts is the only external request).
- `data/index.json` — board list, counts, `generated_at`. Loaded first.
- `data/boards/<board>.json` — one file per board, lazy-loaded on selection.
- `data/boards/OverallLeaderboard_AllSeasons.json` — the one board Steam does not have:
  every season's Overall points summed per player (`build_composite` in
  `tools/campaign_common.py`). Derived by the collector from the `Overall*` rows it just
  read, so it is written and indexed like any other board and needs no leaderboard ID.
- `data/podiums.json` — per-season podium tally (who holds each track's top three),
  derived by the collector from the board rows. Loaded alongside `index.json`.
- `data/players/<digit>.json` — the board files transposed: every player's rank and
  score on every board, keyed by Steam ID (`build_players` in
  `tools/campaign_common.py`). Split ten ways by the ID's last digit so a player page
  fetches one ~400KB shard rather than every board. Loaded only on a player page.
- `derive()` in `tools/campaign_common.py` is the one list of what the collector works
  out from the board rows and where each file lands. `write_site` publishes that list,
  `check_data` compares the committed files against it, and neither restates the
  assembly — which matters, because a shard's board indices are positions in exactly
  the board list `derive` returns, composite last. A new derived artifact is one entry
  there, and is then written, guarded and checked for free.
- `tools/campaign_common.py` — the board table and every shared collector helper.
- `tools/steampy_collect.py` — the collector CI runs. **This is the live path.**
- `tools/ugc_discord_leaderboard.py` — local, on demand: reads every Workshop map's
  board and prints a Discord post (most custom maps beaten, most author medals, most
  world records and top 5s, and the longest-standing campaign and Workshop records).
  Not part of CI and writes nothing into the repo.
- `.github/workflows/refresh.yml` — cron `0 */3 * * *`, commits refreshed data to `main`,
  then calls `deploy.yml`.
- `.github/workflows/deploy.yml` — the Pages deploy (Source: GitHub Actions). Publishes
  only `index.html`, `data/`, `leth/` and `CNAME`, so a new site file must be added to
  its `cp` line or it 404s in production. Runs on push to `main`, by hand, and from
  `refresh.yml`, whose `GITHUB_TOKEN` push triggers no other workflow.
- `tools/ue4ss_mod/` — BallestGrindStats, a UE4SS Lua mod that shows per-map grind stats
  inside the game. Local-only, nothing on the site reads it; `tools/ue4ss_mod/README.md`
  covers install and how it hooks the game.
- `leth/` — a second, self-contained page at `/leth/`: a 3D ghost-route viewer for the
  Leth Trial #1 event board. Frozen snapshots, its own `data/`, not touched by the
  collector; `leth/README.md` covers it.
- `discord-bot/` — Multiballs, the unofficial Discord Match bot (TypeScript, Effect 3,
  Node 22, pnpm; ADR 0003, spec in issue #21). Not deployed with the site: it runs on
  Fly.io, deployed by `.github/workflows/bot.yml`; its own `AGENTS.md` covers running it
  locally (dev app only) and production.
- Everything else under `tools/` is the legacy Steamworks-SDK path or a one-off
  reverse-engineering spike. Read `tools/README-hosting.md` before touching any of it.

## Running it

The page fetches with relative paths, so `file://` will not work. Serve it:

```bash
python -m http.server 8731
```

(or use the `ballest` config in `.claude/launch.json`). Refreshing data locally needs a
Steam refresh token; the mint-and-collect runbook is `tools/README-hosting.md`. The
secrets (`.env`, `tools/refresh_token.txt`) live in the main checkout and are found from
a worktree.

The site and the collector have no tests, linters, or type checks. Verify front-end changes by loading
the served page. Verify collector changes with `python tools/check_data.py` (no Steam
needed), then a live run if the read path changed.

`discord-bot/` has its own tests and type checks; `discord-bot/AGENTS.md` covers testing and
running the bot.

## Invariants worth knowing before you edit

**`score_ms` is two different things, and its name lies in both.** On `Map_*` boards it
is a run time in *hundred-thousandths of a second* — seconds = `score_ms / 100000`, lower
is better — **not** milliseconds. On `Overall*` boards it is points and higher is better,
and the collector's sibling `time` field is meaningless for those rows. The site
discriminates on the name prefix alone (`isPoints` in `index.html`); gap arithmetic, column
headers, and row nouns all flip off it. Renaming an Overall board, or adding an aggregate
board not named `Overall*`, silently renders a point total as a duration.

The unit is pinned by two independent checks, so don't "correct" it back: every Workshop
map publishes its own medal times in seconds, and under `/100000` each world record lands
10-56% faster than that map's author medal (under `/1000` each would be 27-90x *slower*
than author, which no finished run can be); and the board shapes come out right, with
`Map_Track13` reading 0:10.267 / 0:12.541 / 1:46 for best / median / worst. Do the
conversion through `SCORE_TICKS_PER_SECOND` (`tools/campaign_common.py`, `index.html`)
rather than a bare literal — reading the field name as milliseconds is exactly the bug
that shipped 100x-too-long times to production once already.

**Adding a Steam board takes two edits, both in `tools/campaign_common.py`**: the tuple in
`BOARDS` (which is also the site's ordering and, for tracks, the in-game number) and the
numeric ID in `LEADERBOARD_IDS`. The collector reads by ID only, so a board missing from
the table is skipped without an error. steam.py's find-by-name does work for this app
once the message header's `routing_app_id` is set to the app (`find_board_id` in
`tools/ugc_discord_leaderboard.py`); the collector predates that finding and has not
been switched over.

**Never let a run publish an empty board.** `steampy_collect.py` falls back to the
previously committed file when a read fails, and aborts the run without writing anything
if a board has neither (the `except` branch and the `hard_failed` check in `on_ready`).
The derived files carry the same rule, once, in `write_site`: each artifact `derive()`
returns says whether it came out empty, and one empty artifact keeps the committed copy
of every derived file, since they all come from the same rows.
Preserve that in any change to the write path. The pagination stop condition in
`fetch_board` is deliberately conservative for the same reason — don't simplify it.

**`.gitignore` ignores `data/*`**, re-including only `!data/index.json`, `!data/boards/`,
`!data/podiums.json` and `!data/players/`. A new artifact written under `data/` is
invisible to git and 404s in production; the workflow's `git add` line also has to name
it.

**The page has two hash routes**, read by `route()` on load and on `hashchange`:
`#/player/<steam_id>` and `#/board/<board name>` with an optional `/<steam_id>` that
marks that player's row once the board is open. Every player name links to a player page
(`nameHtml`), and the link out to Steam lives on that page rather than on the name.
Selecting a board goes through the route too (`go(boardHash(...))`), so nothing calls
`selectBoard` to navigate — that is what makes a board, and a player's row on it,
something you can link to. Anything else in the hash means the board already on screen,
or the default one.

**`playerRecord` is the only part of the player page that reads the board table.**
It turns a shard plus a Steam ID into everything the page shows — identity, medals,
seasons, tiers, each track with its own field size and record — and the rendering below
it is markup over that record. A finish is matched to the board table **by name**
through the shard's own `boards` list, never by position in `index.json`, which a cached
shard may disagree with.

**Rows are index-aligned to rank.** `rowHtml` reaches for `rows[r.rank - 2]` to compute
the interval to the next rung up, so sorting, filtering, or de-duping the array in place
breaks it.

**Track list order is the in-game numbering.** The game labels Circuit tracks only
`01`..`NN` per season and never shows a name, so `display_name()` derives that number
from a track's position in `S1_TRACKS` / `S2_TRACKS`, and `track_tier()` derives Season
2's Beginner / Intermediate / Advanced heading from the same index in rows of four.
Inserting or reordering a track renumbers everything after it on the site. Append new
tracks in the game's own order and verify in-game: the pre-race screen shows each track's
top five, which is enough to match against `data/boards/`.

**The theme lives in CSS custom properties** on `:root` in `index.html`. It is dark-only
and mobile-first with a single `min-width:820px` breakpoint.

## Data and git

`data/` is CI-owned. The refresh workflow commits straight to `main` every three hours,
so don't hand-edit data files and don't carry regenerated data on a feature branch — it
will conflict. A brand-new data artifact is the exception: its first copy ships with the
code that introduces it, so the feature works on merge rather than after the next
refresh. Data commits read `data: refresh campaign leaderboards (<UTC>)` and touch only
`data/index.json`, `data/boards/`, `data/podiums.json` and `data/players/`; keep code
changes out of them.

`CODING_STANDARDS.md` is the review checklist; it also holds the branch and commit
conventions.

## Do not publish the reverse-engineering material

`research/`, `capture/`, and the traffic-capture scripts are gitignored deliberately:
they document the game developers' internal backend hosts and endpoints. Never copy their
contents into a committed file, a commit message, or a PR description. The agreed stance
for this project is read-only, sourced from Steam rather than the developers' servers, at
a modest cadence.
