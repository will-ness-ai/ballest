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
import { Clock, Context, Data, Deferred, Duration, Effect, Layer, Option, Ref } from "effect";
import { MigratorLive } from "./db.js";

/** A restart asked for hit a bug on its way (its history unreadable): it won't happen. */
export class RestartFailed extends Data.TaggedError("RestartFailed")<{ readonly why: string }> {}

/** Asks for the bot to restart. */
export class Restart extends Context.Tag("multiballs/Restart")<
  Restart,
  {
    /**
     * Restart as soon as the bot is fully up (`ready`), has run MIN_UPTIME and the brake allows,
     * saying why. Every ask waits on that one restart (so an asker forks it), and fails if it hits
     * a bug, so the asker can undo what it counted on; the next ask then tries again.
     */
    readonly request: (why: string) => Effect.Effect<void, RestartFailed>;
    /** The bot is fully up: home's Footer posted, restart recovery done, clicks answered. */
    readonly ready: Effect.Effect<void>;
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

/** A restart never comes sooner than this after the process started. */
const MIN_UPTIME = Duration.toMillis("1 minute");

/** The Restart port over a history and a shutdown; a restart waiting its turn runs in the caller's scope. */
export const makeRestart = Effect.gen(function* () {
  const history = yield* RestartHistory;
  const shutdown = yield* Shutdown;
  const startedAt = yield* Clock.currentTimeMillis;
  const up = yield* Deferred.make<undefined>();
  /** The restart asked for, if any: what every ask waits on. */
  const asked = yield* Ref.make(Option.none<Deferred.Deferred<undefined, RestartFailed>>());
  const scope = yield* Effect.scope;

  const restart = Effect.fn("restart")(function* (why: string) {
    yield* Deferred.await(up);
    const now = yield* Clock.currentTimeMillis;
    const recent = [...(yield* history.since(now - HOUR))].sort((a, b) => a - b);
    // The restart that, once an hour old, leaves room for this one.
    const blocking = recent.at(-RESTARTS_PER_HOUR);
    const braked =
      recent.length < RESTARTS_PER_HOUR || blocking === undefined ? 0 : blocking + HOUR - now;
    const wait = Math.max(0, braked, startedAt + MIN_UPTIME - now);
    if (braked > 0)
      yield* Effect.logWarning(
        `restart deferred ${Duration.format(Duration.millis(wait))} (already ${recent.length} this hour): ${why}`,
      );
    else yield* Effect.log(`restarting: ${why}`);
    yield* Effect.sleep(Duration.millis(wait));
    yield* history.add(yield* Clock.currentTimeMillis);
    yield* shutdown.now;
  });

  return Restart.of({
    request: Effect.fn("Restart.request")(function* (why: string) {
      const mine = yield* Deferred.make<undefined, RestartFailed>();
      const current = yield* Ref.modify(asked, (o) =>
        Option.isSome(o) ? [o.value, o] : [mine, Option.some(mine)],
      );
      if (current === mine) {
        yield* Effect.log(`restart asked: ${why}`);
        // A bug on the way (its history unreadable) fails every ask, and leaves the next free.
        yield* restart(why).pipe(
          Effect.zipRight(Deferred.succeed(mine, undefined)),
          Effect.catchAllCause((cause) =>
            Effect.logError("restarting failed", cause).pipe(
              Effect.zipRight(Ref.set(asked, Option.none())),
              Effect.zipRight(Deferred.fail(mine, new RestartFailed({ why }))),
            ),
          ),
          Effect.forkIn(scope),
        );
      }
      return yield* Deferred.await(current);
    }),
    ready: Deferred.succeed(up, undefined).pipe(Effect.asVoid),
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

/** How long closing the app may take before the process exits anyway. */
const CLOSE_LIMIT = "20 seconds";

/**
 * Run the app until a restart asks it to end: then its scope closes, every finalizer running
 * (Discord logs out, the Activity's server closes), and the process exits 0, even if a socket or
 * timer is still open, or if closing takes over CLOSE_LIMIT. Fly's `always` policy restarts it.
 */
export const launchUntilShutdown = <ROut, E, RIn>(
  app: Layer.Layer<ROut, E, RIn>,
  exit: (code: number) => void = (code) => process.exit(code),
) =>
  Effect.gen(function* () {
    const stop = yield* Deferred.make<undefined>();
    const shutdown = Layer.succeed(Shutdown, {
      now: Deferred.succeed(stop, undefined).pipe(Effect.asVoid),
    });
    const ending = Deferred.await(stop).pipe(
      Effect.zipRight(
        Effect.sleep(CLOSE_LIMIT).pipe(
          Effect.zipRight(Effect.logError(`closing took over ${CLOSE_LIMIT}; exiting anyway`)),
          Effect.zipRight(Effect.sync(() => exit(0))),
          Effect.forkDaemon,
        ),
      ),
    );
    yield* Effect.raceFirst(Layer.launch(app.pipe(Layer.provide(shutdown))), ending);
    yield* Effect.sync(() => exit(0));
  });
