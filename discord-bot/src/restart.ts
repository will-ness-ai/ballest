// Restarting the bot, for a change to which Venues run (src/venues.ts): the set is fixed for the
// life of the process, so an invite, a fixed permission or a removal restarts it instead. It ends
// the way SIGTERM does (the layers close, Discord logs out); on Fly, `[[restart]] policy =
// "always"` brings it back, and the engine's restart recovery picks live Matches back up. Under
// `pnpm dev` it just exits.
import { Context, Duration, Effect, Layer, Ref } from "effect";

/** Asks for the bot to restart. */
export class Restart extends Context.Tag("multiballs/Restart")<
  Restart,
  {
    /** Restart soon, saying why; later asks change nothing. */
    readonly request: (why: string) => Effect.Effect<void>;
  }
>() {}

/** A restart waits until the process has run this long, so the bot restarts at most this often. */
const LIVE_AT_LEAST = Duration.minutes(3);

/** Restart by sending this process SIGTERM, once it has run LIVE_AT_LEAST. */
export const RestartLive = Layer.effect(
  Restart,
  Effect.gen(function* () {
    const asked = yield* Ref.make(false);
    return Restart.of({
      request: Effect.fn("Restart.request")(function* (why: string) {
        if (yield* Ref.getAndSet(asked, true)) return;
        const wait = Duration.millis(
          Math.max(0, Duration.toMillis(LIVE_AT_LEAST) - process.uptime() * 1000),
        );
        yield* Effect.log(`restarting in ${Duration.format(wait)}: ${why}`);
        yield* Effect.sleep(wait).pipe(
          Effect.zipRight(Effect.sync(() => process.kill(process.pid, "SIGTERM"))),
          Effect.forkDaemon,
        );
      }),
    });
  }),
);
