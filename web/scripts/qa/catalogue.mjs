// What `pnpm qa` looks at: the pages, the states a click opens on them, and the player and
// Map IDs each target's data has. A new page or dialog is one row here.
//
// Two ID sets, each picked to be hard on the layout: `real` for production and previews
// (both read the production database) and `stress` for a local build seeded with the stress
// dataset (db/seed/datasets/stress.ts). RANKED holds a five-digit rank on an Overall board,
// LONG has a long name, RIVAL is the head to head's other side, and MAP has a long title. In
// stress one player is RANKED and LONG; on production RANKED is Hky. (12697th in Season 2)
// and LONG is "Twizy #POPEM #LongLiveTheRuler".
export const IDS = {
  real: {
    RANKED: "76561198259485267",
    LONG: "76561198078361919",
    RIVAL: "76561198078361919",
    MAP: "3800958793",
  },
  stress: {
    RANKED: "76561199000000011",
    LONG: "76561199000000011",
    RIVAL: "76561199000000001",
    MAP: "9000000005",
  },
};

/** @type {ReadonlyArray<{ name: string, path: string, status?: number }>} */
export const PAGES = [
  { name: "home", path: "/" },
  { name: "maps", path: "/maps" },
  { name: "map", path: "/map/{MAP}" },
  { name: "board", path: "/board/Map_Track13" },
  { name: "entry", path: "/board/Map_Track13/{RANKED}" },
  { name: "overall", path: "/board/OverallLeaderboard_S1Current" },
  { name: "allseasons", path: "/board/OverallLeaderboard_AllSeasons" },
  { name: "pods", path: "/board/OverallLeaderboard_EASeason2/podiums" },
  { name: "player", path: "/player/{RANKED}" },
  { name: "player-circuit", path: "/player/{RANKED}/circuit" },
  { name: "player-workshop", path: "/player/{RANKED}/workshop" },
  { name: "player-long", path: "/player/{LONG}" },
  { name: "vs", path: "/vs/{RANKED}/{RIVAL}" },
  { name: "players", path: "/players" },
  { name: "players-maps", path: "/players/workshop/maps" },
  { name: "daily", path: "/daily" },
  { name: "daily-standings", path: "/daily/standings" },
  { name: "notfound", path: "/no-such-page", status: 404 },
];

/**
 * A state is what clicking `click` opens on `page`. One whose control is hidden at a width
 * (the board sheet is phone-only) is skipped there; one whose control shows at no width
 * checked is a fault, since the control has gone or moved.
 * @type {ReadonlyArray<{ name: string, page: string, click: string }>}
 */
export const STATES = [
  { name: "sheet", page: "overall", click: "#boardBtn" },
  { name: "seasons", page: "overall", click: ".seasonchip" },
  { name: "points", page: "overall", click: "button[aria-label='How points work']" },
  { name: "fresh", page: "home", click: "#freshness" },
  { name: "compare", page: "player", click: "button:has-text('Compare')" },
  { name: "change", page: "vs", click: "[data-change=b]" },
  { name: "refine", page: "maps", click: "button.refine" },
];

// Hidden before every screenshot on both sides: the refresh time differs between two
// deployments whose caches filled at different moments.
export const MASK = ["#freshness b"];

// Third-party requests that only add noise: the preview toolbar and analytics are dropped;
// Steam's images and avatars are answered with one fixed picture, so every run draws the same.
export const DROP = /vercel\.live|plausible|railway\.app/;
export const STAND_IN = /steamusercontent|steamstatic|example\.invalid/;
