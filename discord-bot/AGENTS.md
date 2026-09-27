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
(the "Multiballs (dev)" app on the test server), its own database in `.logs/dev.sqlite`, and
writes its log to `.logs/bot.log`, emptied at each start. Grep that file for what happened.

Every local run is the dev app on the test server: `pnpm dev`, or `pnpm smoke:steam` for the
Steam adapter. Production lives only on Fly (below): change it by merging to `main`, inspect it
with `fly status -a multiballs` and `fly logs -a multiballs`, and bring it back with
`fly machine restart -a multiballs`. A local copy logged in as the production app answers every
click alongside Fly, so a checkout never holds production's token or starts production, not even
to restore it while it is down.

One copy runs per channel on a machine: a second start stops with "already running (pid N)".
Stop the running copy by that pid before starting another. On Windows, stopping a background
shell leaves its Node process running.

At startup the bot refuses to run without its channel permissions. The channel denies Send
Messages to `@everyone` to stay read-only, so the bot's role needs an explicit Send Messages
allow on that channel.

## Production

Production is the "Multiballs" app on the community server, running on Fly.io (`fly.toml`,
`Dockerfile`). `.github/workflows/bot.yml` tests every PR and deploys every push to `main` that
touches `discord-bot/`; nothing else deploys, and no checkout holds production's secrets. They
live in `fly secrets`, and the repo holds only `FLY_API_TOKEN`, a deploy token for the one app.
`.dockerignore` keeps `.env` and databases out of the image; keep it that way.

A deploy stops the old copy before starting the new one (one volume, one machine), and the
engine's restart recovery resumes live Matches. `src/ops.ts` pings Healthchecks.io every minute
(`HEALTHCHECK_URL`), which alerts the private `#multiballs-ops` channel when pings stop, and
posts there daily (`OPS_WEBHOOK_URL`) once the Steam refresh token has 30 days left; renew it
with `tools/steampy_mint.py` and `fly secrets set STEAM_REFRESH_TOKEN=...`. Logs: `fly logs`.
`.github/workflows/bot-cost.yml` posts a weekly cost estimate there (`scripts/cost_report.py`;
Fly has no billing API, so it prices what is provisioned with the rates in that script, and
reads payment health, billing status and card on file, from Fly's undocumented GraphQL API).
