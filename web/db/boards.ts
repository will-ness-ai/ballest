// Ranked boards, Steam's and the two the site works out from them, as SQL every other
// query builds on. Nothing here is stored (docs/adr/0005): a rank is the order of a board's
// open Entries, and Season 1 Current and All Seasons are added up from those ranks on every
// read, the way the collector's build_current and build_composite did.
//
// Steam orders equal scores by Steam ID in the board's own direction: the lower ID first
// on a time board, the higher first on a points board. Every tie on the committed boards
// (7,288 of them, 2026-10-04) reads that way, so the ranks here are Steam's.
import { sql, type SQL } from "drizzle-orm";

import { COMPOSITE_BOARD, S1_CURRENT_BOARD, S1_TRACKS, S2_OVERALL_BOARD } from "../lib/circuit";

/* The open Entries of the boards `where` picks, each with its rank on its board:
   (board, steam_id, score, rank). `where` is a condition on entries `e`. */
export function rankedSql(where: SQL) {
  return sql`select e.board, e.steam_id, e.score::bigint as score,
      (row_number() over (
        partition by e.board
        order by case when b.scores_points then e.score end desc,
                 case when b.scores_points then e.steam_id end desc,
                 case when not b.scores_points then e.score end asc,
                 case when not b.scores_points then e.steam_id end asc))::int as rank
    from entries e join boards b on b.name = e.board
    where e.closed_refresh is null and (${where})`;
}

/* What a place on one Track pays toward Overall: track_points in tools/campaign_common.py
   and trackPoints in lib/rules.ts. Past 10th it is floor(360000/(100·2^k) +
   40000·5^k/(10·place)) for place in (10^k, 10^(k+1)], which over one denominator is the
   integer division below, so no rounding can creep in. */
const trackPointsSql = (rank: SQL) => sql`(case when ${rank} <= 10 then 40000 / ${rank}
    else (3600000::bigint * ${rank}
          + 4000000::bigint * (10::bigint ^ (length((${rank} - 1)::text) - 1))::bigint)
         / (1000::bigint * (2::bigint ^ (length((${rank} - 1)::text) - 1))::bigint * ${rank})
    end)::bigint`;

/* a list of names as a Postgres text[] */
export const array = (names: ReadonlyArray<string>) =>
  sql`array[${sql.join(
    names.map((n) => sql`${n}`),
    sql`, `,
  )}]::text[]`;

/* Season 1 as it stands: each player's points for their place on every Season 1 Track,
   added up, highest first. Equal totals keep the order the collector met them in: by the
   first Track (in-game order) a player is on, then their place there. */
function s1CurrentSql() {
  const tracks = array(S1_TRACKS);
  return sql`select ${S1_CURRENT_BOARD}::text as board, steam_id, score,
      (row_number() over (order by score desc, first))::int as rank,
      null::jsonb as seasons
    from (
      select steam_id, sum(${trackPointsSql(sql`rank`)})::bigint as score,
        min(array_position(${tracks}, board) * 1000000 + rank) as first
      from (${rankedSql(sql`e.board = any(${tracks})`)}) t
      group by steam_id
    ) p`;
}

/* Every season's Overall points added up per player, Season 1 through its current board
   and Season 2 through Steam's, highest first; equal totals in the order the collector met
   them, Season 1's board first. Each row keeps its parts, by season. */
function compositeSql() {
  return sql`select ${COMPOSITE_BOARD}::text as board, steam_id, sum(score)::bigint as score,
      (row_number() over (order by sum(score) desc, min(first)))::int as rank,
      jsonb_object_agg(season, score order by part) as seasons
    from (
      select steam_id, score, 0 as part, 'Season 1' as season, rank as first
        from (${s1CurrentSql()}) s1
      union all
      select steam_id, score, 1, 'Season 2', 10000000 + rank
        from (${rankedSql(sql`e.board = ${S2_OVERALL_BOARD}`)}) s2
    ) parts
    group by steam_id`;
}

export const DERIVED = [S1_CURRENT_BOARD, COMPOSITE_BOARD] as const;

/* One board's ranked rows, Steam's or derived: (board, steam_id, score, rank, seasons) */
export function boardSql(name: string) {
  if (name === S1_CURRENT_BOARD) return s1CurrentSql();
  if (name === COMPOSITE_BOARD) return compositeSql();
  return sql`select board, steam_id, score, rank, null::jsonb as seasons
    from (${rankedSql(sql`e.board = ${name}`)}) r`;
}
