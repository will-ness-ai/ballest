# The site

How the app in `web/` is put together, for anyone editing it. It is a Next.js App Router
app reading the database (ADR 0004, ADR 0005); what the database holds is in
`docs/data.md`.

## Where things live

- `web/app/` — the routes. Each page renders `<Shell view>` (the header, the tabs and the
  footer) around a `<Suspense>` whose fallback is that view's skeleton, and reads its
  params inside the boundary, so a page whose params weren't prerendered is served from
  its static shell at once. `app/api/` holds the few reads a page makes after it has
  loaded (a board's next rows, a search), the revalidate hook, and Sign in with Steam
  (`auth/`, `me`; ADR 0008).
- `web/components/` — the views, one folder each (`board/`, `workshop/`, `player/`,
  `players/`), and the pieces every view shares at the top level. A file is a client
  component only where it has to be: state, a browser API, or an event handler.
- `web/lib/` — pure TypeScript, no React and no database, with tests in `web/test/`:
  - `rules.ts`, the page's invariants and formatting: score units (`SCORE_TICKS_PER_SECOND`),
    `isPoints`, `isSteamId`, Medal tiers, times and ages.
  - `routes.ts`, every URL the site links to, what each path segment may be (the proxy and
    the pages check a path with the same predicates), which tab a path lights, and how an
    old `#/` link maps onto one.
  - `circuit.ts`, the Circuit's fixed facts: the board order (the in-game numbering), the
    Season 2 tiers, each Track's screenshot and Medal times.
  - `rows.ts`, the row types the read layer returns.
  - `player.ts`, `podiums.ts`, `players.ts`, `workshop.ts`: what each view works out from
    the rows it is given; `standing.ts` (You's place, Medal and next Medal on a board) and
    `spread.ts` (the spread chart's columns and where a time falls on it) for You.
  - `auth.ts`, Sign in with Steam end to end, one call per route (ADR 0008), over
    `steam-openid.ts` (Steam's login and its check) and `cookies.ts` (the cookie names the
    browser also reads). Not pure like the rest: it signs with `node:crypto` and asks Steam.
- `web/hooks/` — the client-only hooks: the clock and debounced searches (`client.ts`), a
  read made once per page and shared (`read.ts`), who is signed in (`me.ts`, reading
  `/api/me`), and You on one board (`you.ts`).
- `web/db/` — the read layer. `site.ts` is the SQL, `data.ts` the cached reads pages call
  (below), `schema.ts` the Drizzle schema the collector writes to.
- `web/proxy.ts` — the checks that must answer before a page starts streaming: a real 404
  for a path that can't be a page, and the redirects (`/leth`, a scope-only Players path,
  a player against themselves).
- `web/app/styles/` — the stylesheet, split by view and imported in order by
  `app/layout.tsx`. Every color is a custom property on `:root`; the theme is dark-only.
  Font sizes are in rem, written `calc(Nrem / 16)` with N the design's px, so text follows
  the reader's text-size setting; `node web/scripts/check-styles.mjs` rejects a px one.
  A size that grows from phone to desktop is fluid rather than a desktop override:
  `calc((Nrem + D * var(--ramp)) / 16)`, where `--ramp` (base.css) runs from 0 on a 390px
  phone to 1rem at the desktop breakpoint, `min-width: 51.25em` (820px at default text).
  The `good-css` skill covers how to write new styles; skip its light/dark token entry.

## Caching

Every read a page makes unasked goes through `db/data.ts`, where each is a
`"use cache: remote"` function tagged `data` with `cacheLife("max")`. Remote, because a
page rendered at request time runs on whichever serverless instance takes it, and plain
`"use cache"` lives in that instance's memory only. Pages are static between Refreshes: the
collector POSTs `/api/revalidate` (Bearer `REVALIDATE_SECRET`) once a Refresh has committed,
which expires the tag, and the next request reads fresh. Searches are read fresh every
time, since their keys would never repeat.

Sign in with Steam (ADR 0008) never touches a page's cache: the session cookie is signed
with `SESSION_SECRET` and only `/api/me` reads it, from the browser, which asks only when
the readable `ballest-in` cookie says a session exists. Without `SESSION_SECRET` nobody can
sign in and every page works as before.

Every Circuit board and every Players view is prerendered at build. A player, a Map or a
head to head is prerendered for a handful of the busiest, and anyone else is served from
the route's static shell, then cached whole. A page served that way streams its title, so
each such view also sets it itself (`DocTitle`): Next 16.3 otherwise keeps the first
title on every later visit to the same route.

A `notFound()` inside a streamed page can only answer 200, so anything that can be told
from the path alone (a board name, a tab, a Players scope, a Steam ID's shape) is checked
in `proxy.ts` instead. A Steam ID nobody raced under is still a soft 404.

## Track screenshots

`circuit/<board name>.webp` is each Circuit track's own screenshot, ~640px wide (Track22's
texture is 527, and stays that size), for the rail and the board's header card.
`TRACKS` in `lib/circuit.ts` pairs each with that track's Medal times, read off the
in-game HUD. Neither is Steam data, so the collector never touches them.

They come from the game files, by hand, after a game update: the private
`ballest-map-making` repo's `python extract/circuit_screenshots.py <this repo>/circuit`.
Each level's data asset names its screenshot texture; the Season 2 names do not follow
track order, and two asset folders differ in case from the board names (`LongHaul`,
`Nightway`), so the script maps them through the data asset rather than by name.

## Share images

A player, a Workshop Map, a Circuit Track and a Daily each unfurl with their own
1200×630 card (spec #179). `lib/share.ts` decides what a card says, `components/share/`
draws it through `next/og` and names it in the page's metadata, and `/og/<kind>/<id>`
(`app/og/[kind]/[id]/route.tsx`, `kind` one of `player`, `map`, `track`, `daily`) serves
the PNG, or a 404 when there is no such page. Any other page, an Overall board included,
keeps the site-wide `og.png`.

- A player gets their marble turned over to their Steam avatar, the Season 2 Overall rank
  if they have one, and up to four tiles: World records, Author medals, Maps finished,
  Maps made. Each counts the Circuit and the Workshop together, and a count of zero is
  left out.
- A Map, Track or Daily gets its picture across the top (the Workshop preview, or the
  Track's screenshot), its world record (a Daily's "Fastest", live or final alike), then
  Players, Author time, Beat the author and either Published (a Map) or Gold time.

The page names its card with the latest Refresh in the URL (`?v=`, `shareHref`), so each
Refresh is a new address for crawlers that keep a picture by URL, and the route answers
with `s-maxage` for a year: Vercel's CDN renders each card once per Refresh at most. On a
preview the card's URL is the branch's own address, since `metadataBase` is production.

Satori reads no WebP, no variable font and no `oklch`, so `assets/share/` holds what it
needs: TTF copies of Bungee and Chakra Petch (OFL, licences beside them) and a JPEG copy
of each `circuit/*.webp`. Regenerate those copies whenever a Track screenshot changes
(quality 82; PIL's `Image.open(webp).convert("RGB").save(jpg, quality=82)`).
`next.config.ts` traces the folder into the route's function. Steam pictures are fetched
with a 3-second timeout, only as PNG, JPEG or GIF and up to 4 MB; a card whose picture
fails to load, or that Satori can't read, draws without it.

## Routes

- `/` — the Workshop homepage: the carousel, the shelves and the search.
- `/maps`, or `/maps/<view>` — All maps, opened on one of `VIEWS` or `PRESETS`
  (`lib/workshop.ts`).
- `/map/<pfid>`, with an optional `/<steam_id>` that marks that player's row.
- `/board/<board name>`, with the same optional `/<steam_id>`, or on an Overall board
  `/podiums`, which lists it in its podium order. A Steam ID is all digits, so the two
  cannot collide.
- `/player/<steam_id>`, with an optional tab from `PLAYER_TABS` (`/circuit`, `/workshop`,
  `/made`). Without one the page opens on Workshop for anyone with a Workshop time, else
  Circuit.
- `/vs/<steam_id>/<steam_id>`, a head to head of two players.
- `/players`, or `/players/<scope>/<sort>`: the Players table, counted over `all`,
  `circuit` or `workshop` and sorted on `wr`, `pod`, `t5` or `maps`.
- `/daily`, or `/daily/<YYYY-MM-DD>`: the Daily page, on the newest Daily or on that day.
  The proxy 404s any other `/daily/...` path but `/daily/standings`, and a real day with no Daily goes to
  `/daily`. A Daily is live or final by the reader's clock against its close (`isLive` in
  `lib/daily.ts`), so a page cached before the close flips to Final without a fresh read;
  a timer at the close (`useNowPast`) flips it on time rather than at the next minute.
  Every day links to its own page: on a desktop the calendar of months (`calendarOf`)
  sits beside the day's panel and stays put while the board scrolls; on a phone a strip
  of days under the tabs, newest at the right and opened on the picked day, stands over
  the panel, and its Calendar button opens the same months over the page. The Daily tab
  follows the Workshop's and is lit on every `/daily` path.
- `/daily/standings`: the all-time Daily standings, behind the Days | Standings switch at
  the top of the Daily page, over final Dailies only (`standingsOf` in `lib/daily.ts`), so
  the live Daily joins once it closes. A card per record (most wins, podiums and Dailies
  played, the longest runs of days played and of wins), each the record's top three as
  small plates with equal values sharing a place, then "Every player": a medal table sorted
  by any column's header button (`aria-sort`), medal order breaking ties, 25 rows before
  "Show all". A phone drops its Podiums and Top 10 columns. Names link to the player's
  Daily tab.

The single-page site's `#/` links live on in Discord and bookmarks: `LegacyHash` replaces
one with its path on load (`legacyPath` in `lib/routes.ts`). Every player name links to a
player page (`PlayerLink`), and the link out to Steam lives on that page. A Map's creator
links to their player page's Made tab, except inside a card or row that is itself a link.
A player or Map page's back link returns to the board or list you came from, remembered
for the tab in `sessionStorage`.

## The header

The wordmark links home. The refresh time under it is a button that opens a dialog on how
the boards refresh: a static table of how long a change takes to show on Circuit and
Workshop boards, and when every Map was last read in full. The table restates
`collect_workshop`'s rules, so a change to when the collector reads a board changes that
copy too (`components/Freshness.tsx`). Ages are worked out in the browser, so a page cached
hours ago still says how old the boards are now.

You's card sits at the top right (`components/YouCard.tsx`): your marble and name, with your
All Seasons place and Maps played on a desktop, linking to your page. On a phone it folds to
marble and name and takes the refresh time's place, which is hidden there (a blank card
holds that place while your record is read). Signed out, it is Sign in with Steam, coming
back to the page you were on; signed in as a Steam ID on no board yet, it is Sign out, since
that player has no page to sign out from (everyone else signs out on their own page). It
reads You from `useYou` (`hooks/me.ts`), which asks `/api/me` and reads your record once
per page load and shares them with every view of You, and it draws nothing until the
browser can tell, so a signed-in visitor never sees Sign in first.

## A board

A board's first rows are rendered on the server, with the tiles, the plates and the card
across the top. The rest of the list is read from `/api/board/<name>` as you scroll, a few
chunks ahead of what is shown, and a search reads its matches the same way. A link to a
player's row reads down to that row first. Each row carries the score of the row above it
(`ahead`, from the query), which is what the interval column is worked out from, so rows
are never re-sorted on the client.

Once you are signed in, a banner above the plates gives You's standing on the board (a
Map, a Track, or an Overall board on its points sort): place, score, the Medal it holds
and a bar toward the next one (`standingOn` in `lib/standing.ts`), and a link to the board
at your row. It reads your row from `/api/board/<name>?player=<steam id>` through
`useYouOnBoard` (`hooks/you.ts`), which every view of You on a board shares, and draws
nothing until it has, so the server's page is the same for everyone; once the browser
knows there is a session it holds the banner's height while the row is read, so the plates
don't jump. The same read draws your time on the spread chart (a Map's panel, a Track's
card) as a line in your marble's hue, held at the right edge with an arrow when it is past
it: the server works the chart out (`spreadOf` in `lib/spread.ts`) and `YouSpread` draws
it again with the line, so only the chart's columns reach the browser, not every run.
`YouMarks` picks out your row and plate with a style rule on their `data-id`, so rows
added later by scrolling or search are marked too; the rule reaches only into its own
page's content, so a page Next keeps hidden leaves the others alone.

Ranks follow Steam's tie rule: equal scores are ordered by Steam ID, ascending on a time
board and descending on a points board (`docs/data.md`).

## The player page

`playerRecord` (`lib/player.ts`) turns a player's rows into everything the page shows:
Circuit tiles, Workshop finishes with their Medal (`medalOf`, and `timeMedal` for the tile counts), and the Maps the player made.
The rendering is markup over that record. A tab is one entry in `PLAYER_TABS`, which the
tab bar, each tab's body and the route are all built from.

## Maps kept off the homepage

`HIDDEN` (`lib/workshop.ts`) lists, by pfid, the Maps the Workshop homepage's carousel and
shelves leave out: ones the game can no longer finish, which otherwise top Barely played
and look like an easy place. Players report one through the link on a Map's page, which
opens a pre-filled GitHub issue; a Map goes in the list by hand. A listed Map stays in All
maps, search and player pages, and its page shows the reason.

## Head to head

`matchup` pairs two player records up: the rows both have a time on, each with its winner
and margin, the tally for All, Circuit and Workshop, and the comparison band. The head to
head page and a player page's score card both read it. The score card appears once you are
signed in (`hooks/me.ts`). The Compare dialog searches
players through `/api/players`.

## Players

`/players` ranks everyone by one column: world records, podiums, top 5s, or Maps finished,
counted on the Circuit, the Workshop or both. The standings read holds only counts;
`lib/players.ts` does the ranking. Only players with at least one of the sorted count are
listed. Equal counts share a rank (1, 2, 2, 4), and inside a tie the other columns in
their header order, then the name, set the order. A search filters that list and keeps
each player's real rank.

The table scrolls inside its own box on a phone, so the rank and name columns stay put
going sideways; on the desktop layout it fits, and the page scrolls. The pinned card is
your own row, once you are signed in, shown at the foot while the row is out of view: how
far the next rank up and the top 10 are, and a click scrolls to the row.

The Players tab sits last in the tab bar, but it is not a season, so it is lit from the
path rather than a group.

## Checking a change

`pnpm dev` in `web/` against a local Postgres (never `vercel env pull`: its development
variables point at production). For a database with real boards, backfill one from
`data/` (`docs/data.md`); for a tiny one, `pnpm db:seed tiny`. Next keeps the page you
navigated away from in the DOM, hidden, so a scripted check counting elements should count
only visible ones.

- **A production build**: `pnpm serve <port> [database]` builds against that local
  database and serves it in the background; `fuser -k -n tcp <port>` stops it.
  `pnpm smoke <url>` then requests every route of a build seeded with `tiny` or `stress` and checks
  each answer, as `web.yml` does in CI. Under `next start`, some prefetches (header
  `next-router-prefetch: 3`) answer 404 in the console; Vercel answers them 200.
- **Revalidate**: serve with `REVALIDATE_SECRET` set, add a Refresh to the database (the
  collector's `--out` run, or rows by hand), then `revalidate()` in `tools/db_writer.py`
  with `SITE_URL` pointing at the build. The changed boards should show at once.
- **The preview**: every pushed branch gets a public preview at
  `https://ballest-git-<branch>-n3sonlines-projects.vercel.app`, the branch name lowercased
  with each `/` as `-` (`claude/x-1` serves `ballest-git-claude-x-1-...`). Vercel shortens a
  hostname over 63 characters and adds a hash, so for a long branch name take the URL from
  the `environment_url` of the branch's deployment status
  (`gh api 'repos/will-ness-ai/ballest/deployments?ref=<branch>'`, then that deployment's
  `statuses`). It is up once that status is `success`. Previews count against the Hobby
  plan's 100 deploys a day, so push a branch in batches.
- **Looking at it**: `pnpm --silent qa` from `web/`, run bare, lists the targets (production,
  this branch's preview with its deploy state, a local build) and what it checks. `qa check`
  draws every page and dialog in `scripts/qa/catalogue.mjs` at 320px with 20px text, 390,
  820 and 1280, on the preview and on production, and prints only what is wrong: sideways
  scroll, an element past the edge (with the one holding it open), text cut off or drawn
  over other text, page errors, and changed pixels, with one picture per change to read
  (reference | target | changes in red) in `scratch/qa/`. Read those pictures, not
  screenshots of your own. `--pages`, `--sizes` and `--at local:<port>` narrow or move it;
  `qa shot <view>` draws one view, and `--box <selector>` or `--eval <js>` measures it, in
  place of a throwaway Playwright script. Both sides read the same database, so a change in
  numbers alone is data, and the two deployments' caches can differ by a Refresh.
  Production's domain may be outside a cloud session's network policy; `prod` is its Vercel
  address. A page or dialog with no row in the catalogue is not checked: add it. Locally,
  serve a build seeded with `stress` (tiny, plus a long name at a five-digit rank and a long
  Map title), whose IDs the catalogue knows; CI runs `qa check --against none --assert` on
  one.
- **Parity**: `pnpm db:parity` compares the read layer with `data/` figure by figure, on a
  database backfilled from the same commit; it stops first when the database is anything else.
