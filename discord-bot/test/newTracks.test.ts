import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Fiber, Layer, Queue, Ref, Stream, TestClock } from "effect";
import {
  AddMaps,
  ADD_MAPS_TIMEOUT,
  AddMapsFailed,
  WAIT_AFTER_POST,
  addMapsLive,
  newTracksLoop,
} from "../src/newTracks.js";
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
      yield* TestClock.adjust(WAIT_AFTER_POST - 1);
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
      yield* TestClock.adjust(WAIT_AFTER_POST / 2);
      yield* t.post;
      yield* t.post;
      yield* TestClock.adjust(WAIT_AFTER_POST / 2);
      expect(yield* Ref.get(t.runs)).toBe(1);
      yield* t.post;
      yield* TestClock.adjust(WAIT_AFTER_POST);
      expect(yield* Ref.get(t.runs)).toBe(2);
      yield* Fiber.interrupt(t.fiber);
    }),
  );

  it.scoped("tells ops when the step can't be started, and carries on", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.failing, true);
      yield* t.post;
      yield* TestClock.adjust(WAIT_AFTER_POST);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs couldn't start adding a new Workshop Map: 401 Bad credentials",
      ]);
      yield* Ref.set(t.failing, false);
      yield* t.post;
      yield* TestClock.adjust(WAIT_AFTER_POST);
      expect(yield* Ref.get(t.runs)).toBe(1);
      yield* Fiber.interrupt(t.fiber);
    }),
  );
});

/** A stand-in for the collector's service: records each request's method and path, and answers
 * with `status` and the body runner.py's queue handler sends (tools/runner.py, `app`), or never
 * answers when `status` is null. */
const collector = (status: number | null) =>
  Effect.acquireRelease(
    Effect.async<{ url: string; requests: Array<string>; server: Server }>((resume) => {
      const requests: Array<string> = [];
      const server = createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);
        if (status === null) return;
        res.writeHead(status, { "content-type": "application/json" }).end('{"queued":true}');
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resume(Effect.succeed({ url: `http://127.0.0.1:${port}`, requests, server }));
      });
    }),
    (c) =>
      Effect.sync(() => {
        c.server.closeAllConnections(); // the one that never answers holds its socket open
        c.server.close();
      }),
  );

describe("asking the collector to add new Maps", () => {
  it.scoped("posts to its /add-maps", () =>
    Effect.gen(function* () {
      const c = yield* collector(202);
      const addMaps = yield* AddMaps.pipe(Effect.provide(addMapsLive(c.url)));
      yield* addMaps.start;
      expect(c.requests).toEqual(["POST /add-maps"]);
    }),
  );

  it.scoped("fails with what the collector answered", () =>
    Effect.gen(function* () {
      const c = yield* collector(500);
      const addMaps = yield* AddMaps.pipe(Effect.provide(addMapsLive(c.url)));
      const result = yield* Effect.either(addMaps.start);
      expect(result).toEqual(Either.left(new AddMapsFailed({ reason: "the collector said 500" })));
    }),
  );

  it.scoped("gives up on a collector that never answers", () =>
    Effect.gen(function* () {
      const c = yield* collector(null);
      const addMaps = yield* AddMaps.pipe(Effect.provide(addMapsLive(c.url)));
      const fiber = yield* Effect.fork(Effect.either(addMaps.start));
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)));
      yield* TestClock.adjust(ADD_MAPS_TIMEOUT);
      expect(yield* Fiber.join(fiber)).toEqual(
        Either.left(new AddMapsFailed({ reason: "the collector didn't answer" })),
      );
    }),
  );
});
