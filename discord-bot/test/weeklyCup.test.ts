// The Weekly Cup's schedule (spec #353, ticket #356) over fakes on the TestClock: the Cup's
// channel and the ops channel, with the Cup's record in SQLite in memory, kept across restarts.
// The week of Monday 26 October 2026 runs across the November clock change.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Layer, Ref, TestClock } from "effect";
import { OpsAlerts, opsAlertsOf } from "../src/ops.js";
import {
  type CupAnswer,
  CupChannel,
  CupLogLive,
  type CupNotice,
  CupPostFailed,
  type CupPostView,
  makeWeeklyCup,
} from "../src/weeklyCup/schedule.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const GUILD = "g-racing";
const WEEK = "2026-10-26";
/** Monday 26 October 00:00 Central (CDT). */
const MONDAY = Date.parse("2026-10-26T05:00:00Z");
/** Thursday 29 October 12:00 Central. */
const THURSDAY_NOON = Date.parse("2026-10-29T17:00:00Z");
/** Friday 30 October 09:00 Central. */
const FRIDAY_NINE = Date.parse("2026-10-30T14:00:00Z");
/** Sunday 1 November 20:00 Central (CST, the clocks went back that morning). */
const SUNDAY_EIGHT = Date.parse("2026-11-02T02:00:00Z");
/** Monday 2 November 00:00 Central. */
const NEXT_MONDAY = Date.parse("2026-11-02T06:00:00Z");

const text = (a: CupAnswer) => (a._tag === "Text" ? a.text : a._tag);

/**
 * The Cup's world: a channel that records each post, edit and notice (or refuses while
 * `channelDown`), and the ops channel. One database for the whole test, so a restart finds what
 * the run before it recorded.
 */
const setup = Effect.gen(function* () {
  const channelDown = yield* Ref.make(false);
  const posts = yield* Ref.make<Array<{ at: number; view: CupPostView }>>([]);
  const edits = yield* Ref.make<Array<{ at: number; messageId: string; view: CupPostView }>>([]);
  const notices = yield* Ref.make<Array<{ at: number; notice: CupNotice }>>([]);
  const alerts = yield* Ref.make<Array<string>>([]);
  const refused = Effect.flatMap(Ref.get(channelDown), (down) =>
    down ? Effect.fail(new CupPostFailed({ reason: "Missing Permissions" })) : Effect.void,
  );
  const fakes = Layer.mergeAll(
    Layer.succeed(
      CupChannel,
      CupChannel.of({
        post: (view) =>
          Effect.gen(function* () {
            yield* refused;
            const at = yield* Clock.currentTimeMillis;
            yield* Ref.update(posts, (p) => [...p, { at, view }]);
            return `m${(yield* Ref.get(posts)).length}`;
          }),
        edit: (messageId, view) =>
          Effect.gen(function* () {
            yield* refused;
            const at = yield* Clock.currentTimeMillis;
            yield* Ref.update(edits, (e) => [...e, { at, messageId, view }]);
          }),
        say: (notice) =>
          Effect.gen(function* () {
            yield* refused;
            const at = yield* Clock.currentTimeMillis;
            yield* Ref.update(notices, (n) => [...n, { at, notice }]);
          }),
      }),
    ),
    Layer.succeed(
      OpsAlerts,
      OpsAlerts.make(
        opsAlertsOf({
          configured: true,
          post: (content) => Ref.update(alerts, (a) => [...a, content]),
        }),
      ),
    ),
  );
  const log = yield* Layer.build(
    CupLogLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
  /** Start the bot: the Cup's schedule runs until `stop`, as a deploy would end it. */
  const start = Effect.gen(function* () {
    const cup = yield* makeWeeklyCup(GUILD);
    const fiber = yield* Effect.fork(cup.run);
    yield* TestClock.adjust(1);
    const within = <A, E>(effect: Effect.Effect<A, E, CupChannel | OpsAlerts>) =>
      effect.pipe(Effect.provide(fakes));
    return {
      signUp: (who: string) => within(cup.signUp(WEEK, who)).pipe(Effect.map(text)),
      withdraw: (who: string) => within(cup.withdraw(WEEK, who)).pipe(Effect.map(text)),
      askSkip: (who: string, manageServer: boolean) =>
        within(cup.askSkip(WEEK, who, manageServer)).pipe(Effect.map(text)),
      skip: (who: string, manageServer: boolean) =>
        within(cup.skip(WEEK, who, manageServer)).pipe(Effect.map(text)),
      press: cup,
      stop: Fiber.interrupt(fiber),
    };
  }).pipe(Effect.provide(fakes), Effect.provide(log));
  /** Start the bot, run it for `ms`, then stop it. */
  const runFor = (ms: number) =>
    Effect.gen(function* () {
      const bot = yield* start;
      yield* TestClock.adjust(ms);
      yield* bot.stop;
    });
  const lastView = Effect.gen(function* () {
    const shown = [...(yield* Ref.get(posts)), ...(yield* Ref.get(edits))].sort(
      (a, b) => a.at - b.at,
    );
    return shown.at(-1)?.view;
  });
  return { channelDown, posts, edits, notices, alerts, start, runFor, lastView };
});

describe("the Weekly Cup's schedule", () => {
  it.scoped("posts the week's Cup at Monday 00:00 Central, open for sign-up", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY - 3 * HOUR);
      yield* t.runFor(2 * 24 * HOUR);
      const posts = yield* Ref.get(t.posts);
      expect(posts.map((p) => p.at)).toEqual([MONDAY]);
      expect(posts[0]?.view).toMatchObject({
        guildId: GUILD,
        state: "open",
        entrants: [],
        week: { week: WEEK, shortlistAt: THURSDAY_NOON, endsAt: SUNDAY_EIGHT },
      });
      expect(yield* Ref.get(t.edits)).toEqual([]);
    }),
  );

  it.scoped("posts at once when it starts mid-week, before Thursday 12:00", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY + 30 * HOUR);
      yield* t.runFor(HOUR);
      expect((yield* Ref.get(t.posts)).map((p) => p.at)).toEqual([MONDAY + 30 * HOUR]);
    }),
  );

  it.scoped("posts nothing for a week it first starts in after Thursday 12:00", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(THURSDAY_NOON + HOUR);
      yield* t.runFor(NEXT_MONDAY - THURSDAY_NOON);
      const posts = yield* Ref.get(t.posts);
      expect(posts.map((p) => [p.at, p.view.week.week])).toEqual([[NEXT_MONDAY, "2026-11-02"]]);
    }),
  );

  it.scoped("signs Entrants up and lets them withdraw, redrawing the post each time", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.start;
      expect(yield* bot.signUp("alice")).toContain("You're signed up");
      expect(yield* bot.signUp("bob")).toContain("You're signed up");
      expect(yield* bot.signUp("alice")).toBe("You're already signed up for this week's Cup.");
      expect(yield* bot.withdraw("bob")).toBe(
        "You've withdrawn from this week's Weekly Cup. Sign up again any time before it ends.",
      );
      expect(yield* bot.withdraw("bob")).toBe("You're not signed up for this week's Cup.");
      const edits = yield* Ref.get(t.edits);
      expect(edits.map((e) => [e.messageId, e.view.entrants])).toEqual([
        ["m1", ["alice"]],
        ["m1", ["alice", "bob"]],
        ["m1", ["alice"]],
      ]);
      yield* bot.stop;
    }),
  );

  it.scoped("cancels a week with fewer than 2 Entrants at Thursday 12:00, and says so", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.start;
      yield* bot.signUp("alice");
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      expect((yield* t.lastView)?.state).toBe("cancelled");
      const notices = yield* Ref.get(t.notices);
      expect(notices).toEqual([
        { at: THURSDAY_NOON, notice: { _tag: "Cancelled", week: WEEK, entrants: ["alice"] } },
      ]);
      expect(yield* bot.signUp("bob")).toBe(
        "This week's Weekly Cup was cancelled: fewer than 2 Players signed up. The next one opens on Monday.",
      );
      // Nothing more that week; the next week's Cup goes up on its Monday.
      yield* TestClock.adjust(NEXT_MONDAY - THURSDAY_NOON);
      expect((yield* Ref.get(t.posts)).map((p) => p.at)).toEqual([MONDAY, NEXT_MONDAY]);
      expect(yield* Ref.get(t.notices)).toHaveLength(1);
      yield* bot.stop;
    }),
  );

  it.scoped("goes on with 2 Entrants, takes late sign-ups, and closes at Sunday 20:00", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.start;
      yield* bot.signUp("alice");
      yield* bot.signUp("bob");
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      expect(yield* Ref.get(t.notices)).toEqual([]);
      expect((yield* t.lastView)?.state).toBe("voting");
      yield* TestClock.adjust(FRIDAY_NINE - THURSDAY_NOON + HOUR);
      expect(yield* bot.signUp("carol")).toContain("You're signed up");
      expect((yield* t.lastView)?.state).toBe("racing");
      yield* TestClock.adjust(SUNDAY_EIGHT - FRIDAY_NINE - HOUR);
      const closed = (yield* Ref.get(t.edits)).at(-1);
      expect(closed).toMatchObject({
        at: SUNDAY_EIGHT,
        view: { state: "final", entrants: ["alice", "bob", "carol"] },
      });
      expect(yield* bot.signUp("dave")).toBe("This week's Weekly Cup is over.");
      yield* bot.stop;
    }),
  );

  it.scoped("lets only a server admin skip the week, after asking, and tells its Entrants", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.start;
      yield* bot.signUp("alice");
      yield* bot.signUp("bob");
      expect(yield* bot.askSkip("bob", false)).toBe(
        "Only a server admin (Manage Server) can skip a week.",
      );
      expect(yield* bot.skip("bob", false)).toBe(
        "Only a server admin (Manage Server) can skip a week.",
      );
      expect(yield* bot.askSkip("admin", true)).toBe("ConfirmSkip");
      expect((yield* t.lastView)?.state).toBe("open");
      expect(yield* bot.skip("admin", true)).toBe(
        "Skipped this week's Weekly Cup. Its Entrants have been told.",
      );
      expect((yield* t.lastView)?.state).toBe("skipped");
      expect((yield* Ref.get(t.notices)).map((n) => n.notice)).toEqual([
        { _tag: "Skipped", week: WEEK, entrants: ["alice", "bob"] },
      ]);
      expect(yield* bot.signUp("carol")).toBe(
        "This week's Weekly Cup was skipped. The next one opens on Monday.",
      );
      // Thursday changes nothing for a skipped week.
      yield* TestClock.adjust(NEXT_MONDAY - MONDAY);
      expect(yield* Ref.get(t.notices)).toHaveLength(1);
      expect((yield* Ref.get(t.posts)).map((p) => p.at)).toEqual([MONDAY, NEXT_MONDAY]);
      yield* bot.stop;
    }),
  );

  it.scoped("can't skip a week once its Shortlist is due", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.start;
      yield* bot.signUp("alice");
      yield* bot.signUp("bob");
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      expect(yield* bot.askSkip("admin", true)).toBe(
        "This week's Weekly Cup is already under way, so it can't be skipped now.",
      );
      expect(yield* bot.skip("admin", true)).toBe(
        "This week's Weekly Cup is already under way, so it can't be skipped now.",
      );
      yield* bot.stop;
    }),
  );

  it.scoped("answers a press on an earlier week's post as over", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(NEXT_MONDAY + HOUR);
      const bot = yield* t.start;
      expect(yield* bot.signUp("alice")).toBe("This week's Weekly Cup is over.");
      yield* bot.stop;
    }),
  );

  describe("after a restart", () => {
    it.scoped("keeps an open week's post and its Entrants, posting nothing again", () =>
      Effect.gen(function* () {
        const t = yield* setup;
        yield* TestClock.setTime(MONDAY);
        const first = yield* t.start;
        yield* first.signUp("alice");
        yield* first.stop;
        const again = yield* t.start;
        expect(yield* again.signUp("alice")).toBe("You're already signed up for this week's Cup.");
        yield* again.signUp("bob");
        yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
        expect((yield* Ref.get(t.posts)).length).toBe(1);
        expect(yield* Ref.get(t.notices)).toEqual([]);
        expect((yield* t.lastView)?.entrants).toEqual(["alice", "bob"]);
        yield* again.stop;
      }),
    );

    it.scoped("cancels at once a week whose Thursday 12:00 passed while it was down", () =>
      Effect.gen(function* () {
        const t = yield* setup;
        yield* TestClock.setTime(MONDAY);
        yield* t.runFor(HOUR);
        yield* TestClock.setTime(THURSDAY_NOON + 2 * HOUR);
        yield* t.runFor(MINUTE);
        expect((yield* Ref.get(t.notices)).map((n) => n.at)).toEqual([THURSDAY_NOON + 2 * HOUR]);
        expect((yield* Ref.get(t.posts)).length).toBe(1);
      }),
    );

    it.scoped("leaves a cancelled, skipped or finished week as it was", () =>
      Effect.gen(function* () {
        for (const end of ["cancelled", "skipped", "final"] as const) {
          const t = yield* setup;
          yield* TestClock.setTime(MONDAY);
          const bot = yield* t.start;
          yield* bot.signUp("alice");
          if (end !== "cancelled") yield* bot.signUp("bob");
          if (end === "skipped") yield* bot.skip("admin", true);
          const until = end === "final" ? SUNDAY_EIGHT : THURSDAY_NOON;
          yield* TestClock.adjust(until - MONDAY);
          yield* bot.stop;
          const before = {
            posts: (yield* Ref.get(t.posts)).length,
            edits: (yield* Ref.get(t.edits)).length,
            notices: (yield* Ref.get(t.notices)).length,
          };
          expect((yield* t.lastView)?.state).toBe(end);
          yield* t.runFor(NEXT_MONDAY - until - MINUTE);
          expect({
            posts: (yield* Ref.get(t.posts)).length,
            edits: (yield* Ref.get(t.edits)).length,
            notices: (yield* Ref.get(t.notices)).length,
          }).toEqual(before);
          yield* TestClock.setTime(MONDAY);
        }
      }),
    );

    it.scoped("carries a racing week on to its close", () =>
      Effect.gen(function* () {
        const t = yield* setup;
        yield* TestClock.setTime(MONDAY);
        const bot = yield* t.start;
        yield* bot.signUp("alice");
        yield* bot.signUp("bob");
        yield* TestClock.adjust(FRIDAY_NINE - MONDAY + HOUR);
        yield* bot.stop;
        yield* t.runFor(SUNDAY_EIGHT - FRIDAY_NINE);
        expect((yield* Ref.get(t.posts)).length).toBe(1);
        expect((yield* t.lastView)?.state).toBe("final");
      }),
    );
  });

  it.scoped("tells ops once when the post fails, and posts on a later try", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.channelDown, true);
      yield* TestClock.setTime(MONDAY);
      yield* t.runFor(10 * MINUTE);
      expect(yield* Ref.get(t.alerts)).toEqual([
        `Multiballs couldn't post the Weekly Cup for ${WEEK} in ${GUILD}: Missing Permissions`,
      ]);
      yield* Ref.set(t.channelDown, false);
      yield* t.runFor(2 * MINUTE);
      expect((yield* Ref.get(t.posts)).length).toBe(1);
    }),
  );

  it.scoped("signs up even when the post can't be redrawn", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.start;
      yield* Ref.set(t.channelDown, true);
      expect(yield* bot.signUp("alice")).toContain("You're signed up");
      yield* Ref.set(t.channelDown, false);
      yield* bot.signUp("bob");
      expect((yield* t.lastView)?.entrants).toEqual(["alice", "bob"]);
      yield* bot.stop;
    }),
  );
});
