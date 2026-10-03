// The Surface port, driven through its interface over an in-memory channel and SQLite in
// memory: where Cards, Match Threads and the Footer end up, across failures and restarts.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option } from "effect";
import { Channel, Drawing, Gone } from "../src/discord/channel.js";
import { DiscordError } from "../src/discord/client.js";
import { ChannelSurfaceLive } from "../src/discord/surface.js";
import { MatchLinks, Surface, ThreadPost } from "../src/ports.js";
import { ALICE, cardView as view } from "./harness.js";

type Failable = "post" | "redraw" | "startThread";

/** A channel in memory: messages in order, threads with their posts, and failures on demand. */
const makeFakeChannel = () => {
  let next = 1;
  const messages: Array<{ id: string; drawing: Drawing | null }> = [];
  const threads = new Map<
    string,
    { messageId: string; posts: Array<ThreadPost>; clock: { id: string; shows: string } | null }
  >();
  let clockDraws = 0;
  const failures = new Map<Failable, number>();

  const fail = (op: Failable) => {
    const left = failures.get(op) ?? 0;
    if (left === 0) return false;
    failures.set(op, left - 1);
    return true;
  };
  const broken = (op: string) => new DiscordError({ op, cause: "flaky" });
  const find = (id: string) => messages.find((m) => m.id === id);

  /** Every drawing posted as a new message, in order: only these can notify a mention. */
  const posted: Array<Drawing> = [];

  const port = Channel.of({
    post: (drawing) =>
      Effect.suspend(() => {
        if (fail("post")) return Effect.fail(broken("post"));
        const id = `msg${next++}`;
        messages.push({ id, drawing });
        posted.push(drawing);
        return Effect.succeed(id);
      }),
    redraw: (messageId, drawing) =>
      Effect.suspend((): Effect.Effect<void, Gone | DiscordError> => {
        if (fail("redraw")) return Effect.fail(broken("redraw"));
        const m = find(messageId);
        if (m === undefined) return Effect.fail(new Gone({ id: messageId }));
        m.drawing = drawing;
        return Effect.void;
      }),
    deleteMessage: (messageId) =>
      Effect.suspend(() => {
        const i = messages.findIndex((m) => m.id === messageId);
        if (i < 0) return Effect.fail(new Gone({ id: messageId }));
        messages.splice(i, 1);
        return Effect.void;
      }),
    startThread: (messageId) =>
      Effect.suspend((): Effect.Effect<string, Gone | DiscordError> => {
        if (fail("startThread")) return Effect.fail(broken("startThread"));
        if (find(messageId) === undefined) return Effect.fail(new Gone({ id: messageId }));
        const id = `thr${next++}`;
        threads.set(id, { messageId, posts: [], clock: null });
        return Effect.succeed(id);
      }),
    deleteThread: (threadId) =>
      Effect.suspend(() =>
        threads.delete(threadId) ? Effect.void : Effect.fail(new Gone({ id: threadId })),
      ),
    postClock: (threadId, view) =>
      Effect.suspend(() => {
        const thread = threads.get(threadId);
        if (thread === undefined) return Effect.fail(new Gone({ id: threadId }));
        const id = `clk${next++}`;
        thread.clock = { id, shows: view.state };
        clockDraws++;
        return Effect.succeed(id);
      }),
    redrawClock: (threadId, messageId, view) =>
      Effect.suspend(() => {
        const thread = threads.get(threadId);
        if (thread?.clock?.id !== messageId) return Effect.fail(new Gone({ id: messageId }));
        thread.clock = { id: messageId, shows: view === "cancelled" ? view : view.state };
        clockDraws++;
        return Effect.void;
      }),
    postInThread: (threadId, _matchId, post) =>
      Effect.suspend(() => {
        const thread = threads.get(threadId);
        if (thread === undefined) return Effect.fail(new Gone({ id: threadId }));
        thread.posts.push(post);
        return Effect.void;
      }),
    lastMessageId: Effect.sync(() => messages.at(-1)?.id ?? null),
  });

  const label = (d: Drawing | null) =>
    d === null
      ? "someone else"
      : Drawing.$match(d, {
          Footer: () => "footer",
          Card: ({ view }) => `card ${view.matchId}`,
          Closed: ({ reason }) => `closed ${reason}`,
        });

  return {
    port,
    /** What the channel shows, top to bottom. */
    order: () => messages.map((m) => label(m.drawing)),
    /** What was posted as a new message rather than drawn over an old one, in order. */
    posted: () => posted.map((d) => label(d)),
    /** The thread started on a Match's Card, if any, and what was posted in it. */
    threadPosts: (matchId: string) => {
      const card = messages.find(
        (m) => m.drawing !== null && label(m.drawing) === `card ${matchId}`,
      );
      const thread = [...threads.values()].find((t) => t.messageId === card?.id);
      return thread?.posts.map((p) => p._tag) ?? null;
    },
    threadCount: () => threads.size,
    /** What the clock at the top of a Match's thread shows, and how often clocks were drawn. */
    clock: (matchId: string) => {
      const card = messages.find(
        (m) => m.drawing !== null && label(m.drawing) === `card ${matchId}`,
      );
      return [...threads.values()].find((t) => t.messageId === card?.id)?.clock?.shows ?? null;
    },
    clockDraws: () => clockDraws,
    /** What every thread's clock shows, whatever its Card became. */
    clocks: () => [...threads.values()].map((t) => t.clock?.shows ?? null),
    failNext: (op: Failable, n: number) => failures.set(op, n),
    postByAnyone: () => messages.push({ id: `msg${next++}`, drawing: null }),
    deleteFooter: () => {
      const i = messages.findIndex((m) => m.drawing?._tag === "Footer");
      if (i >= 0) messages.splice(i, 1);
    },
  };
};

/** A channel and a database that outlive any one Surface, so a test can restart the bot. */
const setup = Effect.gen(function* () {
  const channel = makeFakeChannel();
  const sql = yield* Layer.build(SqliteClient.layer({ filename: ":memory:" }));
  let links = MatchLinks.of({ of: () => Effect.succeed(Option.none()) });
  const start = Effect.gen(function* () {
    const ctx = yield* Layer.build(ChannelSurfaceLive).pipe(
      Effect.provide(Context.add(sql, Channel, channel.port)),
    );
    links = Context.get(ctx, MatchLinks);
    return Context.get(ctx, Surface);
  });
  /** Where the latest start says a Match's Card and thread are. */
  const placeOf = (matchId: string) =>
    Effect.suspend(() => links.of(matchId)).pipe(Effect.map(Option.getOrNull));
  return { channel, start, placeOf };
});

describe("the channel", () => {
  it.scoped("gets a Footer on first start", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      yield* start;
      expect(channel.order()).toEqual(["footer"]);
    }),
  );

  it.scoped(
    "turns the Footer into each new Card, each with a thread, and keeps one Footer last",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup;
        const surface = yield* start;
        yield* surface.showCard(view("m1"));
        yield* surface.showCard(view("m2"));
        yield* surface.showCard(view("m1", { players: [ALICE, ALICE] }));
        expect(channel.order()).toEqual(["card m1", "card m2", "footer"]);
        expect(channel.threadCount()).toBe(2);
      }),
  );

  it.scoped(
    "posts a Lobby's Card fresh, so its ping notifies, then deletes the old Footer and posts a new one last",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup;
        const surface = yield* start;
        yield* surface.showCard(view("m1"));
        yield* surface.showCard(view("m2", { type: "lobby" }));
        expect(channel.order()).toEqual(["card m1", "card m2", "footer"]);
        expect(channel.posted()).toEqual(["footer", "footer", "card m2", "footer"]);
        expect(channel.threadCount()).toBe(2);
      }),
  );

  it.scoped("still turns the Footer into a Public 1v1's Card", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      yield* surface.showCard(view("m1", { type: "public" }));
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.posted()).toEqual(["footer", "footer"]);
    }),
  );

  it.scoped("posts a Lobby's Card only once: later draws are redraws, which notify nobody", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      yield* surface.showCard(view("m1", { type: "lobby" }));
      yield* surface.showCard(view("m1", { type: "lobby", players: [ALICE, ALICE] }));
      yield* surface.showCard(view("m1", { type: "lobby", state: "live" }));
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.posted()).toEqual(["footer", "card m1", "footer"]);
    }),
  );

  it.scoped("posts a Lobby's Card and a Footer when the Footer was deleted by hand", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      channel.deleteFooter();
      yield* surface.showCard(view("m1", { type: "lobby" }));
      expect(channel.order()).toEqual(["card m1", "footer"]);
    }),
  );

  it.scoped(
    "leaves the Footer in place when a Lobby's Card can't be posted, and posts it next time",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup;
        const surface = yield* start;
        channel.failNext("post", 1);
        yield* surface.showCard(view("m1", { type: "lobby" }));
        expect(channel.order()).toEqual(["footer"]);
        yield* surface.showCard(view("m1", { type: "lobby" }));
        expect(channel.order()).toEqual(["card m1", "footer"]);
      }),
  );

  it.scoped("opens each Match Thread with a clock, redrawn only when the Match moves on", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      yield* surface.showCard(view("m1", { expiresAt: 300_000 }));
      expect(channel.clock("m1")).toBe("invite");
      yield* surface.showCard(view("m1", { state: "live", expiresAt: null, endsAt: 900_000 }));
      yield* surface.showCard(
        view("m1", { state: "live", expiresAt: null, endsAt: 900_000, players: [ALICE, ALICE] }),
      );
      expect(channel.clock("m1")).toBe("live");
      expect(channel.clockDraws()).toBe(2);
    }),
  );

  it.scoped("deletes an expired, cancelled or declined Invite's Card and thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      yield* surface.showCard(view("m1"));
      yield* surface.showCard(view("m2"));
      yield* surface.remove("m1", "expired");
      expect(channel.order()).toEqual(["card m2", "footer"]);
      expect(channel.threadCount()).toBe(1);
    }),
  );

  it.scoped("keeps a Card cancelled for want of a Map, saying why, with its thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      yield* surface.showCard(view("m1"));
      yield* surface.post("m1", ThreadPost.NoMap({ players: [ALICE] }));
      yield* surface.remove("m1", "noEligibleMap");
      expect(channel.order()).toEqual(["closed noEligibleMap", "footer"]);
      expect(channel.threadCount()).toBe(1);
    }),
  );

  it.scoped("keeps the Card of a Match everyone left, saying why, with its thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      yield* surface.showCard(view("m1", { state: "live" }));
      yield* surface.post("m1", ThreadPost.Abandoned());
      yield* surface.remove("m1", "abandoned");
      expect(channel.order()).toEqual(["closed abandoned", "footer"]);
      expect(channel.threadCount()).toBe(1);
      expect(channel.clocks()).toEqual(["cancelled"]);
    }),
  );

  it.scoped("posts the Card fresh when the Footer was deleted by hand", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      channel.deleteFooter();
      yield* surface.showCard(view("m1"));
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.threadPosts("m1")).toEqual([]);
    }),
  );

  it.scoped("posts no Footer above a Card that couldn't be drawn, and draws it next time", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      channel.failNext("redraw", 1);
      yield* surface.showCard(view("m1"));
      expect(channel.order()).toEqual(["footer"]);
      yield* surface.showCard(view("m1"));
      expect(channel.order()).toEqual(["card m1", "footer"]);
    }),
  );

  it.scoped(
    "starts a thread that failed to start on the Match's next post, so nothing is dropped",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup;
        const surface = yield* start;
        channel.failNext("startThread", 3);
        yield* surface.showCard(view("m1"));
        expect(channel.threadCount()).toBe(0);
        yield* surface.post("m1", ThreadPost.Opened({ by: ALICE, type: "public", minutes: 10 }));
        expect(channel.threadPosts("m1")).toEqual(["Opened"]);
      }),
  );
});

describe("the end of a Match", () => {
  it.scoped("posts the progression graph after the Result, in the same thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      const surface = yield* start;
      const finished = view("m1", {
        state: "finished",
        standings: [{ player: ALICE, ticks: 1_500_000, rank: 1, medal: null }],
      });
      yield* surface.showCard(view("m1"));
      yield* surface.post(
        "m1",
        ThreadPost.Result({ standings: finished.standings, card: finished }),
      );
      yield* surface.post(
        "m1",
        ThreadPost.Progression({
          card: finished,
          history: [{ steamId: ALICE.steamId, ticks: 1_500_000, at: 60_000 }],
        }),
      );
      expect(channel.threadPosts("m1")).toEqual(["Result", "Progression"]);
    }),
  );

  it.scoped(
    "still knows where a finished Match's Card and thread are, across a restart, for the Activity's links",
    () =>
      Effect.gen(function* () {
        const { start, placeOf } = yield* setup;
        const surface = yield* start;
        const finished = view("m1", { state: "finished" });
        yield* surface.showCard(view("m1"));
        yield* surface.showCard(view("m2"));
        expect(yield* placeOf("m1")).toEqual({ messageId: "msg1", threadId: "thr2" });
        yield* surface.post("m1", ThreadPost.Result({ standings: [], card: finished }));
        yield* surface.remove("m2", "expired");
        yield* start;
        expect(yield* placeOf("m1")).toEqual({ messageId: "msg1", threadId: "thr2" });
        expect(yield* placeOf("m2")).toBeNull();
      }),
  );
});

describe("after a restart", () => {
  it.scoped("leaves the Footer alone when it's still last, and keeps drawing Cards in place", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      yield* (yield* start).showCard(view("m1"));
      const surface = yield* start;
      expect(channel.order()).toEqual(["card m1", "footer"]);
      yield* surface.showCard(view("m1", { state: "live" }));
      yield* surface.post(
        "m1",
        ThreadPost.Result({ standings: [], card: view("m1", { state: "finished" }) }),
      );
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.threadPosts("m1")).toEqual(["Result"]);
    }),
  );

  it.scoped("replaces the Footer if something was posted after it", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup;
      yield* (yield* start).showCard(view("m1"));
      channel.postByAnyone();
      yield* start;
      expect(channel.order()).toEqual(["card m1", "someone else", "footer"]);
    }),
  );
});
