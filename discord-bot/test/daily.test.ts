import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Ref, TestClock } from "effect";
import { OpsAlerts } from "../src/ops.js";
import { Renderer } from "../src/render/renderer.js";
import { ReportChannel, ReportPostFailed } from "../src/report/channel.js";
import { dailyLoop, ReportLogLive } from "../src/report/daily.js";
import { GhostDates } from "../src/report/records.js";
import { DAY_MS } from "../src/report/report.js";
import { ReportSource } from "../src/report/source.js";

const HOUR = 3_600_000;
const DAY0 = Date.UTC(2026, 9, 4); // midnight UTC, Sunday 4 October

/** The schedule over fakes: a database refreshed `refreshedAgo` before each read, a channel that
 * records what it was given (or fails while `failing`), and the ops channel's messages. */
const setup = Effect.gen(function* () {
  const heads = yield* Ref.make<Array<string>>([]);
  const threads = yield* Ref.make(0);
  const alerts = yield* Ref.make<Array<string>>([]);
  const failing = yield* Ref.make(false);
  const refreshedAgo = yield* Ref.make(HOUR);
  const fakes = Layer.mergeAll(
    Layer.succeed(
      ReportSource,
      ReportSource.of({
        read: (at) =>
          Ref.get(refreshedAgo).pipe(
            Effect.map((ago) => ({
              data: { maps: [], entries: [], tracks: [] },
              refreshedAt: at - ago,
            })),
          ),
      }),
    ),
    Layer.succeed(GhostDates, GhostDates.of({ setAt: () => Effect.succeed(Option.none()) })),
    Layer.succeed(
      ReportChannel,
      ReportChannel.of({
        postHead: (content) =>
          Effect.gen(function* () {
            if (yield* Ref.get(failing))
              return yield* Effect.fail(new ReportPostFailed({ reason: "Missing Permissions" }));
            yield* Ref.update(heads, (h) => [...h, content.split("\n")[0] ?? ""]);
            return `m${(yield* Ref.get(heads)).length}`;
          }),
        postThread: () => Ref.update(threads, (n) => n + 1),
      }),
    ),
    Layer.succeed(
      OpsAlerts,
      OpsAlerts.make({
        configured: true,
        post: (content) => Ref.update(alerts, (a) => [...a, content]),
      }),
    ),
    ReportLogLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))),
    // Drawing runs on a worker, in real time; the schedule is checked on the TestClock.
    Layer.succeed(Renderer, {
      standings: () => Effect.succeed(new Uint8Array()),
    } as unknown as Renderer),
  );
  return { heads, threads, alerts, failing, refreshedAgo, fakes };
});

/** Run the schedule from the TestClock's current time until `ms` later, then stop it. */
const runFor = (ms: number) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(dailyLoop);
    yield* TestClock.adjust(ms);
    yield* Fiber.interrupt(fiber);
  });

describe("the Daily Report's schedule", () => {
  it.scoped("posts at 16:00 UTC every day", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 10 * HOUR);
        yield* runFor(5 * HOUR);
        expect(yield* Ref.get(t.heads)).toEqual([]);
        yield* runFor(2 * HOUR + DAY_MS);
        expect(yield* Ref.get(t.heads)).toEqual(["# Sunday 4 October", "# Monday 5 October"]);
        expect(yield* Ref.get(t.threads)).toBe(2);
      }).pipe(Effect.provide(t.fakes));
    }),
  );

  it.scoped("catches up once after a late start, and never posts a day twice", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 18 * HOUR);
        yield* runFor(HOUR);
        yield* runFor(HOUR); // a restart the same evening
        expect(yield* Ref.get(t.heads)).toEqual(["# Sunday 4 October"]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );

  it.scoped("skips a day whose data is over two days old, and tells ops", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.refreshedAgo, 3 * DAY_MS);
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 18 * HOUR);
        yield* runFor(HOUR);
        expect(yield* Ref.get(t.heads)).toEqual([]);
        expect(yield* Ref.get(t.alerts)).toEqual([
          expect.stringContaining("skipped the Daily Report for 2026-10-04"),
        ]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );

  it.scoped("tells ops when a post fails, and tries again on the next start", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.failing, true);
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 18 * HOUR);
        yield* runFor(HOUR);
        expect(yield* Ref.get(t.alerts)).toEqual([
          expect.stringContaining(
            "couldn't post the Daily Report for 2026-10-04: Missing Permissions",
          ),
        ]);
        yield* Ref.set(t.failing, false);
        yield* runFor(HOUR);
        expect(yield* Ref.get(t.heads)).toEqual(["# Sunday 4 October"]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );
});
