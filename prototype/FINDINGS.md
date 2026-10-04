# Ghost replays: what's in them and what fetching them costs

Prototype notes for grill-design on `claude/prototype-entry-data`, measured 2026-10-04.

## What a ghost holds

Every leaderboard row carries `ugc_id`, its ghost replay. Two requests read one:
`ISteamRemoteStorage/GetUGCFileDetails` (Web API key) gives a CDN URL, and that URL serves
plain JSON with no auth. Per ghost, at ~10 Hz: `locations`, `velocities` (cm/s),
`rotation`, `controlRotations`, `elapsedTime`, plus `bestTime` (float seconds, matches the
score), `timestamp` (when the run was set; `0001.01.01` when unset), `skinMaterial`,
`accessory` (hat), `?CheckpointSplits` (empty on every Circuit ghost sampled).

What we derive (`prototype/ghosts.json`, from scratch script `derive.py`):

| Stat | How | Note |
| --- | --- | --- |
| Set on | `timestamp` | the only real "when"; the DB's first seen is "no later than" |
| Avg speed | path length / `bestTime` | on a fixed course it mirrors the time (Track 13: 160-164 m for everyone) |
| Top speed | max of `velocities` | varies independently of rank (Sampler top 50: 103-108 km/h) |
| Distance | path length | a short one flags a shortcut |
| Ball, hat | `skinMaterial`, `accessory` | cosmetics, prettified from the asset names |
| Route | `locations` downsampled to 60 points | top-down; most tracks are nearly straight lines from above |
| Gap along the course | time at the same fraction of distance vs the leader | approximate where routes differ |

Rows with no ghost: `ugc_id == 2**64-1` (old Workshop records), and empty ghosts (the
Track 18 record has 0 samples). Both need a "no replay" state.

## Cost

Measured: 1,241 ghosts (top 50 of 20 Tracks + 5 Workshop Maps) in 113 s at 8 threads, no
errors and no throttling; API call ~330 ms, CDN ~390 ms, 69 KB average (29-111 KB, longer
tracks bigger).

| Scope | Ghosts | Requests | Download | Time at 8 threads |
| --- | --- | --- | --- | --- |
| Everything now | ~143,600 | ~287,000 | ~9.9 GB | ~3.6 h |
| New per day (measured over 24 h of refreshes) | ~5,000 | ~10,000 | ~345 MB | ~8 min |
| Top 50 per board, initial | ~1,250 Circuit + ~37k Workshop rows' top 50 | | | minutes |
| New top-100 ghosts per day | ~1,400 | ~2,800 | ~100 MB | ~2 min |

Constraints: the Steam Web API key allows 100,000 calls a day, so a full backfill alone
takes two days of quota (CDN downloads don't count). A ghost never changes (a new PB gets a
new `ugc_id`), so each is fetched once, ever. Store derived stats (~100 bytes a row) in
Postgres, not the raw files: 143k rows is ~15 MB, against ~10 GB raw.

Strategies, cheapest first:

1. **On demand**: fetch a ghost when someone opens that run, cache the derived row by
   `ugc_id`. Near-zero cost; first open is ~0.7 s slower; no column can be sorted.
2. **Top N, only new**: each Refresh fetches ghosts for new `ugc_id`s in the top N of each
   board. N=100 is ~1,400 a day.
3. **Everything, only new**: ~5,000 a day after a two-day backfill; the only way a whole
   board can sort by a ghost stat.
