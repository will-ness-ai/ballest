// Where You stand on one board: your place in its field, the Medal you hold and the next
// one up. The banner above a board's plates is markup over what standingOn returns.
import {
  MEDALS,
  earns,
  isPoints,
  medalOf,
  medalTicks,
  type MedalKey,
  type TargetMedal,
} from "./rules";

export interface BoardFacts {
  name: string;
  /* how many the board ranks */
  field: number;
  /* [bronze, silver, gold, author] in seconds, or null for a board with none (an Overall
     board, a Track missing from the Track table) */
  medals: ReadonlyArray<number> | null;
}

export interface YourRow {
  rank: number;
  score: number;
}

export interface Standing {
  place: number;
  field: number;
  points: boolean;
  /* through medalOf, so rank 1 is "wr"; null on a board with no Medals */
  medal: MedalKey | null;
  /* the next Medal up: how far off it you are, and the bar's progress (0..1) from the Medal
     you hold to it, or from 1.5x Bronze when you hold none; null when you hold Author */
  next: { medal: TargetMedal; by: number; progress: number } | null;
}

/* how far below Bronze the bar starts for a run that holds no Medal */
const NO_MEDAL_FROM = 1.5;

export function standingOn(board: BoardFacts, row: YourRow): Standing {
  const medals = medalsOn(board);
  return {
    place: row.rank,
    field: board.field,
    points: isPoints(board.name),
    medal: medals ? medalOf(medals, row.rank, row.score) : null,
    next: medals ? nextMedal(medals, row.score) : null,
  };
}

/* the board's Medal targets, when a time on it can earn one: a time board with four
   positive targets. Anything else (a points board, a Map that published none) has no
   Medal and no bar */
export function medalsOn(board: BoardFacts): ReadonlyArray<number> | null {
  const m = board.medals;
  return !isPoints(board.name) && m?.length === 4 && m.every((s) => s > 0) ? m : null;
}

/* the first Medal up from Bronze that the time doesn't earn. The world record is no target
   here, so a record slower than Author still chases Author */
function nextMedal(medals: ReadonlyArray<number>, score: number): Standing["next"] {
  const up = [...MEDALS].reverse();
  const at = up.findIndex(([, , i]) => !earns(medals, i, score));
  if (at < 0) return null;
  const [, , i, medal] = up[at];
  const to = medalTicks(medals, i);
  const from = at > 0 ? medalTicks(medals, up[at - 1][2]) : medalTicks(medals, 0) * NO_MEDAL_FROM;
  const progress = from > to ? Math.min(1, Math.max(0, (from - score) / (from - to))) : 0;
  return { medal, by: score - to, progress };
}
