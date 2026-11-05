// A Map's spinning 3D GIF, for a Daily Post (spec #268, ticket #272) and the Weekly Cup's
// Shortlist. The GIF needs a browser with WebGL, so the site repo's daily-spin.yml draws it in
// GitHub Actions and stores it in the leaderboard database's map_spins (docs/data.md); the bot
// starts that workflow for a Map that has a file (map_files). A Daily Post attaches the GIF; the
// Shortlist links it on the site (/map/<pfid>/spin), since ten are more than one message uploads.
// The port is here, its real adapter below: plain SQL over the schema `web/` owns (ADR 0006), and
// GitHub's API with GITHUB_DISPATCH_TOKEN.
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { SITE_URL } from "./links.js";
import { Config, Context, Data, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";

/** How long after asking for a GIF its absence goes to ops (a run takes about 5 minutes). */
export const SPIN_WAIT = Duration.toMillis("1 hour");

/** The database or GitHub couldn't be reached. */
export class SpinUnavailable extends Data.TaggedError("SpinUnavailable")<{
  readonly reason: string;
}> {}

/** A Map's latest drawing: the map_files version it was drawn from, and when. */
export interface Spin {
  readonly version: string;
  readonly drawnAt: number;
  readonly gif: Uint8Array;
}

/** A Map with a file: its file's version, and its latest drawing (none if it was never drawn). */
export interface Drawing {
  readonly file: string;
  readonly drawn: Option.Option<{ readonly version: string; readonly drawnAt: number }>;
}

/** The link to a Map's drawing on the site: one per drawing, so Discord never shows an old one. */
export const spinUrl = (pfid: string, drawnAt: number) =>
  `${SITE_URL}/map/${pfid}/spin?v=${Math.floor(drawnAt)}`;

export class MapSpins extends Context.Tag("multiballs/MapSpins")<
  MapSpins,
  {
    /** The version of the Map's file the site draws; None for a Map with no file. */
    readonly fileVersion: (pfid: string) => Effect.Effect<Option.Option<string>, SpinUnavailable>;
    /** The Map's latest spinning GIF, if one was ever drawn. */
    readonly latest: (pfid: string) => Effect.Effect<Option.Option<Spin>, SpinUnavailable>;
    /** Each of these Maps that has a file, with its latest drawing (no GIF): one read. */
    readonly drawings: (
      pfids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, Drawing>, SpinUnavailable>;
    /** Start daily-spin.yml for the Map. */
    readonly draw: (pfid: string) => Effect.Effect<void, SpinUnavailable>;
  }
>() {}

/** No database or no token: every Map reads as having no file, so nothing is asked or shown. */
export const MapSpinsOff = Layer.succeed(
  MapSpins,
  MapSpins.of({
    fileVersion: () => Effect.succeedNone,
    latest: () => Effect.succeedNone,
    drawings: Effect.fn("MapSpinsOff.drawings")(function* () {
      return yield* Effect.succeed(new Map<string, Drawing>());
    }),
    draw: () => Effect.void,
  }),
);

const WORKFLOW =
  "https://api.github.com/repos/will-ness-ai/ballest/actions/workflows/daily-spin.yml/dispatches";

const VersionRow = Schema.Struct({ version: Schema.String });
const DrawingRow = Schema.Struct({
  pfid: Schema.String,
  file: Schema.String,
  version: Schema.NullOr(Schema.String),
  drawnAt: Schema.NullOr(Schema.Number),
});
const SpinRow = Schema.Struct({
  version: Schema.String,
  drawnAt: Schema.Number,
  gif: Schema.Uint8ArrayFromSelf,
});

const live = (token: Redacted.Redacted) =>
  Layer.effect(
    MapSpins,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      // Each read opens its own connection and closes it, as the Daily Report's do, so a
      // database that can't be reached fails that read, not the bot's startup.
      const all = Effect.fn("MapSpins.all")(function* <A, I>(
        schema: Schema.Schema<A, I>,
        run: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<unknown>, unknown>,
      ) {
        return yield* Effect.flatMap(SqlClient.SqlClient, run).pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(schema))),
          Effect.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
          Effect.mapError(
            (e) =>
              new SpinUnavailable({
                reason: e instanceof Error ? e.message : "the database couldn't be read",
              }),
          ),
        );
      });
      const query = Effect.fn("MapSpins.query")(function* <A, I>(
        schema: Schema.Schema<A, I>,
        run: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<unknown>, unknown>,
      ) {
        return Option.fromNullable((yield* all(schema, run))[0]);
      });
      return MapSpins.of({
        fileVersion: Effect.fn("MapSpins.fileVersion")(function* (pfid: string) {
          const row = yield* query(
            VersionRow,
            (sql) => sql`select version from map_files where pfid = ${pfid}`,
          );
          return Option.map(row, (r) => r.version);
        }),
        latest: Effect.fn("MapSpins.latest")(function* (pfid: string) {
          return yield* query(
            SpinRow,
            (sql) =>
              sql`select version, (extract(epoch from drawn_at) * 1000)::float8 as "drawnAt", gif
                  from map_spins where pfid = ${pfid}`,
          );
        }),
        drawings: Effect.fn("MapSpins.drawings")(function* (pfids: ReadonlyArray<string>) {
          if (pfids.length === 0) return new Map<string, Drawing>();
          const rows = yield* all(
            DrawingRow,
            (sql) =>
              sql`select f.pfid, f.version as file, s.version,
                    floor(extract(epoch from s.drawn_at) * 1000)::float8 as "drawnAt"
                  from map_files f left join map_spins s on s.pfid = f.pfid
                  where ${sql.in("f.pfid", pfids)}`,
          );
          return new Map(
            rows.map((r): [string, Drawing] => [
              r.pfid,
              {
                file: r.file,
                drawn:
                  r.version === null || r.drawnAt === null
                    ? Option.none()
                    : Option.some({ version: r.version, drawnAt: r.drawnAt }),
              },
            ]),
          );
        }),
        draw: Effect.fn("MapSpins.draw")(function* (pfid: string) {
          yield* http
            .execute(
              HttpClientRequest.post(WORKFLOW).pipe(
                HttpClientRequest.bearerToken(Redacted.value(token)),
                HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
                HttpClientRequest.bodyUnsafeJson({ ref: "main", inputs: { pfid } }),
              ),
            )
            .pipe(
              Effect.scoped,
              Effect.mapError(
                (e) =>
                  new SpinUnavailable({
                    reason:
                      e._tag === "ResponseError" ? `GitHub said ${e.response.status}` : e.message,
                  }),
              ),
            );
        }),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** The real one when DATABASE_URL and GITHUB_DISPATCH_TOKEN are both set; otherwise off. */
export const MapSpinsLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const database = yield* Config.option(Config.redacted("DATABASE_URL"));
    const token = yield* Config.option(Config.redacted("GITHUB_DISPATCH_TOKEN"));
    if (Option.isNone(database) || Option.isNone(token)) {
      yield* Effect.logInfo("no spinning GIFs (DATABASE_URL or GITHUB_DISPATCH_TOKEN not set)");
      return MapSpinsOff;
    }
    return live(token.value);
  }),
);
