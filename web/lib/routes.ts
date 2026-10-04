// Every URL the site links to, and how an old #/ link from the single-page site maps onto
// one. A Steam ID only ever reaches a path through isSteamId: one can arrive from the URL.
import { STEAM_ID, isSteamId, mapPfidOf } from "./rules";

export const PLAYER_TABS = ["circuit", "workshop", "made"] as const;
export type PlayerTab = (typeof PLAYER_TABS)[number];

/* an Overall board's slot for its podium order; a Steam ID is all digits, so the two can't collide */
export const PODIUM_SORT = "podiums";

export const PL_SCOPES = ["all", "circuit", "workshop"] as const;
export type PlScope = (typeof PL_SCOPES)[number];
export const PL_SORTS = ["wr", "pod", "t5", "maps"] as const;
export type PlSort = (typeof PL_SORTS)[number];

export const homeHref = () => "/";

export const playerHref = (id: string, tab?: string | null) =>
  isSteamId(id) ? "/player/" + id + (tab ? "/" + tab : "") : "/";

export const mapHref = (pfid: string, focus?: string | null) =>
  "/map/" + pfid + (focus && isSteamId(focus) ? "/" + focus : "");

/* a board, optionally with a player's row marked or (Overall) its podium order; a Map's
   board name turns into its /map/ link */
export function boardHref(name: string, slot?: string | null) {
  const pfid = mapPfidOf(name);
  if (pfid) return mapHref(pfid, slot);
  return "/board/" + name + (slot && (slot === PODIUM_SORT || isSteamId(slot)) ? "/" + slot : "");
}

export const vsHref = (a: string, b: string) =>
  isSteamId(a) && isSteamId(b) ? "/vs/" + a + "/" + b : "/";

export const mapsHref = (view?: string | null) => "/maps" + (view ? "/" + view : "");

export const playersHref = (scope: PlScope, sort: PlSort) =>
  "/players" + (scope === "all" && sort === "wr" ? "" : "/" + scope + "/" + sort);

/* The single-page site's #/ routes, each to the path that replaces it, or null for a hash
   that named nothing (the page then stays where it is). */
const ID = STEAM_ID.source;
const LEGACY: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [new RegExp(`^#/player/(${ID})(?:/(${PLAYER_TABS.join("|")}))?$`), (m) => playerHref(m[1], m[2])],
  [new RegExp(`^#/vs/(${ID})/(${ID})$`), (m) => vsHref(m[1], m[2])],
  [
    /^#\/players(?:\/(all|circuit|workshop)(?:\/(wr|pod|t5|maps))?)?$/,
    (m) =>
      playersHref(
        ((m[1] as string | undefined) ?? "all") as PlScope,
        ((m[2] as string | undefined) ?? "wr") as PlSort,
      ),
  ],
  [new RegExp(`^#/map/(\\d{1,20})(?:/(${ID}))?$`), (m) => mapHref(m[1], m[2])],
  [/^#\/maps(?:\/([a-z]{1,12}))?$/, (m) => mapsHref(m[1])],
  [
    new RegExp(`^#/board/([A-Za-z0-9_]{1,64})(?:/(${ID}|${PODIUM_SORT}))?$`),
    (m) => boardHref(m[1], m[2]),
  ],
  [/^#\/?(workshop)?$/, () => homeHref()],
];

export function legacyPath(hash: string): string | null {
  for (const [re, to] of LEGACY) {
    const m = re.exec(hash);
    if (m) return to(m);
  }
  return null;
}
