# The page

How `index.html` is put together, for anyone editing it. What it loads is in
`docs/data.md`.

## Routes

`route()` reads the hash on load and on `hashchange`:

- `#/player/<steam_id>`, with an optional tab from `PLAYER_TABS` (`/circuit`, `/workshop`,
  `/made`). Without one the page opens on Workshop for anyone with a Workshop time, else
  Circuit.
- `#/board/<board name>`, with an optional `/<steam_id>` that marks that player's row once
  the board is open.
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

## The player page

`playerRecord` turns a shard plus a Steam ID into everything the page shows: Circuit tiles,
Workshop finishes with their medal (`tierOf`), and the Maps the player made. The rendering
below it is markup over that record. A tab is one entry in `PLAYER_TABS`, which the tab bar,
each tab's body and the route are all built from.

## Rows are index-aligned to rank

`rowHtml` reaches for `rows[r.rank - 2]` to compute the interval to the next rung up, so
sorting, filtering or de-duping a board's `rows` in place breaks it. Walk them into a new
array.

## The theme

Every color is a CSS custom property on `:root`, and the theme is dark-only.
