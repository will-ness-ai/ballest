// Restarting the bot, for a change to which Venues run (src/venues.ts): the set is fixed for the
// life of the process, so a Venue set up or repaired, or a removal, restarts it instead. It ends
// cleanly (`Shutdown`: src/main.ts closes the app's scope, so every finalizer runs, and exits 0); on
// Fly, `[[restart]] policy = "always"` brings it back whatever the exit code, and the engine's
// restart recovery picks live Matches back up. Under `pnpm dev` it just exits.
//
// A brake, kept in SQLite across restarts: at most RESTARTS_PER_HOUR in any hour. One asked for
// beyond that waits until the hour's first falls out, so a server whose availability flaps can't
// keep the bot restarting.
import { SqlClient } from "@effect/sql";
import { Clock, Context, Deferred, Duration, Effect, Layer, Ref } from "effect";
import { MigratorLive } from "./db.js";

/** Asks for the bot to restart. */
export class Restart extends Context.Tag("multiballs/Restart")<
  Restart,
  {
    /** Restart as soon as the brake allows, saying why; later asks in this process change nothing. */
    readonly request: (why: string) => Effect.Effect<void>;
  }
>() {}

/** Ends the process cleanly, closing the app's scope: what a restart does once the brake allows. */
export class Shutdown extends Context.Tag("multiballs/Shutdown")<
  Shutdown,
  { readonly now: Effect.Effect<void> }
>() {}

/** When the bot restarted for its Venues (ms), kept across restarts. */
export class RestartHistory extends Context.Tag("multiballs/RestartHistory")<
  RestartHistory,
  {
    readonly since: (at: number) => Effect.Effect<ReadonlyArray<number>>;
    readonly add: (at: number) => Effect.Effect<void>;
  }
>() {}

export const RESTARTS_PER_HOUR = 3;
const HOUR = Duration.toMillis("1 hour");

/** The Restart port over a history and a shutdown; a restart waiting on the brake runs in the caller's scope. */
export const makeRestart = Effect.gen(function* () {
  const history = yield* RestartHistory;
  const shutdown = yield* Shutdown;
  const asked = yield* Ref.make(false);
  const scope = yield* Effect.scope;
  return Restart.of({
    request: Effect.fn("Restart.request")(function* (why: string) {
      if (yield* Ref.getAndSet(asked, true)) return;
      const now = yield* Clock.currentTimeMillis;
      const recent = [...(yield* history.since(now - HOUR))].sort((a, b) => a - b);
      // The restart that, once an hour old, leaves room for this one.
      const blocking = recent.at(-RESTARTS_PER_HOUR);
      const wait =
        recent.length < RESTARTS_PER_HOUR || blocking === undefined ? 0 : blocking + HOUR - now;
      if (wait > 0)
        yield* Effect.logWarning(
          `restart deferred ${Duration.format(Duration.millis(wait))} (already ${recent.length} this hour): ${why}`,
        );
      else yield* Effect.log(`restarting: ${why}`);
      yield* Effect.sleep(Duration.millis(Math.max(0, wait))).pipe(
        Effect.zipRight(Clock.currentTimeMillis),
        Effect.flatMap((at) => history.add(at)),
        Effect.zipRight(shutdown.now),
        Effect.forkIn(scope),
      );
    }),
  });
});

/** The restart history in the bot's SQLite database (`venue_restarts`). */
export const RestartHistoryLive = Layer.effect(
  RestartHistory,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return RestartHistory.of({
      since: (at) =>
        sql<{ readonly at: number }>`SELECT at FROM venue_restarts WHERE at > ${at}`.pipe(
          Effect.map((rows) => rows.map((r) => r.at)),
          Effect.orDie,
        ),
      add: (at) =>
        sql`INSERT INTO venue_restarts (at) VALUES (${at})`.pipe(
          Effect.zipRight(sql`DELETE FROM venue_restarts WHERE at < ${at - 24 * HOUR}`),
          Effect.asVoid,
          Effect.orDie,
        ),
    });
  }),
).pipe(Layer.provide(MigratorLive));

/** The Restart port with its brake in SQLite. Needs Shutdown and a SqlClient. */
export const RestartLive = Layer.scoped(Restart, makeRestart).pipe(
  Layer.provide(RestartHistoryLive),
);

/**
 * Run the app until a restart asks it to end: then its scope closes, every finalizer running
 * (Discord logs out, the Activity's server closes), and the program returns, so the process exits
 * cleanly on every platform.
 */
export const launchUntilShutdown = <ROut, E, RIn>(app: Layer.Layer<ROut, E, RIn>) =>
  Effect.gen(function* () {
    const stop = yield* Deferred.make<undefined>();
    const shutdown = Layer.succeed(Shutdown, {
      now: Deferred.succeed(stop, undefined).pipe(Effect.asVoid),
    });
    yield* Effect.raceFirst(Layer.launch(app.pipe(Layer.provide(shutdown))), Deferred.await(stop));
  });
