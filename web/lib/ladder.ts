// What /you shows of one Workshop standing, over the lists GET /api/standings serves
// (lib/workshop-standings.ts counts them): the ladder card's rows (the top 3, then You and
// the players around You), the line under the card, the slices "Show all" reads, and how a
// shared place reads. A player whose count is 0 now has dropped off the list: the payload
// keeps them only for the baseline's places.
import type { StandingsStat, WorkshopStandings } from "./rows";
import { fmtN, ord, personaOf, plural } from "./rules";

/* one player on a list, as a ladder draws them */
export interface LadderRow {
  steamId: string;
  persona: string;
  /* the count now */
  n: number;
  /* the count now less the count at the baseline */
  gain: number;
  /* the shared place now: 1 + the players with a strictly higher count */
  place: number;
  /* another player holds the same place */
  shared: boolean;
  /* places climbed since the baseline (negative: dropped), or null for a player who wasn't
     on the list then */
  move: number | null;
}

/* what the line under a card says: how many more pass the player listed above You, a
   leader's margin (or, level with another for the lead, what leads alone), or what gets
   You on the list */
export type Chase =
  | { to: "pass"; more: number; persona: string }
  | { to: "lead"; by: number }
  | { to: "outright" }
  | { to: "alone" }
  | { to: "join" };

/* one card: its rows, null for the gap between the top 3 and You's neighbourhood */
export interface Ladder {
  /* the players on the list now */
  total: number;
  rows: Array<LadderRow | null>;
  /* You's row, or null when You aren't on the list (or nobody is signed in) */
  you: LadderRow | null;
  chase: Chase;
}

/* the four lists in the order /you shows them, and each one's title */
export const STANDINGS_STATS: ReadonlyArray<StandingsStat> = ["played", "author", "wr", "top5"];
export const isStandingsStat = (s: unknown): s is StandingsStat =>
  STANDINGS_STATS.includes(s as StandingsStat);
export const STANDINGS_TITLE: Record<StandingsStat, string> = {
  played: "Most Maps played",
  author: "Most Author Medals",
  wr: "Most world records",
  top5: "Most top 5s",
};

/* You's four cards, as GET /api/standings?ladders serves them */
export interface YouLadders {
  /* when the latest Refresh finished, and the baseline the gains and moves are from */
  readAt: string | null;
  since: string;
  lists: Record<StandingsStat, Ladder>;
}

export const laddersOf = (s: WorkshopStandings, you: string | null): YouLadders => ({
  readAt: s.readAt,
  since: s.since,
  lists: Object.fromEntries(STANDINGS_STATS.map((k) => [k, ladderOf(s, k, you)])) as Record<
    StandingsStat,
    Ladder
  >,
});

/* each list's noun, one and many */
export const STANDINGS_NOUN: Record<StandingsStat, [string, string]> = {
  played: ["Map", "Maps"],
  author: ["Author Medal", "Author Medals"],
  wr: ["world record", "world records"],
  top5: ["top 5", "top 5s"],
};

const TOP = 3,
  ABOVE = 2,
  BELOW = 1,
  /* the top 5 run on unbroken when You are in or near them */
  UNBROKEN = 5;

/* the list's rows with a count now, in listing order */
function rowsOf(s: WorkshopStandings, stat: StandingsStat): Array<LadderRow> {
  const list = s.lists[stat].filter((r) => r[1] > 0);
  const atPlace = new Map<number, number>();
  for (const r of list) atPlace.set(r[3], (atPlace.get(r[3]) ?? 0) + 1);
  return list.map(([i, n, then, place, placeThen]) => ({
    steamId: s.players[i][0],
    persona: personaOf({ steamId: s.players[i][0], persona: s.players[i][1] }),
    n,
    gain: n - then,
    place,
    shared: (atPlace.get(place) ?? 0) > 1,
    move: then > 0 ? placeThen - place : null,
  }));
}

/* The card for `you` (a Steam ID, or null): the top 3, a gap, two above You, You and one
   below; from 1st down past You, unbroken, when the gap would hide no more than one row */
export function ladderOf(s: WorkshopStandings, stat: StandingsStat, you: string | null): Ladder {
  const all = rowsOf(s, stat);
  const i = you === null ? -1 : all.findIndex((r) => r.steamId === you);
  let rows: Array<LadderRow | null>;
  if (i < 0) rows = all.slice(0, TOP);
  else if (i - ABOVE <= TOP + 1) rows = all.slice(0, Math.max(UNBROKEN, i + 1 + BELOW));
  else rows = [...all.slice(0, TOP), null, ...all.slice(i - ABOVE, i + 1 + BELOW)];
  return { total: all.length, rows, you: i < 0 ? null : all[i], chase: chaseOf(all, i) };
}

/* `count` rows of the list from `from` (0-based), for "Show all", and how many are on it */
export function sliceOf(
  s: WorkshopStandings,
  stat: StandingsStat,
  from: number,
  count: number,
): { total: number; rows: Array<LadderRow> } {
  const all = rowsOf(s, stat);
  return { total: all.length, rows: all.slice(from, from + count) };
}

/* a place as it reads on /you: "1st", or "=1,840th" when another player shares it */
export const placeText = (r: Pick<LadderRow, "place" | "shared">) =>
  (r.shared ? "=" : "") + fmtN(r.place) + ord(r.place).replace(/^\d+/, "");

function chaseOf(all: ReadonlyArray<LadderRow>, i: number): Chase {
  if (i < 0) return { to: "join" };
  const me = all[i];
  if (i > 0) return { to: "pass", more: all[i - 1].n - me.n + 1, persona: all[i - 1].persona };
  if (all.length === 1) return { to: "alone" };
  const by = me.n - all[1].n;
  return by > 0 ? { to: "lead", by } : { to: "outright" };
}

/* the line under a card, in the list's own noun */
export function chaseText(stat: StandingsStat, c: Chase): string {
  const [one, many] = STANDINGS_NOUN[stat];
  switch (c.to) {
    case "pass":
      return `${plural(c.more, one, many)} more to pass ${c.persona}`;
    case "lead":
      return `You lead by ${plural(c.by, one, many)}`;
    case "outright":
      return `1 ${one} more to lead outright`;
    case "alone":
      return "You lead";
    case "join":
      return `1 ${one} to get on this list`;
  }
}
