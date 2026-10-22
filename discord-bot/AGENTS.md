# Multiballs (`discord-bot/`)

The unofficial Discord Match bot: TypeScript on Effect 3 with discord.js and steam-user
(ADR 0003; spec in issue #21, design summary in #20). Domain terms are in the root
`CONTEXT.md`.

## Checking a change

`pnpm test` and `pnpm typecheck` here, and `pnpm check` at the repo root for formatting and lint
(`docs/linting.md`). The tests drive the whole Match engine through fake Steam and
Discord ports, SQLite in memory and Effect's TestClock, and the Discord Surface (where Cards,
Match Threads and the Footer go) over an in-memory channel. Every message the bot sends is built
in `messages.ts` from plain data; `test/messages.test.ts` checks each one's buttons and pings, so
a new button or post gets a case there. The discord.js calls (`client.ts`, `channel.ts`,
`interactions.ts`) are checked by running the bot against the test server, in the sandbox below.

Every image the bot posts is drawn by `src/render/` (Satori and resvg, fonts from
`@fontsource`); `pnpm render:samples` writes each one as a PNG to `.logs/samples/` to check by
eye against the design prototype on branch `claude/prototype-discord-bot-surfaces`.

The real Steam adapter is tested only where it recovers: `test/steamSession.test.ts` drives
`src/steam/session.ts` over a fake steam-user client to check it logs on afresh once Steam stops
answering. `pnpm smoke:steam` runs it against live Steam with the
bot account's secrets, and is the check to run after changing `src/steam/`;
`pnpm smoke:steam-outage` does the same with a client that stops hearing Steam's replies, and
passes once the session has logged on afresh and read again (a few minutes). Steam drops
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

One copy runs per home channel on a machine: a second start stops with "already running (pid
N)". Stop the running copy by that pid before starting another. On Windows, stopping a background
shell leaves its Node process running.

## Venues

One process plays in every Venue (CONTEXT.md, spec #315): a server, its Match channel and its
@Multiplayer ping role. The home Venue, the game Discord, is `DISCORD_GUILD_ID`,
`DISCORD_CHANNEL_ID` and `DISCORD_PING_ROLE_ID`, and its name is `home`. Every other server the
bot is in is a Venue it set up itself (spec #321, `src/venues.ts`), named by the server's id,
which is the key stored on its Matches.

A server becomes a Venue by inviting the bot. The production app is private, so only Will can
invite it, and any server it is invited to becomes a Venue. The invite link is

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=bot%20applications.commands&permissions=326686198800
```

(scopes `bot applications.commands`; permissions `326686198800` are the channel permissions the
bot checks for, Mention @everyone, @here and All Roles, Manage Roles and Manage Channels). The
moment it joins (the Guilds intent's guild create event) the bot sets the server up. At startup
only servers already stored as Venues are picked up (and repaired): a server the bot was in
before is set up only once it is invited again, so a deploy never adds a channel nobody asked for.

- **Channel:** a text channel named `multiballs`, reused if there is one, else created. @everyone
  is denied Send Messages (members talk in Match Threads), and the bot's own member is allowed
  every permission it checks for.
- **Role:** a role named `Multiplayer ping`, reused if there is one below the bot's highest role,
  else created, mentionable (Discord puts a new role below the bot's, so it can manage it).
- **Stored:** the ids go in SQLite's `venues` table. At each start a stored Venue whose channel or
  role is gone is set up again the same way; one with both still there is left as it is.

Then it is checked as home is, and runs at once: its Footer goes up and its clicks, ping role
and Activity work, with no restart (the running Venues are a live set, `Discord.changes`, that
the Surface router, `interactions.ts`, `pingRole.ts` and the Activity read). A server that removes
the bot stops being a running Venue; its row stays, so inviting it again picks it back up. The
setup rules are tested on a fake server behind the `SetupGuild` port (`test/venues.test.ts`);
`src/discord/setupGuild.ts` is the port on discord.js, checked live by inviting the dev app to a
second server while `pnpm dev` runs. The dev app's home is the test server, so `pnpm dev` and
the sandbox set nothing up there.

Each Venue has its own Footer, Cards and Match Threads (a `venue_layouts` row each, behind the
router in `src/discord/surface.ts`), its own queue (a Match's `venue`), its own ping role and its
own ping-offer answers. Links, Chosen Skins, the Steam session and "one Match at a time" are
shared. Clicks are handled in the Venue they came from; anywhere else they get "Multiballs only
works in its own channel." The Daily Report, Daily Posts, #new-tracks and ops stay home's only.
The Activity serves every running Venue: opened in a Venue's server it shows and opens that
Venue's Matches only, linked into its channel (#317).

Each Venue is checked as it starts: its channel permissions, and its ping role. Home failing a
check stops the bot, as before; a server the bot can't set up (it lacks Manage Channels or Manage
Roles, say) or whose Venue fails a check is left out with a line to the ops channel while the bot
runs on. A Match open in a Venue that isn't running still runs to its Result and is stored,
unseen, but keeps none of its Players Busy (the Surface port's `runs`). Each channel denies Send
Messages to `@everyone` to stay read-only, so the bot needs an explicit Send Messages allow on
it: in a Venue it set up, its own overwrite; in home, set by hand on the bot's role.

The ping role (Lobby pings, spec #87) is a different role for the dev app's test server and for
production; set `DISCORD_PING_ROLE_ID` in the main checkout's `.env` and in `fly secrets`. In
each Venue the role must exist, the bot needs Manage Roles with its own role above @Multiplayer
ping, and the role must be mentionable or the bot allowed to Mention @everyone, @here and All
Roles (a role the bot made is mentionable). That is the only role the bot ever adds or removes
(`src/discord/pingRole.ts`, behind the `PingRole` port), and `src/pings.ts` is the one place both surfaces go through for it; its words
are in `src/pingWords.ts`.

## The sandbox: driving the bot on the test server

`pnpm sandbox` runs the real bot on the dev app in a channel of its own, with two swaps: the
tests' fake Steam (any profile links, as `fake-<name>`, and times are set on demand), and a
driver on `127.0.0.1:8741` that clicks buttons, picks and submits forms as any member. Discord
lets only people press an app's buttons, so the driver hands `interactions.ts` a stand-in
Interaction (`scripts/sandbox/driver.ts`): everything from there inwards runs as for a real click,
and what the bot answers privately comes back to the caller. A fresh database each start; log
in `.logs/sandbox.log`. It leaves clicks in other channels alone, so it runs beside `pnpm dev`.

`pnpm --silent axi` is how an agent uses it (`--silent` keeps pnpm's echo out; AXI style: run it bare for the state of things, every answer
ends with next steps). It reads as the Admin app ("Multiballs Dev Server Admin"), `ADMIN_DISCORD_TOKEN` in the
dev `.env`, which sees the channel and Match Threads as a member does:

```
pnpm --silent axi sandbox create                # once: a channel the bot can post in
pnpm sandbox                                    # in another shell
pnpm --silent axi press "New Match" --as admin  # labels: the last private answer, then the channel
pnpm --silent axi read                          # the channel; `show <id>` saves its images to read
pnpm --silent axi time <match> 18.2 --as admin  # a finished run, read on the engine's next poll
pnpm --silent axi wait "Go!" --in <thread>
pnpm --silent axi steam down                    # every fake Steam read fails until `steam up`
```

Without `ADMIN_DISCORD_TOKEN` it reads with the dev bot's token: its own messages only, and no
sandbox setup. `--as` takes a member id, `admin`, or a name; pinging a member pings them for
real, so play as `admin` and members who expect it.

It needs a machine that reaches Discord, which cloud containers don't: Will's PC, through Remote
Control. The Admin app is set up there once. In the Developer Portal it has the Message Content
intent (to read other bots' posts) and the Server Members intent (for `axi members`), and it was
invited to the test server with Administrator, so it can make and delete channels. To make it
private, set Installation → Install Link to None before turning off Public Bot; Discord refuses
the other order. The `discord-sandbox` skill is the run, step by step.

What to check where: Match rules in `test/engine.test.ts`, what lands in the channel in
`test/surface.test.ts`, each message's buttons and pings in `test/messages.test.ts`, and the
discord.js calls (what Discord actually renders, threads, pings, edits) in the sandbox.

## Chosen Skins

A player's Chosen Skin (CONTEXT.md, spec #276) replaces their hue marble in every image the
Renderer draws and in Match Thread lines; the bot reads no Ghosts, so its order is Chosen Skin,
then hue. `src/chosenSkins.ts` reads `chosen_skins` at `DATABASE_URL` at most once a minute;
with no database (`pnpm dev`, the sandbox) or one it can't read, everyone keeps their hue. Run
the sandbox with `DATABASE_URL` set to a local database to see picks. The engine reads the
`ChosenSkins` port as it builds each Card view and thread post, which carry their Players' Skins
(`skins` on a `CardView`, `skin` on a post about one Player), so a redraw draws exactly what the
post brought; the Link confirmation and the Daily Report read them as they build their image.
`SkinPictures` (`src/render/skins.ts`) reads the pictures once at startup for the Renderer,
`Marbles` and the Activity, which serves them at `/skins/` beside its fonts and draws a Player's
Chosen Skin from what its API sends (`skins` on a Match view, `skin` on the viewer's Link, the
Challenge picker and the Link preview). The Skin list and its
pictures are copies of the site's (`src/render/skinList.ts`, `assets/skins/`, made by
`scripts/skin_pngs.py`), since resvg reads no WebP and the Fly image is built from
`discord-bot/` alone; `test/skins.test.ts` holds them to `web/lib/skins.ts`. `Marbles` uploads
one application emoji per Skin (`skin_<name>`) at startup beside the hue marbles.

`test/chosenSkins.test.ts` reads a throwaway database on the Postgres at `TEST_DATABASE_URL`
(default the local one), migrated by `web/scripts/migrate.mjs`, so `pnpm test` needs Postgres
running and `pnpm install` in `web/` too; `bot.yml` gives CI both.

## The Activity

`src/activity/` is a Discord Activity (spec #46): the same Matches in a page Discord shows in an
iframe, from Link Steam to the live standings and the Result. `api.ts` is an HTTP API over the
Engine, tested in `test/activity.test.ts` like the engine tests. `/api/config` lists the running
Venues' servers; the page refuses any other, and names its server in the `x-discord-guild`
header of every request (`GUILD_HEADER`; one without it, from a page loaded before Venues, is
home's). The API serves that Venue: it checks the member is in that server, names Players as
that server does, and lists, opens, links and pings that Venue's only, answering another Venue's
Match as not found. Links, Chosen Skins and Busy are shared (Busy by the engine's `isBusy`, which
skips a Venue that isn't running). The running Venues are read at each request, so a Venue that
starts or stops while the bot runs is served or refused from then on. `auth.ts` swaps the SDK's OAuth code for an
access token and holds the ports for Discord sign-in and server members. `server.ts` serves the
page (`web/`: `view.ts` is the markup, `app.ts` the state and actions, bundled by esbuild at
startup), its fonts from `@fontsource`, each Map's Workshop preview (from `src/previews.ts`) and
each Skin's picture, because Discord's proxy blocks every other host. The page polls every two seconds. The visual reference
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
OAuth2 client secret. Locally that host is a Cloudflare quick tunnel (`cloudflared`, installed
on the PC): `pnpm dev` opens one, prints its `*.trycloudflare.com` address, and closes it on
exit. The address is new every start, so the human pastes it into the dev app's URL Mapping for
`/` each time; tell them the address when you start the bot. Fixed addresses were tried and
dropped: ngrok's free plan shows browsers a warning page that renders as a blank Activity, and
the others needed a domain move or more setup than it was worth. A blank Activity means Discord
can't reach the page: no tunnel running, or the mapping still holding an old address. To see
exactly what Discord gets, fetch `https://<DISCORD_APPLICATION_ID>.discordsays.com/` with a
browser User-Agent: that is Discord's own proxy to the mapping. `pnpm dev` does this itself
after opening the tunnel and says when Discord serves the page, so the human relaunches the
Activity once it does. Fetching the tunnel's address
from Will's PC proves nothing either way: his home network (Xfinity Advanced Security) blocks
new hosts, and https to them fails with a TLS "wrong version number".
Production serves it at `https://multiballs.fly.dev` (`fly.toml`'s `http_service`), with
`DISCORD_APPLICATION_ID` and `DISCORD_CLIENT_SECRET` in `fly secrets` and the production app's
URL Mapping pointing there.

## The Daily Report

`src/report/` posts the Daily Report (spec #126, design on branch
`claude/prototype-daily-report`) in `STATS_CHANNEL_ID` at 16:00 UTC: the day, the counts and
Since yesterday in the channel with the four Workshop standings as an image and one link button under it,
"Where do I stand?", to the site's `/you` (spec #221), and the map lists and longest-standing
records in a thread on it. The button and the message's Map links go to the live site whatever
`SITE_URL` says, so a sandbox post's button opens the real `/you`; the bot never hears a press
of a link button, and it never edits the message. The Workshop standings come from the site: it counts
them and serves them at `GET /api/standings` (ADR 0011), which `standings.ts` reads
at `SITE_URL` (default the live site) with the baseline 24 hours before the post, so the image's
places are the site's shared places. Everything else reads the leaderboard database at
`DATABASE_URL` (ADR 0006: plain SQL over the schema `web/` owns, in `source.ts`), and records are
dated from their ghost replays through the Steam Web API. A site or database that can't be read
fails that day's post, and ops hears. It is off unless `STATS_CHANNEL_ID` and `DATABASE_URL` are both set, so `pnpm dev` and
the sandbox never post it. Each posted day is recorded in SQLite (`daily_reports`); a bot that
was down at 16:00 posts once when it starts, and a day whose last Refresh is over 48 hours old
is skipped with a note to the ops channel, as is a post that fails.

What it says is pure and tested: the Workshop standings (from a fake of the site's payload), lists and Since
yesterday in `report.ts` (`test/report.test.ts`), the words and the button in `messages.ts` (the
button in `test/messages.test.ts`), the schedule in `daily.ts` over fakes on the
TestClock (`test/daily.test.ts`). The SQL and the Discord REST calls are checked by posting one:

```
pnpm --silent axi sandbox create
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev pnpm report
pnpm --silent axi read --full
```

`pnpm report` posts the report now into the sandbox channel (or `--channel <id>`), skipping the
schedule's checks, and refuses any database but a local one. Its Workshop standings come from `SITE_URL`;
set it to a local `pnpm dev` of `web/` on the same database to have them agree with the rest. Fill a local Postgres with real
history by migrating it (`web/scripts/migrate.mjs`) and replaying `tools/db_backfill.py` into it
(`docs/data.md`); the database must be UTF-8.

In production the bot's role needs View Channel, Send Messages, Attach Files, Create Public
Threads and Send Messages in Threads in #stats-by-will, and `fly secrets` needs `STATS_CHANNEL_ID`
and `DATABASE_URL` (the collector's Neon URL).

## The Daily Post

`src/dailyPost/` posts each Daily's Daily Post (spec #268, design on branch
`claude/prototype-daily-post`) in `DAILY_CHANNEL_ID` (in `fly.toml`). From 01:00 UTC it asks the
developers' Daily API (`BALLEST_DAILY_URL` with the date appended, `BALLEST_API_KEY` in the
`BallestAPIKey` header; both secrets, never logged) every minute until today's Daily answers, then
posts its card, a Components V2 message with the Workshop screenshot attached, and a thread on it.
Every 15 minutes it reads the Daily's own Steam board (ranks 1 to 3 and the entry count, one
request through the bot's session) and edits the card only when what it shows changed; the first
read at or after the Daily's end is its last, and always turns the card into the result: "🏆 X
wins" (everyone on the fastest time shares it; a read sees only the top 3), the winning time and
player count, the final podium, the pictures and the lead graph drawn without "now", `Closed
<t:f> · final`, and the site button reading "Final board" for "Today's board", or "No winner"
when nobody set a time. A bot that was down at the close makes
that read as it starts. Each post is recorded in SQLite (`daily_posts`), so
a restart resumes the live one and never posts a date twice. Each read that changes the lead (its
time or who holds it) is recorded too (`daily_leads`, `lead.ts`): once the card shows it, with the
lead graph under the podium redrawn by `src/render/` (`leadGraphScene`), the thread gets a quiet
`-#` line for the first time, a steal (with how long the Reign it ended lasted), a tie, or the
leader improving their own time; several changes between two reads are one line, the latest. A
Components V2 message lists its files only in its components' `media` items, not under
`attachments`, so an edit that replaces the graph reads them from there to keep the rest. A failed read keeps the card; the API
failing, no Daily an hour after 01:00, and a post, thread or edit refused each reach ops once until
they clear. It is off unless all three settings are set and the bot has View Channel, Send
Messages, Embed Links, Attach Files, Create Public Threads and Send Messages in Threads there; then
it says why in the log and the bot runs on.

The spinning 3D GIF beside the podium (`spin.ts`) is drawn in GitHub Actions, since it needs a
browser with WebGL: as the card goes up, the bot starts the site repo's `daily-spin.yml` on `main`
for the Map (`GITHUB_DISPATCH_TOKEN`, a fine-grained token with Actions read and write on
`will-ness-ai/ballest` only), which stores the GIF in the leaderboard
database's `map_spins` (`docs/data.md`). Each read, it looks there (`DATABASE_URL`, plain SQL) and
edits the GIF in once one is drawn from the Map's current file or since it asked. A Map with no
`map_files` row gets no GIF and no run, and one already drawn from the same file is used without
a run. A run that fails tells ops itself at once, naming the Map (`daily-spin.yml`'s last step);
a run that can't be started, or no GIF an hour after asking, reaches ops once from the bot. The
card stays without it. Without both settings the card has no GIF. An edit that attaches a file names
every picture the card keeps, read from its components (a Components V2 message lists none under
`attachments`).

On its first run with no Daily Posts recorded the bot backfills (`backfill` in `schedule.ts`): it
posts the three Dailies before the one open now (before 01:00 UTC that is yesterday's, still
live), oldest first, as closed cards with threads, then the open one as usual, and records them,
so it happens once. Their data comes from the leaderboard database
(`history.ts`, plain SQL at `DATABASE_URL`): the final board is the Daily's open Entries, and the
lead is rebuilt from its Score history, every score the board held (closed ones included) from
when its Ghost says it was set (`ghosts.set_at`, used only when it falls after the last read
before the Refresh that first saw it, and before that Refresh ended) or else from that Refresh,
until the same player's next score. A line timed by a Ghost reads like a live one; one timed by
a Refresh says `by the <t:…:t> Refresh`. The graph steps at those times, clamped to the close.
Their GIFs are asked for as a live one's, and edited into the closed card when they come (as is
a live card's that the close came before). Without `DATABASE_URL` there is no backfill, and the
log says so; a database that can't be read reaches ops. The SQL is tested against web/'s `tiny`
dataset with more Daily rows (`test/dailyHistory.test.ts`, the Postgres at `TEST_DATABASE_URL`,
after `pnpm install` in `web/`).

What the card says is pure (`card.ts`, `test/dailyPost.test.ts`), its layout and buttons are in
`messages.ts` (`test/messages.test.ts`), and the schedule in `schedule.ts` runs over ports on the
TestClock (`test/dailyPostSchedule.test.ts`). The real adapters (`live.ts`) are checked by posting
one: `pnpm daily-post <date>` posts that date's live card and thread into the sandbox channel (or
`--channel <id>`, never the production one) with the bot account's Steam session, and records
nothing. With `--close` it then keeps the card current as the schedule does until the Daily's
end, so a past date is posted and at once closed by the schedule's own final edit (no GIF, ops
warnings to the log only). With `DATABASE_URL` set to a local Postgres (it refuses any other)
holding that date's Daily, a past date is posted instead as the backfill posts it, closed, from
that database. Read it back with `pnpm --silent axi show <id> --in <channel>`, which
lists and saves the files a Components V2 card shows.

## New tracks

`src/newTracks.ts` gets a new Workshop Map onto the site within minutes (spec #259). The game
Discord's #new-tracks (`NEW_TRACKS_CHANNEL_ID`, in `fly.toml`) gets a post from the HubUpdates app as each Map
goes up; a minute after a post the bot asks the collector's service on Fly to add them
(`POST /add-maps` at `COLLECTOR_URL`, in `fly.toml`: Fly's private network, no secret; ADR 0012),
and posts within that minute share the request. It never reads a post's words: the GuildMessages
intent only says one arrived, and the collector finds what is new (`docs/data.md`, "New Maps").
A request the collector refuses or can't take goes to the ops channel; a failed add reaches it
from the collector. It is off unless both
settings are set and the bot can view that channel, and then says why in the log; the bot runs on.
The batching is tested on the TestClock (`test/newTracks.test.ts`).

## Production

Production is the "Multiballs" app on the community server, running on Fly.io (`fly.toml`,
`Dockerfile`). `.github/workflows/bot.yml` tests every PR and deploys every push to `main` that
touches `discord-bot/`; nothing else deploys, and no checkout holds production's secrets. They
live in `fly secrets`, and the repo holds only `FLY_API_TOKEN`, a deploy token for the one app
(`FLY_COLLECTOR_TOKEN` is the collector's, ADR 0012).
`.dockerignore` keeps `.env` and databases out of the image; keep it that way.

A deploy stops the old copy before starting the new one (one volume, one machine), and the
engine's restart recovery resumes live Matches. `src/ops.ts` pings Healthchecks.io every minute
(`HEALTHCHECK_URL`), which alerts the private `#multiballs-ops` channel when pings stop, and
posts there daily (`OPS_WEBHOOK_URL`) once the Steam refresh token has 30 days left; renew it
with `tools/steampy_mint.py` and `fly secrets set STEAM_REFRESH_TOKEN=...`. Logs: `fly logs`.
`.github/workflows/bot-cost.yml` posts a weekly cost estimate there for the bot and for the
collector's app (`scripts/cost_report.py`, once per app with that app's deploy token;
Fly has no billing API, so it prices what is provisioned with the rates in that script, and
reads payment health, billing status and card on file, from Fly's undocumented GraphQL API).
`.github/workflows/vercel-usage.yml` posts the site's Vercel plan and usage there on Mondays,
and whenever it nears a limit (`tools/vercel_usage.py`).
