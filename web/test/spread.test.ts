// How every run on a board spreads out (lib/spread.ts), and where You's run lands on it:
// every expected value is worked out by hand from the runs in each case.
import { describe, expect, test } from "vitest";

import { markOn, spreadOf } from "../lib/spread";

/* a chart from the record at 10 s to its right edge at 20 s, in score ticks */
const CHART = { lo: 1_000_000, hi: 2_000_000 };

describe("You's run on the chart", () => {
  test("a run inside the chart lands at its share of the way across", () => {
    expect(markOn(CHART, 1_250_000)).toEqual({ at: 0.25, past: false });
  });

  test("a run slower than the right edge is held at the edge and marked past it", () => {
    expect(markOn(CHART, 3_500_000)).toEqual({ at: 1, past: true });
  });

  test("a run exactly at the right edge is on the chart", () => {
    expect(markOn(CHART, 2_000_000)).toEqual({ at: 1, past: false });
  });

  test("a run faster than the chart's record is held at the left edge", () => {
    expect(markOn(CHART, 900_000)).toEqual({ at: 0, past: false });
  });
});

/* a Map's Medals, [bronze, silver, gold, author] in seconds */
const MEDALS = [30, 20, 15, 10];

describe("the chart of every run", () => {
  test("with fewer than two runs there is nothing to chart, only the count", () => {
    expect(spreadOf([], MEDALS, false)).toMatchObject({ runs: 0, scale: null });
    expect(spreadOf([1_000_000], MEDALS, true)).toMatchObject({ runs: 1, scale: null });
  });

  test("a Map's panel runs to the 95th percentile run, in 24 columns", () => {
    /* 21 runs: the one at index floor(21 × 0.95) = 19 is the right edge, 3400, so the
       columns are (3400 − 1000) / 24 = 100 ticks wide and the 9000 is past the edge */
    const ts = [1000, 1050, 1100, 1500, 1550, 1599, ...Array<number>(13).fill(2000), 3400, 9000];
    const bins = Array<number>(24).fill(0);
    bins[0] = 2;
    bins[1] = 1;
    bins[5] = 3;
    bins[10] = 13;
    bins[23] = 1; /* the edge itself falls in the last column */
    expect(spreadOf(ts, MEDALS, false)).toEqual({
      runs: 21,
      scale: { lo: 1000, hi: 3400, bins, over: 1 },
      medals: MEDALS,
      wide: false,
    });
  });

  test("a Track's card runs 8% past Bronze, in 44 columns, whatever the slowest run", () => {
    /* Bronze 30 s puts the edge at 32.4 s; a 20 s run is (20 − 10) / (32.4 − 10) × 44 =
       19.6 columns in, and the 40 s run is past the edge */
    const bins = Array<number>(44).fill(0);
    bins[0] = 1;
    bins[19] = 1;
    expect(spreadOf([1_000_000, 2_000_000, 4_000_000], MEDALS, true)).toEqual({
      runs: 3,
      scale: { lo: 1_000_000, hi: expect.closeTo(3_240_000) as number, bins, over: 1 },
      medals: MEDALS,
      wide: true,
    });
  });
});
