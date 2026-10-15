// PROTOTYPE (grill-design): a Campaign's standings, the Circuit's Overall rule over its Maps.
import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";

import { array, rankedSql, trackPointsSql } from "./boards";
import { DATA_TAG, db, getWorkshop } from "./data";
import type { Campaign } from "../lib/campaigns";

export interface CampaignRow {
  rank: number;
  steamId: string;
  persona: string;
  avatar: string | null;
  score: number;
  finished: number;
  /* board -> [place, points, time] */
  parts: Record<string, [number, number, number]>;
}

export async function getCampaignRows(boards: Array<string>): Promise<Array<CampaignRow>> {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife("max");
  const names = array(boards);
  const q = sql`select (row_number() over (order by t.score desc, t.first))::int as rank,
      t.steam_id as "steamId", coalesce(nullif(p.persona, ''), 'Player ' || right(p.steam_id, 6)) as persona,
      nullif(p.avatar, '') as avatar, t.score::float8 as score, t.finished::int as finished, t.parts
    from (
      select steam_id, sum(pts)::bigint as score, count(*) as finished,
        min(array_position(${names}, board) * 1000000 + rank) as first,
        jsonb_object_agg(board, jsonb_build_array(rank, pts, score)) as parts
      from (select r.*, ${trackPointsSql(sql`r.rank`)} as pts
            from (${rankedSql(sql`e.board = any(${names})`)}) r) x
      group by steam_id
    ) t join players p on p.steam_id = t.steam_id
    order by rank`;
  return (await db().execute(q)).rows as unknown as Array<CampaignRow>;
}

export async function getCampaign(c: Campaign) {
  const all = await getWorkshop();
  const maps = c.maps.map((pfid) => all.find((m) => m.pfid === pfid)).filter((m) => !!m);
  const rows = await getCampaignRows(maps.map((m) => m.name));
  return { maps, rows };
}
