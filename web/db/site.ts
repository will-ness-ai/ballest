// The queries behind the site's pages, each taking the database it reads so the tests can
// run them against a throwaway one. Results are plain JSON (times as ISO strings or Unix
// seconds), because db/data.ts caches them; their row types are lib/rows.ts. Ranks come
// from db/boards.ts.
import { sql, type SQL } from "drizzle-orm";

import { CIRCUIT, S1_TRACKS, S2_TRACKS } from "../lib/circuit";
import { CREATOR_BEAT_MARGIN_TICKS, SCORE_TICKS_PER_SECOND } from "../lib/rules";
import type { Db } from "./client";
import { DERIVED, array, boardSql, rankedSql } from "./boards";
import type {
  BoardPage,
  BoardRow,
  Freshness,
  NameHit,
  Placing,
  PlayerData,
  PlayerFinish,
  PlayerProfile,
  Standings,
  StandingsRow,
  WorkshopMap,
} from "../lib/rows";

const TRACKS = [...S1_TRACKS, ...S2_TRACKS];

async function rows<T>(db: Db, query: SQL): Promise<Array<T>> {
  return (await db.execute(query)).rows as Array<T>;
}

/* The boards of the Maps the Workshop lists now: those the latest catalogue carried. A
   Map gone from the Workshop keeps its rows, but nothing reads it again (docs/data.md). */
const listedMapsSql = sql`select m.board from maps m join (
    select distinct on (pfid) pfid, last_seen_refresh from map_history
    order by pfid, last_seen_refresh desc, id desc) l on l.pfid = m.pfid
  where l.last_seen_refresh = (select max(last_seen_refresh) from map_history)`;

/* A persona, or the stand-in the page shows for a player Steam gave no name */
const personaSql = sql`coalesce(nullif(p.persona, ''), 'Player ' || right(p.steam_id, 6))`;

/* a search box's text as a LIKE pattern that matches it anywhere, taken literally */
const contains = (q: string) => "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

export async function freshness(db: Db): Promise<Freshness> {
  const [r] = await rows<{ refreshed: Date | null; maps: Date | null }>(
    db,
    sql`select (select max(coalesce(finished_at, started_at)) from refreshes) as refreshed,
      (select min(last) from (
        select max(r.started_at) as last
        from board_reads br join refreshes r on r.id = br.refresh_id
        where br.ok and br.board in (${listedMapsSql})
        group by br.board) m) as maps`,
  );
  return {
    refreshedAt: r.refreshed ? new Date(r.refreshed).toISOString() : null,
    mapsReadBy: r.maps ? new Date(r.maps).toISOString() : null,
  };
}

/* How many players each Circuit board ranks, Steam's and derived */
export async function circuitCounts(db: Db): Promise<Record<string, number>> {
  const steam = CIRCUIT.filter((b) => b.origin === "steam").map((b) => b.name);
  const counts = await rows<{ board: string; n: number }>(
    db,
    sql`select board, count(*)::int as n from entries
      where closed_refresh is null and board = any(${array(steam)}) group by board
      ${sql.join(
        DERIVED.map(
          (name) => sql` union all select ${name}::text, count(*)::int from (${boardSql(name)}) d`,
        ),
        sql``,
      )}`,
  );
  return Object.fromEntries(counts.map((c) => [c.board, c.n]));
}

/* A slice of a board's rows in rank order, from `from` (0-based), optionally only those
   whose persona or Steam ID contains `q`. A row keeps its real rank and interval when a
   search leaves out the rows around it. */
export async function boardPage(
  db: Db,
  name: string,
  { from = 0, count = 50, q = "" }: { from?: number; count?: number; q?: string } = {},
): Promise<BoardPage> {
  const match = q.trim() ? contains(q.trim().toLowerCase()) : null;
  const matched = sql`select b.*, p.persona, nullif(p.avatar, '') as avatar
    from (select *, lag(score) over (order by rank) as ahead from (${boardSql(name)}) r) b
    join players p on p.steam_id = b.steam_id
    ${match ? sql`where lower(${personaSql}) like ${match} or b.steam_id like ${match}` : sql``}`;
  const found = await rows<BoardRow & { total: number }>(
    db,
    sql`select rank, steam_id as "steamId", persona, avatar, score::float8 as score,
        ahead::float8 as ahead, seasons, (count(*) over ())::int as total
      from (${matched}) m
      order by rank offset ${from} limit ${count}`,
  );
  const total =
    found.at(0)?.total ??
    (await rows<{ n: number }>(db, sql`select count(*)::int as n from (${matched}) m`))[0].n;
  for (const r of found) delete (r as Partial<typeof r>).total;
  return { total, rows: found };
}

/* Every score on a board in rank order: how its runs spread out, for a chart */
export async function boardScores(db: Db, name: string): Promise<Array<number>> {
  const found = await rows<{ score: number }>(
    db,
    sql`select score::float8 as score from (${boardSql(name)}) r order by rank`,
  );
  return found.map((r) => r.score);
}

/* Where each of `ids` stands on a board, by Steam ID; a player not on it is left out */
export async function boardPlaces(
  db: Db,
  name: string,
  ids: ReadonlyArray<string>,
): Promise<Record<string, { rank: number; score: number }>> {
  if (!ids.length) return {};
  const found = await rows<{ steamId: string; rank: number; score: number }>(
    db,
    sql`select steam_id as "steamId", rank, score::float8 as score
      from (${boardSql(name)}) r where steam_id = any(${array(ids)})`,
  );
  return Object.fromEntries(found.map((r) => [r.steamId, { rank: r.rank, score: r.score }]));
}

/* The top three of every Circuit Track, which the podium tallies count */
export async function trackPodiums(db: Db): Promise<Array<Placing>> {
  return rows<Placing>(
    db,
    sql`select r.board, r.steam_id as "steamId", p.persona, nullif(p.avatar, '') as avatar,
        nullif(p.profile_url, '') as "profileUrl", r.rank, r.score::float8 as score
      from (${rankedSql(sql`e.board = any(${array(TRACKS)})`)}) r
      join players p on p.steam_id = r.steam_id
      where r.rank <= 3
      order by array_position(${array(TRACKS)}, r.board), r.rank`,
  );
}

/* Every Workshop Map with its latest details and what the Workshop pages show of its board
   without reading it: workshop_stats in tools/campaign_common.py. Newest first. */
export async function workshopMaps(db: Db): Promise<Array<WorkshopMap>> {
  const found = await rows<WorkshopMap>(
    db,
    sql`with latest as (
        select distinct on (pfid) * from map_history
        order by pfid, last_seen_refresh desc, id desc
      ), ranked as (
        ${rankedSql(sql`e.board in (${listedMapsSql})`)}
      ), stats as (
        select r.board,
          jsonb_agg(jsonb_build_array(r.steam_id, coalesce(p.persona, ''), r.score)
            order by r.rank) filter (where r.rank <= 3) as top3,
          min(r.score) filter (where r.rank = 3) - min(r.score) filter (where r.rank = 1) as gap13,
          count(*)::int as runs,
          min(r.score) filter (where r.rank = 1) as lead,
          array_agg(r.score) as scores, array_agg(r.steam_id) as ids
        from ranked r join players p on p.steam_id = r.steam_id
        group by r.board
      )
      select m.pfid, m.board as name, l.title, coalesce(l.creator, '') as creator,
        m.creator_steam_id as cid, l.preview,
        coalesce(extract(epoch from m.created_at), 0)::float8 as created,
        coalesce(l.medals, '{}') as medals, coalesce(l.entry_count, s.runs, 0)::int as "entryCount",
        coalesce(l.sessions, 0)::int as sessions, coalesce(l.subs, 0)::int as subs,
        coalesce(s.top3, '[]'::jsonb) as top3, s.gap13::float8 as gap13,
        coalesce((select count(*) from unnest(s.scores) x where x - s.lead <= ${SCORE_TICKS_PER_SECOND}), 0)::int
          as crowd,
        coalesce((select count(*) from unnest(s.scores, s.ids) as u(score, id)
          where u.score <= l.medals[4] * ${SCORE_TICKS_PER_SECOND}
            - case when u.id = m.creator_steam_id then ${CREATOR_BEAT_MARGIN_TICKS} else 0 end), 0)::int
          as "authorBeaten"
      from maps m join latest l on l.pfid = m.pfid
      left join stats s on s.board = m.board
      where l.last_seen_refresh = (select max(last_seen_refresh) from map_history)
      order by m.created_at desc nulls last, m.pfid`,
  );
  return found;
}

/* A player and their place on every board, or null for a Steam ID on no board */
export async function playerData(db: Db, steamId: string): Promise<PlayerData | null> {
  const profile = (
    await rows<PlayerProfile>(
      db,
      sql`select p.steam_id as "steamId", p.persona, nullif(p.avatar, '') as avatar,
        nullif(p.profile_url, '') as "profileUrl"
      from players p where p.steam_id = ${steamId}
        and exists (select 1 from entries e where e.steam_id = p.steam_id and e.closed_refresh is null)`,
    )
  ).at(0);
  if (!profile) return null;
  const theirs = sql`e.board in (select board from entries
    where steam_id = ${steamId} and closed_refresh is null)`;
  const finishes = await rows<PlayerFinish>(
    db,
    sql`select board, rank, score::float8 as score, lead::float8 as lead, field::int as field from (
        select board, steam_id, rank, score,
          first_value(score) over (partition by board order by rank) as lead,
          count(*) over (partition by board) as field
        from (${rankedSql(theirs)}) r
        ${sql.join(
          DERIVED.map(
            (name) => sql` union all select board, steam_id, rank, score,
              first_value(score) over (order by rank), count(*) over ()
              from (${boardSql(name)}) d`,
          ),
          sql``,
        )}
      ) all_boards
      where steam_id = ${steamId}
      order by board`,
  );
  return { profile, finishes };
}

/* The Players page's counts, a StandingsRow (lib/rows.ts) for everyone with a world
   record, podium or top 5 on the Circuit, or a time on a Map */
export async function standings(db: Db): Promise<Standings> {
  const found = await rows<{ row: StandingsRow }>(
    db,
    sql`with c as (${rankedSql(sql`e.board = any(${array(TRACKS)})`)}),
        w as (${rankedSql(sql`e.board in (${listedMapsSql})`)}),
        counts as (
          select steam_id,
            count(*) filter (where rank = 1 and side = 0) as cwr,
            count(*) filter (where rank = 1 and side = 1) as wwr,
            count(*) filter (where rank <= 3 and side = 0) as cpod,
            count(*) filter (where rank <= 3 and side = 1) as wpod,
            count(*) filter (where rank <= 5 and side = 0) as ct5,
            count(*) filter (where rank <= 5 and side = 1) as wt5,
            count(*) filter (where side = 1) as maps
          from (select steam_id, rank, 0 as side from c where rank <= 5
                union all select steam_id, rank, 1 from w) x
          group by steam_id
        )
      select jsonb_build_array(c.steam_id, coalesce(p.persona, ''), cwr, wwr, cpod, wpod, ct5, wt5, maps)
        as row
      from counts c join players p on p.steam_id = c.steam_id
      where cwr + wwr + cpod + wpod + ct5 + wt5 + maps > 0
      order by c.steam_id`,
  );
  const [n] = await rows<{ maps: number }>(
    db,
    sql`select count(distinct board)::int as maps from entries
      where closed_refresh is null and board in (${listedMapsSql})`,
  );
  return { tracks: TRACKS.length, maps: n.maps, players: found.map((r) => r.row) };
}

/* Up to `limit` players on any board whose persona or Steam ID contains q, the names that
   start with it first: the Compare dialog's search */
export async function searchPlayers(
  db: Db,
  q: string,
  { limit = 10, except = "" }: { limit?: number; except?: string } = {},
): Promise<Array<NameHit>> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const starts = term.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  return rows<NameHit>(
    db,
    sql`select p.steam_id as "steamId", p.persona, nullif(p.avatar, '') as avatar
      from players p
      where (lower(${personaSql}) like ${contains(term)} or p.steam_id like ${contains(term)})
        and p.steam_id <> ${except}
        and exists (select 1 from entries e where e.steam_id = p.steam_id and e.closed_refresh is null)
      order by (lower(${personaSql}) like ${starts}) desc, p.steam_id
      limit ${limit}`,
  );
}
