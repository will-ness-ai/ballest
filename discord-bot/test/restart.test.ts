// Restarting for a change to the Venues, and its brake: at most three restarts in any hour, kept
// in SQLite across restarts, so a server whose availability flaps can't keep the bot restarting.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Ref, TestClock } from "effect";
import {
  makeRestart,
  RESTARTS_PER_HOUR,
  RestartHistory,
  RestartHistoryLive,
  Shutdown,
} from "../src/restart.js";

/** A database that outlives each process, and a way to start one: its Restart, and whether it ended. */
const setup = Effect.gen(function* () {
  const history = Context.get(
    yield* Layer.build(
      RestartHistoryLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
    RestartHistory,
  );
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
  it.scoped("ends the process at once, and only once however often it is asked", () =>
    Effect.gen(function* () {
      const { process } = yield* setup;
      const bot = yield* process;
      yield* bot.restart.request("invited");
      yield* bot.restart.request("removed");
      yield* settle;
      expect(yield* bot.ended).toBe(true);
    }),
  );

  it.scoped(
    "restarts a bot whose server's availability flaps at most three times an hour, then waits",
    () =>
      Effect.gen(function* () {
        const { process } = yield* setup;
        // Each start, the flapping server comes back and asks for a restart a minute in.
        for (let i = 0; i < RESTARTS_PER_HOUR; i++) {
          const bot = yield* process;
          yield* TestClock.adjust("1 minute");
          yield* bot.restart.request("the server is set up as a Venue");
          yield* settle;
          expect(yield* bot.ended).toBe(true);
        }
        const held = yield* process;
        yield* TestClock.adjust("1 minute");
        yield* held.restart.request("the server is set up as a Venue");
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
