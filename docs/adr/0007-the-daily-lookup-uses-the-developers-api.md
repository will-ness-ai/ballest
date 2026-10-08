# The Daily lookup uses the developers' public API

Status: accepted (2026-10-08).

Each Daily (spec #144) has its own Steam board under a generated name, so nothing on Steam
says which board is which day's. The game's developers gave us a key for their public API,
which answers exactly that: a date's Daily, with its Workshop Map, its window and the exact
Steam leaderboard name and ID. The collector asks it, then reads the Daily's scores from
Steam by that ID, like every other board.

This is the one place the project talks to the developers' servers, against the stance in
`AGENTS.md` (read-only, from Steam). It stays narrow: one lookup per Daily the database
doesn't yet hold, paced well under the API's limit; no scores, players or anything else
from it; and the whole endpoint and the key only in the refresh workflow's GitHub secrets
(`BALLEST_DAILY_URL`, the URL a date is appended to, and `BALLEST_API_KEY`), never in the
site, a log line or the repo, which names no host or path of theirs. Nothing from
`research/` or `capture/` is involved.

## Considered Options

- Find Daily boards by name on Steam (`find_board_id`): the names carry a random suffix the
  developers ask us not to construct, so the board can't be named before it is found.
- The base URL secret and the path in code: one less value to keep in step, but it names
  the developers' endpoint in a public repo. Will chose to keep it out (2026-10-08).
