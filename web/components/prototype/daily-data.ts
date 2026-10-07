// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// The 48 Dailies read from Steam on 2026-10-06, frozen in web/prototype/daily-fixture.json.
import fixture from "../../prototype/daily-fixture.json";

export type DEntry = [rank: number, steamId: string, persona: string, score: number];
export interface Daily {
  date: string;
  pfid: string;
  title: string;
  startsAt: number;
  endsAt: number;
  entries: Array<DEntry>;
}

const ALL: Array<Daily> = (
  fixture as unknown as Array<{
    date: string;
    published_file_id: string;
    level_display_name: string;
    starts_at: string;
    ends_at: string;
    entries: Array<DEntry>;
  }>
).map((d) => ({
  date: d.date,
  pfid: d.published_file_id,
  title: d.level_display_name,
  startsAt: Date.parse(d.starts_at),
  endsAt: Date.parse(d.ends_at),
  entries: d.entries,
}));

/* "quiet": today is 2026-10-06, still open with 64 times. "busy": pretend it is the evening
   of 2026-10-05, the busiest Daily, so today's board holds 271. */
export type DState = "quiet" | "busy";
export function dailiesFor(state: DState): { today: Daily; past: Array<Daily>; now: number } {
  const list = state === "busy" ? ALL.slice(0, -1) : ALL;
  const today = list[list.length - 1];
  const now =
    state === "busy"
      ? today.endsAt - (4 * 60 + 20) * 60_000
      : Math.min(Date.now(), today.endsAt - 60_000);
  return { today, past: list.slice(0, -1).reverse(), now };
}

export interface DStanding {
  steamId: string;
  persona: string;
  wins: number;
  podiums: number;
  top10: number;
  played: number;
  best: number;
}
/* every player over the closed Dailies: wins, podiums, top 10s and Dailies played */
export function standings(past: ReadonlyArray<Daily>): Array<DStanding> {
  const by = new Map<string, DStanding>();
  for (const d of past)
    for (const [rank, steamId, persona] of d.entries) {
      const s = by.get(steamId) ?? {
        steamId,
        persona,
        wins: 0,
        podiums: 0,
        top10: 0,
        played: 0,
        best: Infinity,
      };
      s.played++;
      if (rank === 1) s.wins++;
      if (rank <= 3) s.podiums++;
      if (rank <= 10) s.top10++;
      s.best = Math.min(s.best, rank);
      by.set(steamId, s);
    }
  return [...by.values()].sort(
    (a, b) => b.wins - a.wins || b.podiums - a.podiums || b.top10 - a.top10 || b.played - a.played,
  );
}

export const dayLabel = (d: Daily, opts: Intl.DateTimeFormatOptions = {}) =>
  new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...opts,
  });

export function left(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/* how many Dailies a player has a time on */
export const dailyCount = (id: string) =>
  ALL.filter((d) => d.entries.some((e) => e[1] === id)).length;
