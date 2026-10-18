// The lead through a Daily (spec #268): who led after each read of its board, kept in the bot's
// SQLite, and the thread line each change of leader gets. Pure, so the schedule and the tests
// say exactly the same. A lead held by one player is a Reign (CONTEXT.md): it runs from the read
// that saw it start to the read that saw a faster time take it, through the holder's own faster
// times, and a matched time does not start a new one.
import { escape } from "../report/messages.js";
import { type BoardRead, dailyTime, millis, sameTime } from "./card.js";

/** The lead as one read saw it: every name on the fastest time, in board order. */
export interface Lead {
  readonly at: number;
  readonly leaders: ReadonlyArray<string>;
  readonly ticks: number;
}

/** The lead a read shows, or null while the board has no times. */
export const leadOf = (board: BoardRead, at: number): Lead | null => {
  const first = board.top[0];
  if (first === undefined) return null;
  const leaders = board.top.filter((e) => sameTime(e.ticks, first.ticks)).map((e) => e.name);
  return { at, leaders, ticks: first.ticks };
};

/**
 * Whether `next` is worth recording after `last`: a new leading time as shown, or a new set of
 * leaders (Steam may list a tie in either order).
 */
export const leadChanged = (last: Lead | undefined, next: Lead): boolean =>
  last === undefined ||
  !sameTime(last.ticks, next.ticks) ||
  last.leaders.length !== next.leaders.length ||
  last.leaders.some((name) => !next.leaders.includes(name));

const bold = (s: string) => `**${escape(s)}**`;
const names = (list: ReadonlyArray<string>) => list.map(bold).join(" & ");

/** "3h 12m", "46m", "6h". */
const held = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/** The gap between two times as the site would show them: "0.034". */
const gap = (from: number, to: number) => ((millis(from) - millis(to)) / 1000).toFixed(3);

/** When the Reign of anyone in `leaders` began: the earliest read in the run they led through. */
const reignStart = (history: ReadonlyArray<Lead>, leaders: ReadonlyArray<string>) => {
  let start = history.at(-1)?.at ?? 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const lead = history[i];
    if (!lead?.leaders.some((n) => leaders.includes(n))) break;
    start = lead.at;
  }
  return start;
};

/**
 * The thread line for the lead going from the last of `history` to `next`, or null when no one
 * new leads (the leader beat their own time, or a tied leader left). Several changes between two
 * reads are seen as one: the line names only the latest leader. `byRefresh`: the lead was rebuilt
 * from the leaderboard database (the backfill), so the line says which Refresh first saw it.
 */
export const leadLine = (
  history: ReadonlyArray<Lead>,
  next: Lead,
  seen: "read" | "byRefresh" = "read",
): string | null => {
  const last = history.at(-1);
  const time = `<t:${Math.floor(next.at / 1000)}:t>`;
  const at = `-# ${seen === "read" ? time : `by the ${time} Refresh`} · `;
  if (last === undefined)
    return `${at}🏁 ${names(next.leaders)} ${next.leaders.length === 1 ? "sets" : "set"} the first time: ${bold(dailyTime(next.ticks))}`;
  const joined = next.leaders.filter((n) => !last.leaders.includes(n));
  const tie = () =>
    joined.length === 0
      ? null
      : `${at}🤝 ${names(joined)} ${joined.length === 1 ? "ties" : "tie"} ${names(last.leaders)} for the lead: ${bold(dailyTime(next.ticks))}`;
  if (sameTime(next.ticks, last.ticks)) return tie();
  if (millis(next.ticks) > millis(last.ticks)) return null;
  // A faster time: whoever led before and doesn't now has lost the lead to it. A leader who
  // still leads on a new best, matched in the same read, is tied.
  const lost = last.leaders.filter((n) => !next.leaders.includes(n));
  if (lost.length === 0) return tie();
  const takers = next.leaders.filter((n) => !lost.includes(n));
  return `${at}🏁 ${names(takers)} ${takers.length === 1 ? "takes" : "take"} the lead from ${names(lost)}, who held it for ${held(next.at - reignStart(history, lost))} · ${dailyTime(last.ticks)} → ${bold(dailyTime(next.ticks))} (−${gap(last.ticks, next.ticks)} s)`;
};
