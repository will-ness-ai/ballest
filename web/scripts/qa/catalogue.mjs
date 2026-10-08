// What `pnpm qa` looks at: the pages, the states a click opens on them, and the player and
// Map IDs each target's data has. A new page or dialog is one row here.
//
// Two ID sets: `real` for production and previews (both read the production database),
// `stress` for a local build seeded with the stress dataset (db/seed/datasets/stress.ts). The real ones
// are picked, like the stress ones, to be hard on the layout: P1 holds a five-digit rank on one board, P2 has a
// 30-character name, MAP has a 48-character title.
export const IDS = {
  real: { P1: "76561198259485267", P2: "76561198078361919", MAP: "3800958793" },
  stress: { P1: "76561199000000001", P2: "76561199000000011", MAP: "9000000005" },
};

// [name, path, status when not 200]; {P1} {P2} {MAP} come from the target's ID set
export const PAGES = [
  ["home", "/"],
  ["maps", "/maps"],
  ["map", "/map/{MAP}"],
  ["board", "/board/Map_Track13"],
  ["entry", "/board/Map_Track13/{P1}"],
  ["overall", "/board/OverallLeaderboard_S1Current"],
  ["allseasons", "/board/OverallLeaderboard_AllSeasons"],
  ["pods", "/board/OverallLeaderboard_EASeason2/podiums"],
  ["player", "/player/{P1}"],
  ["player-circuit", "/player/{P1}/circuit"],
  ["player-workshop", "/player/{P1}/workshop"],
  ["player-long", "/player/{P2}"],
  ["vs", "/vs/{P1}/{P2}"],
  ["players", "/players"],
  ["players-maps", "/players/workshop/maps"],
  ["daily", "/daily"],
  ["daily-standings", "/daily/standings"],
  ["notfound", "/no-such-page", 404],
];

// [name, page, the control to click]. A state whose control is hidden at a width (the
// board sheet is phone-only) is skipped there, not reported.
export const STATES = [
  ["sheet", "overall", "#boardBtn"],
  ["points", "overall", "button[aria-label='How points work']"],
  ["fresh", "home", "#freshness"],
  ["compare", "player", "button:has-text('Compare')"],
  ["change", "vs", "[data-change=b]"],
  ["refine", "maps", "button.refine"],
];

// Hidden before every screenshot on both sides: the refresh time differs between two
// deployments whose caches filled at different moments.
export const MASK = ["#freshness b"];

// Third-party requests that only add noise: the preview toolbar and analytics are dropped;
// Steam's images and avatars are answered with one fixed picture, so every run draws the same.
export const DROP = /vercel\.live|plausible|railway\.app/;
export const STAND_IN = /steamusercontent|steamstatic|example\.invalid/;
