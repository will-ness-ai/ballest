// PROTOTYPE (grill-design, claude/prototype-standing): never merged. The Daily Report's four
// lists (discord-bot/src/report/report.ts), counted the bot's way, now and 24 hours ago, so
// the /you page can show where a player stands on each.
import { sql } from "drizzle-orm";

import type { Db } from "./client";

export const STATS = ["played", "author", "wr", "top5"] as const;
export type Stat = (typeof STATS)[number];
type Counts = Record<Stat, number>;

/* steamId, persona, the four counts now, the four counts a day ago */
export type ProtoRow = [string, string, number, number, number, number, number, number, number, number];
export interface ProtoLists {
  refreshedAt: number | null;
  maps: number;
  rows: Array<ProtoRow>;
}

const DAY_MS = 86_400_000;
const CREATOR_BEAT_MARGIN = 100; // ticks, as the bot's SCORE_TICKS_PER_SECOND / 1000
const TICKS = 100_000;

interface MapRow {
  board: string;
  creator: string | null;
  author: number | null;
}
interface EntryRow {
  board: string;
  steamId: string;
  persona: string;
  score: number;
  firstSeenAt: number;
  closedAt: number | null;
}

export async function protoLists(db: Db): Promise<ProtoLists> {
  const ms = (c: string) => sql.raw(`(extract(epoch from ${c}) * 1000)::float8`);
  const [last] = (
    await db.execute(sql`select ${ms("max(coalesce(finished_at, started_at))")} as at from refreshes`)
  ).rows as Array<{ at: number | null }>;
  const at = last?.at ?? Date.now();
  const since = new Date(at - DAY_MS);
  const maps = (
    await db.execute(sql`
    select m.board, m.creator_steam_id as creator, h.medals[4] as author
    from maps m
    join lateral (
      select medals, last_seen_refresh from map_history
      where pfid = m.pfid order by last_seen_refresh desc, id desc limit 1
    ) h on true
    where h.last_seen_refresh = (select max(last_seen_refresh) from map_history)`)
  ).rows as unknown as Array<MapRow>;
  const entries = (
    await db.execute(sql`
    select e.board, e.steam_id as "steamId", p.persona, e.score::float8 as score,
           ${ms("f.started_at")} as "firstSeenAt", ${ms("c.started_at")} as "closedAt"
    from entries e
    join boards b on b.name = e.board and b.kind = 'map'
    join players p on p.steam_id = e.steam_id
    join refreshes f on f.id = e.first_seen_refresh
    left join refreshes c on c.id = e.closed_refresh
    where e.closed_refresh is null or c.started_at > ${since}`)
  ).rows as unknown as Array<EntryRow>;

  const byBoard = new Map<string, Array<EntryRow>>();
  for (const e of entries) byBoard.set(e.board, [...(byBoard.get(e.board) ?? []), e]);
  const now = new Map<string, Counts>();
  const before = new Map<string, Counts>();
  const names = new Map<string, string>();
  const open = (e: EntryRow, t: number) => e.firstSeenAt <= t && (e.closedAt === null || e.closedAt > t);
  const tally = (into: Map<string, Counts>, map: MapRow, list: Array<EntryRow>) => {
    const authorTicks = map.author === null ? null : Math.trunc(map.author * TICKS);
    const ranked = list
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.firstSeenAt - b.firstSeenAt ||
          (a.steamId < b.steamId ? -1 : a.steamId > b.steamId ? 1 : 0),
      )
      .filter(
        (e) =>
          e.steamId !== map.creator ||
          authorTicks === null ||
          e.score <= authorTicks - CREATOR_BEAT_MARGIN,
      );
    ranked.forEach((e, i) => {
      const t = into.get(e.steamId) ?? { played: 0, author: 0, wr: 0, top5: 0 };
      t.played += 1;
      if (authorTicks !== null && e.score <= authorTicks) t.author += 1;
      if (i === 0) t.wr += 1;
      if (i < 5) t.top5 += 1;
      into.set(e.steamId, t);
    });
  };
  for (const map of maps) {
    const all = byBoard.get(map.board) ?? [];
    for (const e of all) names.set(e.steamId, e.persona);
    tally(now, map, all.filter((e) => e.closedAt === null));
    tally(before, map, all.filter((e) => open(e, at - DAY_MS)));
  }
  const zero = { played: 0, author: 0, wr: 0, top5: 0 };
  return {
    refreshedAt: last?.at ?? null,
    maps: maps.length,
    rows: [...now].map(([id, n]) => {
      const b = before.get(id) ?? zero;
      return [id, names.get(id) ?? "", n.played, n.author, n.wr, n.top5, b.played, b.author, b.wr, b.top5];
    }),
  };
}
