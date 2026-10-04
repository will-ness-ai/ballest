# The site

How the app in `web/` is put together, for anyone editing it. It is a Next.js App Router
app reading the database (ADR 0004, ADR 0005); what the database holds is in
`docs/data.md`.

## Where things live

- `web/app/` — the routes. Each page renders `<Shell view>` (the header, the tabs and the
  footer) around a `<Suspense>` whose fallback is that view's skeleton, and reads its
  params inside the boundary, so a page whose params weren't prerendered is served from
  its static shell at once. `app/api/` holds the few reads a page makes after it has
  loaded (a board's next rows, a search) and the revalidate hook.
- `web/components/` — the views, one folder each (`board/`, `workshop/`, `player/`,
  `players/`), and the pieces every view shares at the top level. A file is a client
  component only where it has to be: state, a browser API, or an event handler.
- `web/lib/` — pure TypeScript, no React and no database, with tests in `web/test/`:
  - `rules.ts`, the page's invariants and formatting: score units (`SCORE_TICKS_PER_SECOND`),
    `isPoints`, `isSteamId`, Medal tiers, times and ages.
  - `routes.ts`, every URL the site links to, and how an old `#/` link maps onto one.
  - `circuit.ts`, the Circuit's fixed facts: the board order (the in-game numbering), the
    Season 2 tiers, each Track's screenshot and Medal times.
  - `rows.ts`, the row types the read layer returns.
  - `player.ts`, `podiums.ts`, `players.ts`, `workshop.ts`: what each view works out from
    the rows it is given.
  - `client.ts` and `me.ts`, the client-only hooks: the clock, debounced searches, and
    "This is me".
- `web/db/` — the read layer. `site.ts` is the SQL, `data.ts` the cached reads pages call
  (below), `schema.ts` the Drizzle schema the collector writes to.
- `web/proxy.ts` — the checks that must answer before a page starts streaming: a real 404
  for a path that can't be a page, and the redirects (`/leth`, a scope-only Players path,
  a player against themselves).
- `web/app/styles/` — the stylesheet, split by view and imported in order by
  `app/layout.tsx`. Every color is a custom property on `:root`; the theme is dark-only.

## Caching

Every read a page makes unasked goes through `db/data.ts`, where each is a `"use cache"`
function tagged `data` with `cacheLife("max")`. Pages are static between Refreshes: the
collector POSTs `/api/revalidate` (Bearer `REVALIDATE_SECRET`) once a Refresh has committed,
which expires the tag, and the next request reads fresh. Searches are read fresh every
time, since their keys would never repeat.

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

## A board

A board's first rows are rendered on the server, with the tiles, the plates and the card
across the top. The rest of the list is read from `/api/board/<name>` as you scroll, a few
chunks ahead of what is shown, and a search reads its matches the same way. A link to a
player's row reads down to that row first. Each row carries the score of the row above it
(`ahead`, from the query), which is what the interval column is worked out from, so rows
are never re-sorted on the client.

Ranks follow Steam's tie rule: equal scores are ordered by Steam ID, ascending on a time
board and descending on a points board (`docs/data.md`).

## The player page

`playerRecord` (`lib/player.ts`) turns a player's rows into everything the page shows:
Circuit tiles, Workshop finishes with their Medal (`tierOf`), and the Maps the player made.
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
head page and a player page's score card both read it. The score card appears once "This
is me" has put a Steam ID in `localStorage` (`lib/me.ts`). The Compare dialog searches
players through `/api/players`.

## Players

`/players` ranks everyone by one column: world records, podiums, top 5s, or Maps finished,
counted on the Circuit, the Workshop or both. The standings read holds only counts;
`lib/players.ts` does the ranking. Only players with at least one of the sorted count are
listed. Equal counts share a rank (1, 2, 2, 4), and inside a tie the other columns in
their header order, then the name, set the order. A search filters that list and keeps
each player's real rank.

The table scrolls inside its own box on a phone, so the rank and name columns stay put
going sideways; from 820px it fits, and the page scrolls. The pinned card is your own row,
once "This is me" is set, shown at the foot while the row is out of view: how far the
next rank up and the top 10 are, and a click scrolls to the row.

The Players tab sits last in the tab bar, but it is not a season, so it is lit from the
path rather than a group.

## Checking a change

`pnpm dev` in `web/` against a local Postgres (never `vercel env pull`: its development
variables point at production). For a database with real boards, backfill one from
`data/` (`docs/data.md`); for a tiny one, `pnpm db:seed tiny`. `pnpm smoke <url>` requests
every route of a running build seeded with `tiny` and checks each answer, as `web.yml`
does in CI. Next keeps the page you navigated away from in the DOM, hidden, so a scripted
check counting elements should count only visible ones.
