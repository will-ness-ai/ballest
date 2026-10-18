// PROTOTYPE (grill-design: daily standings history). Never merged: recounts the four
// Workshop standings at every past 16:00 UTC from the Entries' history, as a per-day
// snapshot table would hold them, so the variants on /you draw real days.
import { sql, type SQL } from "drizzle-orm";

import { listedMapsSql } from "../../../db/boards";
import { connect, type Db } from "../../../db/client";
import { STANDINGS_STATS } from "../../../lib/ladder";
import type { StandingsStat } from "../../../lib/rows";
import { SCORE_TICKS_PER_SECOND } from "../../../lib/rules";
import {
  countStandings,
  standingOf,
  type StandingsEntry,
  type StandingsMap,
} from "../../../lib/workshop-standings";

const DAY = 86_400_000;

interface Day {
  at: string;
  players: Array<[string, string]>;
  lists: Record<
    StandingsStat,
    Array<{ i: number; n: number; d: number; place: number; mv: number }>
  >;
}

let cache: Promise<Array<Day>> | null = null;
let conn: Db | undefined;
const db = () => (conn ??= connect(process.env.DATABASE_URL ?? ""));
const rows = async <T>(d: Db, q: SQL) => (await d.execute(q)).rows as Array<T>;

async function load(): Promise<Array<Day>> {
  const ms = (c: string) => sql.raw(`(extract(epoch from ${c}) * 1000)::float8`);
  const maps = await rows<Omit<StandingsMap, "authorTicks"> & { author: number | null }>(
    db(),
    sql`select m.board, m.creator_steam_id as creator, h.medals[4]::float8 as author,
        ${ms("m.created_at")} as "createdAt", ${ms("r.first_read")} as "firstReadAt"
      from maps m
      join lateral (select medals from map_history where pfid = m.pfid
        order by last_seen_refresh desc, id desc limit 1) h on true
      left join (select br.board, min(f.started_at) as first_read from board_reads br
        join refreshes f on f.id = br.refresh_id where br.ok group by br.board) r on r.board = m.board
      where m.board in (${listedMapsSql})`,
  );
  const sm: Array<StandingsMap> = maps.map(({ author, ...m }) => ({
    ...m,
    authorTicks: author === null ? null : Math.trunc(author * SCORE_TICKS_PER_SECOND),
  }));
  const entries = await rows<StandingsEntry>(
    db(),
    sql`select e.board, e.steam_id as "steamId",
        coalesce(nullif(p.persona, ''), 'Player ' || right(p.steam_id, 6)) as persona,
        e.score::float8 as score, ${ms("f.started_at")} as "firstSeenAt", ${ms("c.started_at")} as "closedAt"
      from entries e join players p on p.steam_id = e.steam_id
      join refreshes f on f.id = e.first_seen_refresh
      left join refreshes c on c.id = e.closed_refresh
      where e.board in (${listedMapsSql})`,
  );
  const reads = sm.map((m) => m.firstReadAt).filter((t): t is number => t !== null);
  const [last] = await rows<{ at: number }>(
    db(),
    sql`select ${ms("max(started_at)")} as at from refreshes`,
  );
  const first = Math.min(...reads);
  const days: Array<Day> = [];
  let t = Math.ceil((first - 16 * 3_600_000) / DAY) * DAY + 16 * 3_600_000 + DAY;
  for (; t <= last.at; t += DAY) {
    const m = sm.filter((x) => x.firstReadAt !== null && x.firstReadAt <= t);
    /* as the database stood at t: an Entry closed after t was still open then */
    const e = entries
      .filter((x) => x.firstSeenAt <= t && (x.closedAt === null || x.closedAt > t - DAY))
      .map((x) => (x.closedAt !== null && x.closedAt > t ? { ...x, closedAt: null } : x));
    const s = countStandings(m, e, t - DAY);
    days.push({
      at: new Date(t).toISOString(),
      players: s.players,
      lists: Object.fromEntries(
        STANDINGS_STATS.map((k) => [
          k,
          s.lists[k].map((r) => {
            const f = standingOf(r);
            return {
              i: f.player,
              n: f.n,
              d: f.n - f.nBefore,
              place: f.place,
              mv: f.placeBefore ? f.placeBefore - f.place : 0,
            };
          }),
        ]),
      ) as Day["lists"],
    });
  }
  return days;
}

export async function GET() {
  cache ??= load();
  return Response.json(await cache);
}
