// The Shortlist's spinning 3D GIFs (spec #411): the Daily Post's drawings (src/spins.ts), linked
// on the site. `look` reads every Shortlist Map's drawing in one query, asks daily-spin.yml for
// each Map whose file has no drawing yet (once per week and run, from the first look that may
// ask and reads the database), and says each Map's GIF link and whether one is still to come;
// `wake` says when to look again: every minute for the hour after Thursday 12:00, while one is.
import { Effect, Either, Option } from "effect";
import { type Drawing, spinUrl } from "../spins.js";
import type { CupKit } from "./kit.js";
import { type CupMap, SPIN_LOOK, SPIN_WATCH } from "./model.js";
import type { CupWeek } from "./week.js";

/** What one look found: each Map's GIF link (null: none drawn yet), and whether one is to come. */
export interface SpinLook {
  readonly spinOf: (pfid: string) => string | null;
  readonly waiting: boolean;
}

/** A Map whose GIF is still to come: it has a file, and no drawing of that file. */
const due = (d: Drawing) => !Option.exists(d.drawn, (s) => s.version === d.file);

export const makeCupSpins = (kit: CupKit) => {
  /** The weeks whose ask this run has started, and those still to make (a failed read waits). */
  const started = new Set<string>();
  const toAsk = new Set<string>();

  /** Ask for each due Map's GIF, whatever GitHub answers for the others; ops hears once. */
  const ask = Effect.fn("CupSpins.ask")(function* (
    week: CupWeek,
    drawings: ReadonlyMap<string, Drawing>,
  ) {
    toAsk.delete(week.week);
    const pfids = [...drawings].flatMap(([pfid, d]) => (due(d) ? [pfid] : []));
    const answers = yield* Effect.forEach(pfids, (pfid) => Effect.either(kit.spins.draw(pfid)));
    const refused = answers.flatMap((a) => (Either.isLeft(a) ? [a.left.reason] : []));
    yield* kit.attempt(
      "spins",
      "ask for the Weekly Cup's spinning GIFs",
      week.week,
      refused.length === 0
        ? Effect.void
        : Effect.fail({ reason: `${refused.length} of ${pfids.length} refused: ${refused[0]}` }),
    );
    yield* Effect.logInfo(
      `weekly cup: asked for ${pfids.length - refused.length} of ${pfids.length} spinning GIFs for ${week.week}`,
    );
  });

  /**
   * Each Shortlist Map's GIF link, and whether one is to come. `mayAsk`: the week's ask can start
   * here (the draw's step, however often a refused post brings it back); later looks only finish
   * an ask a failed read held up. A read that fails shows no GIF and is looked at again.
   */
  const look = Effect.fn("CupSpins.look")(function* (
    week: CupWeek,
    shortlist: ReadonlyArray<CupMap>,
    mayAsk: boolean,
  ) {
    if (mayAsk && !started.has(week.week)) {
      started.add(week.week);
      toAsk.add(week.week);
    }
    const read = yield* Effect.either(kit.spins.drawings(shortlist.map((m) => m.pfid)));
    if (Either.isLeft(read)) {
      yield* Effect.logWarning(`weekly cup: can't read the spinning GIFs: ${read.left.reason}`);
      return { spinOf: () => null, waiting: true } satisfies SpinLook;
    }
    const drawings = read.right;
    if (toAsk.has(week.week)) yield* ask(week, drawings);
    return {
      // Its latest drawing, even of an older file, until the new one comes.
      spinOf: (pfid) =>
        Option.match(
          Option.flatMap(Option.fromNullable(drawings.get(pfid)), (d) => d.drawn),
          { onNone: () => null, onSome: (s) => spinUrl(pfid, s.drawnAt) },
        ),
      waiting: [...drawings.values()].some(due),
    } satisfies SpinLook;
  });

  /** When to look again: in a minute while a GIF is to come within the hour, else at the close. */
  const wake = (now: number, week: CupWeek, waiting: boolean) =>
    waiting && now + SPIN_LOOK < week.shortlistAt + SPIN_WATCH
      ? Math.min(now + SPIN_LOOK, week.voteClosesAt)
      : week.voteClosesAt;

  /** Whether the hour of looking is over. */
  const over = (now: number, week: CupWeek) => now >= week.shortlistAt + SPIN_WATCH;

  return { look, wake, over };
};
