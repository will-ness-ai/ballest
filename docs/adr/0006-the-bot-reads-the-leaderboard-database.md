# The bot reads the leaderboard database directly, with plain SQL

Status: accepted (2026-10-04).

The Daily Report (spec #126) needs every Workshop Map's board, each Map's Author Medal and
creator, and what changed in the last 24 hours: the Score history that ADR 0005 put in
Postgres on Neon. Multiballs reads it directly, with `@effect/sql-pg` and the same
`DATABASE_URL` the collector writes with, set as a Fly secret. Its queries are plain SQL in
`discord-bot/src/report/source.ts`; the schema stays owned by Drizzle in `web/`, so a
migration that renames or reshapes `maps`, `map_history`, `entries`, `boards`, `players`,
`refreshes` or `board_reads` must update that file too. The bot keeps its own SQLite for
Matches (ADR 0003); the Neon client is provided only to the report's reads.

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
