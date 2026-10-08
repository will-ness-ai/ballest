// The Daily's rules the pages share (CONTEXT.md): when one is live, which is today's, how
// its date and its time left read, the calendar the Daily page lays the days out in, and
// the all-time standings over final Dailies.
import type {
  DailyFinish,
  DailyRecord,
  DailyRecordKey,
  DailyStanding,
  DailyStandings,
  PlayerDailies,
  PlayerDaily,
} from "./rows";

/* Live until its close by the reader's clock, so a page cached before the close still
   flips to Final at it; a Daily the database holds as final (a read after its close made
   it so) is final whatever the reader's clock says. */
export function isLive(d: { endsAt: string; final: boolean }, now: number | null) {
  return !d.final && (now == null || now < Date.parse(d.endsAt));
}

/* "5h 03m" to the close, rounded to the minute */
export function timeLeft(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, "0")}m`;
}

/* "Sat, Sep 5" (", 2026" with the year): the Daily's own date, the same in every time zone */
export function dayLabel(date: string, year = false) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: year ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/* The Daily that is today's: the newest, while it is live by the reader's clock */
export function todayOf(
  days: ReadonlyArray<{ date: string; endsAt: string; final: boolean }>,
  now: number | null,
) {
  const newest = days.at(-1);
  return newest && isLive(newest, now) ? newest.date : null;
}

export interface CalendarMonth<D> {
  /* YYYY-MM, and "September 2026" */
  month: string;
  name: string;
  /* the empty cells before its 1st, in a week that starts on Sunday */
  lead: number;
  /* each day of it, with its Daily or null */
  days: Array<{ n: number; date: string; daily: D | null }>;
}

/* The calendar: every month that has a Daily, newest first, each day with its Daily */
export function calendarOf<D extends { date: string }>(
  days: ReadonlyArray<D>,
): Array<CalendarMonth<D>> {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const months = [...new Set(days.map((d) => d.date.slice(0, 7)))].sort().reverse();
  return months.map((month) => {
    const [y, m] = month.split("-").map(Number);
    return {
      month,
      name: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      lead: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
      days: Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        return { n: i + 1, date, daily: byDate.get(date) ?? null };
      }),
    };
  });
}

/* golds, then silvers, then bronzes, then Dailies played; the Steam ID only so the order
   is the same on every read */
export function medalOrder(a: DailyStanding, b: DailyStanding) {
  return (
    b.gold - a.gold ||
    b.silver - a.silver ||
    b.bronze - a.bronze ||
    b.played - a.played ||
    (a.steamId < b.steamId ? -1 : a.steamId > b.steamId ? 1 : 0)
  );
}

const RECORDS: Array<[DailyRecordKey, (s: DailyStanding) => number]> = [
  ["wins", (s) => s.gold],
  ["podiums", (s) => s.podiums],
  ["played", (s) => s.played],
  ["playedRun", (s) => s.playedRun],
  ["winRun", (s) => s.winRun],
];

/* The Daily standings from every place on a final Daily: `dates` are the final Dailies,
   oldest first, and a run is consecutive Dailies in that list. A record card holds the
   top three on its value, in medal order among equals, each place shared by equal values
   (1, 2, 2), and counts the players left off who share the last one shown. */
export function standingsOf(
  dates: ReadonlyArray<string>,
  finishes: ReadonlyArray<DailyFinish>,
): DailyStandings {
  const at = new Map(dates.map((d, i) => [d, i]));
  const by = new Map<string, { s: DailyStanding; places: Array<number | undefined> }>();
  for (const f of finishes) {
    const i = at.get(f.date);
    if (i === undefined) continue;
    let p = by.get(f.steamId);
    if (!p) {
      p = {
        s: {
          steamId: f.steamId,
          persona: f.persona,
          avatar: f.avatar,
          gold: 0,
          silver: 0,
          bronze: 0,
          podiums: 0,
          top10: 0,
          played: 0,
          playedRun: 0,
          winRun: 0,
        },
        places: [],
      };
      by.set(f.steamId, p);
    }
    p.places[i] = f.rank;
  }
  const players = [...by.values()].map(({ s, places }) => {
    let played = 0,
      won = 0;
    for (let i = 0; i < dates.length; i++) {
      const r = places[i];
      played = r === undefined ? 0 : played + 1;
      won = r === 1 ? won + 1 : 0;
      s.playedRun = Math.max(s.playedRun, played);
      s.winRun = Math.max(s.winRun, won);
      if (r === undefined) continue;
      s.played++;
      if (r === 1) s.gold++;
      if (r === 2) s.silver++;
      if (r === 3) s.bronze++;
      if (r <= 3) s.podiums++;
      if (r <= 10) s.top10++;
    }
    return s;
  });
  players.sort(medalOrder);
  const records = RECORDS.map(([key, value]): DailyRecord => {
    const ranked = players.filter((s) => value(s) > 0).sort((a, b) => value(b) - value(a));
    const holders = ranked.slice(0, 3).map((s) => ({
      steamId: s.steamId,
      persona: s.persona,
      avatar: s.avatar,
      value: value(s),
      place: 1 + ranked.filter((o) => value(o) > value(s)).length,
    }));
    const last = holders.at(-1);
    const more = last ? ranked.slice(3).filter((s) => value(s) === last.value).length : 0;
    return { key, holders, more };
  });
  return { dailies: dates.length, since: dates.at(0) ?? null, players, records };
}

/* the line under a record card's plate: the record's holder, or each of those sharing it,
   how far the rest are behind it, and on the last plate how many more share its value */
export function recordLine({ holders, more }: DailyRecord, i: number) {
  const lead = holders.at(0)?.value ?? 0;
  const h = holders.at(i);
  if (!h) return "";
  const line =
    h.value < lead
      ? `${String(lead - h.value)} behind`
      : holders.filter((o) => o.value === lead).length > 1
        ? "shares the record"
        : "holds the record";
  return i === holders.length - 1 && more > 0 ? `${line} · ${String(more)} more` : line;
}

/* the medal table's columns, each a count it can be sorted on */
export const MEDAL_COLUMNS = ["gold", "silver", "bronze", "podiums", "top10", "played"] as const;
export type MedalColumn = (typeof MEDAL_COLUMNS)[number];

/* The medal table sorted on one column, medal order breaking ties; rows equal on every
   count share a rank. It lists the players with a podium, or with any count in the
   column when that is Top 10 or Played, so a player with a single time far down a board
   is in the table only when the reader sorts by what they have. */
export function medalTable(players: ReadonlyArray<DailyStanding>, by: MedalColumn) {
  const shown = players
    .filter((s) => (by === "played" || by === "top10" ? s[by] > 0 : s.podiums > 0))
    .sort((a, b) => b[by] - a[by] || medalOrder(a, b));
  const same = (a: DailyStanding, b: DailyStanding) =>
    a[by] === b[by] &&
    a.gold === b.gold &&
    a.silver === b.silver &&
    a.bronze === b.bronze &&
    a.played === b.played;
  const rows: Array<{ rank: number; s: DailyStanding }> = [];
  shown.forEach((s, i) => {
    const prev = rows.at(-1);
    rows.push({ rank: prev && same(prev.s, s) ? prev.rank : i + 1, s });
  });
  return rows;
}

/* A place on a Daily counts as a win or a podium only once the Daily is final: until a read
   after its close, the place can still change. The player's tab, its calendar's bands and
   the standings all count it this way. */
const settled = (p: { rank: number; final: boolean }, top: number) => p.final && p.rank <= top;

/* A player's Daily record from every Daily (oldest first) and the ones they have a time on:
   their wins and podiums on final Dailies, and their runs of Dailies played (runsOf) */
export function playerDailiesOf(
  days: ReadonlyArray<{ date: string; final: boolean }>,
  played: Array<PlayerDaily>,
): PlayerDailies {
  return {
    played,
    won: played.filter((p) => settled(p, 1)).length,
    podiums: played.filter((p) => settled(p, 3)).length,
    ...runsOf(days, new Set(played.map((p) => p.date))),
  };
}

/* A player's runs of Dailies played one after another, in date order: the longest, and the
   one going now. The newest Daily, while no read after its close has made it final, ends no
   run: played, it counts; not played yet, the run going now is the one up to the day before. */
function runsOf(
  days: ReadonlyArray<{ date: string; final: boolean }>,
  played: ReadonlySet<string>,
) {
  let longest = 0,
    run = 0;
  for (const d of days) {
    run = played.has(d.date) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const newest = days.at(-1);
  if (newest && !newest.final && !played.has(newest.date)) {
    run = 0;
    for (const d of days.slice(0, -1).reverse()) {
      if (!played.has(d.date)) break;
      run++;
    }
  }
  return { longest, current: run };
}

/* how a place on a Daily reads on a player's calendar: 1st, the podium, the top 10, or
   played; a Daily not final yet shows only that they played it */
export const bandOf = (p: { rank: number; final: boolean }) =>
  settled(p, 1) ? "1" : settled(p, 3) ? "pod" : settled(p, 10) ? "t10" : "in";
