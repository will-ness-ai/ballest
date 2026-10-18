// A Daily's date, "2026-10-18": its name (CONTEXT.md), the key its Daily Post is recorded under,
// and the day its window opens on. The one place that string is read, written and timed.

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** When a day's Daily opens (its window opens at 01:00 UTC since 2026-09-05). */
export const OPENING_HOUR_UTC = 1;

/** Midnight UTC at the start of `date`. */
export const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** The UTC date a moment falls on. */
export const dateOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The date `days` after `date` (before it, if negative). */
export const addDays = (date: string, days: number): string => dateOf(dayStart(date) + days * DAY);

/** When the bot starts asking for `date`'s Daily. */
export const openingOf = (date: string): number => dayStart(date) + OPENING_HOUR_UTC * HOUR;

/** The Daily that had opened last by `at`: before 01:00 UTC, yesterday's, which is still live. */
export const dailyDateAt = (at: number): string => dateOf(at - OPENING_HOUR_UTC * HOUR);
