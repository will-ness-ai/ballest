// The read layer the pages call: the queries in site.ts over this server's database, each
// cached with "use cache: remote" under DATA_TAG for as long as nothing revalidates it.
// Remote, because a page or API call rendered at request time runs on whichever serverless
// instance takes it, and plain "use cache" keeps entries in that instance's memory only:
// every new instance would read the Workshop, the derived boards and the rest again. Pages stay
// static between Refreshes, and POST /api/revalidate (which the collector calls once a
// Refresh lands) expires them all at once. A cache entry's key includes the build, so a
// preview's entries never mix with another deploy's.
//
// Only what a page shows unasked is cached; a search is read fresh, since its keys would
// never repeat. What a reader can name in a URL (a player, a slice of a board) is checked
// against what exists, or read in fixed blocks, before it reaches the cache, so a script
// walking made-up IDs or offsets can't fill it.
import { cacheLife, cacheTag } from "next/cache";

import { CIRCUIT, circuitBoard } from "../lib/circuit";
import { boardHistory, type BoardHistory } from "../lib/history";
import { playerRecord, type IndexBoard, type PlayerRecord } from "../lib/player";
import { podiumTallies, type PodiumTally } from "../lib/podiums";
import type {
  BoardPage,
  DailyCell,
  DailyDay,
  DailyStandings,
  PlayerDailies,
  WorkshopMap,
} from "../lib/rows";
import { mapCard, timed, type MapCard } from "../lib/workshop";
import { connect, type Db } from "./client";
import * as q from "./site";

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
     browser's clock takes over (useClock in hooks/client.ts) */
  asOf: number;
  /* every Circuit board in the site's order, with how many it ranks */
  boards: Array<IndexBoard>;
  podiums: Array<PodiumTally>;
}

/* What every page's frame needs: the Circuit's boards and podiums, and when they were read */
export async function getSite(): Promise<Site> {
  "use cache: remote";
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

export async function getWorkshop(): Promise<Array<WorkshopMap>> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.workshopMaps(db());
}

/* the Maps with a time, as the cards the Workshop views and their search draw */
export async function getMapCards(): Promise<Array<MapCard>> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return timed(await getWorkshop()).map(mapCard);
}

/* a slice of a board in rank order, unfiltered; for the fixed slices a page shows */
export async function getBoardPage(name: string, from: number, count: number) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardPage(db(), name, { from, count });
}

/* rows a board is cached in for reads from the URL: a list growing as the reader scrolls,
   or reading down to a player's row, asks for any slice, and gets it cut from these */
const BLOCK = 1000;

async function getBoardBlock(name: string, k: number) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardPage(db(), name, { from: k * BLOCK, count: BLOCK });
}

/* any slice of a board in rank order, unfiltered, read through whole blocks; only a block
   inside the board is ever read */
export async function readBoard(name: string, from: number, count: number): Promise<BoardPage> {
  const head = await getBoardBlock(name, 0);
  const end = Math.min(from + count, head.total);
  if (end <= from) return { total: head.total, rows: [] };
  const first = Math.floor(from / BLOCK);
  const blocks = await Promise.all(
    Array.from({ length: Math.floor((end - 1) / BLOCK) - first + 1 }, (_, i) =>
      first + i ? getBoardBlock(name, first + i) : Promise.resolve(head),
    ),
  );
  const at = from - first * BLOCK;
  return { total: head.total, rows: blocks.flatMap((b) => b.rows).slice(at, at + end - from) };
}

/* whether a board can be read: a Circuit board, or a Map the Workshop lists */
export async function isBoard(name: string): Promise<boolean> {
  return !!circuitBoard(name) || (await getWorkshop()).some((m) => m.name === name);
}

/* the rows of a board whose persona or Steam ID contains `query`, read fresh */
export function searchBoard(name: string, query: string, from: number, count: number) {
  return q.boardPage(db(), name, { from, count, q: query });
}

/* a Track's or a Map's record history (lib/history.ts), or null for an Overall board; for a
   board the page has already checked */
export async function getBoardHistory(name: string): Promise<BoardHistory | null> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  const input = await q.historyInput(db(), name);
  return input && boardHistory(input);
}

export async function getBoardScores(name: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardScores(db(), name);
}

/* where `ids` stand on a board: an Overall board's podium order says where each player on
   a podium stands on points, and a link to a player's row on a board needs their rank */
export async function getBoardPlaces(name: string, ids: ReadonlyArray<string>) {
  const known = await getPlayerIds();
  return boardPlaces(
    name,
    ids.filter((id) => known.includes(id)),
  );
}

async function boardPlaces(name: string, ids: ReadonlyArray<string>) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.boardPlaces(db(), name, ids);
}

/* Season 1 Current and All Seasons ranked whole, once per Refresh, for every player page */
async function getDerivedStandings() {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.derivedStandings(db());
}

/* every Steam ID the database has seen */
async function getPlayerIds(): Promise<Array<string>> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.playerIds(db());
}

/* a player's record, or null for a Steam ID nobody raced under */
export async function getPlayer(steamId: string): Promise<PlayerRecord | null> {
  return (await getPlayerIds()).includes(steamId) ? playerOf(steamId) : null;
}

async function playerOf(steamId: string): Promise<PlayerRecord | null> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  const [data, site, maps] = await Promise.all([
    q.playerData(db(), steamId, await getDerivedStandings()),
    getSite(),
    getWorkshop(),
  ]);
  return data ? playerRecord(data, site.boards, maps) : null;
}

export async function getStandings() {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.standings(db());
}

/* every Daily's date, oldest first */
export async function getDailyDates(): Promise<Array<string>> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.dailyDates(db());
}

/* every Daily as the calendar draws it, oldest first */
export async function getDailies(): Promise<Array<DailyCell>> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.dailies(db());
}

/* one Daily by its date, or null for a date with none; only a date that has one is read */
export async function getDaily(date: string): Promise<DailyDay | null> {
  return (await getDailyDates()).includes(date) ? dailyOf(date) : null;
}

async function dailyOf(date: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.dailyDay(db(), date);
}

/* the all-time Daily standings, over final Dailies only */
export async function getDailyStandings(): Promise<DailyStandings> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.dailyStandings(db());
}

/* a player's Daily record (their place on each Daily, their runs); only a Steam ID the
   database has seen is read */
export async function getPlayerDailies(steamId: string): Promise<PlayerDailies | null> {
  return (await getPlayerIds()).includes(steamId) ? playerDailiesOf(steamId) : null;
}

async function playerDailiesOf(steamId: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  return q.playerDailies(db(), steamId);
}

/* the Compare dialog's search, read fresh */
export function searchPlayers(query: string, except: string) {
  return q.searchPlayers(db(), query, { except });
}
