// Where You stand on a board (lib/standing.ts): every expected value is worked out by hand
// from the board facts in each case.
import { describe, expect, test } from "vitest";

import { standingOn } from "../lib/standing";

/* a Map's Medals, [bronze, silver, gold, author] in seconds */
const MAP = { name: "Workshop_9000000001", field: 20, lead: 1_900_000, medals: [40, 30, 25, 20] };

describe("standing on a time board with Medals", () => {
  test("a Gold run: its place, its gap to the record, and the bar toward Author", () => {
    expect(standingOn(MAP, { rank: 5, score: 2_300_000 })).toEqual({
      place: 5,
      field: 20,
      points: false,
      gap: 400_000,
      medal: "gold",
      /* 0.3 s off Author's 20 s, two fifths of the way from Gold's 25 s */
      next: { medal: "Author", by: 300_000, progress: 0.4 },
    });
  });

  test("a Silver run chases Gold, from Silver's target", () => {
    expect(standingOn(MAP, { rank: 9, score: 2_600_000 })).toMatchObject({
      medal: "silver",
      /* 1 s off Gold's 25 s, four fifths of the way from Silver's 30 s */
      next: { medal: "Gold", by: 100_000, progress: 0.8 },
    });
  });

  test("a Bronze run chases Silver, from Bronze's target", () => {
    expect(standingOn(MAP, { rank: 14, score: 3_750_000 })).toMatchObject({
      medal: "bronze",
      /* 7.5 s off Silver's 30 s, a quarter of the way from Bronze's 40 s */
      next: { medal: "Silver", by: 750_000, progress: 0.25 },
    });
  });

  test("a run with no Medal chases Bronze, with the bar starting at 1.5x Bronze", () => {
    expect(standingOn(MAP, { rank: 18, score: 5_000_000 })).toMatchObject({
      medal: "none",
      /* 10 s off Bronze's 40 s, halfway from 60 s */
      next: { medal: "Bronze", by: 1_000_000, progress: 0.5 },
    });
  });

  test("a run slower than 1.5x Bronze shows an empty bar, not a negative one", () => {
    expect(standingOn(MAP, { rank: 20, score: 7_000_000 }).next).toEqual({
      medal: "Bronze",
      by: 3_000_000,
      progress: 0,
    });
  });

  test("a run that holds Author has no next Medal", () => {
    expect(standingOn(MAP, { rank: 2, score: 1_950_000 })).toMatchObject({
      gap: 50_000,
      medal: "author",
      next: null,
    });
  });

  test("a run exactly on a target holds that Medal", () => {
    expect(standingOn(MAP, { rank: 7, score: 2_500_000 })).toMatchObject({
      medal: "gold",
      next: { medal: "Author", by: 500_000, progress: 0 },
    });
  });
});

describe("the record", () => {
  test("rank 1 holds the world record, with no gap", () => {
    expect(standingOn(MAP, { rank: 1, score: 1_900_000 })).toEqual({
      place: 1,
      field: 20,
      points: false,
      gap: 0,
      medal: "wr",
      next: null,
    });
  });

  test("a record slower than Author still has Author to chase", () => {
    const slow = { ...MAP, field: 1, lead: 2_100_000 };
    expect(standingOn(slow, { rank: 1, score: 2_100_000 })).toMatchObject({
      gap: 0,
      medal: "wr",
      /* 1 s off Author's 20 s, four fifths of the way from Gold's 25 s */
      next: { medal: "Author", by: 100_000, progress: 0.8 },
    });
  });
});

describe("boards without Medals", () => {
  test("a points board: the gap counts down from the leader's points, and no Medal", () => {
    const overall = { name: "OverallLeaderboard_EASeason2", field: 4, lead: 1450, medals: null };
    expect(standingOn(overall, { rank: 3, score: 1200 })).toEqual({
      place: 3,
      field: 4,
      points: true,
      gap: 250,
      medal: null,
      next: null,
    });
  });

  test("a Track missing from the Track table has a place and a gap, but no Medal", () => {
    const track = { name: "Map_Track99", field: 6, lead: 1_013_307, medals: null };
    expect(standingOn(track, { rank: 4, score: 1_100_000 })).toEqual({
      place: 4,
      field: 6,
      points: false,
      gap: 86_693,
      medal: null,
      next: null,
    });
  });

  test("a Map that published no Medal times is read as having none", () => {
    const bare = { ...MAP, medals: [0, 0, 0, 0] };
    expect(standingOn(bare, { rank: 3, score: 2_000_000 })).toMatchObject({
      medal: null,
      next: null,
    });
  });
});
