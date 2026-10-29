// The Weekly Cup (spec #353): in each server where it is switched on, a Cup every week that runs
// itself in #weekly-cup, every boundary in US Central (week.ts). One state machine per server,
// driven by the clock:
//
//   open      Monday 00:00: the Cup's post goes up with Sign up, Withdraw and Skip
//   voting    Thursday 12:00, with 2 Entrants or more: the Shortlist is drawn and posted with its
//             vote (up to 3 picks each, Entrants only, changeable; vote.ts)
//   racing    Friday 09:00: the 3 most-voted are the Cup Maps, announced with a ping for
//             Entrants, and the Shortlist's vote is closed; every 5 minutes the Entrants' times
//             on them are read and the standings shown (race.ts)
//   final     Sunday 20:00: sign-up closes, and after a final read (waiting up to 30 minutes for
//             Steam) the results are posted
//   cancelled Thursday 12:00 with fewer than 2 Entrants, or no Map to draw: the post and a
//             notice say so
//   skipped   a server admin skipped the week while it was open: its Entrants are told
//
// Sign-up stays open from Monday 00:00 to Sunday 20:00, so a late Entrant can still race
// (presses.ts). Each week is recorded in the bot's SQLite (record.ts), and the schedule works only
// from that record and the clock, so a restart picks the week up where it was without posting,
// drawing or announcing again; a boundary passed while the bot was down is acted on as it starts,
// and an earlier week still racing is finished. A week the bot first starts in after Thursday
// 12:00 gets no post: the next goes up on Monday.
//
// Its effects go through ports (model.ts: the Cup's channel and the Links; Steam, the record, ops
// and the Map previews), taken as the Cup is built, so it is tested on the TestClock over fakes
// (test/weeklyCup.test.ts); the channel on discord.js is in live.ts.
import { Cause, Clock, Context, Effect, Option } from "effect";
import { makeKit } from "./kit.js";
import { RETRY_EVERY } from "./model.js";
import { type CupPresses, makePresses } from "./presses.js";
import { makeRace } from "./race.js";
import { freshCup } from "./record.js";
import { makeVote } from "./vote.js";
import { type CupWeek, weekAt, weekOf } from "./week.js";

/**
 * One server's Weekly Cup: `run` keeps its schedule (it never ends), and the presses on its posts
 * act on the week they were pressed for. One lock keeps a press and the schedule from acting on
 * the same week at once.
 */
export const makeWeeklyCup = Effect.fn("WeeklyCup.make")(function* (guildId: string) {
  const kit = yield* makeKit(guildId);
  const { log } = kit;
  const race = makeRace(kit);
  const vote = makeVote(kit, race);
  const presses = makePresses(kit, race);

  /**
   * Act on this week as it stands at `now`, and say when to look again: post a week with no post
   * yet, and move a posted one on past each boundary it has reached.
   */
  const stepWeek = Effect.fn("WeeklyCup.stepWeek")(function* (now: number, week: CupWeek) {
    const found = yield* log.get(guildId, week.week);
    if (Option.isNone(found)) {
      if (now >= week.shortlistAt) return week.nextOpensAt;
      const view = { guildId, week, state: "open", entrants: [] } as const;
      const posted = yield* kit.attempt(
        "post",
        "post the Weekly Cup",
        week.week,
        kit.channel.show("post", [], view),
      );
      if (Option.isNone(posted)) return now + RETRY_EVERY;
      yield* log.put(guildId, week.week, freshCup(posted.value));
      yield* Effect.logInfo(`weekly cup: posted ${week.week} in ${guildId}`);
      return week.shortlistAt;
    }
    const cup = found.value;
    switch (cup.state) {
      case "open":
        return now < week.shortlistAt ? week.shortlistAt : yield* vote.openVote(now, week, cup);
      case "voting":
        return now < week.voteClosesAt ? week.voteClosesAt : yield* vote.closeVote(now, week, cup);
      case "racing":
        return now < week.endsAt
          ? yield* race.live(now, week, cup)
          : yield* race.finish(now, week, cup);
      default:
        return week.nextOpensAt;
    }
  });

  /**
   * Act at `now`, and say when to look again: act on this week, and finish any earlier week still
   * racing (the bot was down over its close, so its results never went up).
   */
  const step = Effect.fn("WeeklyCup.step")(function* (now: number) {
    let wake = yield* stepWeek(now, weekAt(now));
    for (const earlier of yield* log.unfinished(guildId, weekAt(now).week)) {
      const was = weekOf(earlier);
      const cup = yield* log.get(guildId, earlier);
      if (Option.isNone(cup)) continue;
      const next = yield* race.finish(now, was, cup.value);
      if (next < was.nextOpensAt) wake = Math.min(wake, next);
    }
    return wake;
  });

  /** A step where even a bug is only that step's: ops hears, and it is tried again shortly. */
  const safeStep = Effect.fn("WeeklyCup.safeStep")(function* (now: number) {
    return yield* kit
      .locked(step(now))
      .pipe(
        Effect.catchAllDefect((defect) =>
          kit.alerts
            .post(
              `Multiballs hit a bug running the Weekly Cup in ${guildId}: ${Cause.pretty(Cause.die(defect)).split("\n")[0] ?? ""}`,
            )
            .pipe(Effect.as(now + RETRY_EVERY)),
        ),
      );
  });

  const run = Effect.gen(function* () {
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      const next = yield* safeStep(now);
      const wait = next - (yield* Clock.currentTimeMillis);
      if (wait > 0) yield* Effect.sleep(wait);
    }
  });

  return { guildId, run, ...presses };
});

export type WeeklyCup = Effect.Effect.Success<ReturnType<typeof makeWeeklyCup>>;

/** Every server's Weekly Cup that is running, by server id (WEEKLY_CUP_GUILD_IDS, live.ts). */
export class WeeklyCups extends Context.Tag("multiballs/WeeklyCups")<
  WeeklyCups,
  { readonly in: (guildId: string) => Effect.Effect<Option.Option<CupPresses>> }
>() {}
