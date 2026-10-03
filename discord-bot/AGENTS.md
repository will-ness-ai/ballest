# Multiballs (`discord-bot/`)

The unofficial Discord Match bot: TypeScript on Effect 3 with discord.js and steam-user
(ADR 0003; spec in issue #21, design summary in #20). Domain terms are in the root
`CONTEXT.md`.

## Checking a change

`pnpm test` and `pnpm typecheck`. The tests drive the whole Match engine through fake Steam and
Discord ports, SQLite in memory and Effect's TestClock, and the Discord Surface (where Cards,
Match Threads and the Footer go) over an in-memory channel. Every message the bot sends is built
in `messages.ts` from plain data; `test/messages.test.ts` checks each one's buttons and pings, so
a new button or post gets a case there. The discord.js calls (`client.ts`, `channel.ts`,
`interactions.ts`) are checked by running the bot against the test server.

Every image the bot posts is drawn by `src/render/` (Satori and resvg, fonts from
`@fontsource`); `pnpm render:samples` writes each one as a PNG to `.logs/samples/` to check by
eye against the design prototype on branch `claude/prototype-discord-bot-surfaces`.

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

It also refuses to run unless it can use the @Multiplayer ping role (Lobby pings, spec #87),
whose id is `DISCORD_PING_ROLE_ID` (a different role for the dev app's test server and for
production; set it in the main checkout's `.env` and in `fly secrets`). The role must exist, the
bot needs Manage Roles with its own role above @Multiplayer ping, and the role must be
mentionable or the bot allowed to Mention @everyone, @here and All Roles. That is the only
role the bot ever adds or removes (`src/discord/pingRole.ts`, behind the `PingRole` port), and
`src/pings.ts` is the one place both surfaces go through for it; its words are in
`src/pingWords.ts`.

## The Activity

`src/activity/` is a Discord Activity (spec #46): the same Matches in a page Discord shows in an
iframe, from Link Steam to the live standings and the Result. `api.ts` is an HTTP API over the
Engine, tested in `test/activity.test.ts` like the engine tests; it names Players as the server
does and refuses anyone outside `DISCORD_GUILD_ID`. `auth.ts` swaps the SDK's OAuth code for an
access token and holds the ports for Discord sign-in and server members. `server.ts` serves the
page (`web/`: `view.ts` is the markup, `app.ts` the state and actions, bundled by esbuild at
startup), its fonts from `@fontsource`, and each Map's Workshop preview (from `src/previews.ts`),
because Discord's proxy blocks every other host. The page polls every two seconds. The visual reference
is the prototype on branch `claude/prototype-activity-surfaces`.

The Activity's art in the Developer Portal (the app icon, and the cover and grid-view background
under Activities -> Art Assets) is drawn by `src/render/` too: `pnpm render:activity-art` writes it
to `assets/activity/`, with a DEV-tagged icon and cover for the dev app in `assets/activity/dev/`.
The PNGs are committed; upload them by hand after changing them.

The channel and the Activity show the same Matches, so what they say comes from one place, and a
change there reaches both: the Board Slab's rows and a Match's words from `src/present.ts`, every
PB's rank, gain and world record from `progress` in `domain.ts` (the engine posts exactly that),
marbles and Medals from `render/art.ts`, each Map's preview from `src/previews.ts`, and each
member's buttons from `actionsFor`. Test those in
`test/present.test.ts` and at the API; the surfaces only lay them out.

`pnpm activity:demo` (or the `activity-demo` launch config) runs the page and API on port 8740
over the tests' fake Steam, with no Discord: pick a member to sign in as, or add `?as=d-bob` for a
second tab (alice starts unlinked; paste `https://steamcommunity.com/id/alice`), and `?pip` for
the small view Discord's picture-in-picture window gets. Fake racers set
times once a Match is live. The page is bundled at startup, so restart the demo after editing it.

The bot serves it on `PORT` (default 8080) only when `DISCORD_CLIENT_SECRET` and
`DISCORD_APPLICATION_ID` are set; otherwise nothing listens. Trying it in Discord needs, in the
Developer Portal: Activities enabled, a URL Mapping from `/` to the server's public host, and the
OAuth2 client secret. Locally that host is a fixed ngrok domain, `NGROK_DOMAIN` in the main
checkout's `.env`: `pnpm dev` opens the tunnel to it and closes it on exit, and the dev app's URL
Mapping points there for good. `scripts/ngrok-wizard.sh` sets it up (the human runs it, not an
agent). A blank Activity means Discord can't reach the page: no tunnel running, or the mapping
pointing somewhere else.
Production serves it at `https://multiballs.fly.dev` (`fly.toml`'s `http_service`), with
`DISCORD_APPLICATION_ID` and `DISCORD_CLIENT_SECRET` in `fly secrets` and the production app's
URL Mapping pointing there.

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
