// The Workshop standings (CONTEXT.md): Maps played, Author Medals, world records and top 5s,
// counted over the Maps the Workshop lists now, as they stand now and at a baseline, with
// shared places. The site owns these rules (docs/adr/0009); they moved unchanged from the
// Daily Report's counting in discord-bot/src/report/report.ts, and Multiballs reads the result
// from GET /api/standings. Times are Unix ms.
import { CREATOR_BEAT_MARGIN_TICKS } from "./rules";
import type { StandingsStat, WorkshopStandingRow, WorkshopStandings } from "./rows";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/* the Daily Report's post, 16:00 UTC */
const REPORT_HOUR_UTC = 16;

/* A Map the Workshop lists now, as the counting needs it */
export interface StandingsMap {
  board: string;
  /* the creator's Steam ID: their own Entries count only by beating the Author Medal */
  creator: string | null;
  /* the Author Medal in score ticks, or null for a Map that publishes no Medals */
  authorTicks: number | null;
  /* when it was published, or null if the database doesn't know */
  createdAt: number | null;
  /* when a Refresh first read its board, or null if never */
  firstReadAt: number | null;
}

/* An Entry on a listed Map's board that is open now or was open at the baseline */
export interface StandingsEntry {
  board: string;
  steamId: string;
  persona: string;
  score: number;
  /* when the Refresh that first saw it started */
  firstSeenAt: number;
  /* when the Refresh that closed it started, or null while it is open */
  closedAt: number | null;
}

/* each list, and the count that breaks a tie on it before the Steam ID */
const LISTS: ReadonlyArray<[StandingsStat, StandingsStat | null]> = [
  ["played", null],
  ["author", null],
  ["wr", "top5"],
  ["top5", "wr"],
];

type Counts = Record<StandingsStat, number>;
const zero = (): Counts => ({ played: 0, author: 0, wr: 0, top5: 0 });

const bySteamId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* a Map's rank order: fastest, then first seen, then Steam ID */
const byRank = (a: StandingsEntry, b: StandingsEntry) =>
  a.score - b.score || a.firstSeenAt - b.firstSeenAt || bySteamId(a.steamId, b.steamId);

const openAt = (e: StandingsEntry, t: number) =>
  e.firstSeenAt <= t && (e.closedAt === null || e.closedAt > t);

/* The Entries on a Map that count, in rank order. A creator's own Entry counts only if it
   beats the Author Medal by CREATOR_BEAT_MARGIN_TICKS: the Author time is their publishing
   run, so matching it is not a finish. Positions are counted among these. */
function counted(map: StandingsMap, entries: ReadonlyArray<StandingsEntry>) {
  return [...entries]
    .sort(byRank)
    .filter(
      (e) =>
        e.steamId !== map.creator ||
        map.authorTicks === null ||
        e.score <= map.authorTicks - CREATOR_BEAT_MARGIN_TICKS,
    );
}

function tally(
  into: Map<string, Counts>,
  map: StandingsMap,
  ranked: ReadonlyArray<StandingsEntry>,
) {
  ranked.forEach((e, i) => {
    const t = into.get(e.steamId) ?? zero();
    t.played += 1;
    if (map.authorTicks !== null && e.score <= map.authorTicks) t.author += 1;
    if (i === 0) t.wr += 1;
    if (i < 5) t.top5 += 1;
    into.set(e.steamId, t);
  });
}

/* 1 + how many counts in `all` are strictly higher than each count, by count */
function placesOf(all: ReadonlyArray<number>): Map<number, number> {
  const sorted = [...all].sort((a, b) => b - a);
  const place = new Map<number, number>();
  sorted.forEach((n, i) => {
    if (!place.has(n)) place.set(n, i + 1);
  });
  return place;
}

/* The four lists over `maps` (the Workshop's now) and their Entries, now and at `since`.
   The now side is every open Entry. A board first read after `since` counts as it stands
   on both sides, since the database knew nothing of it before, so it is no gain; a Map
   published after `since` is the exception, its Entries all new. */
export function countStandings(
  maps: ReadonlyArray<StandingsMap>,
  entries: ReadonlyArray<StandingsEntry>,
  since: number,
): Omit<WorkshopStandings, "readAt" | "since"> {
  const byBoard = new Map<string, Array<StandingsEntry>>();
  for (const e of entries) {
    const list = byBoard.get(e.board) ?? [];
    list.push(e);
    byBoard.set(e.board, list);
  }
  const now = new Map<string, Counts>();
  const before = new Map<string, Counts>();
  const names = new Map<string, string>();
  for (const map of maps) {
    const all = byBoard.get(map.board) ?? [];
    for (const e of all) names.set(e.steamId, e.persona);
    const open = counted(
      map,
      all.filter((e) => e.closedAt === null),
    );
    const read = map.firstReadAt !== null && map.firstReadAt <= since;
    const published = map.createdAt === null || map.createdAt <= since;
    tally(now, map, open);
    tally(
      before,
      map,
      read || !published
        ? counted(
            map,
            all.filter((e) => openAt(e, since)),
          )
        : open,
    );
  }

  const ids = [...new Set([...now.keys(), ...before.keys()])].sort(bySteamId);
  const index = new Map(ids.map((id, i) => [id, i]));
  const countOf = (from: Map<string, Counts>, id: string) => from.get(id) ?? zero();
  const lists = Object.fromEntries(
    LISTS.map(([stat, then]) => {
      const on = ids.filter((id) => countOf(now, id)[stat] > 0 || countOf(before, id)[stat] > 0);
      const placeNow = placesOf(on.map((id) => countOf(now, id)[stat]));
      const placeBefore = placesOf(on.map((id) => countOf(before, id)[stat]));
      const rows = on
        .map((id): WorkshopStandingRow => {
          const n = countOf(now, id)[stat];
          const b = countOf(before, id)[stat];
          return [index.get(id) ?? 0, n, b, placeNow.get(n) ?? 0, placeBefore.get(b) ?? 0];
        })
        .sort(
          (a, b) =>
            b[1] - a[1] ||
            (then ? countOf(now, ids[b[0]])[then] - countOf(now, ids[a[0]])[then] : 0) ||
            a[0] - b[0],
        );
      return [stat, rows];
    }),
  ) as Record<StandingsStat, Array<WorkshopStandingRow>>;

  return {
    maps: maps.length,
    players: ids.map((id): [string, string] => [id, names.get(id) ?? ""]),
    lists,
  };
}

/* The baseline /you compares against: 24 hours before the most recent 16:00 UTC at or
   before `now`, so right after the Daily Report posts the page matches its image */
export function youBaseline(now: number): number {
  const post = Math.floor((now - REPORT_HOUR_UTC * HOUR_MS) / DAY_MS) * DAY_MS;
  return post + REPORT_HOUR_UTC * HOUR_MS - DAY_MS;
}
