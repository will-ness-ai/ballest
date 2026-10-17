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
  - `campaigns.ts`, the curated Campaigns and their lookups (below, "Campaigns").
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
in `proxy.ts` instead. A Steam ID nobody raced under is still a soft 404, and so is a
curated Campaign none of whose Maps the Workshop lists, or a Map of it that it no longer
lists: only the database knows, and the proxy can't read the cache, so asking would cost
a function call on every Campaign page view for a case that comes up only when a maker
pulls their Maps.

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

## Ball skins

A board's rows and plates draw each run's ball skin in place of the made-up marble, once
the collector has read the run's Ghost (`docs/data.md`, "Ghosts"): the board query carries
the skin the Ghost names, and `skinPicture` in `lib/skins.ts` maps it to
`skins/<asset>.webp`, the game's menu ball wearing that skin, shot in a sandboxed test copy
and cut round, 192px for a 2x screen. A run with no Ghost read and a skin the list doesn't
know (one a game update added) keep the marble, and so does every derived or Overall board,
whose Entries the Ghost step never reads, and the
marble still turns over to the Steam avatar either way.

A new skin takes a picture and a line in `lib/skins.ts`. The list and pictures were made
on 2026-10-08 (`prototype/skins/` on branch `claude/prototype-skins`, with the game's own
tile icons and notes on which skins animate): the plain colours are shot with the texture
slider at 0, which most players use, and an animated skin (Spirit, Disco, Magma) is one
frame of it.

## Share images

A player, a Workshop Map, a Circuit Track, a Daily and a Campaign each unfurl with their
own 1200×630 card (spec #179; the Campaign's, spec #206). `lib/share.ts` decides what a
card says, `components/share/` draws it through `next/og`, `pageMetadata`
(`components/metadata.ts`) names it in the page's metadata, and `/og/<kind>/<id>`
(`app/og/[kind]/[id]/route.tsx`, `kind` one of `player`, `map`, `track`, `daily`,
`campaign`) serves the PNG, or a 404 when there is no such page. Any other page, an
Overall board included, keeps the site-wide `og.png`.

- A player gets their marble turned over to their Steam avatar, the Season 2 Overall rank
  if they have one, and up to four tiles: World records, Author medals, Maps finished,
  Maps made. Each counts the Circuit and the Workshop together, and a count of zero is
  left out.
- A Map, Track or Daily gets its picture across the top (the Workshop preview, or the
  Track's screenshot), its world record (a Daily's "Fastest", live or final alike), then
  Players, Author time, Beat the author and either Published (a Map) or Gold time.
- A Campaign (`/og/campaign/<slug>`) gets the same Banner with its first five Maps'
  previews side by side as the band (`CAMPAIGN_MAX_PICTURES`), a missing one a blank slice;
  "Campaign · by <maker>", its leader and their points, then Maps, Players and Finished
  every map: the players with a time on every one of its Maps the Workshop lists
  (`finishedEveryMap`). Its Overall, podiums and a focused row name it; a Map inside its
  frame (`/campaign/<slug>/<pfid>`) names that Map's own card, as a Track names its own
  inside its season. A slug that isn't curated, or none of whose Maps is listed, is a 404.

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

- `/` — the Workshop homepage: the carousel, the Campaigns' carousel, the shelves and the
  search.
- `/maps`, or `/maps/<view>` — All maps, opened on one of `VIEWS` or `PRESETS`
  (`lib/workshop.ts`).
- `/map/<pfid>`, with an optional `/<steam_id>` that marks that player's row, and
  `/map/<pfid>/file`, the Map's file for its 3D view ("Maps in 3D").
- `/board/<board name>`, with the same optional `/<steam_id>`, or on an Overall board
  `/podiums`, which lists it in its podium order. A Steam ID is all digits, so the two
  cannot collide. Every Circuit board lights the one Circuit tab, which opens the newest
  season's Overall board. The seasons, newest first then All Seasons (`seasonsOf` in
  `lib/player.ts`), are a row of sub-tabs under the tabs on a desktop and a chip beside
  the board button on a phone, whose menu gives each season's Tracks and field. Each
  season opens its Overall board.
- `/campaign/<slug>`: a Campaign's Overall board, with the same optional `/<steam_id>` or
  `/podiums`, or `/campaign/<slug>/<pfid>` for one of its Maps inside the Campaign's frame,
  as a Track opens inside its season. Lights the Workshop tab. The proxy 404s a slug that
  isn't curated, or anything after it but those; how the page is built is under
  "Campaigns".
- `/campaigns`: every Campaign as a banner, most players first, two across on a desktop
  and one on a phone. Prerendered; lights the Workshop tab.
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
- `/prefabs`: the Prefabs gallery; `/prefab/<slug>`: a Prefab's page; `/prefabs/new`: the
  upload form. The Prefabs tab comes last and is lit on all three. See "Prefabs".

`/robots.txt` (`app/robots.ts`) keeps crawlers to the pages above that stand on their own:
it disallows a player's tabs, the `/<steam_id>` and `/podiums` views of a board, Map or
Campaign, a Campaign's Maps (each has its own page), head to heads, `/api/` and the upload
form. Every one of those multiplies by the number of players, and AI
crawlers walking them all once outran the site's Hobby limits. A new route that adds a
view of a page belongs on that list.

Search engines get the rest from `/sitemap.xml` (`app/sitemap.ts`, `lib/sitemap.ts`),
which robots.txt names. It lists the pages worth a search result, not every page allowed:
the Workshop, All maps, Players, Daily, Daily standings and Campaigns pages, every Circuit
board, every Map with a time, every Daily, every Campaign with a listed Map, and only the players with a world record or podium,
some two thousand pages where all of them would be fifteen thousand more. Each is a server
render per Refresh for whichever crawler reads it, so keep it to pages people search for.
Only a final Daily carries a `lastmod` (its close), since a page that changes every
Refresh would only ask crawlers back sooner. A test checks robots.txt allows every listed
page. The sitemap reads the cached data, so a Refresh's revalidate renews it too.

Every page of the app names its canonical address (`alternates.canonical`; a page with a
`generateMetadata` goes through `pageMetadata` in `components/metadata.ts`), on
`ballestrecords.com` through `metadataBase`: a view names the page it is a view of (a
player's tab names the player's page, a board or Map focused on a row or in podium order
names the board), All maps' views name All maps and the Players table's rankings name
Players, and each Daily is a page of its own. A Map or player the page can only send away
(a soft 404) is `noindex`. The homepage's title says what the site is, and it carries the
site's name for search results as schema.org `WebSite` JSON-LD.

The single-page site's `#/` links live on in Discord and bookmarks: `LegacyHash` replaces
one with its path on load (`legacyPath` in `lib/routes.ts`). Every player name links to a
player page (`PlayerLink`), and the link out to Steam lives on that page. A Map's creator
links to their player page's Made tab, except inside a card or row that is itself a link.
A player or Map page's back link returns to the board or list you came from, remembered
for the tab in `sessionStorage`.

## Campaigns

A Campaign (CONTEXT.md) is a player-made run of Workshop Maps that the site ranks the way
the game ranks a Circuit season. The game knows nothing of them, so the list in
`web/lib/campaigns.ts` (`CAMPAIGNS`) is the only place one exists.

**Adding one** is one entry in `CAMPAIGNS`: its `slug` (the path, lowercase words joined by
`-`), `title`, `creator` (the maker's Workshop name), `creatorId` (the maker's Steam ID) and
`maps`, the Maps' Workshop IDs in the maker's order. That order numbers the Maps 01, 02 and
so on, so append a Map rather than insert one. `campaignProblems` fails the tests on a
repeated slug, a Map in two Campaigns (or twice in one), an empty Campaign or an ID that
isn't one. Nothing else changes: the pages are prerendered from the list.

`python tools/workshop_maps.py <query ...>` finds the IDs: give it Workshop links or IDs, or
a whole pasted post holding them (a Map stands for itself, a Steam collection for its Maps in
order, in the order given), or one maker: a profile URL, a SteamID64, or part of their in-game or Steam name
(oldest first). It prints each Map with its maker's name and ID, marks
any already in a Campaign, and ends with the `maps:` line to paste. A Map the collector
hasn't listed yet (one published since the last Refresh) leaves its Campaign a not-found page
until it is, so after merging a Campaign with new Maps run a Refresh
(`gh workflow run refresh.yml --ref main`) and check the page on production.

**The board.** A Campaign's standings are a derived board named `OverallCampaign_<slug>`
(`campaignBoard`). The `Overall` prefix makes it a points board to `isPoints` and
`board_kind` with no special case, so every board piece (paging, search, You, plates, the
Podiums sort, a row's focus) takes it through `/api/board/<name>` unchanged. Like Season 1
Current it is never stored: `boardSql` (`db/boards.ts`) adds it up on every read from the
open Entries of its Maps the Workshop lists, each place paying the Circuit's track points,
equal totals ordered by the first Map (in the Campaign's order) a player is on, then their
place there. A player is ranked once they have a time on one Map.

**The page** (`components/campaign/CampaignView.tsx`) is a Circuit season's twin, built
from the same pieces: the Campaign switch (`CampaignSwitch.tsx`, the season switch's chip,
never a row of tabs, since the list keeps growing; on a desktop it heads the rail, under a
"Campaign" label and over the maker's name) lists the Campaigns most players first
(`getCampaigns`); the rail lists Overall, then each Map as a strip of its preview picture with its number, record and the part of
its title after the Campaign's name (`mapName`), left out when that is only its number
("Miniblack 01", "AJC1"), and the whole title when what is left starts with a number that
isn't the Map's place ("Ninja0", "AJ26"). Everywhere the frame names a Map (the rail's sheet, the podium
tally, the page's title) it is `mapLabel`: the number, then that name. On a phone the
switch's chip and the board button share a row while they fit, and the button takes a line
of its own when they don't (`.boardrow.named`), since a Campaign's title and Map names run
longer than a season's. The switch's menu scrolls inside itself when the list outgrows the
screen. The Overall card, the points dialog and the podium count say maps
where a season says tracks, and count the Maps the Workshop lists, which are the ones that
pay points. A Map inside the frame gets the Track card's layout with its preview picture
and a link to its own page. A Campaign none of whose Maps the Workshop lists is shown
nowhere and its page is a soft 404 (see "Caching"), as is a Map of it the Workshop no
longer lists. `stress` lists Solar Trials' first Map alone, so its builds have one listed
Campaign of one listed Map and four unlisted ones; `tiny`'s Maps are in no Campaign.

**Where they are listed.** `getCampaigns` is the one read every list takes: each Campaign
`getCampaign` finds (one with a listed Map), with the players its board ranks, its listed
Maps' preview pictures in its order and its board's leader, most players first. A
Campaign's page, its share card and every list read it through `getCampaign`, so it is
counted and led the same way everywhere. A Campaign's picture is
`CampaignPics`: its first five Maps' previews side by side with a hairline between, a Map
with no preview a blank panel; the banners and a player's Campaign cards all draw it. A
banner (`CampaignBanner`) sets the picture at full strength with a full-height fade behind
its text only: "Campaign · N maps · N players", the name, the maker and "<leader> leads
with <points> pts". The homepage's Campaigns carousel (`CampaignCarousel`, under the main
carousel and hidden with it while there is a search) is a scroll-snap track of banners:
a phone shows one with the next peeking in and swipes, a desktop shows two. Its arrows
step one banner and wrap round as the main carousel's do; the counter names the banners
in view ("1 / 5" on a phone, "1–2 / 5" on a desktop), and both hide when every banner
fits. Its heading's See all opens `/campaigns`. With no Campaign listed (a `tiny` build)
the homepage leaves the carousel out and `/campaigns` says there are none. Every count of a
Campaign's Maps that is shown (a banner's, the switch's, a player's card's "n/N maps", the
share card's) is its curated total, as its Maps are numbered out of it.

**A Campaign Map elsewhere** says so (`components/workshop/Campaign.tsx`, both reading
`campaignOfMap`). Its card, wherever `MapCardLink` draws it (the homepage shelves, All maps,
the search), carries a strip along the bottom of its picture: the Campaign's name on the
left and "n / N" on the right, n its place in `maps` and N the Campaign's Map count. With a
pointer, the strip fades while the card's top three cover the picture. The Map page's panel
has a Part of box under the title ("Campaign", its name, "Map n of N →") that links to the
Map inside the Campaign's frame, `/campaign/<slug>/<pfid>`.

**On a player's page** the Workshop tab opens with a Campaigns shelf
(`components/player/CampaignCards.tsx`), a card for each Campaign the player holds a place
in, in `getCampaigns`' order (most players first). `getPlayerCampaigns` reads it:
`playerCampaigns` in `db/site.ts` gives their place and points on each Campaign's board
and how many of its listed Maps they have a time on, and the pictures and the players it
ranks come from `getCampaigns`. A card is `CampaignPics` (four
Maps) with the name over a fade, their place "of N" (gold, silver or bronze for 1st to
3rd), points, "n/N maps" and a bar of them, and it opens the Campaign's board focused on
their row (`/campaign/<slug>/<steam_id>`). A player in no Campaign has no shelf. The shelf
is `Shelf` (`components/player/Shelf.tsx`), the same as World records and Closest to a
record: ← → buttons, swipe, no scrollbar. Its buttons re-measure with a `ResizeObserver` on
the strip rather than on window resize only, so a strip whose size changes after it mounts
still shows them.

## The header

The wordmark links home. The refresh time under it is a button that opens a dialog on how
the boards refresh: a static table of how long a change takes to show on Circuit and
Workshop boards, and when every Map was last read in full. The table restates
`collect_workshop`'s rules, so a change to when the collector reads a board changes that
copy too (`components/Freshness.tsx`). Ages are worked out in the browser, so a page cached
hours ago still says how old the boards are now.

You's card sits at the top right (`components/YouCard.tsx`): your marble and name, with your
All Seasons place and Maps finished on a desktop, linking to your page. On a phone it folds to
marble and name and takes the refresh time's place, which is hidden there (a blank card
holds that place while your record is read). Signed out, it is Sign in with Steam, coming
back to the page you were on; signed in as a Steam ID on no board yet, it is Sign out, since
that player has no page to sign out from (everyone else signs out on their own page). It
reads You from `useYou` (`hooks/me.ts`), which asks `/api/me` and reads your record once
per page load and shares them with every view of You, and it draws nothing until the
browser can tell, so a signed-in visitor never sees Sign in first.

## A board

A board's first rows are rendered on the server, with the plates and the card
across the top. The rest of the list is read from `/api/board/<name>` as you scroll, a few
chunks ahead of what is shown, and a search reads its matches the same way. A link to a
player's row reads down to that row first. Each row carries the score of the row above it
(`ahead`, from the query), which is what the interval column is worked out from, so rows
are never re-sorted on the client.

A Track's or a Map's page carries its record history above the board's bar and search
(`components/board/HistoryCard.tsx`). `lib/history.ts` works it out from the board's Score
history (`historyInput` in `db/site.ts`): its Reigns and what each day
brought, all dated by the Refresh that first saw a time, in UTC days. The card arrives closed,
as a summary of the last three Reigns, and opening it replaces the summary with the Records
and What changed tabs. An Overall board has none, since it keeps current points only.

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

A run whose Ghost has a profile (`race` on the row, `docs/data.md`, "Ghosts") has a
dotted underline on its time, and a tap there opens the race drawer
(`components/board/RaceDrawer.tsx`) under the row, or under the podium for a plate or a
Daily's podium step. The drawer reads `/api/board/<name>?run=<steam id>` when it opens: the
date the run was set, its top speed, and a race against the leader (the leader races 2nd),
which shows only when both Ghosts have a profile. The gap arithmetic is in `lib/race.ts`.
`useRaceOpen` keeps one drawer open on a page, so a tap on another run moves it and a
second tap closes it.

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

The Players tab sits last in the tab bar, and like every tab it is lit from the path
(`tabOfPath`).

## Prefabs

Players' Prefabs (CONTEXT.md), stored in the database by the site itself (ADR 0009; the
tables are in `docs/data.md`). Settled in three grill-design rounds on the never-merged
branch `claude/prototype-prefabs` (spec #213).

- **A Prefab's page** (`components/prefabs/PrefabPage.tsx`): the viewer on the left, and
  beside it the name, uploader, description, size, piece chips, tags and Download. The
  viewer (`PrefabModel`, `PrefabViewer`, `scene.ts`) fetches the file from
  `/api/prefabs/<slug>/file`, the same URL Download saves, and loads three.js from npm only
  there. It starts from the Prefab's angle and turns slowly until it is grabbed, and not at
  all under reduced motion; Reset view goes back to the angle. The ?
  opens the how-to, with the Prefabs folder and the exact spawn command; it opens on its
  own once per browser (`localStorage`). A slug nobody uploaded, or a Prefab deleted, taken
  down or hidden, reads as gone.
- **Stand-in shapes**: the file names meshes but carries no geometry, and the game's
  meshes stay off the repo (ADR 0001), so `lib/prefab.ts` draws each known mesh as a box,
  cylinder, cone, pyramid, sphere, torus or half or quarter ring (the hole bowls) sized from its
  bounds, an unknown one as a grey box. A box whose mesh is curved is drawn instead as its
  outline in one view pushed through the bounds, squeezed by a second view's outline where that
  helps (`lib/prefab-profiles.ts`): coarse outlines, a few dozen points traced from mesh renders
  in the private ballest-map-making (`extract/piece_profiles.py`), never the mesh itself.
  `pnpm --silent qa piece` scores each against those renders. Each piece is coloured by its material's name; an Emissive
  material glows, as the game's lamps do. A fill light opposite
  the key keeps every side's colours true, so a sign seen from the front isn't greyed. Rotations are Unreal's [pitch, yaw, roll] in
  degrees; swapping y and z turns Unreal's left-handed z-up into three's right-handed y-up.
- **The gallery** (`PrefabGallery.tsx`): a card per live Prefab, Popular (favorites, newest
  breaking a tie) or Newest, filtered by one Tag (`galleryOf` in `lib/prefabs.ts`). Each
  card's picture is drawn in the browser from the file by one shared renderer once the card
  scrolls near, so no image is stored.
- **The angle** (`PrefabAngle` in `lib/prefabs.ts`, the `angle` column): the view its uploader
  picked, which the card, the upload ping's still and the page's viewer start from; none is
  three-quarters from above with the whole Prefab in view. It is stored relative to the
  Prefab's bounds (the camera's direction, its distance over the fitting one, and where it
  looks in radii), so it frames the same at any picture size. The uploader picks it in
  `AnglePicker.tsx`, on the upload form and in the Edit dialog: a line saying what to do, the
  preview held still, and Use this view (or Default view), which reads "✓ Card uses this
  view" until they turn the model again. Edit saves it with the name, description and tags;
  `PATCH /api/prefabs/<slug>` also takes `{ angle }` alone.
- **Uploading** (`UploadForm.tsx`, `POST /api/prefabs` in `db/prefab-api.ts`): signed in with
  Steam, 5 an hour per player (or the limit the admin gave them) counted from the rows. The file is checked in the browser the
  moment it's chosen and again on the server (`checkPrefab`, the game's own rules), named,
  described and tagged, previewed in 3D beside the card it will make, and live at once. Each
  upload pings #prefabs on the dev Discord server through Vercel's `OPS_WEBHOOK_URL` (skipped
  with a log line when it is unset; the GitHub and Fly secrets of that name are a different
  webhook, #ops's): the admin bot made that webhook, so it may carry link buttons
  (Open, Take down, Ban uploader; `db/prefab-ping.ts`). The two admin ones open the Prefab's page with
  `?admin=take-down` or `?admin=ban`, which opens that confirm for the admin. The ping's
  picture is a still of the preview the uploader's browser sends with the file (any PNG up to
  1 MB; shown only in #prefabs). An uploader the boards haven't seen is credited by the persona on their public
  Steam profile, read once at upload (`steamPersona`). The download name is the Prefab's name
  as the spawn command takes it (`fileNameOf`).
- **Favorites, editing and the admin** (`Favorite.tsx`, `PrefabTools.tsx`): a signed-in
  reader hearts a Prefab once (`/api/prefabs/<slug>/favorite`). Its uploader can edit its
  name, description and tags (and its angle, above) or delete it (`PATCH`/`DELETE /api/prefabs/<slug>`). The admin,
  one Steam ID (`ADMIN_STEAM_ID` in `lib/prefabs.ts`), can take any Prefab down
  (`/api/prefabs/<slug>/takedown`) and ban its uploader (`/api/prefab-bans/<steam_id>`),
  which hides all their Prefabs; a hidden one's gone page offers Unban. Every write expires
  the cached Prefab reads (`PREFAB_TAG`), so it shows at once. From the same page the admin
  can give the uploader their own hourly upload limit, or put them back on the 5
  (`/api/prefab-limits/<steam_id>`, the `prefab_limits` table); nothing cached reads it, as
  the upload form asks for its quota uncached.

## Maps in 3D

A Map whose file the collector has stored (`map_files`, `docs/data.md` "Map files") has a
**See it in 3D** button under its picture (spec #250; settled in four grill-design rounds on
the never-merged `claude/prototype-maps3d`, variant F). `getWorkshop`'s Map carries the
file's version (`fileVersion`), or null, and the button shows only with one: `map3dOf`
(`lib/workshop.ts`) builds the view's props from the Map, or null without a file.

- **The full screen** (`components/workshop/Map3D.tsx`) is a native `<dialog>` through
  `useDialog`, so Escape and Close (a `method="dialog"` form) close it and focus returns to
  the button. It opens with `useDialog`'s `back`, the one dialog on the site that does: opening
  adds a history entry at the same URL, Back (the browser's, or Android's) closes it and the
  page stays where it was, and closing it any other way goes back over that entry, so one
  Back afterwards leaves the page as it would have before. A bar across the top names the Map
  and its maker; on a desktop a corner card under it (`MedalList`, which the panel's Medals
  share) gives the record and the four Medal times, and a phone leaves it out so the Map
  isn't covered. The card follows the bar in one stack (`.m3d-top`), so it can't overlap it.
  While it is open the page gives up its scrollbar gutter, which nothing in the top layer
  can cover.
- **The Map** (`MapModel.tsx`, its own chunk, mounted only while the dialog is open, so
  neither three.js nor the file loads before the button is pressed) is the file read into a
  Prefab file by `lib/ballmap.ts` (each quaternion as an FRotator by `FQuat::Rotator`'s
  formula, each path out of its type and quote marks) and drawn by `PrefabViewer` with the
  Prefabs' stand-in shapes, from `MAP_ANGLE`: the prototype's "Angled" view that Will
  approved in round 4, closer than a Prefab's default; on a screen taller than wide it
  starts 1.3x further back. "Building the map…" (`MapWait`) shows until the viewer has
  drawn.
- **The file** comes from `/map/<pfid>/file?v=<version>` (`mapFileHref`,
  `app/map/[pfid]/file/route.ts`): the stored gzip bytes with `Content-Encoding: gzip`, read
  fresh (bytes don't belong in the JSON cache). Under the stored version the answer is cached
  a year, immutable, by the browser and the CDN; under any other, a minute. A Map with no
  stored file is a 404. `robots.txt` already keeps crawlers off it (`/map/*/`).
- `tiny` holds Marble Run's file, a four-piece `.ballmap`; `qa`'s `map3d` state opens it
  (`MAP3D` in the catalogue; Ice Boat Race on production).

## Checking a change

`pnpm dev` in `web/` against a local Postgres (never `vercel env pull`: its development
variables point at production). For a database with real boards, backfill one from
`data/`'s git history (`docs/data.md`); for a tiny one, `pnpm db:seed tiny`. Next keeps the page you
navigated away from in the DOM, hidden, so a scripted check counting elements should count
only visible ones.

- **A production build**: `pnpm serve <port> [database]` builds against that local
  database and serves it in the background; `fuser -k -n tcp <port>` stops it.
  `pnpm smoke <url>` then requests every route of a build seeded with `tiny` or `stress` and checks
  each answer, as `web.yml` does in CI. Under `next start`, some prefetches (header
  `next-router-prefetch: 3`) answer 404 in the console; Vercel answers them 200.
- **Revalidate**: serve with `REVALIDATE_SECRET` set, add a Refresh to the database (the
  collector's `--dev` run, or rows by hand), then `revalidate()` in `tools/db_writer.py`
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
  place of a throwaway Playwright script. `qa shot prefab@1280 --prefab <file.json>` has the
  Prefab page's viewer draw any file. To work on a stand-in shape, run `qa piece <mesh>`
  instead: it scores the stand-in's top, front and side outlines against the game mesh's
  renders in `ballest-map-making/references/pieces/` (1.00 is the same outline) and writes a
  game | viewer | outlines sheet; `qa piece --all` lists every mesh, worst first, and
  `--montage` adds their game and viewer rows 16 to a picture (`--match` narrows the list). A page
  that answers 200 with a "not found" title is a `gone` fault: its catalogue ID is stale. Both sides read the same database, so a change in
  numbers alone is data, and the two deployments' caches can differ by a Refresh.
  Production's domain may be outside a cloud session's network policy; `prod` is its Vercel
  address. A page or dialog with no row in the catalogue is not checked: add it. Locally,
  serve a build seeded with `stress` (tiny, plus a long name at a five-digit rank, a long
  Map title and one Campaign Map), whose IDs the catalogue knows; CI runs `qa check --against none --assert` on
  one.
