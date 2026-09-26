# Multiballs (`discord-bot/`)

The unofficial Discord Match bot: TypeScript on Effect 3 with discord.js and steam-user
(ADR 0003; spec in issue #21, design summary in #20). Domain terms are in the root
`CONTEXT.md`.

## Checking a change

`pnpm test` and `pnpm typecheck`. The tests drive the whole Match engine through fake Steam and
Discord ports, SQLite in memory and Effect's TestClock, and the Discord Surface (where Cards,
Match Threads and the Footer go) over an in-memory channel. The discord.js edge (`client.ts`,
`channel.ts`, `messages.ts`, `interactions.ts`) is checked by running the bot against the test
server.

Every image the bot posts is drawn by `src/render/` (Satori and resvg, fonts from
`@fontsource`); `pnpm render:samples <dir>` writes each one as a PNG to check by eye against the
design prototype on branch `claude/prototype-discord-bot-surfaces`.

The real Steam adapter has no unit tests; `pnpm smoke:steam` runs it against live Steam with the
bot account's secrets, and is the check to run after changing `src/steam/`. Steam drops
leaderboard replies when requests overlap, so `src/steam/session.ts` sends them strictly one at
a time; keep it that way.

## Running it

`pnpm dev` runs the bot for iterating, from any checkout: it uses the main checkout's `.env`
(the test server), its own database in `.logs/dev.sqlite`, and writes its log to
`.logs/bot.log`, emptied at each start. Grep that file for what happened.

One copy runs per channel on a machine: a second start stops with "already running (pid N)".
Stop the running copy by that pid before starting another. On Windows, stopping a background
shell leaves its Node process running.

`pnpm start` in the main checkout is the plain run. `.env` there holds the secrets and names
the server and channel. At startup the bot refuses to run without its channel permissions. The
channel denies Send Messages to `@everyone` to stay read-only, so the bot's role needs an
explicit Send Messages allow on that channel.
