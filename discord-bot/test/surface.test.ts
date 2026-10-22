// The Surface port, driven through its interface over an in-memory channel and SQLite in
// memory: where Cards, Match Threads and the Footer end up, across failures and restarts.
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, SubscriptionRef, TestClock } from "effect";
import { type Channel, ChannelGone, Drawing, Gone, VenueChannels } from "../src/discord/channel.js";
import { DiscordError } from "../src/discord/client.js";
import { ChannelSurfaceLive } from "../src/discord/surface.js";
import { migrationsBefore, migratorFor } from "../src/db.js";
import { MatchLinks, Surface, ThreadPost } from "../src/ports.js";
import { ALICE, cardView as view, HOME, RACING } from "./harness.js";

type Failable = "post" | "redraw" | "startThread" | "deleteMessage";

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
  /** Every drawing drawn over an existing message, in order. */
  const redrawn: Array<Drawing> = [];
  /** Stands for the bot's build: a new one may draw the same Drawing differently. */
  let build = 1;
  /** The channel was deleted by hand: posts and reads find no channel. */
  let deleted = false;
  /** The next read of the newest message hits a bug. */
  let crash = false;

  const port: Channel = {
    post: (drawing) =>
      Effect.suspend((): Effect.Effect<string, ChannelGone | DiscordError> => {
        if (deleted) return Effect.fail(new ChannelGone());
        if (fail("post")) return Effect.fail(broken("post"));
        const id = `msg${next++}`;
        messages.push({ id, drawing });
        posted.push(drawing);
        return Effect.succeed(id);
      }),
    fingerprint: (drawing) => Effect.sync(() => `build ${build}: ${label(drawing)}`),
    redraw: (messageId, drawing) =>
      Effect.suspend((): Effect.Effect<void, Gone | DiscordError> => {
        if (fail("redraw")) return Effect.fail(broken("redraw"));
        const m = find(messageId);
        if (m === undefined) return Effect.fail(new Gone({ id: messageId }));
        m.drawing = drawing;
        redrawn.push(drawing);
        return Effect.void;
      }),
    deleteMessage: (messageId) =>
      Effect.suspend((): Effect.Effect<void, Gone | DiscordError> => {
        if (fail("deleteMessage")) return Effect.fail(broken("deleteMessage"));
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
    lastMessageId: Effect.suspend((): Effect.Effect<string | null, ChannelGone> => {
      if (crash) {
        crash = false;
        return Effect.dieMessage("a bug");
      }
      if (deleted) return Effect.fail(new ChannelGone());
      return Effect.succeed(messages.at(-1)?.id ?? null);
    }),
  };

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
    /** What was drawn over an existing message, in order. */
    redrawn: () => redrawn.map((d) => label(d)),
    /** Deploy a build that draws everything differently. */
    newBuild: () => {
      build++;
    },
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
    /** Delete the whole channel, as a moderator might. */
    deleteChannel: () => {
      deleted = true;
      messages.splice(0);
    },
    /** The next start of this channel hits a bug. */
    crashNext: () => {
      crash = true;
    },
    postByAnyone: () => messages.push({ id: `msg${next++}`, drawing: null }),
    deleteFooter: () => {
      const i = messages.findIndex((m) => m.drawing?._tag === "Footer");
      if (i >= 0) messages.splice(i, 1);
    },
  };
};

/**
 * A channel per Venue (home's, and RACING's unless `homeOnly`) and a database that outlive any
 * one Surface, so a test can restart the bot. `beforeVenues` writes into a database as a build
 * from before Venues left it, before the first start migrates it.
 */
const setup = Effect.fn("setup")(function* (
  opts: {
    readonly homeOnly?: boolean;
    readonly beforeVenues?: Effect.Effect<void, unknown, SqlClient.SqlClient>;
  } = {},
) {
  const channel = makeFakeChannel();
  const racing = makeFakeChannel();
  const sql = yield* Layer.build(SqliteClient.layer({ filename: ":memory:" }));
  if (opts.beforeVenues !== undefined) {
    yield* Effect.scoped(Layer.build(migratorFor(migrationsBefore("0008")))).pipe(
      Effect.provide(sql),
      Effect.orDie,
    );
    yield* opts.beforeVenues.pipe(Effect.provide(sql), Effect.orDie);
  }
  // The running Venues' channels, which a test can change as servers join and leave.
  const channels = yield* SubscriptionRef.make<ReadonlyMap<string, Channel>>(
    new Map([
      [HOME, channel.port],
      ...(opts.homeOnly === true ? [] : [[RACING, racing.port] as const]),
    ]),
  );
  /** The Venues the Surface said lost their channel, in order. */
  const gone: Array<string> = [];
  const running = VenueChannels.of({
    now: SubscriptionRef.get(channels),
    changes: channels.changes,
    // As Discord does: the Venue stops running until it is set up again.
    gone: (venue) =>
      Effect.suspend(() => {
        gone.push(venue);
        return SubscriptionRef.update(channels, (all) => {
          const next = new Map(all);
          next.delete(venue);
          return next;
        });
      }),
  });
  /** Venues start, as servers the bot was just invited to do, and the Surface takes them up. */
  const startVenues = Effect.fn("startVenues")(function* (
    started: ReadonlyArray<readonly [string, Channel]>,
  ) {
    yield* SubscriptionRef.update(channels, (all) => new Map([...all, ...started]));
    yield* settle;
  });
  /** A Venue starts, as a server the bot was just invited to does, and the Surface takes it up. */
  const startVenue = (venue: string, port: Channel) => startVenues([[venue, port]]);
  /** A Venue stops, as one whose server removed the bot does. */
  const stopVenue = Effect.fn("stopVenue")(function* (venue: string) {
    yield* SubscriptionRef.update(channels, (all) => {
      const next = new Map(all);
      next.delete(venue);
      return next;
    });
    yield* settle;
  });
  let links = MatchLinks.of({ of: () => Effect.succeed(Option.none()) });
  const start = Effect.gen(function* () {
    const ctx = yield* Layer.build(ChannelSurfaceLive).pipe(
      Effect.provide(Context.add(sql, VenueChannels, running)),
    );
    links = Context.get(ctx, MatchLinks);
    return Context.get(ctx, Surface);
  });
  /** Where the latest start says a Venue's channel (home's unless told) holds a Match's Card and thread. */
  const placeOf = (matchId: string, venue: string = HOME) =>
    Effect.suspend(() => links.of(venue, matchId)).pipe(Effect.map(Option.getOrNull));
  /** Make the saved layout one written before Footer fingerprints were kept. */
  const forgetFingerprint = Effect.gen(function* () {
    const db = yield* SqlClient.SqlClient;
    yield* db`UPDATE venue_layouts SET data = json_remove(data, '$.footerFingerprint')`;
  }).pipe(Effect.provide(sql), Effect.orDie);
  /** Run SQL on the database as some other build would, such as the one before Venues. */
  const onDatabase = <A>(query: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
    query.pipe(Effect.provide(sql), Effect.orDie);
  return {
    channel,
    racing,
    start,
    startVenue,
    startVenues,
    stopVenue,
    /** The Venues reported as having lost their channel. */
    gone: () => [...gone],
    placeOf,
    forgetFingerprint,
    onDatabase,
  };
});

/** Let the Surface follow a change of the running Venues: its Footer check is a few channel calls. */
const settle = Effect.repeatN(Effect.yieldNow(), 20);

describe("the channel", () => {
  it.scoped("gets a Footer on first start", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
      yield* start;
      expect(channel.order()).toEqual(["footer"]);
    }),
  );

  it.scoped(
    "turns the Footer into each new Card, each with a thread, and keeps one Footer last",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup();
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
        const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
      const surface = yield* start;
      yield* surface.showCard(view("m1", { type: "public" }));
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.posted()).toEqual(["footer", "footer"]);
    }),
  );

  it.scoped("posts a Lobby's Card only once: later draws are redraws, which notify nobody", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
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
        const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
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
      const { channel, start } = yield* setup();
      const surface = yield* start;
      channel.deleteFooter();
      yield* surface.showCard(view("m1"));
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.threadPosts("m1")).toEqual([]);
    }),
  );

  it.scoped("posts no Footer above a Card that couldn't be drawn, and draws it next time", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
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
        const { channel, start } = yield* setup();
        const surface = yield* start;
        channel.failNext("startThread", 3);
        yield* surface.showCard(view("m1"));
        expect(channel.threadCount()).toBe(0);
        yield* surface.post(
          "m1",
          ThreadPost.Opened({ by: ALICE, skin: null, type: "public", minutes: 10 }),
        );
        expect(channel.threadPosts("m1")).toEqual(["Opened"]);
      }),
  );
});

describe("the end of a Match", () => {
  it.scoped("posts the progression graph after the Result, in the same thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
      const surface = yield* start;
      const finished = view("m1", {
        state: "finished",
        standings: [{ player: ALICE, ticks: 1_500_000, rank: 1, medal: null }],
      });
      yield* surface.showCard(view("m1"));
      yield* surface.post(
        "m1",
        ThreadPost.Result({ standings: finished.standings, card: finished, steamDown: false }),
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
        const { start, placeOf } = yield* setup();
        const surface = yield* start;
        const finished = view("m1", { state: "finished" });
        yield* surface.showCard(view("m1"));
        yield* surface.showCard(view("m2"));
        expect(yield* placeOf("m1")).toEqual({ messageId: "msg1", threadId: "thr2" });
        yield* surface.post(
          "m1",
          ThreadPost.Result({ standings: [], card: finished, steamDown: false }),
        );
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
      const { channel, start } = yield* setup();
      yield* (yield* start).showCard(view("m1"));
      const surface = yield* start;
      expect(channel.order()).toEqual(["card m1", "footer"]);
      yield* surface.showCard(view("m1", { state: "live" }));
      yield* surface.post(
        "m1",
        ThreadPost.Result({
          standings: [],
          card: view("m1", { state: "finished" }),
          steamDown: false,
        }),
      );
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(channel.threadPosts("m1")).toEqual(["Result"]);
    }),
  );

  it.scoped("replaces the Footer if something was posted after it", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
      yield* (yield* start).showCard(view("m1"));
      channel.postByAnyone();
      yield* start;
      expect(channel.order()).toEqual(["card m1", "someone else", "footer"]);
    }),
  );

  it.scoped(
    "leaves an unchanged Footer unedited, so a deploy doesn't look like channel activity",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup();
        yield* start;
        yield* start;
        expect(channel.redrawn()).toEqual([]);
        expect(channel.order()).toEqual(["footer"]);
      }),
  );

  it.scoped("leaves alone a Footer posted below a new Card, too", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
      yield* (yield* start).showCard(view("m1"));
      const before = channel.redrawn().length;
      yield* start;
      expect(channel.redrawn().length).toBe(before);
    }),
  );

  it.scoped("redraws the Footer once when a new build draws it differently", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup();
      yield* start;
      channel.newBuild();
      yield* start;
      yield* start;
      expect(channel.redrawn()).toEqual(["footer"]);
      expect(channel.order()).toEqual(["footer"]);
    }),
  );

  it.scoped("redraws the Footer once after a layout saved before fingerprints were kept", () =>
    Effect.gen(function* () {
      const { channel, start, forgetFingerprint } = yield* setup();
      yield* start;
      yield* forgetFingerprint;
      yield* start;
      yield* start;
      expect(channel.redrawn()).toEqual(["footer"]);
    }),
  );

  it.scoped(
    "redraws the Footer after a Card that was being drawn over it didn't get recorded",
    () =>
      Effect.gen(function* () {
        const { channel, start } = yield* setup();
        const surface = yield* start;
        channel.failNext("redraw", 1);
        yield* surface.showCard(view("m1"));
        yield* start;
        expect(channel.redrawn()).toEqual(["footer"]);
        expect(channel.order()).toEqual(["footer"]);
      }),
  );
});

describe("Venues", () => {
  it.scoped("give each Venue's channel its own Footer, and each Card goes to its Venue's", () =>
    Effect.gen(function* () {
      const { channel, racing, start } = yield* setup();
      const surface = yield* start;
      expect(racing.order()).toEqual(["footer"]);
      yield* surface.showCard(view("m1"));
      yield* surface.showCard(view("m2", { venue: RACING }));
      yield* surface.showCard(view("m3", { venue: RACING, type: "lobby" }));
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(racing.order()).toEqual(["card m2", "card m3", "footer"]);
      expect(channel.threadCount()).toBe(1);
      expect(racing.threadCount()).toBe(2);
    }),
  );

  it.scoped("post in and remove from the Venue whose channel holds the Card", () =>
    Effect.gen(function* () {
      const { channel, racing, start, placeOf } = yield* setup();
      const surface = yield* start;
      yield* surface.showCard(view("m1"));
      yield* surface.showCard(view("m2", { venue: RACING }));
      yield* surface.post(
        "m2",
        ThreadPost.Opened({ by: ALICE, skin: null, type: "public", minutes: 10 }),
      );
      expect(racing.threadPosts("m2")).toEqual(["Opened"]);
      expect(channel.threadPosts("m1")).toEqual([]);
      expect(yield* placeOf("m2", RACING)).not.toBeNull();
      expect(yield* placeOf("m2")).toBeNull();
      yield* surface.remove("m2", "expired");
      expect(racing.order()).toEqual(["footer"]);
      expect(channel.order()).toEqual(["card m1", "footer"]);
    }),
  );

  it.scoped("keep each Venue's Footer and Cards in place across a restart", () =>
    Effect.gen(function* () {
      const { channel, racing, start, placeOf } = yield* setup();
      const first = yield* start;
      yield* first.showCard(view("m1"));
      yield* first.showCard(view("m2", { venue: RACING }));
      const surface = yield* start;
      yield* surface.showCard(view("m2", { venue: RACING, state: "live" }));
      expect(channel.redrawn()).toEqual(["card m1"]);
      expect(racing.redrawn()).toEqual(["card m2", "card m2"]);
      expect(channel.order()).toEqual(["card m1", "footer"]);
      expect(racing.order()).toEqual(["card m2", "footer"]);
      expect(yield* placeOf("m1")).not.toBeNull();
      expect(yield* placeOf("m2", RACING)).not.toBeNull();
      expect(yield* placeOf("m2")).toBeNull();
    }),
  );

  it.scoped("find the home Venue's Footer from the layout saved before Venues, unedited", () =>
    Effect.gen(function* () {
      const footer = Drawing.Footer();
      // What the build before Venues left: its Footer as the channel's last message, recorded
      // in the one layout row with what it showed.
      const homeOnly = yield* setup({
        homeOnly: true,
        beforeVenues: Effect.gen(function* () {
          const db = yield* SqlClient.SqlClient;
          const data = JSON.stringify({
            footerId: "msg1",
            footerFingerprint: "build 1: footer",
            cards: [],
            finished: [],
          });
          yield* db`INSERT INTO discord_layout (id, data) VALUES (1, ${data})`;
        }),
      });
      yield* homeOnly.channel.port.post(footer);
      yield* homeOnly.start;
      expect(homeOnly.channel.order()).toEqual(["footer"]);
      expect(homeOnly.channel.posted()).toEqual(["footer"]);
      expect(homeOnly.channel.redrawn()).toEqual([]);
      // The build before Venues, rolled back to, still finds its own row where it left it.
      const old = yield* homeOnly.onDatabase(
        Effect.gen(function* () {
          const db = yield* SqlClient.SqlClient;
          return yield* db<{ data: string }>`SELECT data FROM discord_layout WHERE id = 1`;
        }),
      );
      expect(old.map((r) => JSON.parse(r.data).footerId)).toEqual(["msg1"]);
    }),
  );

  it.scoped("start a Venue that starts while the bot runs: its Footer, then its Cards", () =>
    Effect.gen(function* () {
      const { channel, start, startVenue } = yield* setup({ homeOnly: true });
      const surface = yield* start;
      expect(surface.runs(RACING)).toBe(false);
      const racing = makeFakeChannel();
      yield* startVenue(RACING, racing.port);
      expect(surface.runs(RACING)).toBe(true);
      expect(racing.order()).toEqual(["footer"]);
      yield* surface.showCard(view("m1", { venue: RACING }));
      expect(racing.order()).toEqual(["card m1", "footer"]);
      expect(channel.order()).toEqual(["footer"]);
    }),
  );

  it.scoped(
    "stop drawing a Venue that stops, and draw it afresh in its new channel when it's back",
    () =>
      Effect.gen(function* () {
        const { racing, start, startVenue, stopVenue } = yield* setup();
        const surface = yield* start;
        yield* surface.showCard(view("m1", { venue: RACING }));
        yield* stopVenue(RACING);
        expect(surface.runs(RACING)).toBe(false);
        yield* surface.showCard(view("m2", { venue: RACING }));
        expect(racing.order()).toEqual(["card m1", "footer"]);
        // Invited back, it was set up again in a new channel.
        const again = makeFakeChannel();
        yield* startVenue(RACING, again.port);
        expect(surface.runs(RACING)).toBe(true);
        expect(again.order()).toEqual(["footer"]);
      }),
  );

  it.scoped(
    "start each Venue on its own: one whose Footer can't go up waits, the next starts",
    () =>
      Effect.gen(function* () {
        const { channel, start, startVenues } = yield* setup({ homeOnly: true });
        const surface = yield* start;
        const racing = makeFakeChannel();
        const third = makeFakeChannel();
        racing.failNext("post", 100);
        yield* startVenues([
          [RACING, racing.port],
          ["third", third.port],
        ]);
        expect(surface.runs(RACING)).toBe(false);
        expect(surface.runs("third")).toBe(true);
        expect(third.order()).toEqual(["footer"]);
        expect(channel.order()).toEqual(["footer"]);
      }),
  );

  it.scoped("try a Venue whose Footer couldn't go up again shortly, until it runs", () =>
    Effect.gen(function* () {
      const { start, startVenue } = yield* setup({ homeOnly: true });
      const surface = yield* start;
      const racing = makeFakeChannel();
      racing.failNext("post", 1);
      yield* startVenue(RACING, racing.port);
      expect(surface.runs(RACING)).toBe(false);
      yield* TestClock.adjust("1 minute");
      yield* settle;
      expect(surface.runs(RACING)).toBe(true);
      expect(racing.order()).toEqual(["footer"]);
    }),
  );

  it.scoped("leave a Venue out at startup when its Footer can't go up, running home", () =>
    Effect.gen(function* () {
      const { channel, racing, start } = yield* setup();
      racing.failNext("post", 1);
      const surface = yield* start;
      expect(surface.runs(HOME)).toBe(true);
      expect(surface.runs(RACING)).toBe(false);
      expect(channel.order()).toEqual(["footer"]);
    }),
  );

  it.scoped("still post home's Footer when the old one can't be deleted", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup({ homeOnly: true });
      yield* start;
      channel.postByAnyone();
      channel.failNext("deleteMessage", 1);
      yield* start;
      expect(channel.order()).toEqual(["footer", "someone else", "footer"]);
    }),
  );

  it.scoped("start the other Venues when one hits a bug starting, and try that one again", () =>
    Effect.gen(function* () {
      const { start, startVenues } = yield* setup({ homeOnly: true });
      const surface = yield* start;
      const racing = makeFakeChannel();
      const third = makeFakeChannel();
      racing.crashNext();
      yield* startVenues([
        [RACING, racing.port],
        ["third", third.port],
      ]);
      expect(surface.runs(RACING)).toBe(false);
      expect(surface.runs("third")).toBe(true);
      yield* TestClock.adjust("1 minute");
      yield* settle;
      expect(surface.runs(RACING)).toBe(true);
      expect(racing.order()).toEqual(["footer"]);
    }),
  );

  it.scoped("start home when another Venue hits a bug starting with it", () =>
    Effect.gen(function* () {
      const { racing, start } = yield* setup();
      racing.crashNext();
      const surface = yield* start;
      expect(surface.runs(HOME)).toBe(true);
      expect(surface.runs(RACING)).toBe(false);
    }),
  );

  it.scoped("give up a Venue whose channel was deleted, so it is set up again", () =>
    Effect.gen(function* () {
      const { racing, start, gone } = yield* setup();
      const surface = yield* start;
      racing.deleteChannel();
      yield* surface.showCard(view("m1", { venue: RACING }));
      yield* settle;
      expect(gone()).toEqual([RACING]);
      expect(surface.runs(RACING)).toBe(false);
    }),
  );

  it.scoped("give up a Venue whose channel is gone when it starts", () =>
    Effect.gen(function* () {
      const { start, startVenue, gone } = yield* setup({ homeOnly: true });
      const surface = yield* start;
      const racing = makeFakeChannel();
      racing.deleteChannel();
      yield* startVenue(RACING, racing.port);
      expect(gone()).toEqual([RACING]);
      expect(surface.runs(RACING)).toBe(false);
    }),
  );

  it.scoped("run home even when its Footer can't go up at startup, as before", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup({ homeOnly: true });
      channel.failNext("post", 1);
      const surface = yield* start;
      expect(surface.runs(HOME)).toBe(true);
      yield* surface.showCard(view("m1"));
      expect(channel.order()).toEqual(["card m1", "footer"]);
    }),
  );

  it.scoped("draw nothing for a Venue that isn't running, and nothing in another's channel", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup({ homeOnly: true });
      const surface = yield* start;
      expect(surface.runs(HOME)).toBe(true);
      expect(surface.runs(RACING)).toBe(false);
      yield* surface.showCard(view("m1", { venue: RACING }));
      yield* surface.post("m1", ThreadPost.Abandoned());
      yield* surface.remove("m1", "expired");
      expect(channel.order()).toEqual(["footer"]);
      expect(channel.threadCount()).toBe(0);
    }),
  );
});
