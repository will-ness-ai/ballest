// The queries behind the site's pages, each taking the database it reads so the tests can
// run them against a throwaway one. Results are plain JSON (times as ISO strings or Unix
// seconds), because db/data.ts caches them; their row types are lib/rows.ts. Ranks come
// from db/boards.ts.
import { sql, type SQL } from "drizzle-orm";

import { CIRCUIT, S1_TRACKS, S2_TRACKS } from "../lib/circuit";
import { playerDailiesOf, standingsOf } from "../lib/daily";
import { CREATOR_BEAT_MARGIN_TICKS, SCORE_TICKS_PER_SECOND } from "../lib/rules";
import type { Db } from "./client";
import { DERIVED, array, boardSql, rankedSql } from "./boards";
import type { HistoryInput } from "../lib/history";
import type {
  BoardPage,
  BoardRow,
  DailyCell,
  DailyDay,
  DailyFinish,
  DailyStandings,
  DerivedStanding,
  DerivedStandings,
  Freshness,
  NameHit,
  Placing,
  PlayerDailies,
  PlayerDaily,
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

/* a search box's text taken literally in a LIKE pattern, and the patterns that match it
   anywhere or at the start */
const literal = (q: string) => q.replace(/[\\%_]/g, (c) => "\\" + c);
const contains = (q: string) => "%" + literal(q) + "%";

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
  const matched = sql`select b.*, p.persona, nullif(p.avatar, '') as avatar, g.skin
    from (select *, lag(score) over (order by rank) as ahead from (${boardSql(name)}) r) b
    join players p on p.steam_id = b.steam_id
    left join entries e on e.board = b.board and e.steam_id = b.steam_id
      and e.closed_refresh is null
      and e.board in (select name from boards where not scores_points)
    left join ghosts g on g.ugc_id = e.ugc_id
    ${match ? sql`where lower(${personaSql}) like ${match} or b.steam_id like ${match}` : sql``}`;
  const found = await rows<BoardRow & { total: number }>(
    db,
    sql`select rank, steam_id as "steamId", persona, avatar, score::float8 as score,
        ahead::float8 as ahead, seasons, skin, (count(*) over ())::int as total
      from (${matched}) m
      order by rank offset ${from} limit ${count}`,
  );
  const total =
    found.at(0)?.total ??
    (await rows<{ n: number }>(db, sql`select count(*)::int as n from (${matched}) m`))[0].n;
  for (const r of found) delete (r as Partial<typeof r>).total;
  return { total, rows: found };
}

/* Every Steam ID the database has seen, in no order */
export async function playerIds(db: Db): Promise<Array<string>> {
  const found = await rows<{ id: string }>(db, sql`select steam_id as id from players`);
  return found.map((r) => r.id);
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
/* Season 1 Current and All Seasons, each ranked whole, which a player's page reads its
   rows from (playerData) */
export async function derivedStandings(db: Db): Promise<DerivedStandings> {
  const out: DerivedStandings = {};
  for (const name of DERIVED) {
    const found = await rows<{ steamId: string; rank: number; score: number }>(
      db,
      sql`select steam_id as "steamId", rank, score::float8 as score
        from (${boardSql(name)}) d order by rank`,
    );
    out[name] = {
      lead: found.at(0)?.score ?? 0,
      field: found.length,
      places: Object.fromEntries(found.map((r) => [r.steamId, [r.rank, r.score]])),
    };
  }
  return out;
}

/* A player's profile and every board they're on with where they stand: the Steam boards
   ranked here, the derived ones read from `derived` (derivedStandings) */
export async function playerData(
  db: Db,
  steamId: string,
  derived: DerivedStandings,
): Promise<PlayerData | null> {
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
  /* a Daily's board is the player's Daily record, read on its own */
  const theirs = sql`e.board in (select board from entries
    where steam_id = ${steamId} and closed_refresh is null)
    and b.kind <> 'daily'`;
  const finishes = await rows<PlayerFinish>(
    db,
    sql`select board, rank, score::float8 as score, lead::float8 as lead, field::int as field from (
        select board, steam_id, rank, score,
          first_value(score) over (partition by board order by rank) as lead,
          count(*) over (partition by board) as field
        from (${rankedSql(theirs)}) r
      ) all_boards
      where steam_id = ${steamId}`,
  );
  for (const name of DERIVED) {
    const d = derived[name] as DerivedStanding | undefined;
    const at = d?.places[steamId];
    if (d && at)
      finishes.push({ board: name, rank: at[0], score: at[1], lead: d.lead, field: d.field });
  }
  finishes.sort((a, b) => (a.board < b.board ? -1 : a.board > b.board ? 1 : 0));
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
  const starts = literal(term) + "%";
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

/* A Track's or a Map's Score history, every Entry it has held with the Refreshes that saw
   it, for lib/history.ts to work its record history out from; null for a board that does
   not exist or is scored in points, whose Entries keep current points only (docs/adr/0005) */
export async function historyInput(db: Db, name: string): Promise<HistoryInput | null> {
  const board = (
    await rows<{ points: boolean }>(
      db,
      sql`select scores_points as points from boards where name = ${name}`,
    )
  ).at(0);
  if (!board || board.points) return null;
  const [latest] = await rows<{ now: Date }>(db, sql`select max(started_at) as now from refreshes`);
  const found = await rows<{
    steamId: string;
    persona: string;
    score: number;
    f: Date;
    l: Date;
    c: Date | null;
  }>(
    db,
    sql`select e.steam_id as "steamId", ${personaSql} as persona, e.score::float8 as score,
        f.started_at as f, l.started_at as l, c.started_at as c
      from entries e
      join players p on p.steam_id = e.steam_id
      join refreshes f on f.id = e.first_seen_refresh
      join refreshes l on l.id = e.last_seen_refresh
      left join refreshes c on c.id = e.closed_refresh
      where e.board = ${name}`,
  );
  const at = (d: Date) => new Date(d).toISOString();
  return {
    now: at(latest.now),
    entries: found.map((e) => ({
      steamId: e.steamId,
      persona: e.persona,
      score: e.score,
      firstSeenAt: at(e.f),
      lastSeenAt: at(e.l),
      closedAt: e.c ? at(e.c) : null,
    })),
  };
}

/* A Daily's window and whether a read after its close made it final, as lib/daily.ts reads
   them: its open and close as ISO strings in UTC, which isLive compares with the reader's
   clock */
const dailyWindowSql = sql`
  to_char(d.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "startsAt",
  to_char(d.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "endsAt",
  d.final_refresh is not null as final`;

/* A Daily's Map as its latest catalogue row describes it (l.preview, l.medals): a Map no
   catalogue has listed has no row */
const dailyMapSql = sql`left join lateral (select preview, medals from map_history h
    where h.pfid = d.pfid order by last_seen_refresh desc, id desc limit 1) l on true`;

/* One Daily by its date, or null for a date with none. Its board ranks like a Map's
   (boardPage on `board`). */
export async function dailyDay(db: Db, date: string): Promise<DailyDay | null> {
  const found = await rows<DailyDay>(
    db,
    sql`select d.date::text as date, d.board, d.pfid, d.title, l.preview,
        coalesce(l.medals, '{}') as medals,
        exists (select 1 from (${listedMapsSql}) w where w.board = m.board) as listed,
        ${dailyWindowSql},
        (select count(*) from entries e
          where e.board = d.board and e.closed_refresh is null)::int as "entryCount"
      from dailies d
      left join maps m on m.pfid = d.pfid
      ${dailyMapSql}
      where d.date = ${date}::date`,
  );
  return found.at(0) ?? null;
}

/* Every Daily, oldest first, with its 1st as its board ranks it */
export async function dailies(db: Db): Promise<Array<DailyCell>> {
  const found = await rows<
    Omit<DailyCell, "winner"> & { winnerId: string | null; winnerName: string }
  >(
    db,
    sql`select d.date::text as date, d.pfid, d.title, l.preview,
        ${dailyWindowSql},
        coalesce(n.count, 0)::int as "entryCount",
        w.steam_id as "winnerId", ${personaSql} as "winnerName"
      from dailies d
      ${dailyMapSql}
      left join (select board, count(*) from entries
        where closed_refresh is null group by board) n on n.board = d.board
      left join (${rankedSql(sql`e.board in (select board from dailies)`)}) w
        on w.board = d.board and w.rank = 1
      left join players p on p.steam_id = w.steam_id
      order by d.date`,
  );
  return found.map(({ winnerId, winnerName, ...d }) => ({
    ...d,
    winner: winnerId ? { steamId: winnerId, persona: winnerName } : null,
  }));
}

/* Every Daily's date, oldest first: what a URL's date is checked against, and the newest
   is what /daily opens on */
export async function dailyDates(db: Db): Promise<Array<string>> {
  const found = await rows<{ date: string }>(
    db,
    sql`select date::text as date from dailies order by date`,
  );
  return found.map((r) => r.date);
}

/* The all-time Daily standings (standingsOf in lib/daily.ts), over final Dailies only:
   a live Daily's board would move them while it is open */
export async function dailyStandings(db: Db): Promise<DailyStandings> {
  const final = await rows<{ date: string }>(
    db,
    sql`select date::text as date from dailies where final_refresh is not null order by date`,
  );
  const finishes = await rows<DailyFinish>(
    db,
    sql`select d.date::text as date, r.steam_id as "steamId", ${personaSql} as persona,
        nullif(p.avatar, '') as avatar, r.rank
      from (${rankedSql(sql`e.board in (select board from dailies where final_refresh is not null)`)}) r
      join dailies d on d.board = r.board
      join players p on p.steam_id = r.steam_id`,
  );
  return standingsOf(
    final.map((r) => r.date),
    finishes,
  );
}

/* A player's place on every Daily they have a time on, oldest first, each ranked as its
   board ranks it, as their Daily record (playerDailiesOf in lib/daily.ts) */
export async function playerDailies(db: Db, steamId: string): Promise<PlayerDailies> {
  const played = await rows<PlayerDaily>(
    db,
    sql`select d.date::text as date, r.rank, r.field::int as field,
        d.final_refresh is not null as final
      from dailies d join (
        select board, steam_id, rank, count(*) over (partition by board) as field
        from (${rankedSql(sql`e.board in (select board from dailies)`)}) x
      ) r on r.board = d.board
      where r.steam_id = ${steamId}
      order by d.date`,
  );
  const days = await rows<{ date: string; final: boolean }>(
    db,
    sql`select date::text as date, final_refresh is not null as final from dailies order by date`,
  );
  return playerDailiesOf(days, played);
}
