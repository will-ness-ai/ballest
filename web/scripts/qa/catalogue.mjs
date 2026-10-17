// What `pnpm qa` looks at: the pages, the states a click opens on them, and the player and
// Map IDs each target's data has. A new page or dialog is one row here.
//
// Two ID sets, each picked to be hard on the layout: `real` for production and previews
// (both read the production database) and `stress` for a local build seeded with the stress
// dataset (db/seed/datasets/stress.ts). RANKED holds a five-digit rank on an Overall board,
// LONG has a long name, RIVAL is the head to head's other side, MAP has a long title, and
// PREFAB is a Prefab (production's is wrongwaysign, which mixes rings, cubes and pipes). In
// stress one player is RANKED and LONG; on production RANKED is Hky. (12697th in Season 2)
// and LONG is "Twizy #POPEM #LongLiveTheRuler". CAMPAIGN is a Campaign with its podium
// order and CAMPAIGN_MAP one of its Maps inside its frame: on production Solar Trials (nine
// Maps) and its Finale, the longest name; stress lists Solar Trials' first Map alone.
// CAMPAIGNER holds a place in Campaigns, for their Workshop tab's shelf: on production
// Chaos, in every launch Campaign; in stress the long-named player. MAP3D is a Map whose file
// the site holds, for its 3D view: on production Ice Boat Race (3.1 MB, a long track on a
// wide floor); in stress tiny's Marble Run.
export const IDS = {
  real: {
    RANKED: "76561198259485267",
    LONG: "76561198078361919",
    RIVAL: "76561198078361919",
    MAP: "3800958793",
    CAMPAIGN: "solar-trials",
    CAMPAIGN_MAP: "3805413302",
    CAMPAIGNER: "76561197968999419",
    PREFAB: "wrongwaysign",
    MAP3D: "3810672947",
  },
  stress: {
    RANKED: "76561199000000011",
    LONG: "76561199000000011",
    RIVAL: "76561199000000001",
    MAP: "9000000005",
    CAMPAIGN: "solar-trials",
    CAMPAIGN_MAP: "3805399883",
    CAMPAIGNER: "76561199000000011",
    PREFAB: "twin-cubes",
    MAP3D: "9000000001",
  },
};

/** @type {ReadonlyArray<{ name: string, path: string, status?: number }>} */
export const PAGES = [
  { name: "home", path: "/" },
  { name: "maps", path: "/maps" },
  { name: "campaigns", path: "/campaigns" },
  { name: "campaign", path: "/campaign/{CAMPAIGN}" },
  { name: "campaign-pods", path: "/campaign/{CAMPAIGN}/podiums" },
  { name: "campaign-map", path: "/campaign/{CAMPAIGN}/{CAMPAIGN_MAP}" },
  { name: "map", path: "/map/{MAP}" },
  { name: "map-3d", path: "/map/{MAP3D}" },
  { name: "board", path: "/board/Map_Track13" },
  { name: "entry", path: "/board/Map_Track13/{RANKED}" },
  { name: "overall", path: "/board/OverallLeaderboard_S1Current" },
  { name: "allseasons", path: "/board/OverallLeaderboard_AllSeasons" },
  { name: "pods", path: "/board/OverallLeaderboard_EASeason2/podiums" },
  { name: "player", path: "/player/{RANKED}" },
  { name: "player-circuit", path: "/player/{RANKED}/circuit" },
  { name: "player-workshop", path: "/player/{RANKED}/workshop" },
  { name: "player-campaigns", path: "/player/{CAMPAIGNER}/workshop" },
  { name: "player-long", path: "/player/{LONG}" },
  { name: "vs", path: "/vs/{RANKED}/{RIVAL}" },
  { name: "players", path: "/players" },
  { name: "players-maps", path: "/players/workshop/maps" },
  { name: "daily", path: "/daily" },
  { name: "daily-standings", path: "/daily/standings" },
  { name: "prefabs", path: "/prefabs" },
  { name: "prefab", path: "/prefab/{PREFAB}" },
  { name: "prefab-new", path: "/prefabs/new" },
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
  { name: "campaign-switch", page: "campaign", click: ".seasonchip:visible" },
  { name: "campaign-sheet", page: "campaign-map", click: "#boardBtn" },
  { name: "campaign-points", page: "campaign", click: "button[aria-label='How points work']" },
  { name: "fresh", page: "home", click: "#freshness" },
  { name: "compare", page: "player", click: "button:has-text('Compare')" },
  { name: "change", page: "vs", click: "[data-change=b]" },
  { name: "refine", page: "maps", click: "button.refine" },
  { name: "race", page: "board", click: ".row .c-race" },
  { name: "howto", page: "prefab", click: ".pf-q" },
  { name: "race-podium", page: "board", click: ".pl-score.c-race" },
  { name: "map3d", page: "map-3d", click: ".m3d-open" },
];

// Hidden before every screenshot on both sides: the refresh time differs between two
// deployments whose caches filled at different moments.
export const MASK = ["#freshness b"];

// Third-party requests that only add noise: the preview toolbar and analytics are dropped;
// Steam's images and avatars are answered with one fixed picture, so every run draws the same.
export const DROP = /vercel\.live|plausible|railway\.app/;
export const STAND_IN = /steamusercontent|steamstatic|example\.invalid/;
// A Prefab's file, as its page's viewer fetches it (prefabFileHref in lib/routes.ts): `qa shot
// --prefab` answers it with a local file.
export const PREFAB_FILE = "**/api/prefabs/*/file";
