import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Queue, Ref, Stream, TestClock } from "effect";
import { AddMaps, AddMapsFailed, BATCH, newTracksLoop } from "../src/newTracks.js";
import { OpsAlerts } from "../src/ops.js";

/** The loop over a #new-tracks channel fed by `post`, an AddMaps that counts its runs (or fails
 * while `failing`), and the ops channel's messages. */
const setup = Effect.gen(function* () {
  const posts = yield* Queue.unbounded<string>();
  const runs = yield* Ref.make(0);
  const failing = yield* Ref.make(false);
  const alerts = yield* Ref.make<Array<string>>([]);
  const fakes = Layer.mergeAll(
    Layer.succeed(
      AddMaps,
      AddMaps.of({
        start: Effect.gen(function* () {
          if (yield* Ref.get(failing))
            return yield* Effect.fail(new AddMapsFailed({ reason: "401 Bad credentials" }));
          yield* Ref.update(runs, (n) => n + 1);
        }),
      }),
    ),
    Layer.succeed(
      OpsAlerts,
      OpsAlerts.make({
        configured: true,
        post: (content) => Ref.update(alerts, (a) => [...a, content]),
      }),
    ),
  );
  const fiber = yield* Effect.fork(
    newTracksLoop(Stream.fromQueue(posts)).pipe(Effect.provide(fakes)),
  );
  const post = Queue.offer(posts, "m1").pipe(Effect.zipRight(Effect.yieldNow()));
  return { post, runs, failing, alerts, fiber };
});

describe("adding new Maps from #new-tracks", () => {
  it.scoped("starts the step a minute after a post", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.post;
      yield* TestClock.adjust(BATCH - 1);
      expect(yield* Ref.get(t.runs)).toBe(0);
      yield* TestClock.adjust(1);
      expect(yield* Ref.get(t.runs)).toBe(1);
      yield* Fiber.interrupt(t.fiber);
    }),
  );

  it.scoped("posts within that minute share one run, and a later post starts another", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.post;
      yield* TestClock.adjust(BATCH / 2);
      yield* t.post;
      yield* t.post;
      yield* TestClock.adjust(BATCH / 2);
      expect(yield* Ref.get(t.runs)).toBe(1);
      yield* t.post;
      yield* TestClock.adjust(BATCH);
      expect(yield* Ref.get(t.runs)).toBe(2);
      yield* Fiber.interrupt(t.fiber);
    }),
  );

  it.scoped("tells ops when the step can't be started, and carries on", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.failing, true);
      yield* t.post;
      yield* TestClock.adjust(BATCH);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs couldn't start adding a new Workshop Map: 401 Bad credentials",
      ]);
      yield* Ref.set(t.failing, false);
      yield* t.post;
      yield* TestClock.adjust(BATCH);
      expect(yield* Ref.get(t.runs)).toBe(1);
      yield* Fiber.interrupt(t.fiber);
    }),
  );
});
