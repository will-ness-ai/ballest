// Where You stand on one board: your place in its field, how far off the record you are,
// the Medal you hold and the next one up. The banner above a board's plates is markup over
// what standingOn returns.
import { MEDALS, SCORE_TICKS_PER_SECOND, isPoints, medalOf, type MedalKey } from "./rules";

export interface BoardFacts {
  name: string;
  /* how many the board ranks */
  field: number;
  /* the leader's score, or null on an empty board */
  lead: number | null;
  /* [bronze, silver, gold, author] in seconds, or null for a board with none (an Overall
     board, a Track missing from the Track table) */
  medals: ReadonlyArray<number> | null;
}

export interface YourRow {
  rank: number;
  score: number;
}

export type MedalName = (typeof MEDALS)[number][0];

export interface Standing {
  place: number;
  field: number;
  points: boolean;
  /* to the record, in the board's unit; 0 at rank 1 */
  gap: number;
  /* through medalOf, so rank 1 is "wr"; null on a board with no Medals */
  medal: MedalKey | null;
  /* the next Medal up: how far off it you are, and the bar's progress (0..1) from the Medal
     you hold to it, or from 1.5x Bronze when you hold none; null when you hold Author */
  next: { medal: MedalName; by: number; progress: number } | null;
}

/* how far below Bronze the bar starts for a run that holds no Medal */
const NO_MEDAL_FROM = 1.5;

export function standingOn(board: BoardFacts, row: YourRow): Standing {
  const points = isPoints(board.name);
  const gap = board.lead == null ? 0 : points ? board.lead - row.score : row.score - board.lead;
  const medals = !points && hasMedals(board.medals) ? board.medals : null;
  return {
    place: row.rank,
    field: board.field,
    points,
    gap: Math.max(0, gap),
    medal: medals ? medalOf(medals, row.rank, row.score) : null,
    next: medals ? nextMedal(medals, row.score) : null,
  };
}

/* a list of four positive targets; anything else (a Map that published none) has no bar */
function hasMedals(m: ReadonlyArray<number> | null): m is ReadonlyArray<number> {
  return m?.length === 4 && m.every((s) => s > 0);
}

function nextMedal(medals: ReadonlyArray<number>, score: number): Standing["next"] {
  const ticks = (i: number) => medals[i] * SCORE_TICKS_PER_SECOND;
  /* Bronze first: the first target the run misses is the next one up */
  const up = [...MEDALS].reverse();
  const at = up.findIndex(([, , i]) => score > ticks(i));
  if (at < 0) return null;
  const [medal, , i] = up[at];
  const to = ticks(i);
  const from = at > 0 ? ticks(up[at - 1][2]) : ticks(0) * NO_MEDAL_FROM;
  const progress = from > to ? Math.min(1, Math.max(0, (from - score) / (from - to))) : 0;
  return { medal, by: score - to, progress };
}
