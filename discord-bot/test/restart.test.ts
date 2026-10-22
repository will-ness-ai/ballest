// Restarting for a change to the Venues, and its brake: at most three restarts in any hour, kept
// in SQLite across restarts, so a server whose availability flaps can't keep the bot restarting;
// never before the bot is fully up and has run a minute. And ending the process: cleanly, then
// for sure.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, Layer, Ref, TestClock } from "effect";
import {
  launchUntilShutdown,
  makeRestart,
  RESTARTS_PER_HOUR,
  RestartHistory,
  RestartHistoryLive,
  Shutdown,
} from "../src/restart.js";

/**
 * A database that outlives each process, and a way to start one: its Restart, and whether it
 * ended. `brokenReads` many reads of the history hit a bug first.
 */
const setup = Effect.fn("setup")(function* (opts: { readonly brokenReads?: number } = {}) {
  const live = Context.get(
    yield* Layer.build(
      RestartHistoryLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
    RestartHistory,
  );
  let broken = opts.brokenReads ?? 0;
  const history = RestartHistory.of({
    since: (at) =>
      Effect.suspend(() => (broken-- > 0 ? Effect.dieMessage("disk I/O error") : live.since(at))),
    add: live.add,
  });
  const process = Effect.gen(function* () {
    const ended = yield* Ref.make(false);
    const restart = yield* makeRestart.pipe(
      Effect.provideService(RestartHistory, history),
      Effect.provideService(Shutdown, { now: Ref.set(ended, true) }),
    );
    return { restart, ended: Ref.get(ended) };
  });
  return { process };
});

/** Let a restart that is due run. */
const settle = Effect.repeatN(Effect.yieldNow(), 10);

describe("restarting for the Venues", () => {
  it.scoped("ends the process once it is up and has run a minute, once however often asked", () =>
    Effect.gen(function* () {
      const { process } = yield* setup();
      const bot = yield* process;
      yield* bot.restart.ready;
      yield* Effect.fork(bot.restart.request("invited"));
      yield* Effect.fork(bot.restart.request("removed"));
      yield* TestClock.adjust("59 seconds");
      yield* settle;
      expect(yield* bot.ended).toBe(false);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(yield* bot.ended).toBe(true);
    }),
  );

  it.scoped("waits until the bot is fully up: Footers posted, recovery done, clicks answered", () =>
    Effect.gen(function* () {
      const { process } = yield* setup();
      const bot = yield* process;
      yield* Effect.fork(bot.restart.request("invited"));
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(yield* bot.ended).toBe(false);
      yield* bot.restart.ready;
      yield* settle;
      expect(yield* bot.ended).toBe(true);
    }),
  );

  it.scoped(
    "fails each ask after a bug reading its history, so the asker can undo; the next tries again",
    () =>
      Effect.gen(function* () {
        const { process } = yield* setup({ brokenReads: 1 });
        const bot = yield* process;
        yield* bot.restart.ready;
        yield* TestClock.adjust("1 minute");
        const first = yield* Effect.fork(bot.restart.request("invited"));
        const second = yield* Effect.fork(bot.restart.request("removed"));
        yield* settle;
        expect(yield* bot.ended).toBe(false);
        expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true);
        expect(Exit.isFailure(yield* Fiber.await(second))).toBe(true);
        yield* Effect.fork(bot.restart.request("invited"));
        yield* settle;
        expect(yield* bot.ended).toBe(true);
      }),
  );

  it.scoped(
    "restarts a bot whose server's availability flaps at most three times an hour, then waits",
    () =>
      Effect.gen(function* () {
        const { process } = yield* setup();
        // Each start, the flapping server comes back and asks for a restart a minute in.
        for (let i = 0; i < RESTARTS_PER_HOUR; i++) {
          const bot = yield* process;
          yield* bot.restart.ready;
          yield* TestClock.adjust("1 minute");
          yield* Effect.fork(bot.restart.request("the server is set up as a Venue"));
          yield* settle;
          expect(yield* bot.ended).toBe(true);
        }
        const held = yield* process;
        yield* held.restart.ready;
        yield* TestClock.adjust("1 minute");
        yield* Effect.fork(held.restart.request("the server is set up as a Venue"));
        yield* settle;
        expect(yield* held.ended).toBe(false);
        // Deferred, not dropped: an hour after the first of the three.
        yield* TestClock.adjust("56 minutes");
        yield* settle;
        expect(yield* held.ended).toBe(false);
        yield* TestClock.adjust("1 minute");
        yield* settle;
        expect(yield* held.ended).toBe(true);
      }),
  );
});

describe("ending the process", () => {
  /** An app that ends itself once built, with this finalizer. */
  const appEnding = (finalizer: Effect.Effect<void>) =>
    Layer.scopedDiscard(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => finalizer);
        const shutdown = yield* Shutdown;
        yield* shutdown.now;
      }),
    );

  it.effect("closes the app's scope, then exits 0, whatever is still open", () =>
    Effect.gen(function* () {
      const closed = yield* Ref.make(false);
      const exits = yield* Ref.make<ReadonlyArray<number>>([]);
      yield* launchUntilShutdown(appEnding(Ref.set(closed, true)), (code) =>
        Effect.runSync(Ref.update(exits, (all) => [...all, code])),
      );
      expect(yield* Ref.get(closed)).toBe(true);
      expect(yield* Ref.get(exits)).toEqual([0]);
    }),
  );

  it.effect("exits anyway when closing takes over 20 seconds", () =>
    Effect.gen(function* () {
      const exits = yield* Ref.make<ReadonlyArray<number>>([]);
      // A daemon: its closing never ends, so the test doesn't wait on it either.
      yield* Effect.forkDaemon(
        launchUntilShutdown(appEnding(Effect.never), (code) =>
          Effect.runSync(Ref.update(exits, (all) => [...all, code])),
        ),
      );
      yield* settle;
      yield* TestClock.adjust("19 seconds");
      expect(yield* Ref.get(exits)).toEqual([]);
      yield* TestClock.adjust("1 second");
      expect(yield* Ref.get(exits)).toEqual([0]);
    }),
  );
});
