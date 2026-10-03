# The page

How `index.html` is put together, for anyone editing it. What it loads is in
`docs/data.md`.

## Track screenshots

`circuit/<board name>.webp` is each Circuit track's own screenshot, ~640px wide (Track22's
texture is 527, and stays that size), for the rail and the board's header card. The
page's `TRACKS` table pairs each with that track's Medal times, read off the in-game HUD.
Neither is Steam data, so the collector never touches them.

They come from the game files, by hand, after a game update: the private
`ballest-map-making` repo's `python extract/circuit_screenshots.py <this repo>/circuit`.
Each level's data asset names its screenshot texture; the Season 2 names do not follow
track order, and two asset folders differ in case from the board names (`LongHaul`,
`Nightway`), so the script maps them through the data asset rather than by name.

## Routes

`route()` reads the hash on load and on `hashchange`:

- `#/player/<steam_id>`, with an optional tab from `PLAYER_TABS` (`/circuit`, `/workshop`,
  `/made`). Without one the page opens on Workshop for anyone with a Workshop time, else
  Circuit.
- `#/board/<board name>`, with an optional `/<steam_id>` that marks that player's row once
  the board is open, or on an Overall board `/podiums`, which lists it in its podium order
  (`BY_PODIUMS`). A Steam ID is all digits, so the two cannot collide.
- `#/vs/<steam_id>/<steam_id>`, a head to head of two players.
- `#/players`, or `#/players/<scope>/<sort>`: the Players table, counted over `all`,
  `circuit` or `workshop` and sorted on `wr`, `pod`, `t5` or `maps` (`PL_ROUTE`). Its
  scope tabs and column headers are links to these, so every view can be shared.
- The Workshop's three: `#/workshop` (the homepage, and what no hash at all opens),
  `#/maps` or `#/maps/<view>` (All maps, opened on one of `VIEWS` or `PRESETS`), and
  `#/map/<pfid>` with the same optional `/<steam_id>`.

Anything else in the hash means the board already on screen, or the default one.

Navigation always goes through the route: selecting a board is `go(boardHash(...))`, so
nothing calls `selectBoard` to navigate, and that is what makes a board, and a player's row
on it, something you can link to. A Map's page is the board view with the Map's panel where
the rail would be; `boardHash` turns a `Workshop_<pfid>` board name into its `#/map/` link,
so a player page's back link lands there. Every player name links to a player page
(`nameHtml`), and the link out to Steam lives on that page rather than on the name.
A Map's creator links to their player page's Made tab (`creatorHtml`), except inside a
card or row that is itself a link.

## The header

The wordmark links to `#/workshop`, the homepage. The refresh time under it is a button
that opens a dialog on how the boards refresh (`openRefresh`): a static table of how long a
change takes to show on Circuit and Workshop boards, and when every Map was last read in
full, from `workshop.json`'s `full_sweep_at`. The table restates `collect_workshop`'s
rules, so a change to when the collector reads a board changes that copy too.

## The player page

`playerRecord` turns a shard plus a Steam ID into everything the page shows: Circuit tiles,
Workshop finishes with their medal (`tierOf`), and the Maps the player made. The rendering
below it is markup over that record. A tab is one entry in `PLAYER_TABS`, which the tab bar,
each tab's body and the route are all built from.

## Maps kept off the homepage

`HIDDEN` lists, by pfid, the Maps the Workshop homepage's carousel and shelves leave out:
ones the game can no longer finish, which otherwise top Barely played and look like an easy
place. Players report one through the link on a Map's page, which opens a pre-filled GitHub
issue; a Map goes in the list by hand. The homepage draws only from `homeSorted`, which
applies it. A listed Map stays in All maps, search and player pages, and its page shows the
reason.

## Head to head

`matchup` pairs two player records up: the rows both have a time on, each with its winner
and margin, the tally for All, Circuit and Workshop, and the comparison band. The head to
head page and a player page's score card both read it. The score card appears once "This is
me" has put a Steam ID in `localStorage` (`getMe` / `setMe`). The Compare dialog searches
`data/names.json`, fetched the first time it opens.

## Rows are index-aligned to rank

`rowHtml` reaches for `rows[r.rank - 2]` to compute the interval to the next rung up, so
sorting, filtering or de-duping a board's `rows` in place breaks it. Walk them into a new
array.

## Players

`#/players` ranks everyone in `data/standings.json` by one column: world records,
podiums, top 5s, or Maps finished, counted on the Circuit, the Workshop or both. The file
holds only counts; `plRanked` does the ranking, once per scope and sort. Only players with
at least one of the sorted count are listed. Equal counts share a rank (1, 2, 2, 4), and
inside a tie the other columns in their header order, then the name, set the order. A
search filters that list and keeps each player's real rank.

The table scrolls inside its own box on a phone, so the rank and name columns stay put
going sideways; from 820px it fits, and the page scrolls. `plInBox` tells the two apart,
and the chunked loading (`plFill`) and the pinned card (`plPin`) work either way. The card
is your own row, once "This is me" is set, shown at the foot while the row is out of view:
how far the next rank up and the top 10 are, and a click scrolls to the row.

The Players tab sits last in the tab bar (`PLAYERS_TAB`), but it is not a season: `group`
stays whatever it was, and the tab is lit from the view instead.

## The theme

Every color is a CSS custom property on `:root`, and the theme is dark-only.
