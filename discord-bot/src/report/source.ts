// What the Daily Report reads from the leaderboard database (Postgres on Neon, docs/adr/0005 and
// 0006). The schema is owned by Drizzle in web/db/schema.ts; these are plain SQL over it, and the
// ranking rule is web/db/reads.ts's: fastest first, then first seen, then Steam ID. Timestamps
// come back as epoch ms and scores as float8, since pg hands bigints over as strings.
import { SqlClient, type SqlError } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { Config, Context, Data, Effect, Layer } from "effect";
import { SCORE_TICKS_PER_SECOND } from "../domain.js";
import { DAY_MS, type ReportData, type ReportTrack, type TrackRecord } from "./report.js";

export class ReportDataUnavailable extends Data.TaggedError("ReportDataUnavailable")<{
  readonly reason: string;
}> {}

export interface ReportSnapshot {
  readonly data: ReportData;
  /** When the last Refresh that wrote the database finished (ms), or null with none yet. */
  readonly refreshedAt: number | null;
}

export class ReportSource extends Context.Tag("multiballs/ReportSource")<
  ReportSource,
  { readonly read: (at: number) => Effect.Effect<ReportSnapshot, ReportDataUnavailable> }
>() {}

interface MapRow {
  readonly pfid: string;
  readonly board: string;
  readonly title: string;
  readonly creator: string | null;
  readonly createdAt: number | null;
  readonly author: number | null;
  readonly firstReadAt: number | null;
}
interface EntryRow {
  readonly board: string;
  readonly steamId: string;
  readonly persona: string;
  readonly score: number;
  readonly ugcId: string | null;
  readonly firstSeenAt: number;
  readonly closedAt: number | null;
}
interface TrackRow {
  readonly board: string;
  readonly season: string | null;
  readonly display: string;
}
interface RecordRow extends TrackRecord {
  readonly board: string;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const ms = (column: string) => sql.unsafe(`(extract(epoch from ${column}) * 1000)::float8`);

  // Every Map still on the Workshop, with its latest map_history row (medals are [Bronze,
  // Silver, Gold, Author] in s) and when its board was first read. A Map's latest row moves with
  // every Refresh whose catalogue lists it, so one the newest catalogue left out is gone.
  const maps = sql<MapRow>`
    select m.pfid, m.board, h.title, m.creator_steam_id as creator,
           ${ms("m.created_at")} as "createdAt", h.medals[4] as author,
           ${ms("r.first_read")} as "firstReadAt"
    from maps m
    join lateral (
      select title, medals, last_seen_refresh from map_history
      where pfid = m.pfid order by last_seen_refresh desc, id desc limit 1
    ) h on true
    left join (
      select br.board, min(f.started_at) as first_read
      from board_reads br join refreshes f on f.id = br.refresh_id
      where br.ok group by br.board
    ) r on r.board = m.board
    where h.last_seen_refresh = (select max(last_seen_refresh) from map_history)`;

  // Every Entry on a Map's board that is open now or was open at `since`.
  const entries = (since: Date) => sql<EntryRow>`
    select e.board, e.steam_id as "steamId", p.persona, e.score::float8 as score,
           e.ugc_id as "ugcId", ${ms("f.started_at")} as "firstSeenAt",
           ${ms("c.started_at")} as "closedAt"
    from entries e
    join boards b on b.name = e.board and b.kind = 'map'
    join players p on p.steam_id = e.steam_id
    join refreshes f on f.id = e.first_seen_refresh
    left join refreshes c on c.id = e.closed_refresh
    where e.closed_refresh is null or c.started_at > ${since}`;

  const tracks = sql<TrackRow>`
    select name as board, season, display from boards where kind = 'track' order by name`;

  // Each Track's world record at a moment: its best Entry open then.
  const records = (at: Date) => sql<RecordRow>`
    select distinct on (e.board) e.board, e.steam_id as "steamId", p.persona,
           e.score::float8 as score, e.ugc_id as "ugcId"
    from entries e
    join boards b on b.name = e.board and b.kind = 'track'
    join players p on p.steam_id = e.steam_id
    join refreshes f on f.id = e.first_seen_refresh
    left join refreshes c on c.id = e.closed_refresh
    where f.started_at <= ${at} and (c.started_at is null or c.started_at > ${at})
    order by e.board, e.score, e.first_seen_refresh, e.steam_id`;

  const refreshed = sql<{ readonly at: number | null }>`
    select ${ms("max(coalesce(finished_at, started_at))")} as at from refreshes`;

  const read = Effect.fn("ReportSource.read")(
    function* (at: number) {
      const since = new Date(at - DAY_MS);
      const [mapRows, entryRows, trackRows, now, then, last] = yield* Effect.all(
        [maps, entries(since), tracks, records(new Date(at)), records(since), refreshed],
        { concurrency: 1 },
      );
      const recordOf = (rows: ReadonlyArray<RecordRow>) =>
        new Map(rows.map(({ board, ...r }) => [board, r]));
      const nowBy = recordOf(now);
      const thenBy = recordOf(then);
      const data: ReportData = {
        maps: mapRows.map((m) => ({
          pfid: m.pfid,
          board: m.board,
          title: m.title,
          creator: m.creator,
          createdAt: m.createdAt,
          firstReadAt: m.firstReadAt,
          // as the script did: int(seconds * ticks), truncated
          authorTicks: m.author === null ? null : Math.trunc(m.author * SCORE_TICKS_PER_SECOND),
        })),
        entries: entryRows,
        tracks: trackRows
          .map((t): ReportTrack => ({
            board: t.board,
            label: `S${(t.season ?? "").split(" ").at(-1) ?? ""} ${t.display}`,
            record: nowBy.get(t.board) ?? null,
            recordYesterday: thenBy.get(t.board) ?? null,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
      return { data, refreshedAt: last[0]?.at ?? null };
    },
    Effect.mapError((e: SqlError.SqlError) => new ReportDataUnavailable({ reason: e.message })),
  );

  return ReportSource.of({ read });
});

/** The leaderboard database at DATABASE_URL, read-only in practice: nothing here writes. */
export const ReportSourceLive = Layer.effect(ReportSource, make).pipe(
  Layer.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
);
