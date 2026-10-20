// Observed Steam session growth for homepage prototypes. Change-only history uses its
// first observation to reconstruct a cutoff; last_seen moves even when nothing changed.
import { sql } from "drizzle-orm";

import type { Db } from "./client";

export interface HomepageActivity {
  asOf: number;
  metrics: Record<string, { day: number | null; week: number | null }>;
}

export async function readHomepageActivity(db: Db): Promise<HomepageActivity> {
  const found = (
    await db.execute(sql`
    with anchor as (
      select id, started_at from refreshes
      where id = (select max(last_seen_refresh) from map_history)
    ), latest as (
      select distinct on (pfid) * from map_history
      order by pfid, last_seen_refresh desc, id desc
    ), growth as (
      select m.pfid, w.days,
        case when l.sessions is null then null
          when b.sessions is not null and l.sessions >= b.sessions then l.sessions - b.sessions
          when b.sessions is null and m.created_at >= a.started_at - w.days * interval '1 day'
            then l.sessions
          else null end as sessions
      from anchor a
      join latest l on l.last_seen_refresh = a.id
      join maps m on m.pfid = l.pfid
      cross join (values (1), (7)) w(days)
      left join lateral (
        select h.sessions from map_history h
        join refreshes r on r.id = h.first_seen_refresh
        where h.pfid = m.pfid and h.sessions is not null
          and r.started_at <= a.started_at - w.days * interval '1 day'
        order by r.started_at desc, h.id desc limit 1
      ) b on true
    )
    select (extract(epoch from a.started_at) * 1000)::float8 as "asOf", g.pfid,
      max(g.sessions) filter (where g.days = 1)::int as day,
      max(g.sessions) filter (where g.days = 7)::int as week
    from anchor a left join growth g on true
    group by a.started_at, g.pfid
  `)
  ).rows as Array<{ asOf: number; pfid: string | null; day: number | null; week: number | null }>;
  return {
    asOf: found[0]?.asOf ?? 0,
    metrics: Object.fromEntries(
      found.flatMap((r) => (r.pfid ? [[r.pfid, { day: r.day, week: r.week }]] : [])),
    ),
  };
}
