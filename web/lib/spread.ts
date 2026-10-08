// How every run on a board spreads out, as the Spread chart draws it (components/board/
// Spread.tsx), and where You's run lands on that chart. The page works the chart out on
// the server, so only its columns, not every run, reach the browser.
import { medalTicks } from "./rules";

/* a chart's range in score ticks: the record at its left edge, `hi` at its right */
export interface SpreadRange {
  lo: number;
  hi: number;
}

/* the chart: how many runs fall in each of its columns, and how many are past its right
   edge */
export interface SpreadScale extends SpreadRange {
  bins: Array<number>;
  over: number;
}

/* every run on a board, charted: all the Spread chart draws from. `scale` is null with
   fewer than two runs; `medals` and `wide` are what spreadOf was given, for the cut-off
   lines and the chart's size */
export interface SpreadChart {
  runs: number;
  scale: SpreadScale | null;
  medals: ReadonlyArray<number>;
  wide: boolean;
}

/* `ts` is the run times in rank order, `medals` [bronze, silver, gold, author] in seconds.
   On a Map's panel the slowest twentieth is left off the right edge, or one abandoned run
   would squash the rest into a single column. `wide` is a Circuit Track's card: the chart
   runs to just past Bronze, in more columns. */
export function spreadOf(
  ts: ReadonlyArray<number>,
  medals: ReadonlyArray<number>,
  wide: boolean,
): SpreadChart {
  if (ts.length < 2) return { runs: ts.length, scale: null, medals, wide };
  const lo = ts[0];
  const cut = wide
    ? medalTicks(medals, 0) * 1.08
    : ts[Math.min(ts.length - 1, Math.floor(ts.length * 0.95))];
  const hi = Math.max(cut, lo + 1);
  const bins = new Array<number>(wide ? 44 : 24).fill(0);
  let over = 0;
  for (const t of ts) {
    if (t > hi) over++;
    else bins[Math.min(bins.length - 1, Math.floor(((t - lo) / (hi - lo)) * bins.length))]++;
  }
  return { runs: ts.length, scale: { lo, hi, bins, over }, medals, wide };
}

/* where a run lands across the chart, 0 at the record and 1 at the right edge, and whether
   it is past that edge (it is then drawn at the edge, with an arrow) */
export function markOn({ lo, hi }: SpreadRange, score: number): { at: number; past: boolean } {
  return { at: Math.min(Math.max((score - lo) / (hi - lo), 0), 1), past: score > hi };
}
