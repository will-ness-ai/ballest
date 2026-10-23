# The bot reads the leaderboard database directly, with plain SQL

Status: accepted (2026-10-04). Amended by ADR 0011: the site counts the Workshop standings and serves them.
Extended 2026-10-18: the Daily Post reads the database the same way (below).

The Daily Report (spec #126) needs every Workshop Map's board, each Map's Author Medal and
creator, and what changed in the last 24 hours: the Score history that ADR 0005 put in
Postgres on Neon. Multiballs reads it directly, with `@effect/sql-pg` and the same
`DATABASE_URL` the collector writes with, set as a Fly secret. Its queries are plain SQL in
`discord-bot/src/report/source.ts`; the schema stays owned by Drizzle in `web/`. The bot keeps
its own SQLite for Matches and Daily Posts (ADR 0003); the Neon client is provided only to the
reads below, each on a connection of its own, so a database that can't be reached fails that
read and never the bot's startup.

The Daily Post (spec #268) reads the same database with the same plain SQL and `DATABASE_URL`,
from two more files. `discord-bot/src/dailyPost/history.ts` reads a past Daily (for the one-time
backfill of the three Dailies before launch, removed after it ran, and now for `pnpm daily-post`):
`dailies`, `boards`, `entries`, `refreshes`, `players`, `ghosts` (a Ghost's `set_at` times a
rebuilt lead) and `board_reads`. `discord-bot/src/dailyPost/spin.ts` reads a Map's file
version from `map_files` and its spinning GIF from `map_spins` (ADR 0013). Neither writes.

A migration that renames or reshapes a table the bot reads must update the file that reads it:

- `report/source.ts`: `maps`, `map_history`, `entries`, `boards`, `players`, `refreshes`,
  `board_reads`.
- `dailyPost/history.ts`: `dailies`, `boards`, `entries`, `refreshes`, `players`, `ghosts`,
  `board_reads`.
- `dailyPost/spin.ts`: `map_files`, `map_spins`.

## Considered Options

- An API route on the site that the bot fetches: reuses `web/db/reads.ts` and its types,
  but the report needs every Map's Entries at once (tens of thousands of rows), which no
  page needs, and the site is mid-port to React.
- Importing `web/db/` into the bot: the bot's image is built from `discord-bot/` alone, and
  it would pull Drizzle and Next's cache wrappers in with it.
- Keep reading Steam, as the script did: ten minutes of leaderboard reads a day, and no
  memory of yesterday.
- A read-only database role: safer, and still possible later; for now the bot's queries
  only read, with the collector's URL.
