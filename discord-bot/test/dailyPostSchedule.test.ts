// The Daily Post's schedule (spec #268) over fakes on the TestClock: the developers' Daily API,
// the Daily's Steam board, the channel, and the ops channel, with the record in SQLite in memory.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Layer, Option, Ref, TestClock } from "effect";
import type { BoardRead, Challenge, DailyMap } from "../src/dailyPost/card.js";
import type { DailyMessage } from "../src/dailyPost/messages.js";
import {
  DailyApi,
  DailyApiUnavailable,
  DailyChannel,
  DailyPostFailed,
  DailyPostLogLive,
  dailyPostLoop,
  DailySteam,
  DailyThreadFailed,
} from "../src/dailyPost/schedule.js";
import { OpsAlerts } from "../src/ops.js";
import { Renderer } from "../src/render/renderer.js";
import type { LeadGraphImage } from "../src/render/scenes.js";
import { SteamUnavailable } from "../src/ports.js";
import { MapPreviews, PreviewSource } from "../src/previews.js";
import { ticks } from "./harness.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY0 = Date.UTC(2026, 9, 18); // midnight UTC, Sunday 18 October: Daily #60
const OPENS = DAY0 + HOUR;

const challenge = (date: string, startsAt: number): Challenge => ({
  date,
  pfid: "3796494598",
  title: "the drop",
  startsAt,
  endsAt: startsAt + 24 * HOUR,
  boardId: 21331276,
});
const MAP: DailyMap = {
  title: "the drop",
  maker: "AvgRon",
  previewUrl: "https://images.example/drop.jpg",
  medals: { bronze: 14, silver: 11, gold: 9, author: 8.9 },
};
const board = (players: number, leader = "airman"): BoardRead => ({
  players,
  top: players === 0 ? [] : [{ name: leader, ticks: ticks(8.532) }],
});
/** A board whose top runs are these, fastest first. */
const topOf = (...runs: ReadonlyArray<readonly [name: string, seconds: number]>): BoardRead => ({
  players: runs.length + 10,
  top: runs.map(([name, seconds]) => ({ name, ticks: ticks(seconds) })),
});

/** Each text block of a card, joined: what a reader sees, without the layout. */
const words = (m: DailyMessage) =>
  JSON.stringify(m.components)
    .match(/"content":"(?:[^"\\]|\\.)*"/g)
    ?.map((c) => JSON.parse(`{${c}}`).content as string)
    .join("\n") ?? "";

/**
 * The schedule's world: the API answers each date from `opensAt` (or fails while `apiDown`),
 * the board answers `boardNow` (or fails while `steamDown`), and the channel records what it
 * posted and edited, and when (or refuses while `channelDown`).
 */
const setup = Effect.gen(function* () {
  const opensAt = yield* Ref.make(OPENS);
  const apiDown = yield* Ref.make(false);
  const boardNow = yield* Ref.make(board(0));
  const steamDown = yield* Ref.make(false);
  const channelDown = yield* Ref.make(false);
  const threadDown = yield* Ref.make(false);
  const posts = yield* Ref.make<
    Array<{ at: number; message: DailyMessage; files: number; thread: string }>
  >([]);
  const edits = yield* Ref.make<
    Array<{ at: number; messageId: string; message: DailyMessage; files: ReadonlyArray<string> }>
  >([]);
  const lines = yield* Ref.make<Array<{ at: number; threadId: string; content: string }>>([]);
  const graphs = yield* Ref.make<Array<LeadGraphImage>>([]);
  const alerts = yield* Ref.make<Array<string>>([]);
  const sql = SqliteClient.layer({ filename: ":memory:" });
  const fakes = Layer.mergeAll(
    Layer.succeed(
      DailyApi,
      DailyApi.of({
        find: (date) =>
          Effect.gen(function* () {
            if (yield* Ref.get(apiDown))
              return yield* new DailyApiUnavailable({ reason: "503 Service Unavailable" });
            const start = Date.parse(`${date}T00:00:00Z`) + HOUR;
            const opened = (yield* Clock.currentTimeMillis) >= (yield* Ref.get(opensAt));
            // A later day is open too once its own 01:00 has passed.
            const open = start > OPENS ? (yield* Clock.currentTimeMillis) >= start : opened;
            return open ? Option.some(challenge(date, start)) : Option.none();
          }),
      }),
    ),
    Layer.succeed(
      DailySteam,
      DailySteam.of({
        map: () => Effect.succeed(MAP),
        board: () =>
          Effect.gen(function* () {
            if (yield* Ref.get(steamDown))
              return yield* new SteamUnavailable({ reason: "no reply to GetLBEntries" });
            return yield* Ref.get(boardNow);
          }),
      }),
    ),
    Layer.succeed(
      DailyChannel,
      DailyChannel.of({
        post: (message, files, thread) =>
          Effect.gen(function* () {
            if (yield* Ref.get(channelDown))
              return yield* new DailyPostFailed({ reason: "Missing Permissions" });
            const at = yield* Clock.currentTimeMillis;
            yield* Ref.update(posts, (p) => [...p, { at, message, files: files.length, thread }]);
            const messageId = `m${(yield* Ref.get(posts)).length}`;
            if (yield* Ref.get(threadDown))
              return yield* new DailyThreadFailed({ messageId, reason: "Missing Create Threads" });
            return { messageId, threadId: `t-${messageId}` };
          }),
        edit: (messageId, message, files) =>
          Effect.gen(function* () {
            if (yield* Ref.get(channelDown))
              return yield* new DailyPostFailed({ reason: "Missing Permissions" });
            const at = yield* Clock.currentTimeMillis;
            const names = files.map((f) => f.name);
            yield* Ref.update(edits, (e) => [...e, { at, messageId, message, files: names }]);
          }),
        say: (threadId, { content }) =>
          Effect.gen(function* () {
            if (yield* Ref.get(channelDown))
              return yield* new DailyPostFailed({ reason: "Missing Permissions" });
            const at = yield* Clock.currentTimeMillis;
            yield* Ref.update(lines, (l) => [...l, { at, threadId, content }]);
          }),
      }),
    ),
    MapPreviews.Default.pipe(
      Layer.provide(
        Layer.succeed(
          PreviewSource,
          PreviewSource.of({
            fetch: () => Effect.succeed({ type: "image/jpeg", body: new Uint8Array([1]) }),
          }),
        ),
      ),
    ),
    // Drawing runs on a worker, in real time; the schedule is checked on the TestClock.
    Layer.succeed(Renderer, {
      leadGraph: (image: LeadGraphImage) =>
        Ref.update(graphs, (g) => [...g, image]).pipe(Effect.as(new Uint8Array([2]))),
    } as unknown as Renderer),
    Layer.succeed(
      OpsAlerts,
      OpsAlerts.make({
        configured: true,
        post: (content) => Ref.update(alerts, (a) => [...a, content]),
      }),
    ),
  );
  // One database for the whole test, so a restart finds what the run before it recorded.
  const log = yield* Layer.build(DailyPostLogLive.pipe(Layer.provide(sql)));
  /** Run the schedule from now for `ms`, then stop it, as a deploy would. */
  const runFor = (ms: number) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(dailyPostLoop.pipe(Effect.scoped));
      yield* TestClock.adjust(ms);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(fakes), Effect.provide(log));
  return {
    opensAt,
    apiDown,
    boardNow,
    steamDown,
    channelDown,
    threadDown,
    posts,
    edits,
    lines,
    graphs,
    alerts,
    runFor,
  };
});

describe("the Daily Post's schedule", () => {
  it.scoped("posts within a minute of the API answering, with its screenshot and thread", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.opensAt, OPENS + 3 * MINUTE + 20_000);
      yield* TestClock.setTime(DAY0 + 30 * MINUTE);
      yield* t.runFor(HOUR);
      const posts = yield* Ref.get(t.posts);
      expect(posts.map((p) => p.at)).toEqual([OPENS + 4 * MINUTE]);
      expect(posts[0]?.files).toBe(1);
      expect(posts[0]?.thread).toBe("Daily #60 · the drop · Sun 18 Oct");
      expect(words(posts[0]!.message)).toContain("No times yet");
    }),
  );

  it.scoped("edits the card every 15 minutes only when what it shows has changed", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(HOUR);
      expect(yield* Ref.get(t.edits)).toEqual([]);
      yield* Ref.set(t.boardNow, board(3));
      yield* t.runFor(30 * MINUTE);
      const edits = yield* Ref.get(t.edits);
      expect(edits.map((e) => e.messageId)).toEqual(["m1"]);
      expect(words(edits[0]!.message)).toContain("**3** players · fastest **0:08.532**");
    }),
  );

  it.scoped("never posts a date twice across a restart, and resumes editing its card", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(HOUR);
      yield* t.runFor(HOUR);
      expect((yield* Ref.get(t.posts)).length).toBe(1);
      yield* Ref.set(t.boardNow, board(5, "snayK"));
      yield* t.runFor(16 * MINUTE);
      const edits = yield* Ref.get(t.edits);
      expect(edits.map((e) => e.messageId)).toEqual(["m1"]);
      expect(words(edits[0]!.message)).toContain("🥇 **snayK**");
    }),
  );

  it.scoped("reads the board for the last time at the close, then posts the next Daily", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      // Started late in the day (23:40): today's post goes up, then the next day's at its 01:00.
      yield* TestClock.setTime(OPENS + 22 * HOUR + 40 * MINUTE);
      yield* t.runFor(76 * MINUTE);
      expect(yield* Ref.get(t.edits)).toEqual([]);
      yield* Ref.set(t.boardNow, board(9));
      yield* t.runFor(10 * MINUTE);
      const edits = yield* Ref.get(t.edits);
      expect(edits.map((e) => [e.at, e.messageId])).toEqual([[OPENS + 24 * HOUR, "m1"]]);
      const posts = yield* Ref.get(t.posts);
      expect(posts.map((p) => p.thread)).toEqual([
        "Daily #60 · the drop · Sun 18 Oct",
        "Daily #61 · the drop · Mon 19 Oct",
      ]);
      // Closed: a later change to its board no longer touches the card.
      yield* Ref.set(t.boardNow, board(10));
      yield* t.runFor(20 * MINUTE);
      expect((yield* Ref.get(t.edits)).filter((e) => e.messageId === "m1")).toHaveLength(1);
    }),
  );

  it.scoped("tells ops once when a post fails, and posts on the next try", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.channelDown, true);
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(10 * MINUTE);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs couldn't post the Daily Post for 2026-10-18: Missing Permissions",
      ]);
      yield* Ref.set(t.channelDown, false);
      yield* t.runFor(2 * MINUTE);
      expect((yield* Ref.get(t.posts)).length).toBe(1);
    }),
  );

  it.scoped("keeps a post whose thread failed, and tells ops", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.threadDown, true);
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(10 * MINUTE);
      expect((yield* Ref.get(t.posts)).length).toBe(1);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs posted the Daily Post for 2026-10-18, but not its thread: Missing Create Threads",
      ]);
    }),
  );

  it.scoped("keeps the card as it was while the board can't be read, and tells ops once", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(MINUTE);
      yield* Ref.set(t.steamDown, true);
      yield* Ref.set(t.boardNow, board(4));
      yield* t.runFor(HOUR);
      expect(yield* Ref.get(t.edits)).toEqual([]);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs couldn't read the board of the Daily for 2026-10-18: no reply to GetLBEntries",
      ]);
      yield* Ref.set(t.steamDown, false);
      yield* t.runFor(16 * MINUTE);
      expect((yield* Ref.get(t.edits)).length).toBe(1);
    }),
  );

  it.scoped("tells ops once when the API fails or has no Daily an hour after opening time", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.apiDown, true);
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(10 * MINUTE);
      yield* Ref.set(t.apiDown, false);
      yield* Ref.set(t.opensAt, OPENS + 5 * HOUR);
      yield* t.runFor(2 * HOUR);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs can't ask the Daily API for 2026-10-18: 503 Service Unavailable",
        "Multiballs has found no Daily for 2026-10-18 an hour after 01:00 UTC; it keeps asking every minute.",
      ]);
      expect(yield* Ref.get(t.posts)).toEqual([]);
    }),
  );
});

describe("the Daily Post's lead", () => {
  /** The thread's lines so far, without their timestamps. */
  const said = (t: { lines: Ref.Ref<Array<{ at: number; threadId: string; content: string }>> }) =>
    Ref.get(t.lines).pipe(
      Effect.map((l) => l.map((x) => x.content.replace(/^-# <t:\d+:t> · /, ""))),
    );

  it.scoped("marks the first time in the thread, and draws the graph into the card", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(20 * MINUTE);
      yield* Ref.set(t.boardNow, topOf(["MitchPlease", 8.912]));
      yield* t.runFor(15 * MINUTE);
      expect(yield* Ref.get(t.lines)).toEqual([
        {
          at: OPENS + 30 * MINUTE,
          threadId: "t-m1",
          content: `-# <t:${(OPENS + 30 * MINUTE) / 1000}:t> · 🏁 **MitchPlease** sets the first time: **0:08.912**`,
        },
      ]);
      const edits = yield* Ref.get(t.edits);
      expect(edits.map((e) => e.files)).toEqual([["graph.png"]]);
      expect(JSON.stringify(edits[0]!.message)).toContain("attachment://graph.png");
      const graphs = yield* Ref.get(t.graphs);
      expect(graphs.map((g) => [g.leads.length, g.now])).toEqual([[1, OPENS + 30 * MINUTE]]);
    }),
  );

  it.scoped("posts a Daily already played with its graph, and its first line in the thread", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.boardNow, topOf(["MitchPlease", 8.912]));
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(MINUTE);
      expect((yield* Ref.get(t.posts)).map((p) => p.files)).toEqual([2]);
      expect(yield* said(t)).toEqual(["🏁 **MitchPlease** sets the first time: **0:08.912**"]);
    }),
  );

  it.scoped("names who lost the lead and how long they held it, across a restart", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* Ref.set(t.boardNow, topOf(["MitchPlease", 8.912]));
      yield* t.runFor(HOUR);
      yield* Ref.set(t.boardNow, topOf(["MitchPlease", 8.85], ["FEDUS", 8.9]));
      yield* t.runFor(HOUR);
      yield* Ref.set(t.boardNow, topOf(["FEDUS", 8.701], ["MitchPlease", 8.85]));
      yield* t.runFor(46 * MINUTE);
      expect(yield* said(t)).toEqual([
        "🏁 **MitchPlease** sets the first time: **0:08.912**",
        "🏁 **FEDUS** takes the lead from **MitchPlease**, who held it for 2h 15m · 0:08.850 → **0:08.701** (−0.149 s)",
      ]);
      expect((yield* Ref.get(t.graphs)).at(-1)?.leads.map((l) => l.leaders)).toEqual([
        ["MitchPlease"],
        ["MitchPlease"],
        ["FEDUS"],
      ]);
    }),
  );

  it.scoped("posts a matched time as a tie", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* Ref.set(t.boardNow, topOf(["airman", 8.532]));
      yield* t.runFor(20 * MINUTE);
      yield* Ref.set(t.boardNow, topOf(["airman", 8.532], ["snayK", 8.532]));
      yield* t.runFor(20 * MINUTE);
      expect((yield* said(t)).at(-1)).toBe(
        "🤝 **snayK** ties **airman** for the lead: **0:08.532**",
      );
    }),
  );

  it.scoped("posts several changes between two reads once, as the latest leader", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* Ref.set(t.boardNow, topOf(["MitchPlease", 8.912]));
      yield* t.runFor(5 * MINUTE);
      yield* Ref.set(t.boardNow, topOf(["FEDUS", 8.701], ["MitchPlease", 8.912]));
      yield* TestClock.adjust(5 * MINUTE);
      yield* Ref.set(t.boardNow, topOf(["airman", 8.6], ["FEDUS", 8.701], ["MitchPlease", 8.912]));
      yield* t.runFor(15 * MINUTE);
      expect(yield* said(t)).toEqual([
        "🏁 **MitchPlease** sets the first time: **0:08.912**",
        "🏁 **airman** takes the lead from **MitchPlease**, who held it for 15m · 0:08.912 → **0:08.600** (−0.312 s)",
      ]);
    }),
  );

  it.scoped("leaves the lead's line out of a card it couldn't edit, and tells ops once", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(OPENS);
      yield* t.runFor(MINUTE);
      yield* Ref.set(t.channelDown, true);
      yield* Ref.set(t.boardNow, topOf(["MitchPlease", 8.912]));
      yield* t.runFor(40 * MINUTE);
      expect(yield* said(t)).toEqual([]);
      yield* Ref.set(t.channelDown, false);
      yield* t.runFor(15 * MINUTE);
      expect(yield* said(t)).toEqual(["🏁 **MitchPlease** sets the first time: **0:08.912**"]);
      expect(yield* Ref.get(t.alerts)).toEqual([
        "Multiballs couldn't update the Daily Post for 2026-10-18: Missing Permissions",
      ]);
    }),
  );
});
