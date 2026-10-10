// The race drawer's math (lib/race.ts) on hand-made profiles: four points each, so a run's
// time at each quarter of its path.
import { describe, expect, test } from "vitest";

import { gapAtLine, gaps, raceEnd, reached, timeAt } from "../lib/race";

const leader = [1, 2, 3, 4];
const run = [0.5, 1.5, 3.5, 5];

describe("the race", () => {
  test("the gap at each point is this run's time less the rival's", () => {
    expect(gaps(run, leader)).toEqual([-0.5, -0.5, 0.5, 1]);
    expect(gapAtLine(run, leader)).toBe(1);
  });

  test("a race lasts until the slower run finishes", () => {
    expect(raceEnd(run, leader)).toBe(5);
    expect(raceEnd(leader, run)).toBe(5);
  });

  test("how far a run has reached at a race time", () => {
    expect(reached(leader, 0)).toBe(0);
    expect(reached(leader, 0.5)).toBe(0.125);
    expect(reached(leader, 2)).toBe(0.5);
    expect(reached(run, 2.5)).toBe(0.625);
    expect(reached(leader, 9)).toBe(1);
  });

  test("the time a run reached a point of its path", () => {
    expect(timeAt(leader, 0)).toBe(0);
    expect(timeAt(leader, 0.125)).toBe(0.5);
    expect(timeAt(run, 0.625)).toBe(2.5);
    expect(timeAt(run, 1.5)).toBe(5);
  });

  test("reached and timeAt undo each other", () => {
    for (const t of [0.2, 1.7, 3.9]) expect(timeAt(run, reached(run, t))).toBeCloseTo(t);
  });
});
