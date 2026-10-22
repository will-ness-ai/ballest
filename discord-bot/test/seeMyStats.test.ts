// See my stats (spec #323) through its ports: the Stats Links in the leaderboard database and
// the site that draws the Stat Card, faked here, and the member's private answer, recorded. The
// watch for a sign-in runs on the TestClock.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, TestClock } from "effect";
import {
  CardFailed,
  makeSeeMyStats,
  NoStats,
  type StatsAnswer,
  StatsLinks,
  StatsSite,
  StatsUnavailable,
  WATCH_EVERY,
  WATCH_FOR,
} from "../src/seeMyStats.js";

const SITE = "https://ballestrecords.test";
const ALICE = { id: "d-alice", name: "alice" };
const ALICE_STEAM = "76561198000000001";
const PNG = Buffer.from("card");

/** What an answer shows, without the image's bytes. */
const shown = (a: StatsAnswer) =>
  a._tag === "Card" ? { _tag: a._tag, steamId: a.steamId, url: a.url } : a;

/**
 * See my stats over a database holding `links` (Discord id → Steam id) and the requests it is
 * given, and a site that draws a card for every Steam id but those in `noStats`, or none while
 * `drawing` is off. Each press's answers are recorded, in order.
 */
const setup = Effect.gen(function* () {
  const links = yield* Ref.make(new Map<string, string>());
  const requests = yield* Ref.make<Array<{ token: string; discordId: string; name: string }>>([]);
  const used = yield* Ref.make(new Set<string>());
  const readable = yield* Ref.make(true);
  const drawing = yield* Ref.make(true);
  const noStats = yield* Ref.make(new Set<string>());
  const drawn = yield* Ref.make<Array<string>>([]);

  const unreadable = new StatsUnavailable({ reason: "connection refused" });
  const read = <A>(effect: Effect.Effect<A>) =>
    Effect.flatMap(Ref.get(readable), (ok) => (ok ? effect : Effect.fail(unreadable)));

  const fakes = Layer.mergeAll(
    Layer.succeed(
      StatsLinks,
      StatsLinks.of({
        pairedWith: (discordId) =>
          read(Ref.get(links).pipe(Effect.map((m) => Option.fromNullable(m.get(discordId))))),
        request: (discordId, name) =>
          read(
            Effect.gen(function* () {
              const token = `t${String((yield* Ref.get(requests)).length + 1)}`;
              yield* Ref.update(requests, (r) => [...r, { token, discordId, name }]);
              return token;
            }),
          ),
        used: (token) => read(Ref.get(used).pipe(Effect.map((u) => u.has(token)))),
      }),
    ),
    Layer.succeed(
      StatsSite,
      StatsSite.of({
        url: SITE,
        card: (steamId) =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(drawing)))
              return yield* new CardFailed({ reason: "the site said 500" });
            if ((yield* Ref.get(noStats)).has(steamId)) return yield* new NoStats();
            yield* Ref.update(drawn, (d) => [...d, steamId]);
            return PNG;
          }),
      }),
    ),
  );
  const stats = yield* makeSeeMyStats.pipe(Effect.provide(fakes));

  /** A press's private answer: each version of it, oldest first. */
  const answers = () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<StatsAnswer>>([]);
      return {
        answer: (a: StatsAnswer) => Ref.update(seen, (s) => [...s, a]),
        shown: Ref.get(seen).pipe(Effect.map((s) => s.map(shown))),
      };
    });
  /** The member signs in on the link page and confirms the request `token`. */
  const confirm = (token: string, discordId: string, steamId: string) =>
    Effect.all([
      Ref.update(links, (m) => new Map(m).set(discordId, steamId)),
      Ref.update(used, (u) => new Set(u).add(token)),
    ]);
  return { stats, links, requests, readable, drawing, noStats, drawn, answers, confirm };
});

const signIn = (token: string) => ({ _tag: "SignIn", url: `${SITE}/discord/link?t=${token}` });
const card = (steamId: string) => ({ _tag: "Card", steamId, url: `${SITE}/player/${steamId}` });

describe("See my stats", () => {
  it.scoped("answers a paired member with their Stat Card", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.links, new Map([[ALICE.id, ALICE_STEAM]]));
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      expect(yield* a.shown).toEqual([card(ALICE_STEAM)]);
      expect(yield* Ref.get(t.requests)).toEqual([]);
    }),
  );

  it.scoped("sends a member with no Stats Link to sign in, by a request it writes", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      expect(yield* Ref.get(t.requests)).toEqual([
        { token: "t1", discordId: ALICE.id, name: "alice" },
      ]);
      expect(yield* a.shown).toEqual([signIn("t1")]);
    }),
  );

  it.scoped("turns the sign-in answer into the card within seconds of the confirm", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      yield* TestClock.adjust("10 minutes");
      expect(yield* a.shown).toEqual([signIn("t1")]);
      yield* t.confirm("t1", ALICE.id, ALICE_STEAM);
      yield* TestClock.adjust(WATCH_EVERY);
      expect(yield* a.shown).toEqual([signIn("t1"), card(ALICE_STEAM)]);
      // Once is enough: the watch is over.
      yield* TestClock.adjust(WATCH_FOR);
      expect(yield* Ref.get(t.drawn)).toEqual([ALICE_STEAM]);
    }),
  );

  it.scoped("leaves the sign-in answer as it is once the window has passed", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      yield* TestClock.adjust(WATCH_FOR);
      yield* t.confirm("t1", ALICE.id, ALICE_STEAM);
      yield* TestClock.adjust("1 hour");
      expect(yield* a.shown).toEqual([signIn("t1")]);
    }),
  );

  it.scoped("on Pair again, writes a fresh request and watches it, though already paired", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.links, new Map([[ALICE.id, ALICE_STEAM]]));
      const a = yield* t.answers();
      yield* t.stats.pairAgain(ALICE, a.answer);
      expect(yield* Ref.get(t.requests)).toEqual([
        { token: "t1", discordId: ALICE.id, name: "alice" },
      ]);
      expect(yield* a.shown).toEqual([signIn("t1")]);
      const OTHER = "76561198000000002";
      yield* t.confirm("t1", ALICE.id, OTHER);
      yield* TestClock.adjust(WATCH_EVERY);
      expect(yield* a.shown).toEqual([signIn("t1"), card(OTHER)]);
    }),
  );

  it.scoped("keeps watching through a read that fails", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      yield* Ref.set(t.readable, false);
      yield* TestClock.adjust(WATCH_EVERY * 3);
      yield* Ref.set(t.readable, true);
      yield* t.confirm("t1", ALICE.id, ALICE_STEAM);
      yield* TestClock.adjust(WATCH_EVERY);
      expect(yield* a.shown).toEqual([signIn("t1"), card(ALICE_STEAM)]);
    }),
  );

  it.scoped("says to try again when the site can't draw the card", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.links, new Map([[ALICE.id, ALICE_STEAM]]));
      yield* Ref.set(t.drawing, false);
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      expect(yield* a.shown).toEqual([{ _tag: "CardFailed" }]);
    }),
  );

  it.scoped("says so when the paired account has no runs on the boards", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.links, new Map([[ALICE.id, ALICE_STEAM]]));
      yield* Ref.set(t.noStats, new Set([ALICE_STEAM]));
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      expect(yield* a.shown).toEqual([{ _tag: "NoStats" }]);
    }),
  );

  it.scoped("says stats aren't available while the database can't be read", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.readable, false);
      const a = yield* t.answers();
      yield* t.stats.see(ALICE, a.answer);
      yield* t.stats.pairAgain(ALICE, a.answer);
      expect(yield* a.shown).toEqual([{ _tag: "Unavailable" }, { _tag: "Unavailable" }]);
    }),
  );
});
