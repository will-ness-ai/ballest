// The Weekly Cup's week (spec #353): every boundary is a wall-clock time in US Central
// (America/Chicago), so the same local times hold across daylight saving.
//
// Monday 00:00     the Cup's post goes up; sign-up opens
// Thursday 12:00   the Shortlist is drawn, or a week with fewer than 2 Entrants is cancelled
// Friday 09:00     the vote closes; racing starts
// Sunday 20:00     racing and sign-up end; the results
// MOVED_TIMES moves any of the last three for one week.
export const CUP_TIME_ZONE = "America/Chicago";

const DAY = 24 * 60 * 60 * 1000;

export interface CupWeek {
  /** The week's Monday in Central, "2026-10-26": the key its record is kept under. */
  readonly week: string;
  readonly opensAt: number;
  readonly shortlistAt: number;
  readonly voteClosesAt: number;
  readonly endsAt: number;
  /** The next week's Monday 00:00. */
  readonly nextOpensAt: number;
}

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: CUP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** The Central wall clock at `ms`, read as if it were UTC. */
const wallClock = (ms: number) => {
  const p = new Map(parts.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  const n = (type: Intl.DateTimeFormatPartTypes) => p.get(type) ?? 0;
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
};

/** How far Central's wall clock is from UTC at `ms` (negative: behind). */
const offsetAt = (ms: number) => wallClock(ms) - Math.floor(ms / 1000) * 1000;

/** The moment Central's wall clock reads this date (as a UTC midnight) plus `hours`. */
const central = (dayUtc: number, hours: number) => {
  const wall = dayUtc + hours * 60 * 60 * 1000;
  const guess = wall - offsetAt(wall);
  // Near a clock change the offset at the guess can differ from the one at the wall time.
  return wall - offsetAt(guess);
};

/** A boundary moved for one week: [hour, minute] after that week's Monday 00:00 Central. */
type MovedTime = readonly [number, number];

/**
 * Weeks whose Shortlist, vote close or end come at other times than the usual, by week key, each
 * time as [hour, minute] after its Monday 00:00 in Central, so 170 is 02:00 on the next Monday.
 * Moving a week's Shortlist past when its vote already closed draws it again (schedule.ts).
 * Tests add to it (test/weeklyCup.test.ts).
 *
 * - 2026-11-02: Will moved that week's end to midnight Pacific (02:00 Monday Central), after the
 *   next week's post goes up at 00:00; the schedule races both weeks until then.
 * - 2026-11-09: a late Entrant had already Played two of the Cup Maps, so Will had the vote done
 *   again: the Shortlist drawn afresh at Friday 23:00, the vote closing at Saturday 14:00 (noon
 *   Pacific), and racing until Tuesday 20:00.
 */
export const MOVED_TIMES = new Map<
  string,
  Partial<Record<"shortlistAt" | "voteClosesAt" | "endsAt", MovedTime>>
>([
  ["2026-11-02", { endsAt: [170, 0] }],
  ["2026-11-09", { shortlistAt: [119, 0], voteClosesAt: [134, 0], endsAt: [212, 0] }],
]);

const isoDate = (dayUtc: number) => new Date(dayUtc).toISOString().slice(0, 10);

/** The Cup week `ms` falls in: from its Monday 00:00 Central to the next. */
export const weekAt = (ms: number): CupWeek => {
  const wall = wallClock(ms);
  const today = wall - (wall % DAY);
  // getUTCDay: 0 is Sunday; the week starts on Monday.
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  const moved = MOVED_TIMES.get(isoDate(monday)) ?? {};
  /** The moment `hour`:`minute` after the week's Monday 00:00 Central. */
  const after = ([hour, minute]: MovedTime) => central(monday, hour) + minute * 60_000;
  return {
    week: isoDate(monday),
    opensAt: central(monday, 0),
    shortlistAt: after(moved.shortlistAt ?? [3 * 24 + 12, 0]),
    voteClosesAt: after(moved.voteClosesAt ?? [4 * 24 + 9, 0]),
    endsAt: after(moved.endsAt ?? [6 * 24 + 20, 0]),
    nextOpensAt: central(monday + 7 * DAY, 0),
  };
};

/**
 * The week a record's key (its Monday, as `CupWeek.week` has it) names: Monday 12:00 UTC is
 * always in it.
 */
export const weekOf = (key: string): CupWeek => weekAt(Date.parse(`${key}T12:00:00Z`));
