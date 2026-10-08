# The data files

What the collector writes under `data/`, file by file. The site reads the database (below);
the files are still published, for anyone who reads them, until phase 5 of
`docs/nextjs-migration.md`. Every file
here is CI-owned: see "Data and git" in `AGENTS.md` before committing any of it.

## Circuit boards

- `data/index.json`: board list, counts, `generated_at`. The Discord bot reads its board IDs.
- `data/boards/<board>.json`: one file per board.
- `data/boards/OverallLeaderboard_AllSeasons.json`: the one board Steam does not have,
  every season's Overall points summed per player (`build_composite` in
  `tools/campaign_common.py`): Season 1 through its current board below, Season 2
  through Steam's. Derived by the collector, so it is written and indexed like any other
  board and needs no leaderboard ID.
- `data/boards/OverallLeaderboard_S1Current.json`: Season 1's Overall points worked out
  from today's track places (`build_current`, with the game's rule in `track_points`).
  Steam's Season 1 board stopped when the season ended; the site lists this one ahead of
  it as "Current" and Steam's as "Final". Derived and indexed like the composite.
- `data/podiums.json`: per-season podium tally (who holds each track's top three),
  then one more entry, `All Seasons`, tallied over every season's tracks at once, for the
  all-seasons board (`build_podiums`). Derived by the collector from the board rows, and
  ranked there; the site shows it as each Overall board's podium column and sort, and
  never re-ranks it. Loaded alongside `index.json`.
- `data/players/<digit>.json`: the board files transposed, every player's rank and
  score on every board, Circuit and Workshop, keyed by Steam ID (`build_players`). Split
  ten ways by the ID's last digit so a player page fetches one ~580KB shard rather than
  every board. Loaded only on a player page.
- `data/names.json`: `[[steam_id, persona], ...]` for every player in the shards, in Steam
  ID order (`build_names`), ~450KB. Loaded the first time someone opens the Compare
  dialog, which searches it by name.
- `data/standings.json`: the Players page's table (`build_standings`). For every player,
  world records, podiums and top 5s, each counted on the Circuit's tracks and on the
  Workshop's Maps, then how many Maps they have a time on:
  `[steam_id, persona, circuit WRs, Workshop WRs, circuit podiums, Workshop podiums, circuit top 5s, Workshop top 5s, Maps]`,
  in Steam ID order. A player with all zeros is left out. ~200KB, loaded only on the
  Players page, which ranks it by whichever column the reader sorts on.

`derive()` in `tools/campaign_common.py` is the one list of what the collector works out
from the board rows and where each file lands. `write_site` publishes that list,
`check_data` compares the committed files against it, and neither restates the assembly.
That matters because a shard's board indices are positions in exactly the board list
`derive` builds: Circuit boards in `BOARDS` order with Season 1's current board just
ahead of Steam's Season 1 Overall, the composite, then every Map. A new derived artifact is one entry there, and is then
written, guarded and checked for free.

## Workshop Maps

- `data/workshop.json`: every Workshop Map (title, creator and their Steam ID, preview
  picture URL, Medals, board ID, entry count), what the homepage shows of its board
  without fetching it (`workshop_stats`: the top three, the 1st-to-3rd gap, runs within a
  second of the record, runs that beat the author time), and the collector's memory of
  what it last read: each Map's Workshop session and subscription counts as of its last
  board read, and `full_sweep_at`. Loaded with `index.json`; it drives the Workshop
  homepage and All maps.
- `data/workshop/<pfid>.json`: one board file per Map that has a time, the same shape as a
  Circuit board file. Maps stay out of `index.json` and `BOARDS`, so the podiums and the
  composite are Circuit-only. The player shards are not: `derive()` takes every Map's rows
  from `workshop_boards`, read back from the Map files after the run has written them, and
  lists them after the composite in each shard's board list, which is what the player
  page's Workshop tab reads.

`collect_workshop` in `tools/steampy_collect.py` reads a Map's board only when its Workshop
session or subscription count moved since the last read, plus every board once every
`FULL_SWEEP_SECONDS`. Player names are carried forward from the committed board files; a
run looks up only players with no name, plus one rotating slice of the rest (`names_due`),
so every name refreshes about weekly.

## The database (ADR 0005)

Postgres on Neon, written alongside the JSON, and what the site reads. It holds only
what Steam reports, as Score history: no ranks and no derived boards. The schema is
`web/db/schema.ts` (Drizzle), and its migrations in `web/db/migrations/` are generated from
it with `pnpm db:generate` and applied by `pnpm db:migrate`, which `pnpm build` runs first,
so each Vercel deploy migrates the branch it reads. Never edit a migration by hand.

- `refreshes`: one per collector Refresh, or per git snapshot replayed by the backfill
  (`source`, and `commit_sha` for a backfill).
- `boards`: every Steam board, Tracks, Overall boards, each Map's and each Daily's, with
  its kind, Season, display name, leaderboard ID and whether it scores points.
- `board_reads`: which boards each Refresh read and whether the read succeeded. A Map not
  read in a Refresh has no row, and that says nothing about play.
- `players` and `persona_history`: the current profile, and every persona with the first
  and last Refresh that saw it.
- `entries`: Score history. A row per score a player has held on a board, with the first
  and last Refresh that saw it and the Refresh that closed it. At most one open row per
  board and player (`entries_one_open`). An unchanged score moves only
  `last_seen_refresh`, and a player gone from a board that was read successfully is
  closed, never deleted. An Overall board (`scores_points`) keeps current points only: a
  changed score updates its open row in place, so its first-seen is when the player first
  appeared there (ADR 0005).
- `maps` and `map_history`: what a Map never changes (its board, creator, created time),
  and a row per change of its title, creator name, preview, Medals, sessions,
  subscriptions or entry count.
- `dailies`: one per Daily (`CONTEXT.md`), by date: its board (`kind = 'daily'`, named
  exactly as the developers' API returns it), the Map's pfid (no foreign key: a Map can
  leave the Workshop) and title, its window (`starts_at`, `ends_at`), and
  `final_refresh`, the first Refresh that read the board ok at or after `ends_at`.

### Dailies are database-only

A Daily gets no file under `data/` and no `git add` line: the site reads only the
database, and phase 5 of `docs/nextjs-migration.md` stops the JSON anyway. So where the
rest of the write path takes what the JSON guards decided, a Daily has its own rule: a
failed or empty read is a `board_reads` row with `ok = false`, and its Entries stay as they
were. `check_db.py` leaves Daily boards out, since there is no file to compare.

The Daily step (`collect_dailies` in `tools/steampy_collect.py`) runs after the Workshop
step and never blocks it or the Circuit. Without `BALLEST_API_KEY` and
`BALLEST_DAILY_URL` (GitHub secrets, given to the collector step only; the URL is a prefix
the collector appends the date to), or without a
database to write to, it is skipped with a log line. It loads the Dailies the database
holds (`db_writer.load_dailies`), and `daily.plan` picks every date since the first Daily
(2026-08-20) with no final Daily: one the database doesn't hold is looked up in the API
(one call a second at most, well under the API's limit; a date with no Daily, or a failed call, is
tried again next run), and one that has opened is read by its `leaderboard_id` through
`fetch_board`, the ones it holds before the ones it looked up. So the first run catches
up on every Daily, and later runs read today's, plus yesterday's until a read after its
close makes it final. The step stops at `daily.BUDGET` (five minutes) with what it has
read (`daily.collect`), abandoning a call still going, so a slow API or board read never
holds up the Circuit and Workshop write; the rest waits for the next run. Nothing assumes a window:
they ran 00:00 to 00:00 UTC through 2026-09-04, 25 hours on 09-05, and 01:00 to 01:00
since. The collector never prints the key or the URL.

### How a Refresh gets there

`record_refresh` in `tools/db_writer.py` is the collector's database step, called from
`on_ready` once `write_site` has written the JSON, with what that run published: the
Circuit boards, the names of those kept from the committed copy (`reused`), and the
Workshop result `write_site` returns (None when the Workshop step failed, its guards kept
the committed files, or its write failed). `write_refresh` writes it in one transaction,
rows loaded by COPY into temp tables and each step one statement, since a Refresh carries
~155k rows across ~1,100 boards (about 5s against a local Postgres):

1. the Refresh, and every board it carries upserted: Tracks and Overall boards from
   `BOARDS`, with `scores_points` from the `Overall` name prefix, and every Map's board.
   The derived boards are skipped.
2. `board_reads`: a Circuit board is ok unless it is in `reused` or came back empty. A Map
   is read only if the Workshop result has its rows (ok) or lists it in `failed` (not ok,
   a read `collect_workshop` tried and lost). A Map not read gets no row.
3. `players` upserted from the rows (a blank persona or picture never overwrites a known
   one), and `persona_history` appended when a persona differs from the player's latest,
   else that row's `last_seen_refresh` moves.
4. `entries`, for boards read ok only: an open Entry whose (player, score) is still on the
   board moves `last_seen_refresh`; one whose score changed, or whose player is gone, is
   closed by this Refresh; a score with no open Entry opens one. The UGC ID is the one first
   seen with that score. On an Overall board a changed score is written into the open
   Entry instead, so only a player who left closes one.
5. `maps` upserted, and `map_history` appended when the title, creator name, preview,
   Medals, sessions, subscriptions or entry count differ from the latest row. Sessions and
   subscriptions are the ones `workshop.json` stores, as of each Map's last board read.
6. Each Daily the Daily step read: its board and `dailies` row upserted, a `board_reads`
   row (ok unless the read failed or came back empty), and its Entries as in step 4.
   `final_refresh` is set by the first ok read at or after `ends_at`, and never moves.

Which database: `DATABASE_URL`, and the step is skipped with a log line without it. With
`--out`, only `DEV_DATABASE_URL` (a local Postgres for now). A failure is logged as a
GitHub `::error::` and the run goes on, since the JSON is still the source. After a
commit, if `SITE_URL` and `REVALIDATE_SECRET` are set, it POSTs `${SITE_URL}/api/revalidate`
with `Authorization: Bearer <secret>`, which revalidates the `data` tag; a failed call is a
warning.

`tools/check_db.py` is the dual-write parity check, run by `refresh.yml` after the commit
step when the `DATABASE_URL` secret is set. Every Circuit board file in `BOARDS` and every
Map file `workshop.json` lists must equal the database's open Entries on that board, as
(steam_id, score) pairs, and a stored board with open Entries must have a file. A Map gone
from the Workshop loses its file while its Entries stay open, since nothing reads it again,
so it is reported but is not drift. Daily boards are left out: they have no file.

`tools/db_backfill.py` replays every commit on the first-parent line that touched
`data/boards`, `data/workshop` or `data/workshop.json`, oldest first, through
`write_refresh` as `source = 'backfill'` Refreshes dated at the commit, with its SHA. A
snapshot's Circuit boards (in `BOARDS`) count as read ok; a Map counts as read only if its
file changed in that commit or first appears in it. It refuses a database holding any
Refresh unless given `--rebuild`, which truncates every table first. `backfill.yml` runs it
against production by hand. On 2026-10-04 it replayed 150 snapshots in ~7.5 minutes
locally to 1.24M Entries and 470 MB, 1.05M of those Entries on the Season 2 Overall board,
whose points move for most players on every Refresh.

Tests in `web/test/` each get a throwaway database on the Postgres at `TEST_DATABASE_URL`
(`postgres://postgres:postgres@localhost:5432/postgres` by default), which `web.yml`
provides in CI. The collector's tests in `tools/tests/` use the same Postgres, each on a
copy of a template database `web/scripts/migrate.mjs` builds, and run in `check.yml`.

### The read layer

The app reads the database only through `web/db/data.ts`, whose functions are
`"use cache: remote"` (shared by every server instance), tagged `data`, with the `max` lifetime: what every page's frame needs
(`getSite`: when the boards were read, every Circuit board's count, the podium tallies), the
Workshop's Maps with their figures (`getWorkshop`), a slice of a board (`getBoardPage`), a
player's record (`getPlayer`) and the Players counts (`getStandings`), and one Daily by its date (`getDaily`, checked against
`getDailyDates` first), whose board is read like any other. Searches
(`searchBoard`, `searchPlayers`) are read fresh. The queries are in `web/db/site.ts`, built on
the ranked boards in `web/db/boards.ts`, and tested against `tiny` (`web/test/site.test.ts`).
Cached values are JSON, so times come back as ISO strings.

Rank is computed, never stored: fastest first on a time board, most points first on one that
`scores_points`, and equal scores by Steam ID in the board's own direction, the lower first
on a time board and the higher first on a points board. That is Steam's order: every tie on
the committed boards (7,288 of them, 2026-10-04) reads that way. Season 1 Current and All
Seasons are computed the same way, from the Track and Overall ranks, as `build_current` and
`build_composite` did, and so are the podiums, the standings and each Map's Workshop figures.
A Map is in the Workshop while its latest `map_history` row was seen by the latest catalogue;
a Map gone from it keeps its Entries but leaves the Workshop pages and the counts. A board's
Score history (`scoreHistory` in `web/db/reads.ts`) is there for the history features.

`POST /api/revalidate` with `Authorization: Bearer $REVALIDATE_SECRET` expires the `data`
tag; anything else, including a deploy with no secret set, gets a 401. The collector calls
it once a Refresh has committed.

### Seeding a branch

`pnpm db:seed <dataset>` in `web/` empties every table of the database at `DATABASE_URL`
and writes a named dataset, in one transaction. The database must already be migrated: a
preview's deploy migrates its branch, and locally `pnpm db:migrate` does. Run it with no
name, or a wrong one, to list the datasets. `empty` has no rows; `tiny` has two Tracks, an
Overall board, three Maps, four Dailies (three final, one live with a failed read), ten
players and three Refreshes of Score history, and is also the fixture the read layer's
tests run against.

It refuses production three ways: when `VERCEL_ENV` is `production`; when the URL's Neon
endpoint ID (the host's first label, without `-pooler`) is `PRODUCTION_DB_ENDPOINT`, which
Vercel sets to production's endpoint for every environment; and, when that variable is
unset, for any host but localhost unless `--i-know-this-is-not-production` is passed.

- **Locally**, use a local Postgres: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/<db>`.
  Never `vercel env pull`: Vercel's Development variables point at production.
- **A preview branch**: Neon gives a git branch's preview deploys their own database
  branch, `preview/<git-branch>`, copied from production on the first deploy and reused by
  later ones, so a seed stays until that branch is deleted. Copy its connection string
  from the Neon console, then from `web/`:
  `PRODUCTION_DB_ENDPOINT=<production endpoint ID> DATABASE_URL='<preview branch URL>' pnpm db:seed tiny`.
  The preview shows the seeded rows once its cached reads are revalidated, by a
  `POST /api/revalidate` to it with the secret. A new deploy may not be: the Data Cache
  can outlive a build.

**Adding a dataset** is a module in `web/db/seed/datasets/` exporting a `Dataset` (a
one-line `description` and a `seed(tx)` that inserts through the schema in `db/schema.ts`)
and one line in that folder's `index.ts` registry. The harness has already emptied every
table and restarted their IDs, so a dataset writes from nothing, and Refresh IDs come back
from the insert rather than being assumed.
