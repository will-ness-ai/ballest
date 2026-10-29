// A job that runs once a day at a fixed hour in UTC: the Daily Report and the Traffic Report.
// A bot that starts after the hour runs that day's job once at start, so a restart or a deploy
// never loses a day; whether a day already ran is the job's own record, not the schedule's.
import { Clock, Effect } from "effect";

const DAY_MS = 86_400_000;

/** The UTC day a moment falls on, "2026-10-04": the key a day's run is recorded under. */
export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The day `n` days before `day` ("2026-10-04"). */
export const daysBefore = (day: string, n: number) =>
  dayOf(Date.parse(day + "T00:00:00Z") - n * DAY_MS);

/** Today's `hour` (UTC), or tomorrow's once today's has passed. */
export const nextAt = (hour: number, now: number) => {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
  return today > now ? today : today + DAY_MS;
};

/** Catch up on today if it's past `hour`, then run at every `hour` after, forever. */
export const everyDayAt = Effect.fn("EveryDay.at")(function* <E, R>(
  hour: number,
  run: (at: number) => Effect.Effect<void, E, R>,
) {
  const now = yield* Clock.currentTimeMillis;
  // Past today's hour exactly when the next one falls tomorrow.
  if (dayOf(nextAt(hour, now)) !== dayOf(now)) yield* run(now);
  while (true) {
    const t = yield* Clock.currentTimeMillis;
    yield* Effect.sleep(nextAt(hour, t) - t);
    yield* run(yield* Clock.currentTimeMillis);
  }
});
