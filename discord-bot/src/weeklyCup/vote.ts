// The Weekly Cup's Shortlist and vote (spec #353, #357): at Thursday 12:00 the Shortlist is drawn
// from Maps none of the Entrants has Played and posted with its vote; at Friday 09:00 the most
// voted become the Cup Maps, every Entrant's bars are taken, the Cup Maps are announced and the
// Shortlist's vote is closed. Each is recorded before it is shown, so a restart never draws, ranks
// or announces again.
import { Effect, Option, Random } from "effect";
import { searchEligible } from "../eligibleMaps.js";
import { Steam } from "../ports.js";
import type { CupKit } from "./kit.js";
import {
  CUP_AUTHOR_LIMIT,
  CUP_MAPS,
  type CupMap,
  cupMapOf,
  MIN_ENTRANTS,
  READ_RETRIES,
  RETRY_EVERY,
  SHORTLIST_CHECKS,
  SHORTLIST_SIZE,
  type ShortlistView,
} from "./model.js";
import type { CupRace } from "./race.js";
import type { CupRecord, Entrant, Vote } from "./record.js";
import type { CupWeek } from "./week.js";

/**
 * The Cup Maps from the Shortlist and the votes: the most-voted first, a tie settled at random
 * (the Shortlist shuffled, then sorted by votes, which keeps the shuffle's order among equals).
 * Only the votes of `entrants` count.
 */
export const rank = Effect.fn("cup.rank")(function* (
  shortlist: ReadonlyArray<CupMap>,
  votes: ReadonlyArray<Vote>,
  entrants: ReadonlySet<string>,
) {
  const counts = new Map<string, number>();
  for (const v of votes)
    if (entrants.has(v.discordId))
      for (const pfid of v.picks) counts.set(pfid, (counts.get(pfid) ?? 0) + 1);
  const shuffled = [...(yield* Random.shuffle(shortlist))];
  return shuffled
    .map((map) => ({ map, votes: counts.get(map.pfid) ?? 0 }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, CUP_MAPS);
});

export const makeVote = (kit: CupKit, race: CupRace) => {
  const { guildId, log } = kit;

  /** Draw the Shortlist from Maps none of these Entrants has Played, and record it. */
  const draw = Effect.fn("cup.draw")(function* (week: CupWeek, entrants: ReadonlyArray<Entrant>) {
    const steamIds = yield* Effect.forEach(entrants, (e) => kit.links.steamIdOf(e.discordId));
    const { unplayed } = yield* searchEligible({
      authorLimitSeconds: CUP_AUTHOR_LIMIT,
      steamIds: steamIds.flatMap(Option.toArray),
      want: SHORTLIST_SIZE,
      maxChecks: SHORTLIST_CHECKS,
      retries: READ_RETRIES,
    }).pipe(Effect.provideService(Steam, kit.steam));
    const maps = unplayed.map(cupMapOf);
    yield* log.putShortlist(guildId, week.week, maps);
    yield* Effect.logInfo(`weekly cup: drew ${maps.length} Maps for ${week.week} in ${guildId}`);
    return maps;
  });

  /** The Shortlist's post: each Map with its Workshop picture, its vote open or `closed`. */
  const shortlistView = Effect.fn("cup.shortlistView")(function* (
    week: CupWeek,
    shortlist: ReadonlyArray<CupMap>,
    closed: boolean,
  ) {
    const maps = yield* Effect.forEach(shortlist, (map) =>
      Effect.map(kit.previews.of(map.previewUrl), (p) => ({ map, picture: Option.getOrNull(p) })),
    );
    return { guildId, week, maps, wanted: SHORTLIST_SIZE, closed } satisfies ShortlistView;
  });

  /**
   * Thursday 12:00: with enough Entrants signed up by then, draw the Shortlist (once: a restart
   * finds it recorded) and post it, and the week is voting. A draw Steam fails, or a post Discord
   * refuses, is tried again in a minute. Returns when to look again.
   */
  const openVote = Effect.fn("cup.openVote")(function* (
    now: number,
    week: CupWeek,
    cup: CupRecord,
  ) {
    // Those signed up after Thursday 12:00 (while a draw is retried) were not checked against it.
    const checked = (yield* log.entrants(guildId, week.week)).filter(
      (e) => e.signedUpAt <= week.shortlistAt,
    );
    if (checked.length < MIN_ENTRANTS) {
      yield* kit.callOff(week, cup, { _tag: "Cancelled", reason: "entrants" });
      return week.nextOpensAt;
    }
    let shortlist = (yield* log.shortlist(guildId, week.week)).map((s) => s.map);
    if (shortlist.length === 0) {
      const drawn = yield* kit.attempt(
        "draw",
        "draw the Weekly Cup's Shortlist",
        week.week,
        draw(week, checked),
      );
      if (Option.isNone(drawn)) return now + RETRY_EVERY;
      shortlist = drawn.value;
      if (shortlist.length === 0) {
        yield* kit.callOff(week, cup, { _tag: "Cancelled", reason: "maps" });
        return week.nextOpensAt;
      }
    }
    const view = yield* shortlistView(week, shortlist, false);
    const posted = yield* kit.show(week, cup, "shortlist", view, "post the Weekly Cup's Shortlist");
    if (Option.isNone(posted)) return now + RETRY_EVERY;
    yield* kit.enter(week, posted.value, "voting");
    return week.voteClosesAt;
  });

  /**
   * Friday 09:00: the most-voted become the Cup Maps, recorded before they are announced, so a
   * restart or a refused announcement never redraws a tie. Every Entrant's PBs on the Cup Maps are
   * taken as their bars (once), so a time set before racing opens (practice on the Shortlist
   * during the vote, or an old run) counts only once it is beaten. Then the announcement, with a
   * ping for the Entrants, the week is racing, and the Shortlist's vote is closed on its post. A
   * Steam failure or refused announcement is tried again in a minute.
   */
  const closeVote = Effect.fn("cup.closeVote")(function* (
    now: number,
    week: CupWeek,
    cup: CupRecord,
  ) {
    let current = cup;
    const entrants = yield* kit.entrantIds(week.week);
    let shortlist = yield* log.shortlist(guildId, week.week);
    if (!shortlist.some((s) => s.cupRank !== null)) {
      const ranked = yield* rank(
        shortlist.map((s) => s.map),
        yield* log.votes(guildId, week.week),
        new Set(entrants),
      );
      yield* log.putCupMaps(
        guildId,
        week.week,
        ranked.map((r) => ({ pfid: r.map.pfid, votes: r.votes })),
      );
      shortlist = yield* log.shortlist(guildId, week.week);
    }
    const maps = yield* race.cupMapsOf(week.week);
    if (current.barsAt === null) {
      const bars = yield* kit.attempt(
        "bars",
        "read the Entrants' times on the Weekly Cup's Cup Maps",
        week.week,
        race.barsOf(
          maps.map((m) => m.map),
          entrants,
        ),
      );
      if (Option.isNone(bars)) return now + RETRY_EVERY;
      yield* log.putBaselines(guildId, week.week, entrants, bars.value);
      current = { ...current, barsAt: now };
      yield* log.put(guildId, week.week, current);
    }
    const announced = yield* kit.attempt(
      "announce",
      "announce the Weekly Cup's Cup Maps",
      week.week,
      kit.channel.say({ _tag: "CupMaps", week, entrants, maps }),
    );
    if (Option.isNone(announced)) return now + RETRY_EVERY;
    current = yield* kit.enter(week, current, "racing");
    const closed = yield* shortlistView(
      week,
      shortlist.map((s) => s.map),
      true,
    );
    // Best effort, once: a Shortlist someone deleted isn't posted again just to say it closed.
    if (current.shown.shortlist.length > 0)
      yield* kit.show(
        week,
        current,
        "shortlist",
        closed,
        "close the vote on the Weekly Cup's Shortlist",
        "closeVote",
      );

    return now;
  });

  return { openVote, closeVote };
};
