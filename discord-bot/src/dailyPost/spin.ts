// A Daily Post's spinning 3D GIF (spec #268, ticket #272). The GIF needs a browser with WebGL,
// so the site repo's daily-spin.yml draws it in GitHub Actions and stores it in the leaderboard
// database's map_spins (docs/data.md); the bot starts that workflow when it posts a Daily whose
// Map has a file (map_files), and edits the GIF in once it is there. The port is here, its real
// adapter below: plain SQL over the schema `web/` owns (ADR 0006), and GitHub's API with
// GITHUB_DISPATCH_TOKEN, as newTracks.ts starts add-maps.yml.
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
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

export class DailySpins extends Context.Tag("multiballs/DailySpins")<
  DailySpins,
  {
    /** The version of the Map's file the site draws; None for a Map with no file. */
    readonly fileVersion: (pfid: string) => Effect.Effect<Option.Option<string>, SpinUnavailable>;
    /** The Map's latest spinning GIF, if one was ever drawn. */
    readonly latest: (pfid: string) => Effect.Effect<Option.Option<Spin>, SpinUnavailable>;
    /** Start daily-spin.yml for the Map. */
    readonly draw: (pfid: string) => Effect.Effect<void, SpinUnavailable>;
  }
>() {}

/** No database or no token: every Map reads as having no file, so nothing is asked or shown. */
export const DailySpinsOff = Layer.succeed(
  DailySpins,
  DailySpins.of({
    fileVersion: () => Effect.succeedNone,
    latest: () => Effect.succeedNone,
    draw: () => Effect.void,
  }),
);

const WORKFLOW =
  "https://api.github.com/repos/will-ness-ai/ballest/actions/workflows/daily-spin.yml/dispatches";

const VersionRow = Schema.Struct({ version: Schema.String });
const SpinRow = Schema.Struct({
  version: Schema.String,
  drawnAt: Schema.Number,
  gif: Schema.Uint8ArrayFromSelf,
});

const live = (token: Redacted.Redacted) =>
  Layer.effect(
    DailySpins,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      // Each read opens its own connection and closes it, as the Daily Report's do, so a
      // database that can't be reached fails that read, not the bot's startup.
      const query = Effect.fn("DailySpins.query")(function* <A, I>(
        schema: Schema.Schema<A, I>,
        run: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<unknown>, unknown>,
      ) {
        const rows = yield* Effect.flatMap(SqlClient.SqlClient, run).pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(schema))),
          Effect.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
          Effect.mapError(
            (e) =>
              new SpinUnavailable({
                reason: e instanceof Error ? e.message : "the database couldn't be read",
              }),
          ),
        );
        return Option.fromNullable(rows[0]);
      });
      return DailySpins.of({
        fileVersion: Effect.fn("DailySpins.fileVersion")(function* (pfid: string) {
          const row = yield* query(
            VersionRow,
            (sql) => sql`select version from map_files where pfid = ${pfid}`,
          );
          return Option.map(row, (r) => r.version);
        }),
        latest: Effect.fn("DailySpins.latest")(function* (pfid: string) {
          return yield* query(
            SpinRow,
            (sql) =>
              sql`select version, (extract(epoch from drawn_at) * 1000)::float8 as "drawnAt", gif
                  from map_spins where pfid = ${pfid}`,
          );
        }),
        draw: Effect.fn("DailySpins.draw")(function* (pfid: string) {
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
export const DailySpinsLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const database = yield* Config.option(Config.redacted("DATABASE_URL"));
    const token = yield* Config.option(Config.redacted("GITHUB_DISPATCH_TOKEN"));
    if (Option.isNone(database) || Option.isNone(token)) {
      yield* Effect.logInfo(
        "daily post: no spinning GIFs (DATABASE_URL or GITHUB_DISPATCH_TOKEN not set)",
      );
      return DailySpinsOff;
    }
    return live(token.value);
  }),
);
