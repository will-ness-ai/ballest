// The Weekly Cup's week (spec #353): every boundary is a wall-clock time in US Central
// (America/Chicago), so the same local times hold across daylight saving.
//
// Monday 00:00     the Cup's post goes up; sign-up opens
// Thursday 12:00   the Shortlist is drawn, or a week with fewer than 2 Entrants is cancelled
// Friday 09:00     the vote closes; racing starts
// Sunday 20:00     racing and sign-up end; the results
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

const isoDate = (dayUtc: number) => new Date(dayUtc).toISOString().slice(0, 10);

/** The Cup week `ms` falls in: from its Monday 00:00 Central to the next. */
/** The week a record's key (its Monday, as `CupWeek.week` has it) names. */
export const weekOf = (key: string): CupWeek => weekAt(Date.parse(`${key}T12:00:00Z`)); // Monday 12:00 UTC is in it

export const weekAt = (ms: number): CupWeek => {
  const wall = wallClock(ms);
  const today = wall - (wall % DAY);
  // getUTCDay: 0 is Sunday; the week starts on Monday.
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  return {
    week: isoDate(monday),
    opensAt: central(monday, 0),
    shortlistAt: central(monday + 3 * DAY, 12),
    voteClosesAt: central(monday + 4 * DAY, 9),
    endsAt: central(monday + 6 * DAY, 20),
    nextOpensAt: central(monday + 7 * DAY, 0),
  };
};
