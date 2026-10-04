// The read layer the pages call: the queries in site.ts over this server's database, each
// cached with "use cache" under DATA_TAG for as long as nothing revalidates it. Pages stay
// static between Refreshes, and POST /api/revalidate (which the collector calls once a
// Refresh lands) expires them all at once. A cache entry's key includes the build, so a
// preview's entries never mix with another deploy's.
//
// Only what a page shows unasked is cached; a search is read fresh, since its keys would
// never repeat.
import { cacheLife, cacheTag } from "next/cache";

import { CIRCUIT } from "../lib/circuit";
import { playerRecord, type IndexBoard, type PlayerRecord } from "../lib/player";
import { podiumTallies, type PodiumTally } from "../lib/podiums";
import { mapCard, timed, type MapCard } from "../lib/workshop";
import { connect, type Db } from "./client";
import * as q from "./site";

export type { BoardPage, BoardRow, NameHit, Standings, WorkshopMap } from "./site";

export const DATA_TAG = "data";

let client: Db | undefined;

// One pool per server process, opened on the first read.
function db(): Db {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = connect(url);
  }
  return client;
}

export interface Site {
  refreshedAt: string | null;
  mapsReadBy: string | null;
  /* refreshedAt in Unix ms, or 0 before the first Refresh: what an age counts to until the
     browser's clock takes over (useClock in lib/client.ts) */
  asOf: number;
  /* every Circuit board in the site's order, with how many it ranks */
  boards: Array<IndexBoard>;
  podiums: Array<PodiumTally>;
}

/* What every page's frame needs: the Circuit's boards and podiums, and when they were read */
export async function getSite(): Promise<Site> {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  const [fresh, counts, placings] = await Promise.all([
    q.freshness(db()),
    q.circuitCounts(db()),
    q.trackPodiums(db()),
  ]);
  return {
    ...fresh,
    asOf: fresh.refreshedAt ? Date.parse(fresh.refreshedAt) : 0,
    boards: CIRCUIT.map((b) => ({
      name: b.name,
      group: b.group,
      tier: b.tier,
      display: b.display,
      entryCount: counts[b.name] ?? 0,
    })),
    podiums: podiumTallies(placings),
  };
}

export async function getWorkshop(): Promise<Array<q.WorkshopMap>> {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.workshopMaps(db());
}

/* the Maps with a time, as the cards the Workshop views and their search draw */
export async function getMapCards(): Promise<Array<MapCard>> {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return timed(await getWorkshop()).map(mapCard);
}

/* a slice of a board in rank order, unfiltered */
export async function getBoardPage(name: string, from: number, count: number) {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardPage(db(), name, { from, count });
}

/* the rows of a board whose persona or Steam ID contains `query`, read fresh */
export function searchBoard(name: string, query: string, from: number, count: number) {
  return q.boardPage(db(), name, { from, count, q: query });
}

export async function getBoardScores(name: string) {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardScores(db(), name);
}

/* where `ids` stand on a board: an Overall board's podium order says where each player on
   a podium stands on points, and a link to a player's row on a board needs their rank */
export async function getBoardPlaces(name: string, ids: ReadonlyArray<string>) {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardPlaces(db(), name, ids);
}

export async function getPlayer(steamId: string): Promise<PlayerRecord | null> {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  const [data, site, maps] = await Promise.all([
    q.playerData(db(), steamId),
    getSite(),
    getWorkshop(),
  ]);
  return data ? playerRecord(data, site.boards, maps) : null;
}

export async function getStandings() {
  "use cache";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.standings(db());
}

/* the Compare dialog's search, read fresh */
export function searchPlayers(query: string, except: string) {
  return q.searchPlayers(db(), query, { except });
}
