# The data files

What the collector writes under `data/` and what the site loads, file by file. Every file
here is CI-owned: see "Data and git" in `AGENTS.md` before committing any of it.

## Circuit boards

- `data/index.json`: board list, counts, `generated_at`. Loaded first.
- `data/boards/<board>.json`: one file per board, lazy-loaded on selection.
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
