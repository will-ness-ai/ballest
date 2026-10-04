// What the Daily Report reads from the leaderboard database (Postgres on Neon, docs/adr/0005 and
// 0006). The schema is owned by Drizzle in web/db/schema.ts; these are plain SQL over it, and the
// ranking rule is web/db/reads.ts's: fastest first, then first seen, then Steam ID. Timestamps
// come back as epoch ms and scores as float8, since pg hands bigints over as strings; every row
// is decoded before the report sees it.
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { Config, Context, Data, Effect, Layer, Schema } from "effect";
import { SCORE_TICKS_PER_SECOND } from "../domain.js";
import { DAY_MS, type ReportData, type ReportTrack, type TrackRecord } from "./report.js";

export class ReportDataUnavailable extends Data.TaggedError("ReportDataUnavailable")<{
  readonly reason: string;
}> {}

export class ReportSource extends Context.Tag("multiballs/ReportSource")<
  ReportSource,
  { readonly read: (at: number) => Effect.Effect<ReportData, ReportDataUnavailable> }
>() {}

/** k_UGCHandleInvalid: Steam's id for "no ghost attached", read here as no UGC id at all. */
const NO_GHOST = "18446744073709551615";
const UgcId = Schema.transform(Schema.NullOr(Schema.String), Schema.NullOr(Schema.String), {
  strict: true,
  decode: (id) => (id === NO_GHOST ? null : id),
  encode: (id) => id,
});
const Ms = Schema.NullOr(Schema.Number);

const MapRow = Schema.Struct({
  pfid: Schema.String,
  board: Schema.String,
  title: Schema.String,
  creator: Schema.NullOr(Schema.String),
  createdAt: Ms,
  author: Ms,
  firstReadAt: Ms,
});
const EntryRow = Schema.Struct({
  board: Schema.String,
  steamId: Schema.String,
  persona: Schema.String,
  score: Schema.Number,
  ugcId: UgcId,
  firstSeenAt: Schema.Number,
  closedAt: Ms,
});
const TrackRow = Schema.Struct({
  board: Schema.String,
  season: Schema.NullOr(Schema.String),
  display: Schema.String,
});
const RecordRow = Schema.Struct({
  board: Schema.String,
  steamId: Schema.String,
  persona: Schema.String,
  score: Schema.Number,
  ugcId: UgcId,
});
const RefreshedRow = Schema.Struct({ at: Ms });

const rows = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknown(Schema.Array(schema));

const read = Effect.fn("ReportSource.read")(function* (at: number) {
  const sql = yield* SqlClient.SqlClient;
  const ms = (column: string) => sql.unsafe(`(extract(epoch from ${column}) * 1000)::float8`);
  const since = new Date(at - DAY_MS);

  // Every Map still on the Workshop, with its latest map_history row (medals are [Bronze,
  // Silver, Gold, Author] in s) and when its board was first read. A Map's latest row moves with
  // every Refresh whose catalogue lists it, so one the newest catalogue left out is gone.
  const maps = sql`
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
    where h.last_seen_refresh = (select max(last_seen_refresh) from map_history)`.pipe(
    Effect.flatMap(rows(MapRow)),
  );

  // Every Entry on a Map's board that is open now or was open a day ago.
  const entries = sql`
    select e.board, e.steam_id as "steamId", p.persona, e.score::float8 as score,
           e.ugc_id as "ugcId", ${ms("f.started_at")} as "firstSeenAt",
           ${ms("c.started_at")} as "closedAt"
    from entries e
    join boards b on b.name = e.board and b.kind = 'map'
    join players p on p.steam_id = e.steam_id
    join refreshes f on f.id = e.first_seen_refresh
    left join refreshes c on c.id = e.closed_refresh
    where e.closed_refresh is null or c.started_at > ${since}`.pipe(Effect.flatMap(rows(EntryRow)));

  const tracks = sql`
    select name as board, season, display from boards where kind = 'track'`.pipe(
    Effect.flatMap(rows(TrackRow)),
  );

  // Each Track's world record at a moment: its best Entry open then.
  const records = (moment: Date) =>
    sql`
    select distinct on (e.board) e.board, e.steam_id as "steamId", p.persona,
           e.score::float8 as score, e.ugc_id as "ugcId"
    from entries e
    join boards b on b.name = e.board and b.kind = 'track'
    join players p on p.steam_id = e.steam_id
    join refreshes f on f.id = e.first_seen_refresh
    left join refreshes c on c.id = e.closed_refresh
    where f.started_at <= ${moment} and (c.started_at is null or c.started_at > ${moment})
    order by e.board, e.score, e.first_seen_refresh, e.steam_id`.pipe(
      Effect.flatMap(rows(RecordRow)),
      Effect.map(
        (found) => new Map(found.map(({ board, ...r }): [string, TrackRecord] => [board, r])),
      ),
    );

  const refreshed = sql`
    select ${ms("max(coalesce(finished_at, started_at))")} as at from refreshes`.pipe(
    Effect.flatMap(rows(RefreshedRow)),
  );

  const [mapRows, entryRows, trackRows, now, then, last] = yield* Effect.all(
    [maps, entries, tracks, records(new Date(at)), records(since), refreshed],
    { concurrency: 1 },
  );
  return {
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
        record: now.get(t.board) ?? null,
        recordYesterday: then.get(t.board) ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    refreshedAt: last[0]?.at ?? null,
  } satisfies ReportData;
});

/**
 * The leaderboard database at DATABASE_URL, read-only in practice: nothing here writes. Each read
 * opens its own connection and closes it, so a database that can't be reached fails that day's
 * report (and ops hears) instead of the bot's startup.
 */
export const ReportSourceLive = Layer.succeed(
  ReportSource,
  ReportSource.of({
    read: (at) =>
      read(at).pipe(
        Effect.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
        Effect.catchTags({
          SqlError: (e) => Effect.fail(new ReportDataUnavailable({ reason: e.message })),
          ParseError: (e) => Effect.fail(new ReportDataUnavailable({ reason: e.message })),
          ConfigError: () =>
            Effect.fail(
              new ReportDataUnavailable({ reason: "DATABASE_URL is missing or not a URL" }),
            ),
        }),
      ),
  }),
);
