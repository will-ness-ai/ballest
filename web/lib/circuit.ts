// The Circuit's fixed facts, which Steam doesn't hold: the order the site lists its boards
// in (the in-game numbering, so a Track's place here is its number), the difficulty
// headings Season 2's track-selection screen groups Tracks under, and each Track's
// screenshot and Medal times. BOARDS in tools/campaign_common.py is the same order; the
// test that reads it keeps the two together. The two boards Steam doesn't have, Season 1's
// current Overall board and All Seasons, sit where the site has always listed them.

export const S1_CURRENT_BOARD = "OverallLeaderboard_S1Current";
export const COMPOSITE_BOARD = "OverallLeaderboard_AllSeasons";
export const COMPOSITE_GROUP = "All Seasons";
/* Steam's Season 1 board stopped when the season ended */
export const S1_FINAL_BOARD = "OverallLeaderboard";
export const S2_OVERALL_BOARD = "OverallLeaderboard_EASeason2";

export const S1_TRACKS = [
  "Map_Track13",
  "Map_Track15",
  "Map_Track16",
  "Map_Track05",
  "Map_Track18",
  "Map_Track21",
  "Map_Track22",
  "Map_Track19",
] as const;
export const S2_TRACKS = [
  "Map_Track_S2_Sampler",
  "Map_Track_S2_Longhaul",
  "Map_Track_S2_Pyramids",
  "Map_Track_S2_BigStairs",
  "Map_Track_S2_Checkerboard",
  "Map_Track_S2_Loopworks",
  "Map_Track_S2_TinyTower",
  "Map_Track_S2_Downhill",
  "Map_Track_S2_NightCondo",
  "Map_Track_S2_NightVents",
  "Map_Track_S2_NightWay",
  "Map_Track_S2_NightClimb",
] as const;

/* Season 2's screen groups Tracks in rows of four under these; Season 1's has none */
const S2_TIERS = ["Beginner", "Intermediate", "Advanced"] as const;

export type BoardOrigin = "steam" | "derived";
export interface CircuitBoard {
  name: string;
  group: string;
  /* a Track's difficulty heading, or null */
  tier: string | null;
  /* what the site calls it: the in-game number, then a nickname for Season 2 */
  display: string;
  /* Steam's, or worked out from Steam's (S1 Current, All Seasons) */
  origin: BoardOrigin;
}

const nick = (name: string) =>
  name.slice("Map_Track_S2_".length).replace(/(?<=[a-z])(?=[A-Z])/g, " ");
const no = (i: number) => String(i + 1).padStart(2, "0");

/* every Circuit board in the site's order: a season's Overall boards ahead of its Tracks */
export const CIRCUIT: ReadonlyArray<CircuitBoard> = [
  { name: S1_CURRENT_BOARD, group: "Season 1", tier: null, display: "Current", origin: "derived" },
  { name: S1_FINAL_BOARD, group: "Season 1", tier: null, display: "Final", origin: "steam" },
  ...S1_TRACKS.map((name, i) => ({
    name,
    group: "Season 1",
    tier: null,
    display: no(i),
    origin: "steam" as const,
  })),
  { name: S2_OVERALL_BOARD, group: "Season 2", tier: null, display: "Overall", origin: "steam" },
  ...S2_TRACKS.map((name, i) => ({
    name,
    group: "Season 2",
    tier: S2_TIERS[Math.min(Math.floor(i / 4), S2_TIERS.length - 1)],
    display: no(i) + " " + nick(name),
    origin: "steam" as const,
  })),
  {
    name: COMPOSITE_BOARD,
    group: COMPOSITE_GROUP,
    tier: null,
    display: "Overall",
    origin: "derived",
  },
];

export const circuitBoard = (name: string) => CIRCUIT.find((b) => b.name === name);

/* Each Track's screenshot from the game's own files and its Medal times in seconds,
   [bronze, silver, gold, author], read off the in-game HUD (docs/site.md). */
export const TRACKS: Readonly<Record<string, { img: string; medals: Array<number> }>> = {
  Map_Track13: { img: "/circuit/Map_Track13.webp", medals: [21, 16, 14, 12.792] },
  Map_Track15: { img: "/circuit/Map_Track15.webp", medals: [34, 26, 23, 21.186] },
  Map_Track16: { img: "/circuit/Map_Track16.webp", medals: [43, 32, 29, 26.509] },
  Map_Track05: { img: "/circuit/Map_Track05.webp", medals: [29, 22, 20, 17.935] },
  Map_Track18: { img: "/circuit/Map_Track18.webp", medals: [47, 35, 31, 28.921] },
  Map_Track21: { img: "/circuit/Map_Track21.webp", medals: [32, 24, 22, 19.817] },
  Map_Track22: { img: "/circuit/Map_Track22.webp", medals: [25, 19, 17, 15.352] },
  Map_Track19: { img: "/circuit/Map_Track19.webp", medals: [52, 39, 35, 32.353] },
  Map_Track_S2_Sampler: { img: "/circuit/Map_Track_S2_Sampler.webp", medals: [49, 37, 33, 30.419] },
  Map_Track_S2_Longhaul: {
    img: "/circuit/Map_Track_S2_Longhaul.webp",
    medals: [58, 44, 39, 36.129],
  },
  Map_Track_S2_Pyramids: {
    img: "/circuit/Map_Track_S2_Pyramids.webp",
    medals: [54, 41, 36, 33.338],
  },
  Map_Track_S2_BigStairs: {
    img: "/circuit/Map_Track_S2_BigStairs.webp",
    medals: [72, 54, 48, 44.532],
  },
  Map_Track_S2_Checkerboard: {
    img: "/circuit/Map_Track_S2_Checkerboard.webp",
    medals: [55, 41, 36, 33.774],
  },
  Map_Track_S2_Loopworks: {
    img: "/circuit/Map_Track_S2_Loopworks.webp",
    medals: [52, 39, 35, 32.09],
  },
  Map_Track_S2_TinyTower: {
    img: "/circuit/Map_Track_S2_TinyTower.webp",
    medals: [80, 60, 53, 49.749],
  },
  Map_Track_S2_Downhill: {
    img: "/circuit/Map_Track_S2_Downhill.webp",
    medals: [38, 29, 26, 23.589],
  },
  Map_Track_S2_NightCondo: {
    img: "/circuit/Map_Track_S2_NightCondo.webp",
    medals: [49, 37, 32, 30.174],
  },
  Map_Track_S2_NightVents: {
    img: "/circuit/Map_Track_S2_NightVents.webp",
    medals: [39, 29, 26, 24.074],
  },
  Map_Track_S2_NightWay: {
    img: "/circuit/Map_Track_S2_NightWay.webp",
    medals: [51, 38, 34, 31.573],
  },
  Map_Track_S2_NightClimb: {
    img: "/circuit/Map_Track_S2_NightClimb.webp",
    medals: [61, 46, 41, 38.053],
  },
};

/* the in-game number a Track's display name leads with, "08" of "08 Downhill" */
export const trackNo = (display: string) => /^\d+/.exec(display)?.[0] ?? display;
