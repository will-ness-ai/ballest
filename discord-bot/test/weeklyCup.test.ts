// The Weekly Cup's schedule (spec #353, ticket #356) over fakes on the TestClock: the Cup's
// channel and the ops channel, with the Cup's record in SQLite in memory, kept across restarts.
// The week of Monday 26 October 2026 runs across the November clock change.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Layer, Option, Random, Ref, TestClock } from "effect";
import { OpsAlerts, opsAlertsOf } from "../src/ops.js";
import { Steam, SteamUnavailable } from "../src/ports.js";
import { MapPreviews, PreviewSource } from "../src/previews.js";
import {
  type CupAnswer,
  CupChannel,
  CupLinks,
  CupLogLive,
  type CupNotice,
  CupPostFailed,
  type CupPostView,
  makeWeeklyCup,
  type ShortlistView,
} from "../src/weeklyCup/schedule.js";
import { makeFakeSteam, makeMap } from "./harness.js";

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

const steamIdOf = (discordId: string) => `s-${discordId}`;
/** Twelve Workshop Maps that fit the Cup: author time 20 s, world record 15 s. */
const ELIGIBLE = Array.from({ length: 12 }, (_, i) => makeMap(i + 1));

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
  const shortlists = yield* Ref.make<Array<{ at: number; view: ShortlistView }>>([]);
  const alerts = yield* Ref.make<Array<string>>([]);
  const refused = Effect.flatMap(Ref.get(channelDown), (down) =>
    down ? Effect.fail(new CupPostFailed({ reason: "Missing Permissions" })) : Effect.void,
  );
  // The Workshop: 12 Eligible Maps unless a test sets its own; every member linked as s-<id>.
  const steam = yield* makeFakeSteam({});
  yield* steam.control.setCatalogue(ELIGIBLE);
  const unlinked = new Set<string>();
  const steamDown = yield* Ref.make(false);
  const fakes = Layer.mergeAll(
    Layer.succeed(Steam, {
      ...steam.port,
      catalogue: Effect.flatMap(Ref.get(steamDown), (down) =>
        down ? Effect.fail(new SteamUnavailable({ reason: "no reply" })) : steam.port.catalogue,
      ),
    }),
    Layer.succeed(
      CupLinks,
      CupLinks.of({
        steamIdOf: (id) =>
          Effect.succeed(unlinked.has(id) ? Option.none() : Option.some(steamIdOf(id))),
      }),
    ),
    MapPreviews.Default.pipe(
      Layer.provide(
        Layer.succeed(
          PreviewSource,
          PreviewSource.of({
            fetch: () => Effect.succeed({ type: "image/png", body: new Uint8Array([1]) }),
          }),
        ),
      ),
    ),
    Layer.succeed(
      CupChannel,
      CupChannel.of({
        postShortlist: (view) =>
          Effect.gen(function* () {
            yield* refused;
            const at = yield* Clock.currentTimeMillis;
            yield* Ref.update(shortlists, (s) => [...s, { at, view }]);
            return `s${(yield* Ref.get(shortlists)).length}`;
          }),
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
  /**
   * Start the bot: the Cup's schedule runs until `stop`, as a deploy would end it. Its draws and
   * tie-breaks come from a Random seeded with `seed`, so two worlds started alike draw alike.
   */
  const startWith = (seed: number) =>
    Effect.gen(function* () {
      const cup = yield* makeWeeklyCup(GUILD);
      const fiber = yield* Effect.fork(cup.run.pipe(Effect.withRandom(Random.make(seed))));
      yield* TestClock.adjust(1);
      const within = <A, E>(effect: Effect.Effect<A, E, Layer.Layer.Success<typeof fakes>>) =>
        effect.pipe(Effect.provide(fakes));
      return {
        signUp: (who: string) => within(cup.signUp(WEEK, who)).pipe(Effect.map(text)),
        withdraw: (who: string) => within(cup.withdraw(WEEK, who)).pipe(Effect.map(text)),
        askSkip: (who: string, manageServer: boolean) =>
          within(cup.askSkip(WEEK, who, manageServer)).pipe(Effect.map(text)),
        skip: (who: string, manageServer: boolean) =>
          within(cup.skip(WEEK, who, manageServer)).pipe(Effect.map(text)),
        vote: (who: string, picks: ReadonlyArray<string>) =>
          within(cup.vote(WEEK, who, picks)).pipe(Effect.map(text)),
        stop: Fiber.interrupt(fiber),
      };
    }).pipe(Effect.provide(fakes), Effect.provide(log));
  const start = startWith(1);
  /** Start the bot, run it for `ms`, then stop it. */
  const runFor = (ms: number, seed = 1) =>
    Effect.gen(function* () {
      const bot = yield* startWith(seed);
      yield* TestClock.adjust(ms);
      yield* bot.stop;
    });
  const lastView = Effect.gen(function* () {
    const shown = [...(yield* Ref.get(posts)), ...(yield* Ref.get(edits))].sort(
      (a, b) => a.at - b.at,
    );
    return shown.at(-1)?.view;
  });
  return {
    channelDown,
    steamDown,
    steam: steam.control,
    unlinked,
    posts,
    edits,
    notices,
    shortlists,
    alerts,
    start,
    startWith,
    runFor,
    lastView,
  };
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
        {
          at: THURSDAY_NOON,
          notice: { _tag: "Cancelled", reason: "entrants", week: WEEK, entrants: ["alice"] },
        },
      ]);
      expect(yield* bot.signUp("bob")).toBe(
        "This week's Weekly Cup was cancelled. The next one opens on Monday.",
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

describe("the Weekly Cup's Shortlist and vote", () => {
  /** A world at Monday 00:00 with alice and bob signed up, its bot running. */
  const signedUp = (seed = 1) =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* TestClock.setTime(MONDAY);
      const bot = yield* t.startWith(seed);
      yield* bot.signUp("alice");
      yield* bot.signUp("bob");
      return { t, bot };
    });
  const pfidsOf = (t: Effect.Effect.Success<typeof setup>) =>
    Effect.map(Ref.get(t.shortlists), (s) => s.at(-1)?.view.maps.map((m) => m.map.pfid) ?? []);

  it.scoped(
    "draws 10 Maps no Entrant has Played at Thursday 12:00, and posts them with their pictures",
    () =>
      Effect.gen(function* () {
        const { t, bot } = yield* signedUp();
        const longAuthor = makeMap(21, {
          medals: { bronze: 400, silver: 300, gold: 250, author: 181 },
        });
        const quickRecord = makeMap(22, { worldRecordTicks: 300_000 });
        yield* t.steam.setCatalogue([...ELIGIBLE, longAuthor, quickRecord]);
        yield* t.steam.setTime(1, steamIdOf("alice"), 30);
        yield* t.steam.setTime(2, steamIdOf("bob"), 30);
        yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
        const shortlists = yield* Ref.get(t.shortlists);
        expect(shortlists.map((s) => s.at)).toEqual([THURSDAY_NOON]);
        const maps = shortlists[0]?.view.maps ?? [];
        expect(maps.map((m) => m.map.pfid).sort()).toEqual(
          ELIGIBLE.slice(2)
            .map((m) => m.pfid)
            .sort(),
        );
        expect(maps[0]).toMatchObject({
          picture: { type: "image/png", body: new Uint8Array([1]) },
          map: { authorSeconds: 20, creator: "pebblewright" },
        });
        for (const m of maps) expect(m.map.boardId).toBe(Number(m.map.pfid.slice(2)));
        expect((yield* t.lastView)?.state).toBe("voting");
        yield* bot.stop;
      }),
  );

  it.scoped("posts a shorter Shortlist when fewer than 10 Maps are eligible", () =>
    Effect.gen(function* () {
      const { t, bot } = yield* signedUp();
      yield* t.steam.setCatalogue(ELIGIBLE.slice(0, 4));
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      expect(yield* pfidsOf(t)).toHaveLength(4);
      expect((yield* t.lastView)?.state).toBe("voting");
      yield* bot.stop;
    }),
  );

  it.scoped("cancels the week when no Map is eligible, and says why", () =>
    Effect.gen(function* () {
      const { t, bot } = yield* signedUp();
      yield* t.steam.setCatalogue([]);
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      expect(yield* Ref.get(t.shortlists)).toEqual([]);
      expect((yield* Ref.get(t.notices)).map((n) => n.notice)).toEqual([
        { _tag: "Cancelled", reason: "maps", week: WEEK, entrants: ["alice", "bob"] },
      ]);
      expect((yield* t.lastView)?.state).toBe("cancelled");
      yield* bot.stop;
    }),
  );

  it.scoped("tries the draw again each minute while Steam is down, telling ops once", () =>
    Effect.gen(function* () {
      const { t, bot } = yield* signedUp();
      yield* Ref.set(t.steamDown, true);
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY + 10 * MINUTE);
      expect(yield* Ref.get(t.shortlists)).toEqual([]);
      expect(yield* Ref.get(t.alerts)).toEqual([
        `Multiballs couldn't draw the Weekly Cup's Shortlist for ${WEEK} in ${GUILD}: no reply`,
      ]);
      yield* Ref.set(t.steamDown, false);
      yield* TestClock.adjust(MINUTE);
      expect((yield* Ref.get(t.shortlists)).map((s) => s.at)).toEqual([
        THURSDAY_NOON + 11 * MINUTE,
      ]);
      yield* bot.stop;
    }),
  );

  it.scoped("takes up to 3 votes from each Entrant, changeable until Friday 09:00", () =>
    Effect.gen(function* () {
      const { t, bot } = yield* signedUp();
      expect(yield* bot.vote("alice", ["pf1"])).toBe(
        `The Shortlist isn't drawn yet: it comes <t:${THURSDAY_NOON / 1000}:F>.`,
      );
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      const [a, b, c, d] = yield* pfidsOf(t);
      expect(yield* bot.vote("carol", [a ?? ""])).toBe(
        "Only Entrants can vote. Sign up on the Cup's post first.",
      );
      expect(yield* bot.vote("alice", [a, b, c, d].map(String))).toBe("Pick up to 3 Maps.");
      expect(yield* bot.vote("alice", ["pf99"])).toBe("That Map isn't on this week's Shortlist.");
      expect(yield* bot.vote("alice", [a, b].map(String))).toContain("Your vote:");
      expect(yield* bot.vote("alice", [c].map(String))).toBe(
        `Your vote: **Map ${(c ?? "").slice(2)}**. You can change it until <t:${FRIDAY_NINE / 1000}:F>.`,
      );
      yield* TestClock.adjust(FRIDAY_NINE - THURSDAY_NOON);
      expect(yield* bot.vote("alice", [a].map(String))).toBe("The vote has closed.");
      yield* bot.stop;
    }),
  );

  it.scoped(
    "makes the 3 most-voted the Cup Maps at Friday 09:00, announced with a ping for Entrants",
    () =>
      Effect.gen(function* () {
        const { t, bot } = yield* signedUp();
        yield* TestClock.adjust(THURSDAY_NOON - MONDAY + HOUR);
        const [m0, m1, m2, m3, m4, m5] = (yield* pfidsOf(t)).map(String);
        yield* bot.signUp("carol");
        yield* bot.signUp("dave");
        yield* bot.vote("alice", [m0, m1, m2].map(String));
        yield* bot.vote("alice", [m0, m1].map(String));
        yield* bot.vote("bob", [m0, m1, m3].map(String));
        yield* bot.vote("carol", [m0, m4].map(String));
        // A vote from someone who withdrew no longer counts.
        yield* bot.vote("dave", [m5, m3, m4].map(String));
        yield* bot.withdraw("dave");
        yield* TestClock.adjust(FRIDAY_NINE - THURSDAY_NOON - HOUR);
        const notices = yield* Ref.get(t.notices);
        expect(notices.map((n) => n.at)).toEqual([FRIDAY_NINE]);
        const notice = notices[0]?.notice;
        if (notice?._tag !== "CupMaps") throw new Error("no Cup Maps announced");
        expect(notice.entrants).toEqual(["alice", "bob", "carol"]);
        expect(notice.maps.map((m) => [m.map.pfid, m.votes]).slice(0, 2)).toEqual([
          [m0, 3],
          [m1, 2],
        ]);
        expect([m3, m4]).toContain(notice.maps[2]?.map.pfid);
        expect(notice.maps[2]?.votes).toBe(1);
        for (const m of notice.maps) expect(typeof m.map.boardId).toBe("number");
        expect((yield* t.lastView)?.state).toBe("racing");
        yield* bot.stop;
      }),
  );

  it.scoped("refuses a vote naming the same Map twice", () =>
    Effect.gen(function* () {
      const { t, bot } = yield* signedUp();
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY);
      const [a] = yield* pfidsOf(t);
      expect(yield* bot.vote("alice", [a, a].map(String))).toBe("Pick each Map once.");
      yield* bot.stop;
    }),
  );

  it.scoped("keeps the Shortlist through a restart, drawing and posting it once", () =>
    Effect.gen(function* () {
      const { t, bot } = yield* signedUp();
      yield* TestClock.adjust(THURSDAY_NOON - MONDAY + HOUR);
      const drawn = yield* pfidsOf(t);
      yield* bot.vote("alice", [drawn[0] ?? ""]);
      yield* bot.stop;
      const again = yield* t.startWith(42);
      expect(yield* again.vote("alice", [drawn[1] ?? ""])).toContain("Your vote:");
      yield* TestClock.adjust(HOUR);
      expect(yield* Ref.get(t.shortlists)).toHaveLength(1);
      yield* again.stop;
    }),
  );

  it.scoped("records the Cup Maps, tie-break and all, so a restart never redraws them", () =>
    Effect.gen(function* () {
      /** Up to Friday 09:00 with no votes (every Map tied), the announcement refused. */
      const tallied = Effect.gen(function* () {
        const { t, bot } = yield* signedUp(7);
        yield* TestClock.adjust(FRIDAY_NINE - MONDAY - MINUTE);
        yield* Ref.set(t.channelDown, true);
        yield* TestClock.adjust(10 * MINUTE);
        yield* bot.stop;
        expect(yield* Ref.get(t.alerts)).toContain(
          `Multiballs couldn't announce the Weekly Cup's Cup Maps for ${WEEK} in ${GUILD}: Missing Permissions`,
        );
        yield* Ref.set(t.channelDown, false);
        return t;
      });
      const announced = (seed: number) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(MONDAY);
          const t = yield* tallied;
          yield* t.runFor(5 * MINUTE, seed);
          const notices = (yield* Ref.get(t.notices)).map((n) => n.notice);
          expect(notices.map((n) => n._tag)).toEqual(["CupMaps"]);
          return notices[0]?._tag === "CupMaps" ? notices[0].maps.map((m) => m.map.pfid) : [];
        });
      const first = yield* announced(99);
      expect(first).toHaveLength(3);
      expect(yield* announced(5)).toEqual(first);
    }),
  );
});
